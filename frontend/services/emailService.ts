import emailjs from '@emailjs/browser';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getAppConfig } from './adminConfigService';
import { db } from './firebaseService';

type EmailKeys = {
  serviceId: string;
  publicKey: string;
  welcomeTemplateId: string;
  purchaseTemplateId: string;
  expiryTemplateId: string;
};

const envKeys = (): EmailKeys => ({
  serviceId: String((import.meta as any).env?.VITE_EMAILJS_SERVICE_ID || ''),
  publicKey: String((import.meta as any).env?.VITE_EMAILJS_PUBLIC_KEY || ''),
  welcomeTemplateId: String((import.meta as any).env?.VITE_EMAILJS_WELCOME_TEMPLATE_ID || ''),
  purchaseTemplateId: String(
    (import.meta as any).env?.VITE_EMAILJS_PURCHASE_TEMPLATE_ID ||
      (import.meta as any).env?.VITE_EMAILJS_TEMPLATE_ID ||
      ''
  ),
  expiryTemplateId: String(
    (import.meta as any).env?.VITE_EMAILJS_EXPIRY_TEMPLATE_ID ||
      (import.meta as any).env?.VITE_EMAILJS_TEMPLATE_ID ||
      ''
  ),
});

let cachedCloudKeys: Partial<EmailKeys> | null = null;

const resolveKeys = async (): Promise<EmailKeys> => {
  const base = envKeys();
  try {
    if (!cachedCloudKeys) {
      const cloud = await getAppConfig<Record<string, string>>('email_keys');
      if (cloud) {
        cachedCloudKeys = {
          serviceId: cloud.serviceId || cloud.emailServiceId,
          publicKey: cloud.publicKey || cloud.emailPublicKey,
          welcomeTemplateId: cloud.welcomeTemplateId,
          purchaseTemplateId: cloud.purchaseTemplateId,
          expiryTemplateId: cloud.expiryTemplateId,
        };
      } else {
        cachedCloudKeys = {};
      }
    }
  } catch {
    cachedCloudKeys = cachedCloudKeys || {};
  }

  return {
    serviceId: cachedCloudKeys?.serviceId || base.serviceId,
    publicKey: cachedCloudKeys?.publicKey || base.publicKey,
    welcomeTemplateId:
      (cachedCloudKeys?.welcomeTemplateId && cachedCloudKeys.welcomeTemplateId !== otpTemplateId()
        ? cachedCloudKeys.welcomeTemplateId
        : '') || base.welcomeTemplateId,
    purchaseTemplateId: cachedCloudKeys?.purchaseTemplateId || base.purchaseTemplateId,
    expiryTemplateId: cachedCloudKeys?.expiryTemplateId || base.expiryTemplateId,
  };
};

const APP_URL = 'https://meetcasemate.com';
const FROM_EMAIL = 'meetcasemate@gmail.com';

const sendCasemateEmail = async (opts: {
  templateId: string;
  toEmail: string;
  toName: string;
  subject: string;
  message: string;
  extra?: Record<string, string>;
}): Promise<boolean> => {
  const keys = await resolveKeys();
  if (!keys.serviceId || !keys.publicKey || !opts.templateId) {
    console.error('[Email] EmailJS configuration missing.');
    return false;
  }
  if (!opts.toEmail) return false;

  const toName = opts.toName || 'Advocate';
  await emailjs.send(
    keys.serviceId,
    opts.templateId,
    {
      // The EmailJS template's To field is {{email}}. to_email alone leaves it empty.
      email: opts.toEmail,
      to_email: opts.toEmail,
      user_email: opts.toEmail,
      name: toName,
      to_name: toName,
      from_name: 'casemate',
      from_email: FROM_EMAIL,
      reply_to: FROM_EMAIL,
      subject: opts.subject,
      message: opts.message,
      app_name: 'casemate',
      app_url: APP_URL,
      ...(opts.extra || {}),
    },
    keys.publicKey
  );
  return true;
};

const apiBase = () =>
  String((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

const verificationEndpoints = (): string[] => {
  const urls: string[] = [];
  const base = apiBase();
  if (base) urls.push(`${base}/api/verification-link`);
  urls.push('https://asia-south1-legalai-78759.cloudfunctions.net/verificationLink');
  return urls;
};

/** Real Firebase verify link for this signed-in account. */
export const fetchVerificationLink = async (idToken: string): Promise<string> => {
  if (!idToken) return '';
  for (const url of verificationEndpoints()) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (typeof data?.link === 'string' && data.link.startsWith('https://')) return data.link;
    } catch {
      /* try the next endpoint */
    }
  }
  return '';
};

const otpTemplateId = () => String((import.meta as any).env?.VITE_EMAILJS_TEMPLATE_ID || '');

/** The welcome template must be a different EmailJS template from the OTP mail. */
const distinctWelcomeTemplateId = (candidate?: string) => {
  const id = String(candidate || '').trim();
  if (!id || id === otpTemplateId()) return '';
  return id;
};

/** Welcome email. Uses the second EmailJS template, never the OTP template. */
export const sendWelcomeEmail = async (userEmail: string, userName: string): Promise<boolean> => {
  try {
    const keys = await resolveKeys();
    const templateId = distinctWelcomeTemplateId(keys.welcomeTemplateId);
    if (!templateId) {
      console.error('[Email] Welcome template is not set.');
      return false;
    }
    const ok = await sendCasemateEmail({
      templateId,
      toEmail: userEmail,
      toName: userName,
      subject: 'Welcome to casemate',
      message:
        `Dear ${userName || 'Advocate'},\n\n` +
        `Welcome to casemate — your AI legal drafting assistant.\n\n` +
        `Your account is ready.\n\n` +
        `Website: ${APP_URL}\n\n` +
        `Regards,\nTeam casemate`,
    });
    if (ok) console.log('[Email] Welcome email sent to', userEmail);
    return ok;
  } catch (error) {
    console.error('[Email] Welcome failed:', error);
    return false;
  }
};

/** Sends the welcome template once per account, after a successful sign-in. */
export const sendWelcomeEmailOnce = async (uid: string, userEmail: string, userName: string): Promise<void> => {
  if (!uid || !userEmail || !userEmail.includes('@')) return;
  try {
    const ref = doc(db, 'users_data', uid);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.get('welcomeEmailSent') === true) return;
    const ok = await sendWelcomeEmail(userEmail, userName);
    if (!ok) return;
    await setDoc(ref, { welcomeEmailSent: true, updatedAt: Date.now() }, { merge: true });
  } catch (error) {
    console.error('[Email] Welcome once failed:', error);
  }
};

/** 2. After successful payment / plan upgrade */
export const sendPurchaseEmail = async (
  userEmail: string,
  userName: string,
  planName: string,
  expiryDate?: number | null
): Promise<boolean> => {
  try {
    const keys = await resolveKeys();
    const expiryText = expiryDate
      ? `\nYour plan is active until: ${new Date(expiryDate).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}.`
      : '';
    const ok = await sendCasemateEmail({
      templateId: keys.purchaseTemplateId,
      toEmail: userEmail,
      toName: userName,
      subject: `casemate — ${planName} activated`,
      message:
        `Dear ${userName || 'Advocate'},\n\n` +
        `Thank you for upgrading to ${planName}.\n\n` +
        `Your payment was successful and your subscription is now active.${expiryText}\n\n` +
        `You can continue using casemate with your new plan limits.\n\n` +
        `Regards,\nTeam casemate`,
      extra: {
        plan_name: planName,
        expiry_date: expiryDate ? new Date(expiryDate).toISOString() : '',
      },
    });
    if (ok) console.log('[Email] Purchase email sent to', userEmail);
    return ok;
  } catch (error) {
    console.error('[Email] Purchase failed:', error);
    return false;
  }
};

/** 3. Plan expiry reminder */
export const sendExpiryAlertEmail = async (
  userEmail: string,
  userName: string,
  daysLeft: number,
  planName?: string
): Promise<boolean> => {
  try {
    const keys = await resolveKeys();
    const planLabel = planName || 'your subscription';
    const ok = await sendCasemateEmail({
      templateId: keys.expiryTemplateId,
      toEmail: userEmail,
      toName: userName,
      subject: `casemate — ${planLabel} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      message:
        `Dear ${userName || 'Advocate'},\n\n` +
        `This is a reminder that ${planLabel} will expire in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.\n\n` +
        `Please renew your plan to continue uninterrupted access to drafting and advanced features.\n\n` +
        `Renew here: ${APP_URL}\n\n` +
        `Regards,\nTeam casemate`,
      extra: {
        days_left: String(daysLeft),
        plan_name: planLabel,
      },
    });
    if (ok) console.log('[Email] Expiry reminder sent to', userEmail, 'daysLeft=', daysLeft);
    return ok;
  } catch (error) {
    console.error('[Email] Expiry reminder failed:', error);
    return false;
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * If paid plan expires within 7 / 3 / 1 days, send a reminder once per threshold.
 * Safe to call on every app open.
 */
export const checkAndSendExpiryReminder = async (user: {
  id: string;
  email?: string;
  name?: string;
  plan?: string | null;
  subscriptionExpiryDate?: number | null;
}): Promise<void> => {
  try {
    if (!user?.id || !user.email) return;
    if (!user.plan || user.plan === 'free') return;
    const expiry = user.subscriptionExpiryDate;
    if (!expiry || typeof expiry !== 'number') return;

    const msLeft = expiry - Date.now();
    if (msLeft <= 0) return;

    const daysLeft = Math.ceil(msLeft / DAY_MS);
    const thresholds = [7, 3, 1];
    const hit = thresholds.find((t) => daysLeft <= t && daysLeft > 0);
    if (!hit) return;

    const storageKey = `casemate_expiry_email_${user.id}_${hit}`;
    if (localStorage.getItem(storageKey) === '1') return;

    const planName =
      user.plan === 'basic' ? 'Basic Plan' : user.plan === 'annual' ? 'Annual Plan' : 'Pro Plan';

    const ok = await sendExpiryAlertEmail(user.email, user.name || 'Advocate', daysLeft, planName);
    if (ok) {
      localStorage.setItem(storageKey, '1');
      try {
        await setDoc(
          doc(db, 'users_data', user.id),
          { lastExpiryEmailThreshold: hit, lastExpiryEmailAt: Date.now() },
          { merge: true }
        );
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.error('[Email] checkAndSendExpiryReminder failed', e);
  }
};
