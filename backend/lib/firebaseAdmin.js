/**
 * Firebase Admin (server-side Firestore).
 *
 * Needed for anything the phone must not be trusted with: granting a paid plan
 * after a verified payment, per-user fair-use counters, and device slots.
 *
 * Credentials come from one of:
 *   FIREBASE_SERVICE_ACCOUNT        - the service-account JSON (raw or base64)
 *   GOOGLE_APPLICATION_CREDENTIALS  - path to that JSON file
 *
 * Without them the server stays up: payments are refused (so no money is taken
 * that we cannot honour) and AI fair-use falls back to the per-IP limit.
 */
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/** Their Firestore database is not "(default)" — it is named "legal". */
const DATABASE_ID = String(
  process.env.FIREBASE_FIRESTORE_DATABASE ||
  process.env.VITE_FIREBASE_FIRESTORE_DATABASE ||
  'legal'
).trim();

let db = null;
let initError = '';

const parseServiceAccount = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;
  const json = text.startsWith('{')
    ? text
    : Buffer.from(text, 'base64').toString('utf8');
  return JSON.parse(json);
};

const init = () => {
  try {
    const existing = getApps();
    const app = existing.length
      ? existing[0]
      : (() => {
          const svc = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
          if (svc) return initializeApp({ credential: cert(svc) });
          if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            return initializeApp({ credential: applicationDefault() });
          }
          return null;
        })();

    if (!app) {
      initError = 'FIREBASE_SERVICE_ACCOUNT is not set';
      return;
    }
    db = getFirestore(app, DATABASE_ID);
  } catch (err) {
    initError = err?.message || 'Firebase Admin init failed';
    db = null;
  }
};

init();

if (db) {
  console.log(`[firebase-admin] ready (database: ${DATABASE_ID})`);
} else {
  console.warn(
    `[firebase-admin] NOT configured (${initError}). ` +
    'Subscriptions are disabled and per-user AI fair-use is not enforced. ' +
    'Set FIREBASE_SERVICE_ACCOUNT on the server to enable both.'
  );
}

export const adminReady = () => db !== null;
export const adminInitError = () => initError;
export const getDb = () => db;
export const userDoc = (uid) => db.collection('users_data').doc(uid);
export const orderDoc = (orderId) => db.collection('orders').doc(orderId);
