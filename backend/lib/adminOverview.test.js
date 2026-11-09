import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySiteStats, mergeAdminUsers } from './adminOverview.js';

test('mergeAdminUsers combines Auth, profile, and presence without leaking admin', () => {
  const users = mergeAdminUsers([
    {
      id: 'u1',
      name: '',
      email: 'advocate@example.com',
      createdAt: 100,
      lastSignInAt: 400,
      emailVerified: true,
    },
    {
      id: 'u1',
      name: 'Priya',
      email: 'advocate@example.com',
      plan: 'pro',
      createdAt: 100,
    },
    {
      id: 'u1',
      lastSeen: 900,
      plan: 'pro',
    },
    {
      id: 'admin',
      email: 'admin@casemate.com',
      name: 'System Admin',
    },
    {
      id: 'admin_config_api_keys',
      email: 'hidden@example.com',
    },
  ]);
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'u1');
  assert.equal(users[0].name, 'Priya');
  assert.equal(users[0].plan, 'pro');
  assert.equal(users[0].lastSeen, 900);
  assert.equal(users[0].lastSignInAt, 400);
  assert.equal(users[0].emailVerified, true);
});

test('empty site stats start at zero', () => {
  assert.deepEqual(emptySiteStats(), { visits: 0, logins: 0, signups: 0 });
});
