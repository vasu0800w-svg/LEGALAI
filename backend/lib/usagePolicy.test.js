import test from 'node:test';
import assert from 'node:assert/strict';
import { usageUnavailable } from './usagePolicy.js';

test('usage verification failures fail closed and do not skip quota', () => {
  const result = usageUnavailable();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'USAGE_UNAVAILABLE');
  assert.equal(result.skipped, undefined);
});
