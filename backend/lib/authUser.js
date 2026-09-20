/**
 * Verify the Firebase ID token sent by the app.
 * Uses Google's public certs, so this needs no service-account credentials.
 */
import { OAuth2Client } from 'google-auth-library';

const tokenClient = new OAuth2Client();

export const firebaseAudience = () =>
  String(
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'legalai-78759'
  ).trim();

/**
 * Express middleware: resolve the caller once so the rate limiter can key on
 * the user id instead of the shared office IP.
 */
export const attachAuthUser = async (req, _res, next) => {
  req.authUser = await verifyRequestUser(req);
  next();
};

/** @returns {Promise<{uid: string, email: string} | null>} */
export const verifyRequestUser = async (req) => {
  if (req.authUser !== undefined) return req.authUser;
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    const ticket = await tokenClient.verifyIdToken({
      idToken: token,
      audience: firebaseAudience(),
    });
    const payload = ticket.getPayload() || {};
    const uid = String(payload.user_id || payload.sub || '').trim();
    if (!uid) return null;
    return { uid, email: String(payload.email || '').trim().toLowerCase() };
  } catch {
    return null;
  }
};
