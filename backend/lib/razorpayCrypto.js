import crypto from 'crypto';

export const razorpaySignatureValid = (orderId, paymentId, signature, keySecret) => {
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', String(keySecret || '')).update(payload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

export const paymentMatchesOrder = (payment, order) => {
  if (!payment || !order) return false;
  if (String(payment.order_id || '') !== String(order.razorpayOrderId || order.id || '')) return false;
  const status = String(payment.status || '');
  if (status !== 'captured' && status !== 'authorized') return false;
  const paid = Number(payment.amount);
  const expected = Number(order.amount);
  if (!Number.isFinite(paid) || !Number.isFinite(expected) || paid !== expected) return false;
  if (String(payment.currency || 'INR').toUpperCase() !== String(order.currency || 'INR').toUpperCase()) return false;
  return true;
};
