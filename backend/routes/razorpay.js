/**
 * Razorpay Standard Checkout — create order + verify signature + grant the plan.
 *
 * The phone never decides what it paid for or what it gets:
 *  - /api/create-order  takes a planId, prices it from server config, and stores
 *    a pending order tied to the signed-in user.
 *  - /api/verify-payment checks the signature against that stored order and then
 *    writes the plan with the Admin SDK (Firestore rules block the client).
 */
import Razorpay from 'razorpay';
import { adminReady, getDb, userDoc, orderDoc, paymentDoc } from '../lib/firebaseAdmin.js';
import { verifyRequestUser } from '../lib/authUser.js';
import { DEFAULT_PLAN_PRICES, PLAN_DURATION_DAYS, DEFAULT_PAID_LIMITS, getPlanLimits, loadFreePlanLimits } from '../middleware/planLimits.js';
import { loadPlanCatalog, addonById, isChatLimitAddon } from '../lib/planCatalog.js';
import { effectivePlan } from '../lib/usageGuard.js';
import { quoteCustomPlan } from '../lib/customPlan.js';
import { loadCustomPricing } from './customPlan.js';
import { applyCors } from '../lib/httpSecurity.js';
import { razorpaySignatureValid, paymentMatchesOrder } from '../lib/razorpayCrypto.js';
import {
  nextExpiryFrom,
  nextPlanAfterPurchase,
  mergeAddOnGrants,
  appendBillingHistory,
  preferRicherLimits,
  CATALOG_VERSION,
  persistLimits,
} from '../lib/entitlementMath.js';

const cors = (req, res) => applyCors(req, res, 'POST, OPTIONS');

const VALID_PLANS = ['starter', 'basic', 'pro', 'annual'];

const pairFrom = (id, secret) => {
  const key_id = String(id || '').trim();
  const key_secret = String(secret || '').trim();
  if (!key_id || !key_secret) return null;
  return {
    key_id,
    key_secret,
    mode: key_id.startsWith('rzp_live_') ? 'live' : 'test',
  };
};

let cachedKeys = null;
let cachedKeysAt = 0;

/** Live keys win over test keys. Env live beats a live key saved in the admin panel. */
export async function resolveRazorpayKeys() {
  if (cachedKeys && Date.now() - cachedKeysAt < 30_000) return cachedKeys;
  const envPair = pairFrom(process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET);
  let cloudPair = null;
  if (adminReady()) {
    try {
      const snap = await getDb().collection('app_config').doc('api_keys').get();
      const data = snap.exists ? snap.data() : null;
      cloudPair = pairFrom(data?.razorpayKeyId, data?.razorpayKeySecret);
    } catch (err) {
      console.warn('[Razorpay] cloud key read failed', err?.message || err);
    }
  }
  const chosen =
    (envPair?.mode === 'live' && envPair) ||
    (cloudPair?.mode === 'live' && cloudPair) ||
    envPair ||
    cloudPair;
  if (!chosen) {
    const err = new Error('Razorpay credentials are not configured on the server.');
    err.statusCode = 500;
    throw err;
  }
  cachedKeys = chosen;
  cachedKeysAt = Date.now();
  return chosen;
}

async function getRazorpayClient() {
  const keys = await resolveRazorpayKeys();
  return { client: new Razorpay({ key_id: keys.key_id, key_secret: keys.key_secret }), keys };
}

/** Live price from the admin panel, falling back to the built-in default. */
const resolvePlanPrice = async (planId) => {
  const fallback = DEFAULT_PLAN_PRICES[planId];
  if (!adminReady()) return fallback;
  try {
    const snap = await getDb().collection('app_config').doc('plans').get();
    if (!snap.exists) return fallback;
    const raw = snap.data();
    const list = Array.isArray(raw?.plans) ? raw.plans : Array.isArray(raw) ? raw : [];
    const hit = list.find((p) => String(p?.id) === planId);
    const price = Number(hit?.price);
    return Number.isFinite(price) && price > 0 ? Math.round(price) : fallback;
  } catch (err) {
    console.warn('[Razorpay] could not read app_config/plans:', err?.message || err);
    return fallback;
  }
};

/** POST /api/create-order  body: { planId }  header: Bearer <Firebase ID token> */
export async function createOrderHandler(req, res) {
  cors(req, res);
  try {
    if (!adminReady()) {
      return res.status(503).json({
        error: 'SUBSCRIPTIONS_UNAVAILABLE',
        message: 'Subscriptions are temporarily unavailable. Please try again later.',
      });
    }

    const authUser = await verifyRequestUser(req, { checkRevoked: true });
    if (!authUser) {
      return res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'Please sign in again before paying.',
      });
    }

    const addOnId = String(req.body?.addOnId || '').trim();
    const planId = String(req.body?.planId || '').trim();
    let kind = 'plan';
    let sku = planId;
    let rupees = 0;

    let addonGrants = null;
    let customPayload = null;
    if (addOnId) {
      const catalog = await loadPlanCatalog();
      const addon = addonById(catalog, addOnId);
      if (!addon || !(Number(addon.price) > 0)) {
        return res.status(400).json({
          error: 'INVALID_ADDON',
          message: 'Unknown add-on.',
        });
      }
      kind = 'addon';
      sku = addon.id;
      rupees = Math.round(Number(addon.price));
      addonGrants = addon.grants && typeof addon.grants === 'object' ? addon.grants : {};
      if (isChatLimitAddon(addon)) {
        await loadFreePlanLimits().catch(() => null);
        let userData = {};
        try {
          const snap = await userDoc(authUser.uid).get();
          userData = snap.exists ? snap.data() || {} : {};
        } catch (err) {
          console.warn('[Razorpay] user read for add-on eligibility failed', err?.message || err);
        }
        const limits = getPlanLimits(
          effectivePlan(userData),
          authUser.email || userData.email,
          userData,
          null
        );
        if (!Number.isFinite(limits.maxSessionChars)) {
          return res.status(400).json({
            error: 'ADDON_NO_BENEFIT',
            message: 'Your current plan already has no chat character cap, so this increase would not add capacity.',
          });
        }
      }
    } else if (planId === 'custom' || req.body?.kind === 'custom') {
      const pricing = await loadCustomPricing();
      const quote = quoteCustomPlan(req.body?.selection || req.body?.customSelection, pricing);
      if (!quote.ok) {
        return res.status(400).json({
          error: 'INVALID_CUSTOM_PLAN',
          message: quote.errors[0] || 'That custom plan cannot be purchased.',
          errors: quote.errors,
        });
      }
      kind = 'custom';
      sku = 'custom';
      rupees = quote.totalRupees;
      customPayload = {
        selection: quote.selection,
        lines: quote.lines,
        limits: persistLimits(quote.limits),
        subtotalRupees: quote.subtotalRupees,
        taxRupees: quote.taxRupees,
        taxPercent: quote.taxPercent,
        totalRupees: quote.totalRupees,
      };
    } else if (VALID_PLANS.includes(planId)) {
      rupees = await resolvePlanPrice(planId);
    } else {
      return res.status(400).json({
        error: 'INVALID_PLAN',
        message: 'Unknown subscription plan.',
      });
    }

    const amountPaise = Math.round(rupees * 100);
    if (!Number.isFinite(amountPaise) || amountPaise < 100) {
      return res.status(400).json({
        error: 'INVALID_AMOUNT',
        message: 'Plan price is not configured correctly.',
      });
    }

    const { client: razorpay, keys } = await getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`.slice(0, 40),
      notes: {
        uid: authUser.uid,
        planId: kind === 'addon' ? '' : sku,
        addOnId: kind === 'addon' ? sku : '',
        kind,
      },
    });

    await orderDoc(order.id).set({
      uid: authUser.uid,
      email: authUser.email || '',
      kind,
      planId: kind === 'addon' ? '' : sku,
      addOnId: kind === 'addon' ? sku : '',
      grants: addonGrants,
      selection: customPayload?.selection || null,
      lines: customPayload?.lines || null,
      limits: customPayload?.limits || null,
      quotedRupees: customPayload?.totalRupees || rupees,
      taxPercent: customPayload?.taxPercent ?? 0,
      amount: amountPaise,
      status: 'created',
      createdAt: Date.now(),
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      planId: kind === 'addon' ? undefined : sku,
      addOnId: kind === 'addon' ? sku : undefined,
      amountRupees: rupees,
      selection: customPayload?.selection,
      lines: customPayload?.lines,
      key_id: keys.key_id,
      mode: keys.mode,
    });
  } catch (err) {
    console.error('[Razorpay] create-order error:', err);
    const status = err?.statusCode === 401 ? 401 : err?.statusCode || 500;
    if (status === 401) {
      return res.status(503).json({
        error: 'PAYMENTS_UNAVAILABLE',
        message: 'Payments are temporarily unavailable. Please try again later.',
      });
    }
    return res.status(500).json({
      error: 'ORDER_CREATE_FAILED',
      message: 'Failed to create Razorpay order.',
    });
  }
}

/**
 * POST /api/verify-payment
 * body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * header: Bearer <Firebase ID token>
 */
export async function verifyPaymentHandler(req, res) {
  cors(req, res);
  try {
    const authUser = await verifyRequestUser(req, { checkRevoked: true });
    if (!authUser) {
      return res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'Please sign in again so we can activate your plan.',
        success: false,
      });
    }

    const orderId = req.body?.razorpay_order_id;
    const paymentId = req.body?.razorpay_payment_id;
    const signature = req.body?.razorpay_signature;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.',
        success: false,
      });
    }

    const keySecret = (await resolveRazorpayKeys()).key_secret;
    if (!keySecret) {
      return res.status(503).json({
        error: 'NOT_CONFIGURED',
        message: 'Payments are temporarily unavailable.',
        success: false,
      });
    }

    if (!razorpaySignatureValid(orderId, paymentId, signature, keySecret)) {
      return res.status(400).json({
        error: 'SIGNATURE_MISMATCH',
        message: 'Payment signature verification failed.',
        success: false,
      });
    }

    if (!adminReady()) {
      console.error('[Razorpay] payment verified but Firebase Admin is not configured — plan NOT granted');
      return res.status(503).json({
        error: 'PLAN_GRANT_UNAVAILABLE',
        message: 'Payment received but the subscription could not be activated. Please contact support with your payment id.',
        success: false,
      });
    }

    let remotePayment = null;
    try {
      const { client } = await getRazorpayClient();
      remotePayment = await client.payments.fetch(String(paymentId));
    } catch (err) {
      console.warn('[Razorpay] payment lookup failed', err?.statusCode || err?.code || 'failed');
      return res.status(400).json({
        error: 'PAYMENT_LOOKUP_FAILED',
        message: 'This payment could not be confirmed.',
        success: false,
      });
    }

    const db = getDb();
    const orderRef = orderDoc(orderId);
    const payRef = paymentDoc(paymentId);
    const userRef = userDoc(authUser.uid);

    const grant = await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) {
        const err = new Error('UNKNOWN_ORDER');
        err.code = 'UNKNOWN_ORDER';
        throw err;
      }
      const order = orderSnap.data() || {};
      if (order.uid !== authUser.uid) {
        const err = new Error('ORDER_OWNER_MISMATCH');
        err.code = 'ORDER_OWNER_MISMATCH';
        throw err;
      }
      if (!paymentMatchesOrder(remotePayment, {
        id: orderId,
        amount: order.amount,
        currency: order.currency || 'INR',
      })) {
        const err = new Error('PAYMENT_MISMATCH');
        err.code = 'PAYMENT_MISMATCH';
        throw err;
      }
      if (order.status === 'paid') {
        return {
          alreadyPaid: true,
          kind: order.kind || 'plan',
          planId: order.planId || null,
          addOnId: order.addOnId || null,
          subscriptionExpiryDate: order.subscriptionExpiryDate || null,
          addOns: order.addOns || null,
        };
      }

      const paySnap = await tx.get(payRef);
      if (paySnap.exists) {
        const prev = paySnap.data() || {};
        if (prev.orderId && prev.orderId !== orderId) {
          const err = new Error('DUPLICATE_PAYMENT');
          err.code = 'DUPLICATE_PAYMENT';
          throw err;
        }
        return {
          alreadyPaid: true,
          kind: prev.kind || 'plan',
          planId: prev.planId || order.planId || null,
          addOnId: prev.addOnId || order.addOnId || null,
          subscriptionExpiryDate: prev.subscriptionExpiryDate || null,
          addOns: prev.addOns || null,
        };
      }

      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const now = Date.now();
      const kind = order.kind === 'addon' || order.addOnId
        ? 'addon'
        : order.kind === 'custom' || order.planId === 'custom'
          ? 'custom'
          : 'plan';

      if (kind === 'addon') {
        const addOnId = String(order.addOnId || '');
        const grants = order.grants && typeof order.grants === 'object' ? order.grants : {};
        const addOns = mergeAddOnGrants(userData.addOns, grants);
        const billingHistory = appendBillingHistory(userData.billingHistory, {
          at: now,
          orderId,
          paymentId,
          amountPaise: Number(order.amount) || 0,
          addOnId,
          kind: 'addon',
          status: 'paid',
        });
        tx.set(userRef, {
          addOns,
          billingHistory,
          planSource: userData.planSource || 'razorpay',
          planOrderId: orderId,
          paymentStatus: 'paid',
          updatedAt: now,
        }, { merge: true });
        tx.set(orderRef, {
          status: 'paid',
          paymentId,
          paidAt: now,
          addOns,
        }, { merge: true });
        tx.set(payRef, {
          uid: authUser.uid,
          orderId,
          kind: 'addon',
          addOnId,
          addOns,
          grantedAt: now,
        });
        return { alreadyPaid: false, kind: 'addon', addOnId, addOns, planId: userData.plan || 'free', subscriptionExpiryDate: userData.subscriptionExpiryDate || null };
      }

      if (kind === 'custom') {
        const lockedLimits = order.limits && typeof order.limits === 'object' ? order.limits : null;
        if (!lockedLimits) {
          const err = new Error('CUSTOM_QUOTE_MISSING');
          err.code = 'CUSTOM_QUOTE_MISSING';
          throw err;
        }
        const days = PLAN_DURATION_DAYS.custom || 30;
        const durationMs = days * 24 * 60 * 60 * 1000;
        const currentExpiry = Number(userData.subscriptionExpiryDate || 0);
        const subscriptionExpiryDate = nextExpiryFrom(currentExpiry, durationMs, now);
        const nextPlan = nextPlanAfterPurchase(userData.plan, currentExpiry, 'custom', now);
        const billingCycleStart = subscriptionExpiryDate - durationMs;
        const quotedLimits = { ...lockedLimits };
        for (const [key, value] of Object.entries(quotedLimits)) {
          quotedLimits[key] = value == null ? Number.POSITIVE_INFINITY : Number(value);
        }
        const currentLimits = getPlanLimits(
          String(userData.plan || 'free'),
          authUser.email || userData.email,
          userData,
          null
        );
        const activePaid = String(userData.plan || 'free') !== 'free' && currentExpiry > now;
        const grantedLimits = activePaid
          ? preferRicherLimits(userData.grantedLimits || currentLimits, quotedLimits)
          : { ...quotedLimits };
        const customPlan = {
          selection: order.selection || null,
          lines: order.lines || [],
          totalRupees: Number(order.quotedRupees) || Math.round((Number(order.amount) || 0) / 100),
          taxPercent: Number(order.taxPercent) || 0,
        };
        const billingHistory = appendBillingHistory(userData.billingHistory, {
          at: now,
          orderId,
          paymentId,
          amountPaise: Number(order.amount) || 0,
          planId: nextPlan,
          kind: 'custom',
          status: 'paid',
        });
        tx.set(userRef, {
          plan: nextPlan,
          subscriptionExpiryDate,
          billingCycleStart,
          planSource: 'razorpay',
          planOrderId: orderId,
          paymentStatus: 'paid',
          entitlementsVersion: CATALOG_VERSION,
          grantedLimits: persistLimits(grantedLimits),
          customPlan,
          billingHistory,
          lastExpiryEmailThreshold: null,
          updatedAt: now,
        }, { merge: true });
        tx.set(orderRef, {
          status: 'paid',
          paymentId,
          paidAt: now,
          planId: nextPlan,
          purchasedPlanId: 'custom',
          subscriptionExpiryDate,
        }, { merge: true });
        tx.set(payRef, {
          uid: authUser.uid,
          orderId,
          kind: 'custom',
          planId: nextPlan,
          purchasedPlanId: 'custom',
          subscriptionExpiryDate,
          grantedAt: now,
        });
        return {
          alreadyPaid: false,
          kind: 'custom',
          planId: nextPlan,
          purchasedPlanId: 'custom',
          subscriptionExpiryDate,
          customPlan,
        };
      }

      const planId = VALID_PLANS.includes(order.planId) ? order.planId : 'basic';
      const days = PLAN_DURATION_DAYS[planId] || 30;
      const durationMs = days * 24 * 60 * 60 * 1000;
      const currentExpiry = Number(userData.subscriptionExpiryDate || 0);
      const subscriptionExpiryDate = nextExpiryFrom(currentExpiry, durationMs, now);
      const nextPlan = nextPlanAfterPurchase(userData.plan, currentExpiry, planId, now);
      const billingCycleStart = subscriptionExpiryDate - durationMs;
      const catalogLimits = DEFAULT_PAID_LIMITS[nextPlan] || DEFAULT_PAID_LIMITS.pro;
      const currentLimits = getPlanLimits(
        String(userData.plan || 'free'),
        authUser.email || userData.email,
        userData,
        null
      );
      const activePaid = String(userData.plan || 'free') !== 'free' && currentExpiry > now;
      const grantedLimits = activePaid
        ? preferRicherLimits(userData.grantedLimits || currentLimits, catalogLimits)
        : { ...catalogLimits };
      const billingHistory = appendBillingHistory(userData.billingHistory, {
        at: now,
        orderId,
        paymentId,
        amountPaise: Number(order.amount) || 0,
        planId: nextPlan,
        kind: 'plan',
        status: 'paid',
      });

      tx.set(userRef, {
        plan: nextPlan,
        subscriptionExpiryDate,
        billingCycleStart,
        planSource: 'razorpay',
        planOrderId: orderId,
        paymentStatus: 'paid',
        entitlementsVersion: CATALOG_VERSION,
        grantedLimits: persistLimits(grantedLimits),
        billingHistory,
        lastExpiryEmailThreshold: null,
        updatedAt: now,
      }, { merge: true });
      tx.set(orderRef, {
        status: 'paid',
        paymentId,
        paidAt: now,
        planId: nextPlan,
        purchasedPlanId: planId,
        subscriptionExpiryDate,
      }, { merge: true });
      tx.set(payRef, {
        uid: authUser.uid,
        orderId,
        kind: 'plan',
        planId: nextPlan,
        purchasedPlanId: planId,
        subscriptionExpiryDate,
        grantedAt: now,
      });
      return { alreadyPaid: false, kind: 'plan', planId: nextPlan, purchasedPlanId: planId, subscriptionExpiryDate };
    });

    if (grant.alreadyPaid) {
      return res.status(200).json({
        success: true,
        message: 'Payment already activated.',
        planId: grant.planId,
        addOnId: grant.addOnId || undefined,
        subscriptionExpiryDate: grant.subscriptionExpiryDate || null,
      });
    }

    return res.status(200).json({
      success: true,
      message: grant.kind === 'addon'
        ? 'Payment verified and add-on activated.'
        : grant.kind === 'custom'
          ? 'Payment verified and custom plan activated.'
          : 'Payment verified and plan activated.',
      order_id: orderId,
      payment_id: paymentId,
      planId: grant.planId,
      addOnId: grant.addOnId || undefined,
      subscriptionExpiryDate: grant.subscriptionExpiryDate,
    });
  } catch (err) {
    const code = err?.code || '';
    if (code === 'UNKNOWN_ORDER') {
      return res.status(400).json({ error: code, message: 'This order was not created by casemate.', success: false });
    }
    if (code === 'ORDER_OWNER_MISMATCH') {
      return res.status(403).json({ error: code, message: 'This payment belongs to a different account.', success: false });
    }
    if (code === 'DUPLICATE_PAYMENT') {
      return res.status(409).json({ error: code, message: 'This payment was already used for another order.', success: false });
    }
    if (code === 'CUSTOM_QUOTE_MISSING') {
      return res.status(400).json({ error: code, message: 'This custom-plan order has no locked quote. It was not activated.', success: false });
    }
    if (code === 'PAYMENT_MISMATCH') {
      return res.status(400).json({ error: code, message: 'This payment does not match the Casemate order.', success: false });
    }
    console.error('[Razorpay] verify-payment error:', err?.code || 'failed');
    return res.status(500).json({
      error: 'VERIFY_FAILED',
      message: 'Failed to verify payment.',
      success: false,
    });
  }
}

export function razorpayOptionsHandler(req, res) {
  cors(req, res);
  res.status(204).end();
}
