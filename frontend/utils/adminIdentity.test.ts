import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_EMAIL, isAdminEmail } from './adminIdentity.ts';

test('only the configured admin email is treated as admin', () => {
  assert.equal(ADMIN_EMAIL.includes('@'), true);
  assert.equal(isAdminEmail(ADMIN_EMAIL), true);
  assert.equal(isAdminEmail(` ${ADMIN_EMAIL.toUpperCase()} `), true);
  assert.equal(isAdminEmail('advocate@example.com'), false);
  assert.equal(isAdminEmail(''), false);
});
