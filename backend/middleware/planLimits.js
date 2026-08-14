/**
 * Plan-wise draft / message / session character limits.
 * Keep in sync with frontend/utils/planLimits.ts
 */

export function getPlanLimits(plan) {
  const p = plan || 'free';
  const isHighTier = p === 'pro' || p === 'annual';

  if (p === 'basic') {
    return {
      draftLimit: 20,
      maxMessageChars: 4000,
      maxSessionChars: 20000,
      chatSessionLimit: 50,
      dailyUses: Number.POSITIVE_INFINITY,
    };
  }

  if (isHighTier) {
    return {
      draftLimit: 50,
      maxMessageChars: 10000,
      maxSessionChars: 50000,
      chatSessionLimit: 100,
      dailyUses: Number.POSITIVE_INFINITY,
    };
  }

  return {
    draftLimit: 5,
    maxMessageChars: 4000,
    maxSessionChars: 20000,
    chatSessionLimit: 50,
    dailyUses: 1,
  };
}

export function getSessionCharCount(messages = []) {
  return messages.reduce((sum, m) => sum + ((m && m.text && m.text.length) || 0), 0);
}

/**
 * Express middleware: validates single-message and total session character limits
 * against the user's active plan. Expects JSON body:
 * { plan, message, sessionMessages?: [{ text }] }
 */
export function validateChatLimitsMiddleware(req, res, next) {
  try {
    const plan = req.body?.plan ?? 'free';
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const sessionMessages = Array.isArray(req.body?.sessionMessages)
      ? req.body.sessionMessages
      : [];

    const limits = getPlanLimits(plan);
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
