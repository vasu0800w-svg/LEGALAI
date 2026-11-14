/**
 * Plan-wise draft / message / session character limits.
 * Keep in sync with frontend/utils/planLimits.ts
 *
 * Paid numbers live in backend/lib/planCatalog.js defaults. This file still
 * owns the unlimited-email list and the free-plan sanitizer so those values
 * cannot drift from a casual catalog edit.
 */
import { isPromoActive } from '../lib/promoCodes.js';
import { adminReady, getDb, userDoc } from '../lib/firebaseAdmin.js';
import { verifyRequestUser } from '../lib/authUser.js';
import { applyAddOnGrants, countMessageChars, countCasePhotos, resolvePaidLimits, CATALOG_VERSION } from '../lib/entitlementMath.js';

const UNLIMITED_EMAILS = new Set([
  'nt9234536@gmail.com',
  'shuchirajput22@gmail.com',
  'sourabhmishra.law@gmail.com',
  'vibhav.tiwari40@gmail.com',
  'kajol.dewangan1995@gmail.com',
  'yashthakur.1982@gmail.com',
  'sunilnandi171@gmail.com',
  'ajaysahu3003@gmail.com',
  'rakesh25475@gmail.com',
  'vinodkujur1@gmail.com',
  'kujurmanoj@gmail.com',
  'sshrivastava86@gmail.com',
]);

export function isUnlimitedEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return UNLIMITED_EMAILS.has(email.trim().toLowerCase());
}

export const DEFAULT_FREE_PLAN_LIMITS = {
  draftLimit: 5,
  maxMessageChars: 10000,
  maxSessionChars: 50000,
  chatSessionLimit: 50,
  dailyUses: Number.POSITIVE_INFINITY,
  dailyAiRequests: 20,
  dailySeconds: 3600,
  maxPhotosPerChat: 18,
  maxPhotosPerUpload: 20,
  monthlyAiRequests: 120,
  monthlyImages: 150,
  maxDevices: 2,
};

const clampLimit = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export const sanitizeFreePlanLimits = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    draftLimit: clampLimit(src.draftLimit, DEFAULT_FREE_PLAN_LIMITS.draftLimit, 1, 500),
    maxMessageChars: clampLimit(src.maxMessageChars, DEFAULT_FREE_PLAN_LIMITS.maxMessageChars, 1000, 100000),
    maxSessionChars: Math.max(
      clampLimit(src.maxSessionChars, DEFAULT_FREE_PLAN_LIMITS.maxSessionChars, 4000, 500000),
      DEFAULT_FREE_PLAN_LIMITS.maxSessionChars
    ),
    chatSessionLimit: clampLimit(src.chatSessionLimit, DEFAULT_FREE_PLAN_LIMITS.chatSessionLimit, 5, 5000),
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: clampLimit(src.dailyAiRequests, DEFAULT_FREE_PLAN_LIMITS.dailyAiRequests, 1, 500),
    dailySeconds: clampLimit(src.dailySeconds, DEFAULT_FREE_PLAN_LIMITS.dailySeconds, 0, 86400),
    maxPhotosPerChat: clampLimit(src.maxPhotosPerChat, DEFAULT_FREE_PLAN_LIMITS.maxPhotosPerChat, 1, 200),
    maxPhotosPerUpload: clampLimit(src.maxPhotosPerUpload, DEFAULT_FREE_PLAN_LIMITS.maxPhotosPerUpload, 1, 80),
    monthlyAiRequests: clampLimit(src.monthlyAiRequests, DEFAULT_FREE_PLAN_LIMITS.monthlyAiRequests, 10, 20000),
    monthlyImages: clampLimit(src.monthlyImages, DEFAULT_FREE_PLAN_LIMITS.monthlyImages, 10, 20000),
    maxDevices: clampLimit(src.maxDevices, DEFAULT_FREE_PLAN_LIMITS.maxDevices, 1, 20),
  };
};

/** Limits already granted to paid accounts before Part 5. Do not apply to them automatically. */
export const LEGACY_PAID_LIMITS = {
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
    draftLimit: Number.POSITIVE_INFINITY,
    maxMessageChars: 10000,
    maxSessionChars: 300000,
    chatSessionLimit: 200,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 40,
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
    maxPhotosPerUpload: 60,
    monthlyAiRequests: 4000,
    monthlyImages: 4000,
    maxDevices: 5,
  },
};
LEGACY_PAID_LIMITS.annual = { ...LEGACY_PAID_LIMITS.pro };

/** Current catalog for new purchases. Admin paidLimits may override. */
const DEFAULT_PAID_LIMITS = {
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
export { DEFAULT_PAID_LIMITS, CATALOG_VERSION };

let freeCache = { at: 0, limits: sanitizeFreePlanLimits(null), paid: { ...DEFAULT_PAID_LIMITS } };

const mergePaid = (raw) => {
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
    out[id] = { ...out[id], ...hit, dailyUses: Number.POSITIVE_INFINITY };
    const floor = Number(DEFAULT_PAID_LIMITS[id].maxSessionChars);
    const n = Number(out[id].maxSessionChars);
    if (Number.isFinite(floor) && Number.isFinite(n) && floor > n) out[id].maxSessionChars = floor;
  }
  return out;
};

export async function loadFreePlanLimits() {
  if (freeCache.limits && Date.now() - freeCache.at < 15000) return freeCache.limits;
  if (!adminReady()) {
    freeCache = { at: Date.now(), limits: sanitizeFreePlanLimits(null), paid: { ...DEFAULT_PAID_LIMITS } };
    return freeCache.limits;
  }
  try {
    const snap = await getDb().collection('app_config').doc('plans').get();
    const data = snap.exists ? snap.data() || {} : {};
    freeCache = {
      at: Date.now(),
      limits: sanitizeFreePlanLimits(data.freeLimits),
      paid: mergePaid(data.paidLimits),
    };
  } catch (err) {
    console.warn('[planLimits] could not load freeLimits:', err?.message || err);
    freeCache = {
      at: Date.now(),
      limits: freeCache.limits || sanitizeFreePlanLimits(null),
      paid: freeCache.paid || { ...DEFAULT_PAID_LIMITS },
    };
  }
  return freeCache.limits;
}

export function getPlanLimits(plan, email, userData = null, codes = null) {
  if (isUnlimitedEmail(email) || (userData && codes && isPromoActive(userData, codes))) {
    return {
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
  }

  const p = plan || 'free';
  const paid = freeCache.paid || DEFAULT_PAID_LIMITS;
  let limits;
  if (p === 'custom') {
    const base = freeCache.limits || sanitizeFreePlanLimits(null);
    const granted = userData?.grantedLimits;
    if (granted && typeof granted === 'object' && Object.keys(granted).length > 0) {
      limits = { ...base };
      for (const [key, value] of Object.entries(granted)) {
        limits[key] = value == null ? Number.POSITIVE_INFINITY : Number(value);
      }
    } else {
      limits = base;
    }
  } else if (p === 'starter' || p === 'basic' || p === 'pro' || p === 'annual') {
    const catalogLimits = paid[p] || DEFAULT_PAID_LIMITS[p] || DEFAULT_PAID_LIMITS.pro;
    const legacyLimits = LEGACY_PAID_LIMITS[p] || LEGACY_PAID_LIMITS.pro;
    limits = resolvePaidLimits({
      plan: p,
      expiry: userData?.subscriptionExpiryDate,
      entitlementsVersion: userData?.entitlementsVersion,
      grantedLimits: userData?.grantedLimits,
      catalogLimits,
      legacyLimits,
    });
  } else {
    limits = freeCache.limits || sanitizeFreePlanLimits(null);
  }
  return applyAddOnGrants({ ...limits }, userData?.addOns);
}

/** Authoritative monthly price per plan (rupees). Admin config may override. */
export const DEFAULT_PLAN_PRICES = {
  starter: 999,
  basic: 2999,
  pro: 4999,
  annual: 34990,
};

export const PLAN_DURATION_DAYS = {
  starter: 30,
  basic: 30,
  pro: 30,
  annual: 365,
  custom: 30,
};

export function getSessionCharCount(messages = []) {
  return countMessageChars(messages);
}

export const istDateKey = (now = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * Express middleware: validates character and photo limits against the
 * authenticated user's actual plan. Client-supplied plan/email are ignored.
 *
 * Counted characters = concatenated message.text only. Image bytes are not text.
 *
 * Body: { chatId?, message, sessionMessages?: [{ text, attachments }], photoCount?, uploadPhotoCount? }
 */
export async function validateChatLimitsMiddleware(req, res, next) {
  try {
    const authUser = await verifyRequestUser(req);
    if (!authUser?.uid) {
      return res.status(401).json({
        error: 'AUTH',
        message: 'Sign in required to validate chat limits.',
      });
    }

    await loadFreePlanLimits();

    let userData = {};
    if (adminReady()) {
      try {
        const snap = await userDoc(authUser.uid).get();
        userData = snap.exists ? snap.data() || {} : {};
      } catch (err) {
        console.warn('[planLimits] user read failed', err?.message || err);
      }
    }

    const plan = String(userData.plan || 'free');
    const expiry = Number(userData.subscriptionExpiryDate || 0);
    const effective = plan !== 'free' && expiry > 0 && expiry < Date.now() ? 'free' : plan;
    const email = authUser.email || String(userData.email || '');
    const limits = getPlanLimits(effective, email, userData);
    if (isUnlimitedEmail(email)) {
      req.planLimits = limits;
      return next();
    }

    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    let sessionMessages = Array.isArray(req.body?.sessionMessages) ? req.body.sessionMessages : [];
    const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() : '';

    if (chatId && adminReady()) {
      try {
        const chatSnap = await userDoc(authUser.uid).collection('chats').doc(chatId).get();
        if (chatSnap.exists) {
          const chat = chatSnap.data() || {};
          if (Array.isArray(chat.messages) && chat.messages.length > 0) {
            sessionMessages = chat.messages;
          }
        }
      } catch (err) {
        console.warn('[planLimits] chat read skipped', err?.message || err);
      }
    }

    const messageLen = message.length;
    if (messageLen > limits.maxMessageChars) {
      return res.status(400).json({
        error: 'MESSAGE_LIMIT_EXCEEDED',
        message: `Message exceeds the ${limits.maxMessageChars.toLocaleString()} character limit for your plan.`,
        limits,
      });
    }

    const sessionTotal = countMessageChars(sessionMessages) + messageLen;
    if (sessionTotal > limits.maxSessionChars) {
      return res.status(400).json({
        error: 'SESSION_LIMIT_EXCEEDED',
        message: `This chat has reached the ${limits.maxSessionChars.toLocaleString()} character history limit for your plan. Increase the chat limit or start a new chat. Your conversation is kept.`,
        limits,
      });
    }

    const pending = Number(req.body?.photoCount);
    const photoCount = Number.isFinite(pending)
      ? pending
      : countCasePhotos(sessionMessages, Number(req.body?.uploadPhotoCount) || 0);
    if (Number.isFinite(limits.maxPhotosPerChat) && photoCount > limits.maxPhotosPerChat) {
      return res.status(400).json({
        error: 'PHOTO_LIMIT_EXCEEDED',
        message: `This chat allows ${limits.maxPhotosPerChat} photos on your plan. Start a new chat or upgrade to add more.`,
        limits,
      });
    }

    const uploadCount = Number(req.body?.uploadPhotoCount);
    if (Number.isFinite(uploadCount) && Number.isFinite(limits.maxPhotosPerUpload) && uploadCount > limits.maxPhotosPerUpload) {
      return res.status(400).json({
        error: 'UPLOAD_PHOTO_LIMIT_EXCEEDED',
        message: `You can attach up to ${limits.maxPhotosPerUpload} photos in one upload.`,
        limits,
      });
    }

    req.planLimits = limits;
    req.authUser = authUser;
    return next();
  } catch (err) {
    console.error('[planLimits] validation error', err);
    return res.status(500).json({
      error: 'VALIDATION_FAILED',
      message: 'Unable to validate chat limits.',
    });
  }
}
