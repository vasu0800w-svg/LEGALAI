/**
 * Verify the Firebase ID token sent by the app.
 *
 * Firebase ID tokens are issued by https://securetoken.google.com/<project> and
 * are NOT Google Sign-In tokens, so they must be verified with the Firebase
 * verifier. This needs no service-account credentials.
 */
import { verifyFirebaseIdToken, projectId } from './firebaseAdmin.js';

export const firebaseAudience = projectId;

/** @returns {Promise<{uid: string, email: string} | null>} */
export const verifyRequestUser = async (req) => {
  if (req.authUser !== undefined) return req.authUser;
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    const decoded = await verifyFirebaseIdToken(token);
    const uid = String(decoded.uid || decoded.user_id || decoded.sub || '').trim();
    if (!uid) return null;
    return { uid, email: String(decoded.email || '').trim().toLowerCase() };
  } catch (err) {
    console.warn('[auth] ID token rejected:', err?.code || err?.message || err);
    return null;
  }
};

/**
 * Express middleware: resolve the caller once so the rate limiter can key on
 * the user id instead of the shared office IP.
 */
export const attachAuthUser = async (req, _res, next) => {
  req.authUser = await verifyRequestUser(req);
  next();
};
