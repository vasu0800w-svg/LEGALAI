/**
 * Plan-wise draft / message / session character limits.
 * Keep in sync with frontend/utils/planLimits.ts
 */

const UNLIMITED_EMAILS = new Set([
  'nt9234536@gmail.com',
  'shuchirajput22@gmail.com',
]);

export function isUnlimitedEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return UNLIMITED_EMAILS.has(email.trim().toLowerCase());
}

export function getPlanLimits(plan, email) {
  if (isUnlimitedEmail(email)) {
    return {
      draftLimit: Number.POSITIVE_INFINITY,
      maxMessageChars: 500000,
      maxSessionChars: 5000000,
      chatSessionLimit: 10000,
      dailyUses: Number.POSITIVE_INFINITY,
      monthlyAiRequests: Number.POSITIVE_INFINITY,
      monthlyImages: Number.POSITIVE_INFINITY,
      maxDevices: 99,
    };
  }

  const p = plan || 'free';
  const isHighTier = p === 'pro' || p === 'annual';

  if (p === 'basic') {
    return {
      draftLimit: Number.POSITIVE_INFINITY,
      maxMessageChars: 10000,
      maxSessionChars: 60000,
      chatSessionLimit: 200,
      dailyUses: Number.POSITIVE_INFINITY,
      monthlyAiRequests: 2000,
      monthlyImages: 2000,
      maxDevices: 3,
    };
  }

  if (isHighTier) {
    return {
      draftLimit: Number.POSITIVE_INFINITY,
      maxMessageChars: 20000,
      maxSessionChars: 120000,
      chatSessionLimit: 500,
      dailyUses: Number.POSITIVE_INFINITY,
      monthlyAiRequests: 4000,
      monthlyImages: 4000,
      maxDevices: 5,
    };
  }

  return {
    draftLimit: 5,
    maxMessageChars: 4000,
    maxSessionChars: 20000,
    chatSessionLimit: 50,
    dailyUses: 1,
    monthlyAiRequests: 120,
    monthlyImages: 150,
    maxDevices: 2,
  };
}

/** Authoritative monthly price per plan (rupees). Admin config may override. */
export const DEFAULT_PLAN_PRICES = {
  basic: 2999,
  pro: 4999,
  annual: 29999,
};

export const PLAN_DURATION_DAYS = {
  basic: 30,
  pro: 30,
  annual: 365,
};

export function getSessionCharCount(messages = []) {
  return messages.reduce((sum, m) => sum + ((m && m.text && m.text.length) || 0), 0);
}

/**
 * Express middleware: validates single-message and total session character limits
 * against the user's active plan. Expects JSON body:
 * { plan, email, message, sessionMessages?: [{ text }] }
 */
export function validateChatLimitsMiddleware(req, res, next) {
  try {
    const plan = req.body?.plan ?? 'free';
    const email = req.body?.email ?? '';
    if (isUnlimitedEmail(email)) {
      req.planLimits = getPlanLimits(plan, email);
      return next();
    }

    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const sessionMessages = Array.isArray(req.body?.sessionMessages)
      ? req.body.sessionMessages
      : [];

    const limits = getPlanLimits(plan, email);
    const messageLen = message.length;

    if (messageLen > limits.maxMessageChars) {
      return res.status(400).json({
        error: 'MESSAGE_LIMIT_EXCEEDED',
        message: `Message exceeds the ${limits.maxMessageChars.toLocaleString()} character limit for your plan.`,
        limits,
      });
    }

    const sessionTotal = getSessionCharCount(sessionMessages) + messageLen;
    if (sessionTotal > limits.maxSessionChars) {
      return res.status(400).json({
        error: 'SESSION_LIMIT_EXCEEDED',
        message: `This chat has reached the ${limits.maxSessionChars.toLocaleString()} character history limit for your plan. Please start a new chat.`,
        limits,
      });
    }

    req.planLimits = limits;
    return next();
  } catch (err) {
    console.error('[planLimits] validation error', err);
    return res.status(500).json({
      error: 'VALIDATION_FAILED',
      message: 'Unable to validate chat limits.',
    });
  }
}
