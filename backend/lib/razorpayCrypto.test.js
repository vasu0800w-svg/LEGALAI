import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { razorpaySignatureValid, paymentMatchesOrder } from './razorpayCrypto.js';

const secret = 'test_secret';
const orderId = 'order_abc';
const paymentId = 'pay_123';
const goodSig = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

test('valid Razorpay signatures are accepted', () => {
  assert.equal(razorpaySignatureValid(orderId, paymentId, goodSig, secret), true);
});

test('altered, mismatched, and empty signatures are rejected', () => {
  assert.equal(razorpaySignatureValid(orderId, paymentId, '0'.repeat(goodSig.length), secret), false);
  assert.equal(razorpaySignatureValid(orderId, 'pay_OTHER', goodSig, secret), false);
  assert.equal(razorpaySignatureValid(orderId, paymentId, goodSig.slice(0, 8), secret), false);
  assert.equal(razorpaySignatureValid(orderId, paymentId, '', secret), false);
});

test('replayed payment for a different order amount is rejected', () => {
  const payment = { order_id: orderId, status: 'captured', amount: 49900, currency: 'INR' };
  const order = { id: orderId, amount: 19900, currency: 'INR' };
  assert.equal(paymentMatchesOrder(payment, order), false);
});

test('captured payment matching the stored order is accepted', () => {
  const payment = { order_id: orderId, status: 'captured', amount: 19900, currency: 'INR' };
  const order = { id: orderId, amount: 19900, currency: 'INR' };
  assert.equal(paymentMatchesOrder(payment, order), true);
});

test('failed or created payments cannot grant a plan', () => {
  const order = { id: orderId, amount: 19900, currency: 'INR' };
  assert.equal(paymentMatchesOrder({ order_id: orderId, status: 'failed', amount: 19900, currency: 'INR' }, order), false);
  assert.equal(paymentMatchesOrder({ order_id: 'order_other', status: 'captured', amount: 19900, currency: 'INR' }, order), false);
});
