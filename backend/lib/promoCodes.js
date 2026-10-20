/**
 * Promo codes live in Firestore app_config/promo_codes so they can be changed
 * from the admin panel. They are not shipped in the website or app bundle.
 *
 * code14    — unlimited for 14 days from the moment it is entered
 * codeAlways — unlimited until this code is changed in the admin panel
 */
import { adminReady, getDb } from './firebaseAdmin.js';

export const PROMO_14_MS = 14 * 24 * 60 * 60 * 1000;

const DEFAULTS = {
  code14: 'CM14-7KQM-4W2N',
  codeAlways: 'CMALWAYS-9RWP-3H6T',
};

export const normalizePromoCode = (value) =>
  String(value || '').trim().toUpperCase().replace(/\s+/g, '');

let cache = { at: 0, codes: null };

export const loadPromoCodes = async () => {
  if (cache.codes && Date.now() - cache.at < 15000) return cache.codes;
  const fallback = { ...DEFAULTS };
  if (!adminReady()) return fallback;

  const ref = getDb().collection('app_config').doc('promo_codes');
  const snap = await ref.get();
  const data = snap.exists ? snap.data() || {} : {};
  const codes = {
    code14: normalizePromoCode(data.code14) || DEFAULTS.code14,
    codeAlways: normalizePromoCode(data.codeAlways) || DEFAULTS.codeAlways,
  };
  if (!snap.exists) {
    await ref.set({ ...codes, updatedAt: Date.now() });
  }
  cache = { at: Date.now(), codes };
  return codes;
};

export const clearPromoCodeCache = () => {
  cache = { at: 0, codes: null };
};

/** True when this user document currently has promo unlimited. Email-list accounts are separate. */
export const isPromoActive = (data, codes, now = Date.now()) => {
  const kind = String(data?.promoKind || '');
  if (kind === '14d') return Number(data?.promoExpiresAt || 0) > now;
  if (kind === 'forever') {
    const saved = normalizePromoCode(data?.promoCode);
    const current = normalizePromoCode(codes?.codeAlways);
    return Boolean(saved && current && saved === current);
  }
  return false;
};
