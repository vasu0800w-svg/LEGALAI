import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

initializeApp();

const otpDb = () => getFirestore(getApp(), 'legal');
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;

const hashCode = (salt, code) =>
  createHash('sha256').update(`${salt}:${code}`).digest('hex');

const newCode = () => String(randomInt(0, 1000000)).padStart(6, '0');

const hashesMatch = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

const sendCasemateMail = async ({ to, name, code }) => {
  const serviceId = process.env.EMAILJS_SERVICE_ID || '';
  const templateId = process.env.EMAILJS_TEMPLATE_ID || '';
  const publicKey = process.env.EMAILJS_PUBLIC_KEY || '';
  if (!serviceId || !templateId || !publicKey) {
    throw Object.assign(new Error('Email is not configured.'), { status: 503 });
  }
  const who = name || 'Advocate';
  const line = `Your verification code is ${code}`;
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://meetcasemate.com',
      Referer: 'https://meetcasemate.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        email: to,
        to_email: to,
        name: `${who}. ${line}`,
        to_name: `${who}. ${line}`,
        from_name: `casemate ${code}`,
        from_email: 'meetcasemate@gmail.com',
        reply_to: 'meetcasemate@gmail.com',
        subject: line,
        title: line,
        message: `${line}\n\nThis code expires in 10 minutes.\n\nIf you did not request it, ignore this email.`,
        content: line,
        code,
        otp: code,
        passcode: code,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[authOtp] email send failed', res.status, text.slice(0, 180));
    throw Object.assign(new Error('Could not send the email.'), { status: 502 });
  }
};

const clientIp = (req) => {
  const forwarded = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || String(req.ip || 'unknown').slice(0, 64);
};

const limitOtpIp = async (req, action) => {
  const ip = clientIp(req);
  const id = createHash('sha256').update(`${action}:${ip}`).digest('hex').slice(0, 40);
  const ref = otpDb().collection('auth_otp_limits').doc(id);
  await otpDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const started = Number(snap.get('startedAt') || 0);
    const count = Number(snap.get('count') || 0);
    const next = started && now - started < windowMs ? count + 1 : 1;
    if (next > 8) {
      throw Object.assign(new Error('Please wait before requesting another code.'), { status: 429 });
    }
    tx.set(ref, {
      startedAt: next === 1 ? now : started,
      count: next,
      updatedAt: now,
    });
  });
};

const bearerUser = async (req) => {
  const header = String(req.get('authorization') || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  return getAuth().verifyIdToken(token);
};

const issueCode = async (docId, salt, email) => {
  const ref = otpDb().collection('auth_otps').doc(docId);
  const code = newCode();
  await otpDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const sentAt = Number(snap.get('sentAt') || 0);
    if (sentAt && Date.now() - sentAt < RESEND_MS) {
      throw Object.assign(new Error('Please wait a minute before requesting another code.'), { status: 429 });
    }
    tx.set(ref, {
      codeHash: hashCode(salt, code),
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      sentAt: Date.now(),
      email,
    });
  });
  return { ref, code };
};

const checkCode = async (docId, salt, code) => {
  const ref = otpDb().collection('auth_otps').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw Object.assign(new Error('That code is wrong or expired.'), { status: 400 });
  }
  const data = snap.data() || {};
  if (Number(data.expiresAt || 0) < Date.now() || Number(data.attempts || 0) >= 5) {
    await ref.delete().catch(() => {});
    throw Object.assign(new Error('That code is wrong or expired.'), { status: 400 });
  }
  if (!hashesMatch(data.codeHash, hashCode(salt, code))) {
    const attempts = Number(data.attempts || 0) + 1;
    if (attempts >= 5) await ref.delete().catch(() => {});
    else await ref.set({ attempts }, { merge: true });
    throw Object.assign(new Error('That code is wrong or expired.'), { status: 400 });
  }
  await ref.delete().catch(() => {});
};

export const authOtp = onRequest(
  { region: 'asia-south1', cors: true, invoker: 'public', maxInstances: 3 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'METHOD' });
      return;
    }
    const action = String(req.body?.action || '');
    try {
      if (action === 'send-email') {
        await limitOtpIp(req, 'send-email');
        const user = await bearerUser(req);
        if (!user?.uid || !user.email) {
          res.status(401).json({ error: 'AUTH', message: 'Sign in required.' });
          return;
        }
        const record = await getAuth().getUser(user.uid);
        if (record.emailVerified) {
          res.json({ ok: true, alreadyVerified: true });
          return;
        }
        const { ref, code } = await issueCode(`verify_${user.uid}`, user.uid, user.email);
        try {
          await sendCasemateMail({
            to: user.email,
            name: record.displayName || 'Advocate',
            code,
          });
        } catch (err) {
          await ref.delete().catch(() => {});
          throw err;
        }
        res.json({ ok: true });
        return;
      }

      if (action === 'verify-email') {
        const user = await bearerUser(req);
        const code = String(req.body?.code || '').replace(/\D/g, '');
        if (!user?.uid) {
          res.status(401).json({ error: 'AUTH', message: 'Sign in required.' });
          return;
        }
        if (code.length !== 6) {
          res.status(400).json({ error: 'CODE', message: 'Enter the 6-digit code.' });
          return;
        }
        await checkCode(`verify_${user.uid}`, user.uid, code);
        await getAuth().updateUser(user.uid, { emailVerified: true });
        res.json({ ok: true });
        return;
      }

      if (action === 'send-reset') {
        await limitOtpIp(req, 'send-reset');
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
          res.status(400).json({ error: 'EMAIL', message: 'Enter a valid email address.' });
          return;
        }
        let record = null;
        try {
          record = await getAuth().getUserByEmail(email);
        } catch (err) {
          if (err?.code !== 'auth/user-not-found') throw err;
        }
        if (!record) {
          res.json({ ok: true });
          return;
        }
        const salt = createHash('sha256').update(email).digest('hex');
        const { ref, code } = await issueCode(`reset_${salt}`, salt, email);
        try {
          await sendCasemateMail({
            to: email,
            name: record.displayName || 'Advocate',
            code,
          });
        } catch (err) {
          await ref.delete().catch(() => {});
          throw err;
        }
        res.json({ ok: true });
        return;
      }

      if (action === 'confirm-reset') {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const code = String(req.body?.code || '').replace(/\D/g, '');
        const password = String(req.body?.password || '');
        if (!email || code.length !== 6) {
          res.status(400).json({ error: 'CODE', message: 'That code is wrong or expired.' });
          return;
        }
        if (password.length < 6) {
          res.status(400).json({ error: 'PASSWORD', message: 'Use at least 6 characters.' });
          return;
        }
        let record = null;
        try {
          record = await getAuth().getUserByEmail(email);
        } catch (err) {
          if (err?.code !== 'auth/user-not-found') throw err;
        }
        if (!record) {
          res.status(400).json({ error: 'CODE', message: 'That code is wrong or expired.' });
          return;
        }
        const salt = createHash('sha256').update(email).digest('hex');
        await checkCode(`reset_${salt}`, salt, code);
        await getAuth().updateUser(record.uid, { password });
        res.json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'ACTION', message: 'Unknown request.' });
    } catch (err) {
      const status = Number(err?.status) || 500;
      console.error('[authOtp]', action, err?.code || err?.message || err);
      res.status(status).json({
        error: 'OTP',
        message: status === 500 ? 'Could not complete that request.' : (err?.message || 'Could not complete that request.'),
      });
    }
  }
);

export const verificationLink = onRequest(
  { region: 'asia-south1', cors: true, invoker: 'public', maxInstances: 2 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'METHOD' });
      return;
    }
    const header = String(req.get('authorization') || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'AUTH' });
      return;
    }
    try {
      const decoded = await getAuth().verifyIdToken(token);
      const email = String(decoded.email || '').trim();
      if (!email) {
        res.status(400).json({ error: 'EMAIL' });
        return;
      }
      const link = await getAuth().generateEmailVerificationLink(email, {
        url: 'https://meetcasemate.com',
        handleCodeInApp: false,
      });
      res.json({ link });
    } catch (err) {
      console.error('[verificationLink]', err?.code || err?.message || err);
      res.status(500).json({ error: 'LINK' });
    }
  }
);
