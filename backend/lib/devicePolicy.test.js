import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceId } from './devicePolicy.js';

test('missing or short device ids cannot be used', () => {
  assert.equal(parseDeviceId(''), null);
  assert.equal(parseDeviceId('abc'), null);
  assert.equal(parseDeviceId('short-id'), null);
});

test('spoofed ids with spaces or punctuation are rejected', () => {
  assert.equal(parseDeviceId('device id with spaces!!!!'), null);
  assert.equal(parseDeviceId('../../etc/passwd______________'), null);
});

test('the app install id format is accepted', () => {
  assert.equal(parseDeviceId('a'.repeat(32)), 'a'.repeat(32));
  assert.equal(parseDeviceId('Ab12_-'.repeat(4)), 'Ab12_-'.repeat(4));
});
