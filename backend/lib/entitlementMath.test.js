import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countMessageChars,
  countCasePhotos,
  remainingOf,
  nextExpiryFrom,
  nextPlanAfterPurchase,
  seedMonthDrafts,
  applyAddOnGrants,
  mergeAddOnGrants,
  activeExtraSessionChars,
  utcMonthKey,
  utcMonthEndMs,
  publicDevices,
  annualSavings,
  resolvePaidLimits,
  CATALOG_VERSION,
  preferRicherLimits,
  persistLimits,
  reviveLimits,
} from './entitlementMath.js';

test('character limits count message.text only, never image bytes', () => {
  const messages = [
    { text: 'hello', attachments: [{ type: 'case', size: 5_000_000 }] },
    { text: 'world', attachments: [{ type: 'format' }] },
  ];
  assert.equal(countMessageChars(messages), 10);
  assert.equal(countMessageChars([{ inlineData: { data: 'AAAA'.repeat(1000) } }]), 0);
});

test('photo counts are case attachments, not character length', () => {
  const messages = [
    { text: 'a'.repeat(500), attachments: [{ type: 'case' }, { type: 'case' }, { type: 'format' }] },
  ];
  assert.equal(countCasePhotos(messages, 3), 5);
});

test('payment grant never shortens an active expiry', () => {
  const now = 1_700_000_000_000;
  const current = now + 10 * 86400000;
  const next = nextExpiryFrom(current, 30 * 86400000, now);
  assert.equal(next, current + 30 * 86400000);
  assert.ok(next > current);
});

test('buying a lower plan while a higher plan is active keeps the higher plan', () => {
  const now = Date.now();
  const expiry = now + 20 * 86400000;
  assert.equal(nextPlanAfterPurchase('pro', expiry, 'basic', now), 'pro');
  assert.equal(nextPlanAfterPurchase('basic', expiry, 'pro', now), 'pro');
  assert.equal(nextPlanAfterPurchase('basic', expiry, 'starter', now), 'basic');
  assert.equal(nextPlanAfterPurchase('starter', expiry, 'basic', now), 'basic');
  assert.equal(nextPlanAfterPurchase('pro', now - 1000, 'basic', now), 'basic');
  assert.equal(nextPlanAfterPurchase('pro', expiry, 'custom', now), 'pro');
  assert.equal(nextPlanAfterPurchase('free', expiry, 'custom', now), 'custom');
});

test('monthDrafts seed preserves existing client draftCount in the same month', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const seeded = seedMonthDrafts(undefined, 3, now.getMonth(), '2026-10', now);
  assert.equal(seeded, 3);
  const fromServer = seedMonthDrafts({ month: '2026-10', monthDrafts: 5 }, 3, now.getMonth(), '2026-10', now);
  assert.equal(fromServer, 5);
  const otherMonth = seedMonthDrafts(undefined, 3, (now.getMonth() + 1) % 12, '2026-10', now);
  assert.equal(otherMonth, 0);
});

test('add-on grants increase finite allowances only', () => {
  const free = applyAddOnGrants({ draftLimit: 5, monthlyImages: 150, dailyAiRequests: 20 }, { extraDrafts: 10, extraMonthlyImages: 100 });
  assert.equal(free.draftLimit, 15);
  assert.equal(free.monthlyImages, 250);
  const paid = applyAddOnGrants({ draftLimit: Number.POSITIVE_INFINITY, monthlyImages: Number.POSITIVE_INFINITY }, { extraDrafts: 10 });
  assert.equal(paid.draftLimit, Number.POSITIVE_INFINITY);
});

test('duplicate add-on purchases stack', () => {
  const once = mergeAddOnGrants({}, { extraDrafts: 10 });
  const twice = mergeAddOnGrants(once, { extraDrafts: 10 });
  assert.equal(twice.extraDrafts, 20);
});

test('chat-limit add-on raises maxSessionChars for every chat in the purchase month only', () => {
  const oct = Date.parse('2026-10-15T12:00:00Z');
  const nov = Date.parse('2026-11-01T00:00:00Z');
  const granted = mergeAddOnGrants({}, { extraSessionChars: 20000 }, oct);
  assert.equal(granted.extraSessionChars, 20000);
  assert.equal(granted.extraSessionCharsMonth, '2026-10');
  assert.equal(granted.extraSessionCharsUntil, utcMonthEndMs(oct));
  assert.equal(activeExtraSessionChars(granted, oct), 20000);
  assert.equal(applyAddOnGrants({ maxSessionChars: 20000 }, granted, oct).maxSessionChars, 40000);
  assert.equal(applyAddOnGrants({ maxSessionChars: 20000 }, granted, nov).maxSessionChars, 20000);
  const stacked = mergeAddOnGrants(granted, { extraSessionChars: 50000 }, oct);
  assert.equal(stacked.extraSessionChars, 70000);
  const rolled = mergeAddOnGrants(granted, { extraSessionChars: 50000 }, nov);
  assert.equal(rolled.extraSessionChars, 50000);
  assert.equal(rolled.extraSessionCharsMonth, utcMonthKey(nov));
  const unlimited = applyAddOnGrants({ maxSessionChars: Number.POSITIVE_INFINITY }, granted, oct);
  assert.equal(unlimited.maxSessionChars, Number.POSITIVE_INFINITY);
});

test('remaining counters never go negative', () => {
  assert.equal(remainingOf(7, 5), 0);
  assert.equal(remainingOf(2, 5), 3);
  assert.equal(remainingOf(0, Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
});

test('annual savings at list prices is ₹24,998 / 41.7%', () => {
  const s = annualSavings(4999, 34990);
  assert.equal(s.twelveMonthCost, 59988);
  assert.equal(s.annualPrice, 34990);
  assert.equal(s.saved, 24998);
  assert.equal(s.percent, 41.7);
});

test('existing paid users without catalog version keep legacy limits', () => {
  const catalog = { draftLimit: 50, maxPhotosPerUpload: 80 };
  const legacy = { draftLimit: Number.POSITIVE_INFINITY, maxPhotosPerUpload: 40 };
  const now = 2_000_000_000_000;
  const kept = resolvePaidLimits({
    plan: 'basic',
    expiry: now + 1000,
    entitlementsVersion: undefined,
    grantedLimits: null,
    catalogLimits: catalog,
    legacyLimits: legacy,
    now,
  });
  assert.equal(kept.draftLimit, Number.POSITIVE_INFINITY);
  const fresh = resolvePaidLimits({
    plan: 'basic',
    expiry: now + 1000,
    entitlementsVersion: CATALOG_VERSION,
    grantedLimits: null,
    catalogLimits: catalog,
    legacyLimits: legacy,
    now,
  });
  assert.equal(fresh.draftLimit, 50);
  const snap = resolvePaidLimits({
    plan: 'basic',
    expiry: now + 1000,
    entitlementsVersion: CATALOG_VERSION,
    grantedLimits: { draftLimit: 80 },
    catalogLimits: catalog,
    legacyLimits: legacy,
    now,
  });
  assert.equal(snap.draftLimit, 80);
});

test('unlimited limits persist as null and revive to Infinity', () => {
  const stored = persistLimits({ draftLimit: Number.POSITIVE_INFINITY, maxPhotosPerUpload: 80 });
  assert.equal(stored.draftLimit, null);
  assert.equal(stored.maxPhotosPerUpload, 80);
  const live = reviveLimits(stored, { draftLimit: 50, maxPhotosPerUpload: 40 });
  assert.equal(live.draftLimit, Number.POSITIVE_INFINITY);
  assert.equal(live.maxPhotosPerUpload, 80);
});

test('renewal cannot cut an active unlimited draft grant', () => {
  const kept = preferRicherLimits(
    { draftLimit: Number.POSITIVE_INFINITY, maxPhotosPerUpload: 40 },
    { draftLimit: 50, maxPhotosPerUpload: 80 }
  );
  assert.equal(kept.draftLimit, Number.POSITIVE_INFINITY);
  assert.equal(kept.maxPhotosPerUpload, 80);
});

test('devices expose only id and lastSeen, not fingerprints', () => {
  const now = Date.now();
  const listed = publicDevices(
    [
      { id: 'abc', lastSeen: now, userAgent: 'secret', ip: '1.1.1.1' },
      { id: 'old', lastSeen: now - 20 * 86400000 },
    ],
    'abc',
    now
  );
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], { id: 'abc', lastSeen: now, current: true });
});
