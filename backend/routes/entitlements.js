/**
 * Authenticated snapshot of what this user is allowed to do, plus device
 * list/revoke. Plan and usage come from Firestore via the Admin SDK — the
 * client cannot grant itself a paid plan or extra quota.
 */
import { verifyRequestUser } from '../lib/authUser.js';
import { adminReady, userDoc } from '../lib/firebaseAdmin.js';
import { getPlanLimits, loadFreePlanLimits, istDateKey } from '../middleware/planLimits.js';
import { loadPlanCatalog, billingWindow, isChatLimitAddon } from '../lib/planCatalog.js';
import { loadPromoCodes, isPromoActive } from '../lib/promoCodes.js';
import { effectivePlan, listDevices, revokeDevice } from '../lib/usageGuard.js';
import { remainingOf, seedMonthDrafts, CATALOG_VERSION, activeExtraSessionChars } from '../lib/entitlementMath.js';
import { applyCors } from '../lib/httpSecurity.js';

const cors = (req, res) => applyCors(req, res, 'GET, POST, OPTIONS');

export function entitlementsOptionsHandler(req, res) {
  cors(req, res);
  res.status(204).end();
}

const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);

const requireUser = async (req, res) => {
  const authUser = await verifyRequestUser(req);
  if (!authUser?.uid) {
    res.status(401).json({ error: 'AUTH', message: 'Sign in required.' });
    return null;
  }
  return authUser;
};

export async function entitlementsHandler(req, res) {
  cors(req, res);
  const authUser = await requireUser(req, res);
  if (!authUser) return;

  await loadFreePlanLimits().catch(() => null);
  const catalog = await loadPlanCatalog().catch(() => null);
  const codes = await loadPromoCodes().catch(() => null);

  let userData = {};
  if (adminReady()) {
    try {
      const snap = await userDoc(authUser.uid).get();
      userData = snap.exists ? snap.data() || {} : {};
    } catch (err) {
      console.warn('[entitlements] user read failed', err?.message || err);
    }
  }

  const plan = effectivePlan(userData);
  const limits = getPlanLimits(plan, authUser.email || userData.email, userData, codes);
  const now = new Date();
  const month = monthKey(now);
  const day = istDateKey(now);
  const usage = userData.aiUsage && typeof userData.aiUsage === 'object' ? userData.aiUsage : {};
  const dayRequests = usage.day === day ? Number(usage.dayRequests || 0) : 0;
  const requests = usage.month === month ? Number(usage.requests || 0) : 0;
  const images = usage.month === month ? Number(usage.images || 0) : 0;
  const monthDrafts = seedMonthDrafts(usage, userData.draftCount, userData.lastResetDate, month, now);
  const window = billingWindow({ ...userData, plan });
  const currentId = String(req.headers['x-device-id'] || '').slice(0, 64);
  const devices = listDevices(userData, currentId);
  const promo = codes ? isPromoActive(userData, codes) : false;

  const jsonSafe = (n) => (Number.isFinite(n) ? n : null);

  return res.json({
    ok: true,
    uid: authUser.uid,
    plan,
    storedPlan: userData.plan || 'free',
    subscriptionExpiryDate: Number(userData.subscriptionExpiryDate || 0) || null,
    billingCycleStart: window.start,
    billingCycleEnd: window.end,
    status: window.status,
    paymentStatus: window.paymentStatus,
    promoActive: promo,
    entitlementsVersion: Number(userData.entitlementsVersion || 0) || null,
    grandfathered: String(userData.plan || 'free') !== 'free'
      && Number(userData.subscriptionExpiryDate || 0) > Date.now()
      && Number(userData.entitlementsVersion) !== CATALOG_VERSION
      && !(userData.grantedLimits && Object.keys(userData.grantedLimits).length),
    addOns: userData.addOns && typeof userData.addOns === 'object' ? userData.addOns : {},
    billingHistory: Array.isArray(userData.billingHistory) ? userData.billingHistory.slice(-25) : [],
    limits: {
      ...limits,
      draftLimit: jsonSafe(limits.draftLimit),
      dailyAiRequests: jsonSafe(limits.dailyAiRequests),
      dailyUses: jsonSafe(limits.dailyUses),
      maxPhotosPerChat: jsonSafe(limits.maxPhotosPerChat),
      maxPhotosPerUpload: jsonSafe(limits.maxPhotosPerUpload),
      monthlyAiRequests: jsonSafe(limits.monthlyAiRequests),
      monthlyImages: jsonSafe(limits.monthlyImages),
      maxSessionChars: limits.maxSessionChars,
      maxMessageChars: limits.maxMessageChars,
      maxDevices: limits.maxDevices,
    },
    usage: {
      day,
      dayRequests,
      month,
      requests,
      images,
      monthDrafts,
    },
    remaining: {
      dailyAi: jsonSafe(remainingOf(dayRequests, limits.dailyAiRequests)),
      monthlyAi: jsonSafe(remainingOf(requests, limits.monthlyAiRequests)),
      monthlyImages: jsonSafe(remainingOf(images, limits.monthlyImages)),
      drafts: jsonSafe(remainingOf(monthDrafts, limits.draftLimit)),
      devices: Math.max(0, Number(limits.maxDevices || 0) - devices.length),
    },
    devices,
    customPlan: userData.customPlan && typeof userData.customPlan === 'object' ? userData.customPlan : null,
    chatLimit: {
      maxSessionChars: jsonSafe(limits.maxSessionChars),
      extraSessionChars: activeExtraSessionChars(userData.addOns),
      extraUntil: Number(userData.addOns?.extraSessionCharsUntil || 0) || null,
      extraMonth: userData.addOns?.extraSessionCharsMonth || null,
      scope: 'all chats for the remainder of the current calendar month',
      options: (catalog?.addOns || []).filter(isChatLimitAddon).map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        billingPeriod: a.billingPeriod,
        extraSessionChars: Number(a.grants?.extraSessionChars) || 0,
        features: a.features,
        eligible: Number.isFinite(limits.maxSessionChars),
      })),
    },
    catalog: catalog
      ? {
          plans: catalog.plans,
          addOns: catalog.addOns,
        }
      : null,
    reset: {
      daily: 'midnight IST',
      monthly: '1st of the calendar month (UTC month key)',
    },
  });
}

export async function devicesHandler(req, res) {
  cors(req, res);
  const authUser = await requireUser(req, res);
  if (!authUser) return;
  if (!adminReady()) {
    return res.json({ ok: true, devices: [] });
  }
  try {
    const snap = await userDoc(authUser.uid).get();
    const data = snap.exists ? snap.data() || {} : {};
    const currentId = String(req.headers['x-device-id'] || '').slice(0, 64);
    return res.json({ ok: true, devices: listDevices(data, currentId) });
  } catch (err) {
    console.warn('[entitlements] devices read failed', err?.message || err);
    return res.status(500).json({ error: 'DEVICES_READ_FAILED', message: 'Could not load devices.' });
  }
}

export async function revokeDeviceHandler(req, res) {
  cors(req, res);
  const authUser = await requireUser(req, res);
  if (!authUser) return;
  const deviceId = String(req.body?.deviceId || '').trim().slice(0, 64);
  if (!deviceId) {
    return res.status(400).json({ error: 'INVALID', message: 'deviceId is required.' });
  }
  const result = await revokeDevice({ uid: authUser.uid, deviceId });
  if (!result.ok) {
    return res.status(400).json({ error: result.code, message: result.message });
  }
  return res.json({ ok: true, devices: result.devices });
}
