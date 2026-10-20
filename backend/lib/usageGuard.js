/**
 * Per-user fair-use + device slots for AI requests.
 *
 * The per-IP limiter in server.js only slows a flood down; it is not a budget.
 * This module is the actual spend control: it counts AI calls and analysed
 * images per account per calendar month, and limits how many devices may share
 * one subscription.
 *
 * Fails open when Firebase Admin is not configured, so the app keeps working.
 */
import { adminReady, getDb, userDoc } from './firebaseAdmin.js';
import { getPlanLimits } from '../middleware/planLimits.js';
import { loadPromoCodes } from '../lib/promoCodes.js';

/** A device slot is released after this many days without use. */
const DEVICE_STALE_DAYS = 14;
const DEVICE_STALE_MS = DEVICE_STALE_DAYS * 24 * 60 * 60 * 1000;

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

/**
 * Reserve one AI request (plus its images) for this user.
 * @returns {Promise<{ok: true, skipped?: boolean} | {ok: false, code: string, message: string}>}
 */
export const reserveAiRequest = async ({ uid, email, deviceId, contents }) => {
  if (!adminReady()) return { ok: true, skipped: true };

  const db = getDb();
  const ref = userDoc(uid);
  const images = countImages(contents);
  const now = Date.now();
  const month = monthKey();
  const codes = await loadPromoCodes().catch(() => null);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const plan = effectivePlan(data);
      const limits = getPlanLimits(plan, email || data.email, data, codes);

      const prev = data.aiUsage && data.aiUsage.month === month
        ? data.aiUsage
        : { month, requests: 0, images: 0 };

      if (prev.requests + 1 > limits.monthlyAiRequests) {
        return {
          ok: false,
          code: 'FAIR_USE_REQUESTS',
          message: 'You have reached this month\'s fair-use limit for AI requests. It resets on the 1st. Contact support if you need more.',
        };
      }
      if (images > 0 && prev.images + images > limits.monthlyImages) {
        return {
          ok: false,
          code: 'FAIR_USE_IMAGES',
          message: 'You have reached this month\'s fair-use limit for photo analysis. It resets on the 1st. Contact support if you need more.',
        };
      }

      // Device slots. Older app builds send no device id — those are not blocked.
      let devices = Array.isArray(data.devices) ? data.devices.slice(0, 50) : [];
      if (deviceId) {
        const fresh = devices.filter(
          (d) => d && d.id && (now - Number(d.lastSeen || 0)) < DEVICE_STALE_MS
        );
        const mine = fresh.find((d) => d.id === deviceId);
        if (mine) {
          mine.lastSeen = now;
          devices = fresh;
        } else if (fresh.length >= limits.maxDevices) {
          return {
            ok: false,
            code: 'DEVICE_LIMIT',
            message: `This account is already in use on ${limits.maxDevices} devices. Sign out on another device, or wait ${DEVICE_STALE_DAYS} days for an unused one to free up.`,
          };
        } else {
          devices = [...fresh, { id: deviceId, lastSeen: now }];
        }
      }

      tx.set(ref, {
        aiUsage: {
          month,
          requests: prev.requests + 1,
          images: prev.images + images,
          updatedAt: now,
        },
        ...(deviceId ? { devices } : {}),
      }, { merge: true });

      return { ok: true };
    });
  } catch (err) {
    // Never block a paying user because our own bookkeeping failed.
    console.warn('[usageGuard] could not record usage:', err?.message || err);
    return { ok: true, skipped: true };
  }
};
