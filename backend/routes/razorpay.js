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
import crypto from 'crypto';
import { adminReady, adminInitError, getDb, userDoc, orderDoc } from '../lib/firebaseAdmin.js';
import { verifyRequestUser } from '../lib/authUser.js';
import { DEFAULT_PLAN_PRICES, PLAN_DURATION_DAYS } from '../middleware/planLimits.js';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

const VALID_PLANS = ['basic', 'pro', 'annual'];

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
  cors(res);
  try {
    if (!adminReady()) {
      return res.status(503).json({
        error: 'SUBSCRIPTIONS_UNAVAILABLE',
        message: 'Subscriptions are temporarily unavailable. Please try again later.',
        detail: adminInitError(),
      });
    }

    const authUser = await verifyRequestUser(req);
    if (!authUser) {
      return res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'Please sign in again before paying.',
      });
    }

    const planId = String(req.body?.planId || '').trim();
    if (!VALID_PLANS.includes(planId)) {
      return res.status(400).json({
        error: 'INVALID_PLAN',
        message: 'Unknown subscription plan.',
      });
    }

    const rupees = await resolvePlanPrice(planId);
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
      notes: { uid: authUser.uid, planId },
    });

    await orderDoc(order.id).set({
      uid: authUser.uid,
      email: authUser.email || '',
      planId,
      amount: amountPaise,
      status: 'created',
      createdAt: Date.now(),
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      planId,
      amountRupees: rupees,
      key_id: keys.key_id,
      mode: keys.mode,
    });
  } catch (err) {
    console.error('[Razorpay] create-order error:', err);
    const status = err?.statusCode === 401 ? 401 : err?.statusCode || 500;
    if (status === 401) {
      return res.status(401).json({
        error: 'AUTH_FAILED',
        message: 'Razorpay authentication failed. Check KEY_ID / KEY_SECRET.',
      });
    }
    return res.status(500).json({
      error: 'ORDER_CREATE_FAILED',
      message: err?.error?.description || err?.message || 'Failed to create Razorpay order.',
    });
  }
}

/**
 * POST /api/verify-payment
 * body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * header: Bearer <Firebase ID token>
 */
export async function verifyPaymentHandler(req, res) {
  cors(res);
  try {
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
      return res.status(500).json({
        error: 'NOT_CONFIGURED',
        message: 'Razorpay KEY_SECRET is not configured on the server.',
        success: false,
      });
    }

    const payload = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({
        error: 'SIGNATURE_MISMATCH',
        message: 'Payment signature verification failed.',
        success: false,
      });
    }

    if (!adminReady()) {
      // Signature is valid but we cannot record the plan. Say so loudly instead
      // of letting the phone grant itself a subscription.
      console.error('[Razorpay] payment verified but Firebase Admin is not configured — plan NOT granted:', orderId);
      return res.status(503).json({
        error: 'PLAN_GRANT_UNAVAILABLE',
        message: 'Payment received but the subscription could not be activated. Please contact support with your payment id.',
        success: false,
        payment_id: paymentId,
      });
    }

    const authUser = await verifyRequestUser(req);
    if (!authUser) {
      return res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'Please sign in again so we can activate your plan.',
        success: false,
      });
    }

    const orderRef = orderDoc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return res.status(400).json({
        error: 'UNKNOWN_ORDER',
        message: 'This order was not created by casemate.',
        success: false,
      });
    }
    const order = orderSnap.data();
    if (order.uid !== authUser.uid) {
      return res.status(403).json({
        error: 'ORDER_OWNER_MISMATCH',
        message: 'This payment belongs to a different account.',
        success: false,
      });
    }
    if (order.status === 'paid') {
      return res.status(200).json({
        success: true,
        message: 'Payment already activated.',
        planId: order.planId,
        subscriptionExpiryDate: order.subscriptionExpiryDate || null,
      });
    }

    const planId = VALID_PLANS.includes(order.planId) ? order.planId : 'basic';
    const days = PLAN_DURATION_DAYS[planId] || 30;
    const now = Date.now();

    // Extend an existing subscription instead of shortening it.
    const userSnap = await userDoc(authUser.uid).get();
    const currentExpiry = Number(userSnap.exists ? userSnap.data()?.subscriptionExpiryDate || 0 : 0);
    const base = currentExpiry > now ? currentExpiry : now;
    const subscriptionExpiryDate = base + days * 24 * 60 * 60 * 1000;

    await userDoc(authUser.uid).set({
      plan: planId,
      subscriptionExpiryDate,
      planSource: 'razorpay',
      planOrderId: orderId,
      lastExpiryEmailThreshold: null,
      updatedAt: now,
    }, { merge: true });

    await orderRef.set({
      status: 'paid',
      paymentId,
      paidAt: now,
      subscriptionExpiryDate,
    }, { merge: true });

    return res.status(200).json({
      success: true,
      message: 'Payment verified and plan activated.',
      order_id: orderId,
      payment_id: paymentId,
      planId,
      subscriptionExpiryDate,
    });
  } catch (err) {
    console.error('[Razorpay] verify-payment error:', err);
    return res.status(500).json({
      error: 'VERIFY_FAILED',
      message: err?.message || 'Failed to verify payment.',
      success: false,
    });
  }
}

export function razorpayOptionsHandler(_req, res) {
  cors(res);
  res.status(204).end();
}
