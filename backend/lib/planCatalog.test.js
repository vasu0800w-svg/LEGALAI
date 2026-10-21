import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAddOns, DEFAULT_CHAT_LIMIT_ADDONS, isChatLimitAddon, DEFAULT_PLAN_PRICES } from './planCatalog.js';
import { annualSavings } from './entitlementMath.js';

test('chat-limit add-ons are ₹199 / +20,000 and ₹399 / +50,000 by default', () => {
  const a = DEFAULT_CHAT_LIMIT_ADDONS.find((x) => x.id === 'chat_chars_20k');
  const b = DEFAULT_CHAT_LIMIT_ADDONS.find((x) => x.id === 'chat_chars_50k');
  assert.equal(a.price, 199);
  assert.equal(a.grants.extraSessionChars, 20000);
  assert.equal(b.price, 399);
  assert.equal(b.grants.extraSessionChars, 50000);
  assert.equal(a.billingPeriod, 'month');
});

test('live add-on lists still receive chat-limit SKUs when they were omitted', () => {
  const list = sanitizeAddOns([
    { id: 'extra_drafts', name: 'Extra drafts', price: 499, grants: { extraDrafts: 10 } },
  ]);
  assert.ok(list.some((a) => a.id === 'extra_drafts'));
  assert.ok(list.some((a) => a.id === 'chat_chars_20k'));
  assert.ok(list.some((a) => a.id === 'chat_chars_50k'));
  assert.equal(list.filter(isChatLimitAddon).length, 2);
});

test('shipped list prices match the published catalog', () => {
  assert.equal(DEFAULT_PLAN_PRICES.basic, 2999);
  assert.equal(DEFAULT_PLAN_PRICES.pro, 4999);
  assert.equal(DEFAULT_PLAN_PRICES.annual, 34990);
  const save = annualSavings(4999, 34990);
  assert.equal(save.twelveMonthCost, 59988);
  assert.equal(save.saved, 24998);
  assert.equal(save.percent, 41.7);
});

test('admin prices for chat-limit SKUs are kept when present', () => {
  const list = sanitizeAddOns([
    { id: 'chat_chars_20k', name: 'Custom 20k', price: 250, grants: { extraSessionChars: 20000 } },
  ]);
  const hit = list.find((a) => a.id === 'chat_chars_20k');
  assert.equal(hit.price, 250);
  assert.ok(list.some((a) => a.id === 'chat_chars_50k'));
});
