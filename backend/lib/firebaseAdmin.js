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
 * that we cannot honour) and AI requests are rejected until usage can be recorded.
 */
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

export const projectId = () =>
  String(
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'legalai-78759'
  ).trim();

/** Their Firestore database is not "(default)" — it is named "legal". */
const DATABASE_ID = String(
  process.env.FIREBASE_FIRESTORE_DATABASE ||
  process.env.VITE_FIREBASE_FIRESTORE_DATABASE ||
  'legal'
).trim();

let db = null;
let app = null;
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
    if (existing.length) {
      app = existing[0];
    } else {
      const svc = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (svc) {
        app = initializeApp({ credential: cert(svc), projectId: svc.project_id || projectId() });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        app = initializeApp({ credential: applicationDefault(), projectId: projectId() });
      } else {
        // No credentials: token verification still works (it only needs the
        // project id plus Google's public certs). Firestore writes do not.
        initError = 'FIREBASE_SERVICE_ACCOUNT is not set';
        app = initializeApp({ projectId: projectId() });
        return;
      }
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
    `[firebase-admin] no credentials (${initError}). ` +
    'Sign-in verification still works; subscriptions and AI requests stay blocked until FIREBASE_SERVICE_ACCOUNT is set.'
  );
}

/** True when Firestore writes are possible (service account present). */
export const adminReady = () => db !== null;
export const adminInitError = () => initError;
export const getDb = () => db;
export const getAdminAuth = () => {
  if (!app) throw new Error('Firebase Admin app not initialised');
  return getAuth(app);
};
export const userDoc = (uid) => db.collection('users_data').doc(uid);
export const orderDoc = (orderId) => db.collection('orders').doc(orderId);
export const paymentDoc = (paymentId) => db.collection('payments').doc(String(paymentId || ''));

/**
 * Verify a Firebase ID token. Works without a service account because it only
 * needs the project id and Google's public securetoken certificates.
 */
export const verifyFirebaseIdToken = async (idToken, opts = {}) => {
  if (!app) throw new Error('Firebase Admin app not initialised');
  return getAuth(app).verifyIdToken(idToken, !!opts.checkRevoked);
};

/** Off unless APP_CHECK_ENFORCE=1 after App Check is configured and the client sends tokens. */
export const verifyAppCheckIfEnforced = async (req) => {
  if (String(process.env.APP_CHECK_ENFORCE || '') !== '1') return true;
  const token = String(req?.headers?.['x-firebase-appcheck'] || '').trim();
  if (!token || !app) return false;
  try {
    const { getAppCheck } = await import('firebase-admin/app-check');
    await getAppCheck(app).verifyToken(token);
    return true;
  } catch {
    return false;
  }
};

/** Inbox email uses this link. The continue page must be an authorized domain. */
export const createEmailVerificationLink = async (email) => {
  if (!app || !adminReady()) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  }
  const address = String(email || '').trim();
  if (!address) throw new Error('Email is required');
  return getAuth(app).generateEmailVerificationLink(address, {
    url: 'https://meetcasemate.com',
    handleCodeInApp: false,
  });
};
