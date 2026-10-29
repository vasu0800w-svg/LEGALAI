import { verifyRequestUser } from '../lib/authUser.js';
import { adminReady, createEmailVerificationLink } from '../lib/firebaseAdmin.js';
import { applyCors } from '../lib/httpSecurity.js';

const cors = (req, res) => applyCors(req, res, 'POST, OPTIONS');

export const verificationLinkOptionsHandler = (req, res) => {
  cors(req, res);
  res.status(204).end();
};

/**
 * Signed-in signup calls this once, then puts the link in the casemate email.
 * The raw Firebase verification mail is not sent, so the link is not stuck in spam.
 */
export const verificationLinkHandler = async (req, res) => {
  cors(req, res);
  const user = await verifyRequestUser(req, { checkRevoked: true });
  if (!user?.uid || !user.email) {
    return res.status(401).json({ error: 'AUTH', message: 'Sign in required.' });
  }
  if (!adminReady()) {
    return res.status(503).json({
      error: 'ADMIN',
      message: 'Email verification link is unavailable.',
    });
  }
  try {
    const link = await createEmailVerificationLink(user.email);
    return res.json({ link });
  } catch (err) {
    console.error('[verification-link]', err?.code || err?.message || err);
    return res.status(500).json({
      error: 'LINK',
      message: 'Could not create the verification link.',
    });
  }
};
