export type PlanId = 'free' | 'basic' | 'pro' | 'annual';

export interface PlanLimits {
  draftLimit: number;
  maxMessageChars: number;
  maxSessionChars: number;
  chatSessionLimit: number;
  dailyUses: number;
  /** Fair-use guard: AI calls per calendar month (enforced on the server). */
  monthlyAiRequests: number;
  /** Fair-use guard: images sent for analysis per calendar month (server-side). */
  monthlyImages: number;
  /** Devices that may use one account at the same time (server-side). */
  maxDevices: number;
}

/** Accounts with no draft / timer / character / chat-count restrictions */
const UNLIMITED_EMAILS = new Set([
  'nt9234536@gmail.com',
  'shuchirajput22@gmail.com',
]);

export const isUnlimitedEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return UNLIMITED_EMAILS.has(email.trim().toLowerCase());
};

const UNLIMITED_LIMITS: PlanLimits = {
  draftLimit: Number.POSITIVE_INFINITY,
  maxMessageChars: 500_000,
  maxSessionChars: 5_000_000,
  chatSessionLimit: 10_000,
  dailyUses: Number.POSITIVE_INFINITY,
  monthlyAiRequests: Number.POSITIVE_INFINITY,
  monthlyImages: Number.POSITIVE_INFINITY,
  maxDevices: 99,
};

/** Feature bullets shown on subscription / upgrade / admin UIs */
export const PLAN_FEATURES: Record<'basic' | 'pro' | 'annual', string[]> = {
  basic: [
    'Unlimited drafts (fair use)',
    'Unlimited case photo uploads',
    '60,000 characters per chat session',
    'Up to 3 devices',
  ],
  pro: [
    'Unlimited drafts (higher fair use)',
    'Unlimited case photo uploads',
    '1,20,000 characters per chat session',
    'Up to 5 devices',
    'All advanced features',
  ],
  annual: [
    'Everything in Pro, billed yearly',
    'Unlimited drafts (higher fair use)',
    'Unlimited case photo uploads',
    'Up to 5 devices',
  ],
};

export const DEFAULT_PLAN_PRICES: Record<string, number> = {
  basic: 2999,
  pro: 4999,
  annual: 29999,
};

export type SubscriptionPlanShape = {
  id: string;
  name: string;
  price: number;
  features?: string[];
};

/** Keep admin-set prices/features. Only fill gaps when a value is missing or invalid. */
export const sanitizeSubscriptionPlans = (
  plans: Array<Partial<SubscriptionPlanShape>> | null | undefined
): SubscriptionPlanShape[] => {
  if (!Array.isArray(plans) || plans.length === 0) {
    return [
      { id: 'basic', name: 'Basic Plan', price: DEFAULT_PLAN_PRICES.basic, features: [...PLAN_FEATURES.basic] },
      { id: 'pro', name: 'Pro Plan', price: DEFAULT_PLAN_PRICES.pro, features: [...PLAN_FEATURES.pro] },
      { id: 'annual', name: 'Annual Plan', price: DEFAULT_PLAN_PRICES.annual, features: [...PLAN_FEATURES.annual] },
    ];
  }
  return plans.map((p, i) => {
    const id = String(p?.id || `plan_${i + 1}`);
    const name = String(p?.name || 'Plan').trim() || 'Plan';
    const n = Number(p?.price);
    const fallback = DEFAULT_PLAN_PRICES[id] ?? DEFAULT_PLAN_PRICES.pro;
    const price = Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
    const known = PLAN_FEATURES[id as keyof typeof PLAN_FEATURES];
    const features = Array.isArray(p?.features) && p.features.length > 0
      ? p.features.map((f) => String(f).trim()).filter(Boolean)
      : known ? [...known] : [];
    return { id, name, price, features };
  });
};

/** Plan-wise draft, message, and session character limits */
export const getPlanLimits = (plan?: string | null, email?: string | null): PlanLimits => {
  if (isUnlimitedEmail(email)) return UNLIMITED_LIMITS;

  const p = (plan || 'free') as string;
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

  // Free tier
  return {
    draftLimit: 5,
    maxMessageChars: 4000,
    maxSessionChars: 20000,
    chatSessionLimit: 50,
    dailyUses: Number.POSITIVE_INFINITY, // gated by 1-hour daily timer instead
    monthlyAiRequests: 120,
    monthlyImages: 150,
    maxDevices: 2,
  };
};

export const getSessionCharCount = (messages: { text?: string }[]): number =>
  messages.reduce((sum, m) => sum + (m.text?.length || 0), 0);

export const validateChatCharacterLimits = (
  plan: string | null | undefined,
  messageText: string,
  sessionMessages: { text?: string }[],
  email?: string | null
): { ok: true } | { ok: false; error: string } => {
  if (isUnlimitedEmail(email)) return { ok: true };

  const limits = getPlanLimits(plan, email);
  const messageLen = messageText.length;

  if (messageLen > limits.maxMessageChars) {
    return {
      ok: false,
      error: `Message exceeds the ${limits.maxMessageChars.toLocaleString()} character limit for your plan.`,
    };
  }

  const sessionTotal = getSessionCharCount(sessionMessages) + messageLen;
  if (sessionTotal > limits.maxSessionChars) {
    return {
      ok: false,
      error: `This chat has reached the ${limits.maxSessionChars.toLocaleString()} character history limit for your plan. Please start a new chat.`,
    };
  }

  return { ok: true };
};

export const todayKey = (): string => new Date().toDateString();
