/**
 * Per-user fair-use + device slots + monthly draft reservations.
 *
 * The per-IP limiter in server.js only slows a flood down; it is not a budget.
 * This module is the actual spend control: it counts AI calls, analysed images,
 * and completed draft-generation operations per account, and limits how many
 * devices may share one subscription.
 *
 * Drafts: a draft counts only when this module successfully reserves one for a
 * generate-document call (X-Work-Kind: draft). Failed Gemini calls release the
 * reservation so they do not consume quota. Concurrent reserves run in a
 * Firestore transaction so two in-flight drafts cannot both sneak past the cap.
 *
 * Fails closed when Firebase Admin or usage writes are unavailable so AI
 * spend cannot run without a recorded quota check.
 */
import { adminReady, getDb, userDoc } from './firebaseAdmin.js';
import { getPlanLimits, loadFreePlanLimits, istDateKey } from '../middleware/planLimits.js';
import { loadPromoCodes } from './promoCodes.js';
import { seedMonthDrafts } from './entitlementMath.js';
import { usageUnavailable } from './usagePolicy.js';
import { DEVICE_STALE_DAYS, DEVICE_STALE_MS, decideAiReservation } from './usageDecision.js';

const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);

/** A paid plan past its expiry date is treated as free. */
export const effectivePlan = (data) => {
  const plan = String(data?.plan || 'free');
  if (plan === 'free') return 'free';
  const expiry = Number(data?.subscriptionExpiryDate || 0);
  if (expiry > 0 && expiry < Date.now()) return 'free';
  return plan;
};

const countImages = (contents) => {
  const list = Array.isArray(contents) ? contents : [contents];
  let n = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (item.inlineData?.data || item.inline_data?.data) n += 1;
    if (Array.isArray(item.parts)) {
      for (const p of item.parts) {
        if (p?.inlineData?.data || p?.inline_data?.data) n += 1;
      }
    }
  }
  return n;
};

export const countRequestImages = countImages;

const usageSnapshot = (data, month, day, nowDate = new Date()) => {
  const prevMonth = data.aiUsage && data.aiUsage.month === month
    ? data.aiUsage
    : { month, requests: 0, images: 0, day, dayRequests: 0 };
  return {
    month,
    requests: Number(prevMonth.requests || 0),
    images: Number(prevMonth.images || 0),
    day,
    dayRequests: prevMonth.day === day ? Number(prevMonth.dayRequests || 0) : 0,
    monthDrafts: seedMonthDrafts(data.aiUsage, data.draftCount, data.lastResetDate, month, nowDate),
  };
};

const writeUsage = (tx, ref, prev, extra = {}) => {
  tx.set(ref, {
    aiUsage: {
      month: prev.month,
      requests: prev.requests,
      images: prev.images,
      day: prev.day,
      dayRequests: prev.dayRequests,
      monthDrafts: prev.monthDrafts,
      updatedAt: Date.now(),
    },
    ...extra,
  }, { merge: true });
};

/**
 * Reserve one AI request (plus its images) for this user.
 * @returns {Promise<{ok: true, skipped?: boolean} | {ok: false, code: string, message: string}>}
 */
export const reserveAiRequest = async ({ uid, email, deviceId, contents }) => {
  if (!adminReady()) return usageUnavailable();
  if (!deviceId) {
    return {
      ok: false,
      code: 'DEVICE_REQUIRED',
      message: 'This app install could not be verified. Please reopen Casemate and try again.',
    };
  }

  await loadFreePlanLimits().catch(() => null);
  const db = getDb();
  const ref = userDoc(uid);
  const images = countImages(contents);
  const now = Date.now();
  const nowDate = new Date(now);
  const month = monthKey(nowDate);
  const day = istDateKey(nowDate);
  const codes = await loadPromoCodes().catch(() => null);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const plan = effectivePlan(data);
      const limits = getPlanLimits(plan, email || data.email, data, codes);
      const prev = usageSnapshot(data, month, day, nowDate);
      const decision = decideAiReservation({
        prev,
        limits,
        images,
        devices: data.devices,
        deviceId,
        now,
      });
      if (!decision.ok) return decision;

      writeUsage(tx, ref, decision.next, { devices: decision.devices });
      return { ok: true };
    });
  } catch (err) {
    console.warn('[usageGuard] could not record usage:', err?.code || err?.message || 'failed');
    return usageUnavailable();
  }
};

/** Undo a reservation when the AI request itself failed. */
export const releaseAiRequest = async ({ uid, contents }) => {
  if (!adminReady() || !uid) return;
  const images = countImages(contents);
  const now = Date.now();
  const nowDate = new Date(now);
  const month = monthKey(nowDate);
  const day = istDateKey(nowDate);
  const ref = userDoc(uid);
  try {
    await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const prev = usageSnapshot(data, month, day, nowDate);
      if (!data.aiUsage || data.aiUsage.month !== month) return;
      writeUsage(tx, ref, {
        ...prev,
        requests: Math.max(0, prev.requests - 1),
        images: Math.max(0, prev.images - images),
        dayRequests: data.aiUsage.day === day ? Math.max(0, prev.dayRequests - 1) : prev.dayRequests,
      });
    });
  } catch (err) {
    console.warn('[usageGuard] could not release usage:', err?.message || err);
  }
};

/**
 * Reserve one monthly draft for a completed-generate attempt.
 * Must be paired with releaseDraft if generation fails.
 */
export const reserveDraft = async ({ uid, email }) => {
  if (!adminReady()) return usageUnavailable();
  await loadFreePlanLimits().catch(() => null);
  const now = Date.now();
  const nowDate = new Date(now);
  const month = monthKey(nowDate);
  const day = istDateKey(nowDate);
  const codes = await loadPromoCodes().catch(() => null);
  const ref = userDoc(uid);

  try {
    return await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const plan = effectivePlan(data);
      const limits = getPlanLimits(plan, email || data.email, data, codes);
      const prev = usageSnapshot(data, month, day, nowDate);

      if (Number.isFinite(limits.draftLimit) && prev.monthDrafts + 1 > limits.draftLimit) {
        return {
          ok: false,
          code: 'DRAFT_LIMIT',
          message: `You have used this month's ${limits.draftLimit} drafts. The allowance resets on the 1st. Your chats and uploads are saved.`,
        };
      }

      const nextDrafts = prev.monthDrafts + 1;
      writeUsage(tx, ref, { ...prev, monthDrafts: nextDrafts }, {
        draftCount: nextDrafts,
        lastResetDate: nowDate.getMonth(),
      });
      return { ok: true, monthDrafts: nextDrafts, remaining: Number.isFinite(limits.draftLimit) ? Math.max(0, limits.draftLimit - nextDrafts) : null };
    });
  } catch (err) {
    console.warn('[usageGuard] could not reserve draft:', err?.code || err?.message || 'failed');
    return usageUnavailable();
  }
};

export const releaseDraft = async ({ uid }) => {
  if (!adminReady() || !uid) return;
  const now = Date.now();
  const nowDate = new Date(now);
  const month = monthKey(nowDate);
  const day = istDateKey(nowDate);
  const ref = userDoc(uid);
  try {
    await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (!data.aiUsage || data.aiUsage.month !== month) return;
      const prev = usageSnapshot(data, month, day, nowDate);
      const nextDrafts = Math.max(0, prev.monthDrafts - 1);
      writeUsage(tx, ref, { ...prev, monthDrafts: nextDrafts }, {
        draftCount: nextDrafts,
      });
    });
  } catch (err) {
    console.warn('[usageGuard] could not release draft:', err?.message || err);
  }
};

export const listDevices = (data, currentId, now = Date.now()) => {
  const devices = Array.isArray(data?.devices) ? data.devices : [];
  return devices
    .filter((d) => d && d.id && now - Number(d.lastSeen || 0) < DEVICE_STALE_MS)
    .map((d) => ({
      id: String(d.id),
      lastSeen: Number(d.lastSeen || 0),
      current: Boolean(currentId) && d.id === currentId,
    }));
};

export const revokeDevice = async ({ uid, deviceId }) => {
  if (!adminReady() || !uid || !deviceId) {
    return { ok: false, code: 'INVALID', message: 'Missing device.' };
  }
  const ref = userDoc(uid);
  try {
    const result = await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() || {} : {};
      const devices = (Array.isArray(data.devices) ? data.devices : []).filter(
        (d) => d && d.id && d.id !== deviceId
      );
      tx.set(ref, { devices }, { merge: true });
      return { ok: true, devices: listDevices({ devices }) };
    });
    return result;
  } catch (err) {
    console.warn('[usageGuard] could not revoke device:', err?.message || err);
    return { ok: false, code: 'REVOKE_FAILED', message: 'Could not update devices. Try again.' };
  }
};

export { DEVICE_STALE_DAYS, DEVICE_STALE_MS };
