import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdminEmail, requireAdmin } from './adminAuth.js';

const here = dirname(fileURLToPath(import.meta.url));

test('only the configured admin email is treated as admin', () => {
  assert.equal(isAdminEmail('admin@casemate.com'), true);
  assert.equal(isAdminEmail(' ADMIN@casemate.com '), true);
  assert.equal(isAdminEmail('advocate@example.com'), false);
  assert.equal(isAdminEmail(''), false);
});

test('admin source does not embed a default password', () => {
  const files = [
    '../lib/adminAuth.js',
    '../../frontend/utils/adminIdentity.ts',
    '../../frontend/components/AuthScreen.tsx',
    '../../frontend/components/AdminDashboard.tsx',
    '../../frontend/services/adminConfigService.ts',
  ];
  for (const rel of files) {
    const text = readFileSync(resolve(here, rel), 'utf8');
    assert.equal(text.toLowerCase().includes('admin123'), false, rel);
    assert.equal(/password\s*[:=]\s*['"][^'"]+['"]/i.test(text), false, rel);
  }
});

test('admin HTTP routes reject missing auth without leaking account details', async () => {
  const headers = {};
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const user = await requireAdmin({ headers: {} }, res);
  assert.equal(user, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'FORBIDDEN');
  assert.equal(JSON.stringify(res.body).includes('casemate.com'), false);
});
