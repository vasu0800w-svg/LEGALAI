/**
 * Single source of truth for Casemate plans, prices, limits, and add-ons.
 * Loaded from app_config/plans. Missing fields keep the currently shipped
 * numbers so existing paid customers are not silently tightened.
 */
import { adminReady, getDb } from './firebaseAdmin.js';
import { isPromoActive } from './promoCodes.js';
import { applyAddOnGrants } from './entitlementMath.js';
import {
  isUnlimitedEmail,
  sanitizeFreePlanLimits,
  DEFAULT_FREE_PLAN_LIMITS,
} from '../middleware/planLimits.js';

export const PLAN_DURATION_DAYS = {
  starter: 30,
  basic: 30,
  pro: 30,
  annual: 365,
  custom: 30,
};

export const DEFAULT_PLAN_PRICES = {
  starter: 999,
  basic: 2999,
  pro: 4999,
  annual: 34990,
};

const UNLIMITED_LIMITS = {
  draftLimit: Number.POSITIVE_INFINITY,
  maxMessageChars: 500000,
  maxSessionChars: 5000000,
  chatSessionLimit: 10000,
  dailyUses: Number.POSITIVE_INFINITY,
  dailyAiRequests: Number.POSITIVE_INFINITY,
  dailySeconds: 0,
  maxPhotosPerChat: Number.POSITIVE_INFINITY,
  maxPhotosPerUpload: Number.POSITIVE_INFINITY,
  monthlyAiRequests: Number.POSITIVE_INFINITY,
  monthlyImages: Number.POSITIVE_INFINITY,
  maxDevices: 99,
};

/** Current catalog for new purchases. Existing paid users are grandfathered in getPlanLimits. */
export const DEFAULT_PAID_LIMITS = {
  starter: {
    draftLimit: 30,
    maxMessageChars: 10000,
    maxSessionChars: 100000,
    chatSessionLimit: 100,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 50,
    monthlyAiRequests: 2000,
    monthlyImages: 2000,
    maxDevices: 2,
  },
  basic: {
    draftLimit: 50,
    maxMessageChars: 10000,
    maxSessionChars: 300000,
    chatSessionLimit: 200,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 80,
    monthlyAiRequests: 2000,
    monthlyImages: 2000,
    maxDevices: 3,
  },
  pro: {
    draftLimit: Number.POSITIVE_INFINITY,
    maxMessageChars: 20000,
    maxSessionChars: 500000,
    chatSessionLimit: 500,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 200,
    monthlyAiRequests: 4000,
    monthlyImages: 4000,
    maxDevices: 5,
  },
};

DEFAULT_PAID_LIMITS.annual = { ...DEFAULT_PAID_LIMITS.pro };

export const DEFAULT_CHAT_LIMIT_ADDONS = [
  {
    id: 'chat_chars_20k',
    name: 'Increase chat limit +20,000',
    price: 199,
    billingPeriod: 'month',
    grants: { extraSessionChars: 20000 },
    features: [
      '+20,000 characters per chat for the rest of this calendar month',
      'Applies to every chat on this account, not only the current thread',
      'Conversations and uploads are kept',
    ],
  },
  {
    id: 'chat_chars_50k',
    name: 'Increase chat limit +50,000',
    price: 399,
    billingPeriod: 'month',
    grants: { extraSessionChars: 50000 },
    features: [
      '+50,000 characters per chat for the rest of this calendar month',
      'Applies to every chat on this account, not only the current thread',
      'Conversations and uploads are kept',
    ],
  },
];

export const DEFAULT_ADDONS = [
  ...DEFAULT_CHAT_LIMIT_ADDONS,
  {
    id: 'extra_drafts',
    name: 'Extra drafts',
    price: 499,
    billingPeriod: 'once',
    grants: { extraDrafts: 10 },
    features: ['10 extra completed drafts this month'],
  },
  {
    id: 'extra_photos',
    name: 'Extra photo analysis',
    price: 299,
    billingPeriod: 'once',
    grants: { extraMonthlyImages: 100 },
    features: ['100 extra photo analyses this month'],
  },
];

const finiteOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const sanitizePaidLimits = (raw) => {
  const out = {
    starter: { ...DEFAULT_PAID_LIMITS.starter },
    basic: { ...DEFAULT_PAID_LIMITS.basic },
    pro: { ...DEFAULT_PAID_LIMITS.pro },
    annual: { ...DEFAULT_PAID_LIMITS.annual },
  };
  if (!raw || typeof raw !== 'object') return out;
  for (const id of ['starter', 'basic', 'pro', 'annual']) {
    const hit = raw[id];
    if (!hit || typeof hit !== 'object') continue;
    const base = out[id];
    out[id] = {
      ...base,
      draftLimit: finiteOr(hit.draftLimit, base.draftLimit),
      maxMessageChars: finiteOr(hit.maxMessageChars, base.maxMessageChars),
      maxSessionChars: (() => {
        const n = finiteOr(hit.maxSessionChars, base.maxSessionChars);
        const floor = Number(base.maxSessionChars);
        return Number.isFinite(floor) && Number.isFinite(n) && floor > n ? floor : n;
      })(),
      chatSessionLimit: finiteOr(hit.chatSessionLimit, base.chatSessionLimit),
      dailyAiRequests: finiteOr(hit.dailyAiRequests, base.dailyAiRequests),
      dailySeconds: finiteOr(hit.dailySeconds, base.dailySeconds),
      maxPhotosPerChat: finiteOr(hit.maxPhotosPerChat, base.maxPhotosPerChat),
      maxPhotosPerUpload: finiteOr(hit.maxPhotosPerUpload, base.maxPhotosPerUpload),
      monthlyAiRequests: finiteOr(hit.monthlyAiRequests, base.monthlyAiRequests),
      monthlyImages: finiteOr(hit.monthlyImages, base.monthlyImages),
      maxDevices: finiteOr(hit.maxDevices, base.maxDevices),
      dailyUses: Number.POSITIVE_INFINITY,
    };
  }
  return out;
};

export const sanitizeAddOns = (raw) => {
  const mapped = (!Array.isArray(raw) || raw.length === 0)
    ? DEFAULT_ADDONS.map((a) => ({ ...a, grants: { ...a.grants }, features: [...a.features] }))
    : raw.map((item, i) => ({
      id: String(item?.id || `addon_${i + 1}`),
      name: String(item?.name || 'Add-on').trim() || 'Add-on',
      price: Math.max(0, Math.round(Number(item?.price) || 0)),
      billingPeriod: String(item?.billingPeriod || 'once'),
      grants: item?.grants && typeof item.grants === 'object' ? item.grants : {},
      features: Array.isArray(item?.features) ? item.features.map((f) => String(f)) : [],
    }));
  const ids = new Set(mapped.map((a) => a.id));
  for (const fallback of DEFAULT_CHAT_LIMIT_ADDONS) {
    if (!ids.has(fallback.id)) {
      mapped.push({ ...fallback, grants: { ...fallback.grants }, features: [...fallback.features] });
    }
  }
  return mapped;
};

export const isChatLimitAddon = (addon) =>
  Number(addon?.grants?.extraSessionChars) > 0 && Number(addon?.price) > 0;

let cache = { at: 0, catalog: null };

export const emptyCatalog = () => ({
  plans: [
    { id: 'starter', name: 'Casemate Starter', price: DEFAULT_PLAN_PRICES.starter, billingDays: 30, features: [] },
    { id: 'basic', name: 'Basic Plan', price: DEFAULT_PLAN_PRICES.basic, billingDays: 30, features: [] },
    { id: 'pro', name: 'Pro Plan', price: DEFAULT_PLAN_PRICES.pro, billingDays: 30, features: [] },
    { id: 'annual', name: 'Annual Plan', price: DEFAULT_PLAN_PRICES.annual, billingDays: 365, features: [] },
  ],
  freeLimits: { ...DEFAULT_FREE_PLAN_LIMITS, maxPhotosPerUpload: 20 },
  paidLimits: sanitizePaidLimits(null),
  addOns: sanitizeAddOns(null),
});

export async function loadPlanCatalog() {
  if (cache.catalog && Date.now() - cache.at < 15000) return cache.catalog;
  const fallback = emptyCatalog();
  if (!adminReady()) {
    cache = { at: Date.now(), catalog: fallback };
    return fallback;
  }
  try {
    const snap = await getDb().collection('app_config').doc('plans').get();
    const data = snap.exists ? snap.data() || {} : {};
    const list = Array.isArray(data.plans) ? data.plans : [];
    const plans = (list.length ? list : fallback.plans).map((p) => {
      const id = String(p?.id || '');
      return {
        id,
        name: String(p?.name || id || 'Plan'),
        price: Math.round(Number(p?.price) || DEFAULT_PLAN_PRICES[id] || 0),
        billingDays: PLAN_DURATION_DAYS[id] || 30,
        features: Array.isArray(p?.features) ? p.features : [],
      };
    });
    if (!plans.some((p) => p.id === 'starter')) {
      plans.unshift({
        id: 'starter',
        name: 'Casemate Starter',
        price: DEFAULT_PLAN_PRICES.starter,
        billingDays: 30,
        features: [],
      });
    }
    const freeLimits = sanitizeFreePlanLimits(data.freeLimits);
    freeLimits.maxPhotosPerUpload = finiteOr(data.freeLimits?.maxPhotosPerUpload, 20);
    const catalog = {
      plans,
      freeLimits,
      paidLimits: sanitizePaidLimits(data.paidLimits),
      addOns: sanitizeAddOns(data.addOns),
    };
    cache = { at: Date.now(), catalog };
    return catalog;
  } catch (err) {
    console.warn('[planCatalog] load failed:', err?.message || err);
    cache = { at: Date.now(), catalog: cache.catalog || fallback };
    return cache.catalog;
  }
}

export function limitsFor(plan, email, userData, codes, catalog) {
  if (isUnlimitedEmail(email) || (userData && codes && isPromoActive(userData, codes))) {
    return UNLIMITED_LIMITS;
  }
  const cat = catalog || cache.catalog || emptyCatalog();
  const p = plan || 'free';
  let limits;
  if (p === 'custom') {
    const granted = userData?.grantedLimits;
    const base = cat.freeLimits || DEFAULT_FREE_PLAN_LIMITS;
    if (granted && typeof granted === 'object' && Object.keys(granted).length > 0) {
      limits = { ...base };
      for (const [key, value] of Object.entries(granted)) {
        limits[key] = value == null ? Number.POSITIVE_INFINITY : Number(value);
      }
    } else {
      limits = base;
    }
  } else if (p === 'starter' || p === 'basic' || p === 'pro' || p === 'annual') {
    const catalogLimits = cat.paidLimits[p] || DEFAULT_PAID_LIMITS[p] || DEFAULT_PAID_LIMITS.pro;
    limits = catalogLimits;
  } else {
    limits = cat.freeLimits || DEFAULT_FREE_PLAN_LIMITS;
  }
  return applyAddOnGrants({ ...limits }, userData?.addOns);
}

export const billingWindow = (userData, now = Date.now()) => {
  const plan = String(userData?.plan || 'free');
  const expiry = Number(userData?.subscriptionExpiryDate || 0);
  if (plan === 'free' || expiry <= 0) {
    return { start: null, end: null, status: 'free', paymentStatus: userData?.paymentStatus || 'none' };
  }
  const days = PLAN_DURATION_DAYS[plan] || 30;
  const start = Number(userData?.billingCycleStart) || (expiry - days * 24 * 60 * 60 * 1000);
  const active = expiry > now;
  return {
    start,
    end: expiry,
    status: active ? 'active' : 'expired',
    paymentStatus: userData?.paymentStatus || (active ? 'paid' : 'expired'),
  };
};

export const addonById = (catalog, addOnId) =>
  (catalog?.addOns || []).find((a) => a.id === String(addOnId || ''));
