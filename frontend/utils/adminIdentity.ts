/** Must stay in sync with firestore.rules isAdmin() and backend/lib/adminAuth.js */
export const ADMIN_EMAIL = 'admin@casemate.com';

export const isAdminEmail = (email?: string | null): boolean =>
  String(email || '').trim().toLowerCase() === ADMIN_EMAIL;
