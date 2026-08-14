/**
 * Razorpay Standard Checkout — create order + verify signature.
 * KEY_SECRET stays server-side only.
 */
import Razorpay from 'razorpay';
import crypto from 'crypto';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

function getRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    const err = new Error('Razorpay credentials are not configured on the server.');
    err.statusCode = 500;
    throw err;
  }
  return new Razorpay({ key_id, key_secret });
}

/** POST /api/create-order  body: { amount (paise), currency?, receipt? } */
export async function createOrderHandler(req, res) {
  cors(res);
  try {
    const amount = Number(req.body?.amount);
    const currency = (req.body?.currency || 'INR').toUpperCase();
    const receipt = (req.body?.receipt || `rcpt_${Date.now()}`).toString().slice(0, 40);

    if (!Number.isFinite(amount) || amount < 100) {
      return res.status(400).json({
        error: 'INVALID_AMOUNT',
        message: 'Amount must be at least 100 paise (₹1).',
      });
    }

    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: Math.round(amount),
      currency,
      receipt,
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
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

/** POST /api/verify-payment  body: { razorpay_order_id, razorpay_payment_id, razorpay_signature } */
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
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({
        error: 'NOT_CONFIGURED',
        message: 'Razorpay KEY_SECRET is not configured on the server.',
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

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully.',
      order_id: orderId,
      payment_id: paymentId,
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
