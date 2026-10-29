import { verifyRequestUser } from './authUser.js';

/** Must stay in sync with firestore.rules isAdmin() and frontend/utils/adminIdentity.ts */
export const ADMIN_EMAIL = 'admin@casemate.com';

export const isAdminEmail = (email) =>
  String(email || '').trim().toLowerCase() === ADMIN_EMAIL;

export const requireAdmin = async (req, res) => {
  const user = await verifyRequestUser(req, { checkRevoked: true });
  if (!user?.uid || !isAdminEmail(user.email)) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required.' });
    return null;
  }
  return user;
};
