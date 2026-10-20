import { verifyRequestUser } from '../lib/authUser.js';
import { adminReady, userDoc } from '../lib/firebaseAdmin.js';
import { isUnlimitedEmail } from '../middleware/planLimits.js';
import { PROMO_14_MS, isPromoActive, loadPromoCodes, normalizePromoCode } from '../lib/promoCodes.js';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

export function promoOptionsHandler(req, res) {
  cors(res);
  res.status(204).end();
}

export async function redeemPromoHandler(req, res) {
  cors(res);
  if (!adminReady()) {
    return res.status(503).json({ error: 'UNAVAILABLE', message: 'Promo codes are not available right now.' });
  }

  const authUser = await verifyRequestUser(req);
  if (!authUser?.uid) {
    return res.status(401).json({ error: 'AUTH', message: 'Sign in, then enter the promo code.' });
  }

  const code = normalizePromoCode(req.body?.code);
  if (!code || code.length < 4 || code.length > 40) {
    return res.status(400).json({ error: 'CODE', message: 'That promo code is not valid.' });
  }

  if (isUnlimitedEmail(authUser.email)) {
    return res.json({ ok: true, alreadyUnlimited: true });
  }

  const codes = await loadPromoCodes();
  const kind = code === codes.code14 ? '14d' : code === codes.codeAlways ? 'forever' : '';
  if (!kind) {
    return res.status(400).json({ error: 'CODE', message: 'That promo code is not valid.' });
  }

  const ref = userDoc(authUser.uid);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() || {} : {};
  if (isPromoActive(data, codes)) {
    return res.json({
      ok: true,
      alreadyActive: true,
      kind: data.promoKind,
      expiresAt: data.promoKind === '14d' ? Number(data.promoExpiresAt || 0) : null,
    });
  }

  const now = Date.now();
  const expiresAt = kind === '14d' ? now + PROMO_14_MS : null;
  await ref.set({
    promoKind: kind,
    promoExpiresAt: expiresAt,
    promoRedeemedAt: now,
    promoCode: code,
  }, { merge: true });

  return res.json({ ok: true, kind, expiresAt, code });
}

export async function promoStatusHandler(req, res) {
  cors(res);
  const authUser = await verifyRequestUser(req);
  if (!authUser?.uid) {
    return res.status(401).json({ error: 'AUTH', message: 'Sign in required.' });
  }
  if (isUnlimitedEmail(authUser.email)) {
    return res.json({ ok: true, active: true, source: 'email' });
  }
  if (!adminReady()) return res.json({ ok: true, active: false });
  const snap = await userDoc(authUser.uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  const codes = await loadPromoCodes();
  const active = isPromoActive(data, codes);
  return res.json({
    ok: true,
    active,
    kind: active ? data.promoKind : null,
    expiresAt: active && data.promoKind === '14d' ? Number(data.promoExpiresAt || 0) : null,
  });
}
