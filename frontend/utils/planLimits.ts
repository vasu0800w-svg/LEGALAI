export type PaidPlanId = 'starter' | 'basic' | 'pro' | 'annual';
export type PlanId = 'free' | PaidPlanId | 'custom';
export const PAID_PLAN_IDS: PaidPlanId[] = ['starter', 'basic', 'pro', 'annual'];
export const isPaidPlanId = (id: string): id is PaidPlanId =>
  (PAID_PLAN_IDS as string[]).includes(id);

export interface PlanLimits {
  draftLimit: number;
  maxMessageChars: number;
  maxSessionChars: number;
  chatSessionLimit: number;
  dailyUses: number;
  /** Backend-enforced AI requests per IST calendar day. */
  dailyAiRequests: number;
  /** Client session window in seconds. 0 disables the timer. */
  dailySeconds: number;
  /** Case photos/files allowed in one chat. */
  maxPhotosPerChat: number;
  /** Photos allowed in a single upload / Gemini request. */
  maxPhotosPerUpload: number;
  /** Fair-use guard: AI calls per calendar month (enforced on the server). */
  monthlyAiRequests: number;
  /** Fair-use guard: images sent for analysis per calendar month (server-side). */
  monthlyImages: number;
  /** Devices that may use one account at the same time (server-side). */
  maxDevices: number;
}

/** Accounts with no draft / timer / character / chat-count restrictions. Keep in sync with backend/middleware/planLimits.js */
export const UNLIMITED_EMAIL_LIST = [
  'nt9234536@gmail.com',
  'shuchirajput22@gmail.com',
  'sourabhmishra.law@gmail.com',
  'vibhav.tiwari40@gmail.com',
  'kajol.dewangan1995@gmail.com',
  'yashthakur.1982@gmail.com',
  'sunilnandi171@gmail.com',
  'ajaysahu3003@gmail.com',
  'rakesh25475@gmail.com',
  'vinodkujur1@gmail.com',
  'kujurmanoj@gmail.com',
  'sshrivastava86@gmail.com',
] as const;

const UNLIMITED_EMAILS = new Set<string>(UNLIMITED_EMAIL_LIST);

export const isUnlimitedEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return UNLIMITED_EMAILS.has(email.trim().toLowerCase());
};

export type PromoFields = {
  promoKind?: string | null;
  promoExpiresAt?: number | null;
  addOns?: Record<string, number | string>;
  grantedLimits?: Partial<PlanLimits> | null;
  entitlementsVersion?: number | null;
  subscriptionExpiryDate?: number | null;
  plan?: string | null;
};

/** A promo grant already stored on the account. The code itself is checked on the server. */
export const isPromoActive = (promo?: PromoFields | null, now = Date.now()): boolean => {
  const kind = String(promo?.promoKind || '');
  if (kind === '14d') return Number(promo?.promoExpiresAt || 0) > now;
  if (kind === 'forever') return true;
  return false;
};

export const hasUnlimitedAccess = (email?: string | null, promo?: PromoFields | null): boolean =>
  isUnlimitedEmail(email) || isPromoActive(promo);

const UNLIMITED_LIMITS: PlanLimits = {
  draftLimit: Number.POSITIVE_INFINITY,
  maxMessageChars: 500_000,
  maxSessionChars: 5_000_000,
  chatSessionLimit: 10_000,
  dailyUses: Number.POSITIVE_INFINITY,
  dailyAiRequests: Number.POSITIVE_INFINITY,
  dailySeconds: 0,
  maxPhotosPerChat: Number.POSITIVE_INFINITY,
  maxPhotosPerUpload: Number.POSITIVE_INFINITY,
  monthlyAiRequests: Number.POSITIVE_INFINITY,
  monthlyImages: Number.POSITIVE_INFINITY,
  maxDevices: 99,
};

/**
 * Free-plan defaults. Admin config may override these.
 * Session characters stay at 20,000 (already more generous than a 10,000-character chat cap).
 * Per-message characters are raised to 10,000 so a case note can be pasted in one go.
 */
export const DEFAULT_FREE_PLAN_LIMITS: PlanLimits = {
  draftLimit: 5,
  maxMessageChars: 10_000,
  maxSessionChars: 20_000,
  chatSessionLimit: 50,
  dailyUses: Number.POSITIVE_INFINITY,
  dailyAiRequests: 20,
  dailySeconds: 3600,
  maxPhotosPerChat: 18,
  maxPhotosPerUpload: 20,
  monthlyAiRequests: 120,
  monthlyImages: 150,
  maxDevices: 2,
};

const clampLimit = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export const sanitizeFreePlanLimits = (
  raw: Partial<PlanLimits> | null | undefined
): PlanLimits => {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    draftLimit: clampLimit(src.draftLimit, DEFAULT_FREE_PLAN_LIMITS.draftLimit, 1, 500),
    maxMessageChars: clampLimit(src.maxMessageChars, DEFAULT_FREE_PLAN_LIMITS.maxMessageChars, 1000, 100_000),
    maxSessionChars: clampLimit(src.maxSessionChars, DEFAULT_FREE_PLAN_LIMITS.maxSessionChars, 4000, 500_000),
    chatSessionLimit: clampLimit(src.chatSessionLimit, DEFAULT_FREE_PLAN_LIMITS.chatSessionLimit, 5, 5000),
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: clampLimit(src.dailyAiRequests, DEFAULT_FREE_PLAN_LIMITS.dailyAiRequests, 1, 500),
    dailySeconds: clampLimit(src.dailySeconds, DEFAULT_FREE_PLAN_LIMITS.dailySeconds, 0, 86_400),
    maxPhotosPerChat: clampLimit(src.maxPhotosPerChat, DEFAULT_FREE_PLAN_LIMITS.maxPhotosPerChat, 1, 200),
    maxPhotosPerUpload: clampLimit(src.maxPhotosPerUpload, DEFAULT_FREE_PLAN_LIMITS.maxPhotosPerUpload, 1, 80),
    monthlyAiRequests: clampLimit(src.monthlyAiRequests, DEFAULT_FREE_PLAN_LIMITS.monthlyAiRequests, 10, 20_000),
    monthlyImages: clampLimit(src.monthlyImages, DEFAULT_FREE_PLAN_LIMITS.monthlyImages, 10, 20_000),
    maxDevices: clampLimit(src.maxDevices, DEFAULT_FREE_PLAN_LIMITS.maxDevices, 1, 20),
  };
};

let freePlanOverride: PlanLimits | null = null;

export const CATALOG_VERSION = 5;

export const LEGACY_PAID_LIMITS: Record<PaidPlanId, PlanLimits> = {
  starter: {
    draftLimit: 30,
    maxMessageChars: 10000,
    maxSessionChars: 40000,
    chatSessionLimit: 100,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 50,
    monthlyAiRequests: 2000,
    monthlyImages: 2000,
    maxDevices: 2,
  },
  basic: {
    draftLimit: Number.POSITIVE_INFINITY,
    maxMessageChars: 10000,
    maxSessionChars: 60000,
    chatSessionLimit: 200,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 40,
    monthlyAiRequests: 2000,
    monthlyImages: 2000,
    maxDevices: 3,
  },
  pro: {
    draftLimit: Number.POSITIVE_INFINITY,
    maxMessageChars: 20000,
    maxSessionChars: 120000,
    chatSessionLimit: 500,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 60,
    monthlyAiRequests: 4000,
    monthlyImages: 4000,
    maxDevices: 5,
  },
  annual: {
    draftLimit: Number.POSITIVE_INFINITY,
    maxMessageChars: 20000,
    maxSessionChars: 120000,
    chatSessionLimit: 500,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 60,
    monthlyAiRequests: 4000,
    monthlyImages: 4000,
    maxDevices: 5,
  },
};

export const DEFAULT_PAID_LIMITS: Record<PaidPlanId, PlanLimits> = {
  starter: { ...LEGACY_PAID_LIMITS.starter },
  basic: {
    draftLimit: 50,
    maxMessageChars: 10000,
    maxSessionChars: 60000,
    chatSessionLimit: 200,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 80,
    monthlyAiRequests: 2000,
    monthlyImages: 2000,
    maxDevices: 3,
  },
  pro: {
    draftLimit: Number.POSITIVE_INFINITY,
    maxMessageChars: 20000,
    maxSessionChars: 120000,
    chatSessionLimit: 500,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 200,
    monthlyAiRequests: 4000,
    monthlyImages: 4000,
    maxDevices: 5,
  },
  annual: {
    draftLimit: Number.POSITIVE_INFINITY,
    maxMessageChars: 20000,
    maxSessionChars: 120000,
    chatSessionLimit: 500,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: Number.POSITIVE_INFINITY,
    dailySeconds: 0,
    maxPhotosPerChat: Number.POSITIVE_INFINITY,
    maxPhotosPerUpload: 200,
    monthlyAiRequests: 4000,
    monthlyImages: 4000,
    maxDevices: 5,
  },
};

let paidPlanOverride: Record<string, PlanLimits> | null = null;

export const utcMonthKey = (now = Date.now()): string => new Date(now).toISOString().slice(0, 7);

export const utcMonthEndMs = (now = Date.now()): number => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0);
};

export const activeExtraSessionChars = (
  addOns?: Record<string, number | string> | null,
  now = Date.now()
): number => {
  if (!addOns || typeof addOns !== 'object') return 0;
  if (String(addOns.extraSessionCharsMonth || '') !== utcMonthKey(now)) return 0;
  const until = Number(addOns.extraSessionCharsUntil || 0);
  if (until > 0 && until <= now) return 0;
  return Math.max(0, Number(addOns.extraSessionChars || 0));
};

const applyAddOns = (limits: PlanLimits, promo?: PromoFields | null): PlanLimits => {
  const addOns = promo?.addOns;
  if (!addOns || typeof addOns !== 'object') return limits;
  const next = { ...limits };
  const extraDrafts = Number(addOns.extraDrafts || 0);
  const extraImages = Number(addOns.extraMonthlyImages || 0);
  const extraDaily = Number(addOns.extraDailyAi || 0);
  const extraChars = activeExtraSessionChars(addOns);
  if (extraDrafts > 0 && Number.isFinite(next.draftLimit)) next.draftLimit += extraDrafts;
  if (extraImages > 0 && Number.isFinite(next.monthlyImages)) next.monthlyImages += extraImages;
  if (extraDaily > 0 && Number.isFinite(next.dailyAiRequests)) next.dailyAiRequests += extraDaily;
  if (extraChars > 0 && Number.isFinite(next.maxSessionChars)) next.maxSessionChars += extraChars;
  return next;
};

export const chatLimitProximity = (
  used: number,
  max: number
): 'ok' | 'near' | 'reached' => {
  if (!Number.isFinite(max) || max <= 0) return 'ok';
  if (used >= max) return 'reached';
  if (used / max >= 0.8 || max - used <= 2000) return 'near';
  return 'ok';
};

export const applyPaidPlanConfig = (raw: Record<string, Partial<PlanLimits>> | null | undefined) => {
  if (!raw || typeof raw !== 'object') {
    paidPlanOverride = null;
    return;
  }
  paidPlanOverride = {
    starter: { ...DEFAULT_PAID_LIMITS.starter, ...(raw.starter || {}) },
    basic: { ...DEFAULT_PAID_LIMITS.basic, ...(raw.basic || {}) },
    pro: { ...DEFAULT_PAID_LIMITS.pro, ...(raw.pro || {}) },
    annual: { ...DEFAULT_PAID_LIMITS.annual, ...(raw.annual || {}) },
  };
};

export const applyFreePlanConfig = (raw: Partial<PlanLimits> | null | undefined) => {
  freePlanOverride = raw ? sanitizeFreePlanLimits(raw) : sanitizeFreePlanLimits(null);
  try {
    localStorage.setItem('casemate_free_plan_limits', JSON.stringify(freePlanOverride));
  } catch { /* ignore */ }
  return freePlanOverride;
};

export const loadStoredFreePlanLimits = (): PlanLimits => {
  try {
    const raw = localStorage.getItem('casemate_free_plan_limits');
    if (raw) {
      freePlanOverride = sanitizeFreePlanLimits(JSON.parse(raw));
      return freePlanOverride;
    }
  } catch { /* ignore */ }
  return DEFAULT_FREE_PLAN_LIMITS;
};

export const formatInr = (n: number): string =>
  `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export const annualSavings = (monthlyPrice: number, annualPrice: number) => {
  const monthly = Math.max(0, Math.round(Number(monthlyPrice) || 0));
  const annual = Math.max(0, Math.round(Number(annualPrice) || 0));
  const twelveMonthCost = monthly * 12;
  const saved = twelveMonthCost - annual;
  const percent = twelveMonthCost > 0 && saved > 0 ? Math.round((saved / twelveMonthCost) * 1000) / 10 : 0;
  return { twelveMonthCost, annualPrice: annual, saved, percent };
};

const qty = (n: number, infiniteLabel: string, finite: (v: number) => string) =>
  Number.isFinite(n) ? finite(n) : infiniteLabel;

export const catalogLimitsFor = (planId: string, free: PlanLimits = DEFAULT_FREE_PLAN_LIMITS): PlanLimits => {
  if (isPaidPlanId(planId)) {
    return paidPlanOverride?.[planId] || DEFAULT_PAID_LIMITS[planId];
  }
  return freePlanOverride || free;
};

export const paidFeatureLines = (planId: string, limits: PlanLimits): string[] => {
  const drafts = qty(
    limits.draftLimit,
    'Unlimited completed drafts, subject to monthly AI fair use',
    (n) => `${n} completed drafts each month`
  );
  const upload = qty(limits.maxPhotosPerUpload, 'No per-upload photo cap', (n) => `Up to ${n} photos per upload`);
  const chars = `${limits.maxSessionChars.toLocaleString('en-IN')} characters per chat`;
  const devices = `Up to ${limits.maxDevices} devices`;
  const lines = [drafts, upload, chars, devices];
  if (!Number.isFinite(limits.draftLimit)) {
    lines.push(
      `Fair use: ${limits.monthlyAiRequests.toLocaleString('en-IN')} AI requests and ${limits.monthlyImages.toLocaleString('en-IN')} photo analyses each month`
    );
  }
  if (planId === 'starter') {
    const uploadIdx = lines.indexOf(upload);
    if (uploadIdx >= 0) lines.splice(uploadIdx + 1, 0, 'No per-chat photo cap');
    const deviceIdx = lines.indexOf(devices);
    if (deviceIdx >= 0) lines.splice(deviceIdx, 0, 'No daily AI cap');
  }
  if (planId === 'annual') lines.unshift('Same features as Casemate Pro, billed once a year');
  if (planId === 'pro') lines.push('All supported premium drafting and analysis tools');
  return lines;
};

/** Feature bullets shown on subscription / upgrade / admin UIs — derived from catalog limits. */
export const PLAN_FEATURES: Record<PaidPlanId, string[]> = {
  starter: paidFeatureLines('starter', DEFAULT_PAID_LIMITS.starter),
  basic: paidFeatureLines('basic', DEFAULT_PAID_LIMITS.basic),
  pro: paidFeatureLines('pro', DEFAULT_PAID_LIMITS.pro),
  annual: paidFeatureLines('annual', DEFAULT_PAID_LIMITS.annual),
};

export const DEFAULT_PLAN_PRICES: Record<string, number> = {
  starter: 999,
  basic: 2999,
  pro: 4999,
  annual: 34990,
};

export const PLAN_DURATION_DAYS: Record<string, number> = {
  starter: 30,
  basic: 30,
  pro: 30,
  annual: 365,
  custom: 30,
};

export const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: 'Free Plan',
  starter: 'Casemate Starter',
  basic: 'Casemate Basic',
  pro: 'Casemate Pro',
  annual: 'Annual Plan',
  custom: 'Custom Plan',
};

export type SubscriptionPlanShape = {
  id: string;
  name: string;
  price: number;
  features?: string[];
};

export type PlanSpec = { label: string; value: string };

export type PlanCardModel = {
  id: string;
  name: string;
  price: number;
  period: 'free' | 'month' | 'year';
  periodLabel: string;
  specs: PlanSpec[];
  features: string[];
  savings?: { saved: number; percent: number; twelveMonthCost: number };
  highlighted?: boolean;
};

export const planSpecs = (limits: PlanLimits, planId: string): PlanSpec[] => {
  const daily = Number.isFinite(limits.dailyAiRequests)
    ? `${limits.dailyAiRequests} AI requests / day`
    : 'No daily AI cap (monthly fair use still applies)';
  const drafts = Number.isFinite(limits.draftLimit)
    ? `${limits.draftLimit} / month`
    : 'Unlimited (AI fair use)';
  const photosChat = Number.isFinite(limits.maxPhotosPerChat)
    ? String(limits.maxPhotosPerChat)
    : 'No per-chat cap';
  return [
    { label: 'Price period', value: planId === 'annual' ? 'Year' : planId === 'free' ? 'Free' : 'Month' },
    { label: 'Photos per upload', value: Number.isFinite(limits.maxPhotosPerUpload) ? String(limits.maxPhotosPerUpload) : 'No cap' },
    { label: 'Photos per chat', value: photosChat },
    { label: 'Characters per chat', value: limits.maxSessionChars.toLocaleString('en-IN') },
    { label: 'Monthly drafts', value: drafts },
    { label: 'Daily AI', value: daily },
    { label: 'Devices', value: String(limits.maxDevices) },
  ];
};

export const buildPlanCards = (
  plans: SubscriptionPlanShape[],
  freeLimits: PlanLimits = DEFAULT_FREE_PLAN_LIMITS
): PlanCardModel[] => {
  const paid = sanitizeSubscriptionPlans(plans);
  const pro = paid.find((p) => p.id === 'pro');
  const annual = paid.find((p) => p.id === 'annual');
  const savings = pro && annual ? annualSavings(pro.price, annual.price) : undefined;
  const freeCard: PlanCardModel = {
    id: 'free',
    name: PLAN_DISPLAY_NAMES.free,
    price: 0,
    period: 'free',
    periodLabel: 'Free',
    specs: planSpecs(freeLimits, 'free'),
    features: freePlanFeatureLines(freeLimits),
  };
  const paidCards = paid.map((p) => {
    const limits = catalogLimitsFor(p.id, freeLimits);
    return {
      id: p.id,
      name: p.name || PLAN_DISPLAY_NAMES[p.id] || p.id,
      price: p.price,
      period: p.id === 'annual' ? 'year' as const : 'month' as const,
      periodLabel: p.id === 'annual' ? '/ year' : '/ month',
      specs: planSpecs(limits, p.id),
      features: paidFeatureLines(p.id, limits),
      savings: p.id === 'annual' && savings && savings.saved > 0
        ? { saved: savings.saved, percent: savings.percent, twelveMonthCost: savings.twelveMonthCost }
        : undefined,
      highlighted: p.id === 'pro',
    };
  });
  return [freeCard, ...paidCards];
};

/** Keep admin-set prices/features. Only fill gaps when a value is missing or invalid. */
export const sanitizeSubscriptionPlans = (
  plans: Array<Partial<SubscriptionPlanShape>> | null | undefined
): SubscriptionPlanShape[] => {
  const catalogFallback = (): SubscriptionPlanShape[] =>
    PAID_PLAN_IDS.map((id) => ({
      id,
      name: PLAN_DISPLAY_NAMES[id],
      price: DEFAULT_PLAN_PRICES[id],
      features: [...PLAN_FEATURES[id]],
    }));
  if (!Array.isArray(plans) || plans.length === 0) return catalogFallback();
  const mapped = plans.map((p, i) => {
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
  if (!mapped.some((p) => p.id === 'starter')) {
    mapped.unshift({
      id: 'starter',
      name: PLAN_DISPLAY_NAMES.starter,
      price: DEFAULT_PLAN_PRICES.starter,
      features: [...PLAN_FEATURES.starter],
    });
  }
  return mapped;
};

/** Plan-wise draft, message, and session character limits */
export const getPlanLimits = (plan?: string | null, email?: string | null, promo?: PromoFields | null): PlanLimits => {
  if (hasUnlimitedAccess(email, promo)) return UNLIMITED_LIMITS;

  const p = (plan || 'free') as string;
  if (p === 'custom') {
    const base = freePlanOverride || DEFAULT_FREE_PLAN_LIMITS;
    const granted = promo?.grantedLimits;
    if (granted && typeof granted === 'object' && Object.keys(granted).length > 0) {
      const limits = { ...base } as PlanLimits;
      for (const [key, value] of Object.entries(granted)) {
        (limits as unknown as Record<string, number>)[key] = value == null ? Number.POSITIVE_INFINITY : Number(value);
      }
      return applyAddOns(limits, promo);
    }
    return applyAddOns(base, promo);
  }
  if (isPaidPlanId(p)) {
    const catalogLimits = paidPlanOverride?.[p] || DEFAULT_PAID_LIMITS[p] || DEFAULT_PAID_LIMITS.pro;
    const legacyLimits = LEGACY_PAID_LIMITS[p] || LEGACY_PAID_LIMITS.pro;
    const granted = promo?.grantedLimits;
    let limits = catalogLimits;
    if (granted && typeof granted === 'object' && Object.keys(granted).length > 0) {
      limits = { ...catalogLimits };
      for (const [key, value] of Object.entries(granted)) {
        (limits as unknown as Record<string, number>)[key] = value == null ? Number.POSITIVE_INFINITY : Number(value);
      }
    } else {
      const expiry = Number(promo?.subscriptionExpiryDate || 0);
      const active = expiry > Date.now();
      if (active && Number(promo?.entitlementsVersion) !== CATALOG_VERSION) {
        limits = legacyLimits;
      }
    }
    return applyAddOns(limits, promo);
  }

  return applyAddOns(freePlanOverride || DEFAULT_FREE_PLAN_LIMITS, promo);
};

export const countCasePhotos = (
  messages: { attachments?: { type?: string }[] }[],
  pending = 0
): number => {
  const saved = messages.reduce((sum, m) => {
    const atts = Array.isArray(m.attachments) ? m.attachments : [];
    return sum + atts.filter((a) => a?.type === 'case').length;
  }, 0);
  return saved + Math.max(0, pending);
};

export const validatePhotoLimit = (
  plan: string | null | undefined,
  messages: { attachments?: { type?: string }[] }[],
  pendingCount: number,
  email?: string | null,
  promo?: PromoFields | null
): { ok: true } | { ok: false; error: string } => {
  if (hasUnlimitedAccess(email, promo)) return { ok: true };
  const limits = getPlanLimits(plan, email, promo);
  if (Number.isFinite(limits.maxPhotosPerUpload) && pendingCount > limits.maxPhotosPerUpload) {
    return {
      ok: false,
      error: `You can attach up to ${limits.maxPhotosPerUpload} photos in one upload.`,
    };
  }
  if (!Number.isFinite(limits.maxPhotosPerChat)) return { ok: true };
  const used = countCasePhotos(messages, pendingCount);
  if (used > limits.maxPhotosPerChat) {
    return {
      ok: false,
      error: `This chat allows ${limits.maxPhotosPerChat} photos on your plan. Start a new chat or upgrade to add more.`,
    };
  }
  return { ok: true };
};

/** IST calendar date YYYY-MM-DD — daily allowances reset at midnight IST. */
export const istDateKey = (now = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const nextIstMidnightLabel = (): string => 'midnight IST';

export const nextMonthResetLabel = (): string => {
  const today = istDateKey();
  const [y, m] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return next.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export const freePlanFeatureLines = (limits: PlanLimits = DEFAULT_FREE_PLAN_LIMITS): string[] => {
  const hour = limits.dailySeconds > 0 ? Math.round(limits.dailySeconds / 3600) : 0;
  return [
    `${limits.draftLimit} drafts each month`,
    hour > 0 ? `${hour} hour of app use each day` : 'No daily timer',
    `${limits.dailyAiRequests} AI requests each day`,
    `${limits.maxPhotosPerChat} photos per chat`,
    `${limits.maxSessionChars.toLocaleString('en-IN')} characters per chat`,
    `Up to ${limits.maxDevices} devices`,
  ];
};

export const getSessionCharCount = (messages: { text?: string }[]): number =>
  messages.reduce((sum, m) => sum + (m.text?.length || 0), 0);

export const validateChatCharacterLimits = (
  plan: string | null | undefined,
  messageText: string,
  sessionMessages: { text?: string }[],
  email?: string | null,
  promo?: PromoFields | null
): { ok: true } | { ok: false; error: string; code?: 'MESSAGE_LIMIT' | 'SESSION_LIMIT' } => {
  if (hasUnlimitedAccess(email, promo)) return { ok: true };

  const limits = getPlanLimits(plan, email, promo);
  const messageLen = messageText.length;

  if (messageLen > limits.maxMessageChars) {
    return {
      ok: false,
      code: 'MESSAGE_LIMIT',
      error: `Message exceeds the ${limits.maxMessageChars.toLocaleString()} character limit for your plan.`,
    };
  }

  const sessionTotal = getSessionCharCount(sessionMessages) + messageLen;
  if (sessionTotal > limits.maxSessionChars) {
    return {
      ok: false,
      code: 'SESSION_LIMIT',
      error: `This chat has reached the ${limits.maxSessionChars.toLocaleString()} character history limit for your plan. Increase the chat limit or start a new chat. Your conversation is kept.`,
    };
  }

  return { ok: true };
};

export const todayKey = (): string => istDateKey();

try {
  loadStoredFreePlanLimits();
} catch {
  /* ignore */
}
