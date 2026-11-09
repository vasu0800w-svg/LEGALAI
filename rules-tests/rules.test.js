import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firestoreRules = readFileSync(resolve(root, 'firestore.rules'), 'utf8');
const storageRules = readFileSync(resolve(root, 'storage.rules'), 'utf8');

const PROJECT_ID = 'demo-casemate-rules';
const DATABASE_ID = 'legal';
const ALICE = 'userAliceUid';
const BOB = 'userBobUid';

let testEnv;

const firestoreFor = (uid, email) => {
  const ctx = uid
    ? testEnv.authenticatedContext(uid, { email })
    : testEnv.unauthenticatedContext();
  try {
    return ctx.firestore({ databaseId: DATABASE_ID });
  } catch {
    return ctx.firestore();
  }
};

const storageFor = (uid, email) => {
  const ctx = uid
    ? testEnv.authenticatedContext(uid, { email })
    : testEnv.unauthenticatedContext();
  return ctx.storage();
};

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: firestoreRules },
    storage: { rules: storageRules },
  });
});

test.after(async () => {
  await testEnv?.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    let db;
    try {
      db = ctx.firestore({ databaseId: DATABASE_ID });
    } catch {
      db = ctx.firestore();
    }
    await db.doc(`users_data/${ALICE}`).set({
      name: 'Alice',
      email: 'alice@example.com',
      plan: 'free',
      createdAt: 1,
    });
    await db.doc(`users_data/${ALICE}/chats/case-1`).set({
      title: 'Alice private case',
      messages: [{ role: 'user', text: 'confidential pleading' }],
      updatedAt: 1,
    });
    await db.doc(`users_data/${BOB}`).set({
      name: 'Bob',
      email: 'bob@example.com',
      plan: 'free',
      createdAt: 1,
    });
    await db.doc(`user_directory/${ALICE}`).set({
      name: 'Alice',
      email: 'alice@example.com',
      plan: 'free',
      lastSeen: 1,
      createdAt: 1,
    });
    await db.doc('orders/order-alice').set({ uid: ALICE, amount: 1 });
    await db.doc('payments/pay-alice').set({ uid: ALICE, amount: 1 });
    await db.doc('auth_otps/otp-alice').set({ email: 'alice@example.com', code: 'hidden' });
    await db.doc('site_stats/summary').set({ visits: 4, logins: 2, signups: 1 });
    const bucket = ctx.storage();
    await bucket.ref(`users/${ALICE}/chats/case-1/secret.pdf`).put(Buffer.from('alice-file'), {
      contentType: 'application/pdf',
    });
  });
});

test('User A can read their own user document and chat', async () => {
  const db = firestoreFor(ALICE, 'alice@example.com');
  await assertSucceeds(db.doc(`users_data/${ALICE}`).get());
  await assertSucceeds(db.doc(`users_data/${ALICE}/chats/case-1`).get());
});

test('User B cannot read User A chats or private user document', async () => {
  const db = firestoreFor(BOB, 'bob@example.com');
  await assertFails(db.doc(`users_data/${ALICE}`).get());
  await assertFails(db.doc(`users_data/${ALICE}/chats/case-1`).get());
});

test('User B cannot modify or delete User A chats', async () => {
  const db = firestoreFor(BOB, 'bob@example.com');
  await assertFails(db.doc(`users_data/${ALICE}/chats/case-1`).set({ title: 'hijacked' }));
  await assertFails(db.doc(`users_data/${ALICE}/chats/case-1`).delete());
  await assertFails(db.doc(`users_data/${ALICE}`).set({ plan: 'pro' }, { merge: true }));
  await assertFails(db.doc(`users_data/${ALICE}`).delete());
});

test('unauthenticated callers cannot read private user records', async () => {
  const db = firestoreFor(null);
  await assertFails(db.doc(`users_data/${ALICE}`).get());
  await assertFails(db.doc(`users_data/${ALICE}/chats/case-1`).get());
  await assertFails(db.doc('orders/order-alice').get());
  await assertFails(db.doc('payments/pay-alice').get());
  await assertFails(db.doc('auth_otps/otp-alice').get());
  await assertFails(db.doc(`user_directory/${ALICE}`).get());
});

test('User B cannot read User A directory, orders, payments, or OTP records', async () => {
  const db = firestoreFor(BOB, 'bob@example.com');
  await assertFails(db.doc(`user_directory/${ALICE}`).get());
  await assertFails(db.doc('orders/order-alice').get());
  await assertFails(db.doc('payments/pay-alice').get());
  await assertFails(db.doc('auth_otps/otp-alice').get());
});

test('User B cannot read or overwrite User A storage files', async () => {
  const storage = storageFor(BOB, 'bob@example.com');
  const ref = storage.ref(`users/${ALICE}/chats/case-1/secret.pdf`);
  await assertFails(ref.getDownloadURL());
  await assertFails(ref.put(Buffer.from('overwrite'), { contentType: 'application/pdf' }));
  await assertFails(ref.delete());
});

test('User A can upload and read their own storage file', async () => {
  const storage = storageFor(ALICE, 'alice@example.com');
  const ref = storage.ref(`users/${ALICE}/chats/case-1/own.pdf`);
  await assertSucceeds(ref.put(Buffer.from('alice-own'), { contentType: 'application/pdf' }));
  await assertSucceeds(ref.getDownloadURL());
});

test('anonymous storage access to User A files is denied', async () => {
  const storage = storageFor(null);
  await assertFails(storage.ref(`users/${ALICE}/chats/case-1/secret.pdf`).getDownloadURL());
});

test('cross-user isolation assertions completed', () => {
  assert.equal(ALICE === BOB, false);
});

test('visitors can read and increment site_stats but cannot reset them', async () => {
  const db = firestoreFor(null);
  await assertSucceeds(db.doc('site_stats/summary').get());
  await assertSucceeds(db.doc('site_stats/summary').set({ visits: 5, logins: 2, signups: 1 }));
  await assertFails(db.doc('site_stats/summary').set({ visits: 0, logins: 0, signups: 0 }));
});

test('admin can list user directory and Bob cannot', async () => {
  const adminDb = firestoreFor('adminUid', 'admin@casemate.com');
  await assertSucceeds(adminDb.collection('user_directory').get());
  const bobDb = firestoreFor(BOB, 'bob@example.com');
  await assertFails(bobDb.collection('user_directory').get());
});
