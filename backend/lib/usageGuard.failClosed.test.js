import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveAiRequest, reserveDraft } from './usageGuard.js';

const deviceId = 'a'.repeat(32);

test('AI reservation fails closed when Firebase Admin is unavailable', async () => {
  const result = await reserveAiRequest({
    uid: 'user-a',
    email: 'a@example.com',
    deviceId,
    contents: [{ text: 'hello' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'USAGE_UNAVAILABLE');
  assert.equal(result.skipped, undefined);
});

test('draft reservation fails closed when Firebase Admin is unavailable', async () => {
  const result = await reserveDraft({ uid: 'user-a', email: 'a@example.com' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'USAGE_UNAVAILABLE');
});

test('parallel AI reservations cannot skip the fail-closed path', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      reserveAiRequest({
        uid: 'user-a',
        email: 'a@example.com',
        deviceId,
        contents: [{ text: 'hello' }],
      })
    )
  );
  assert.equal(results.length, 8);
  assert.ok(results.every((r) => r.ok === false && r.code === 'USAGE_UNAVAILABLE'));
});
