import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, applyCors, applySecurityHeaders, safeErrorMessage } from './httpSecurity.js';

test('production Casemate origins are allowed', () => {
  assert.equal(isAllowedOrigin('https://meetcasemate.com'), true);
  assert.equal(isAllowedOrigin('https://legalai-78759.web.app'), true);
  assert.equal(isAllowedOrigin('http://localhost:5173'), true);
});

test('unknown websites are not allowed', () => {
  assert.equal(isAllowedOrigin('https://evil.example'), false);
  assert.equal(isAllowedOrigin('https://meetcasemate.com.evil.com'), false);
});

test('missing origin is allowed for native and same-origin calls', () => {
  assert.equal(isAllowedOrigin(''), true);
  assert.equal(isAllowedOrigin(undefined), true);
});

test('CORS does not echo an unapproved origin', () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  applyCors({ headers: { origin: 'https://evil.example' } }, res);
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
});

test('CORS echoes an approved origin', () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  applyCors({ headers: { origin: 'https://meetcasemate.com' } }, res);
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://meetcasemate.com');
});

test('security headers include nosniff and deny framing', () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  applySecurityHeaders({}, res);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
});

test('safeErrorMessage hides key-like text', () => {
  assert.equal(safeErrorMessage({ message: 'GEMINI_API_KEY missing' }, 'Request failed.'), 'Request failed.');
  assert.equal(safeErrorMessage({ message: 'Order not found' }, 'Request failed.'), 'Order not found');
});
