/**
 * Pure entitlement helpers. No I/O so concurrent-grant and quota rules can
 * be unit-tested without Firebase.
 *
 * Character counting: only `message.text` length. Image bytes, filenames,
 * mime types, and evidence notes are not characters.
 */

export const persistLimits = (limits) => {
  const src = limits && typeof limits === 'object' ? limits : {};
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    const n = Number(value);
    out[key] = Number.isFinite(n) ? n : null;
  }
  return out;
};

export const reviveLimits = (stored, fallback) => {
  const base = fallback && typeof fallback === 'object' ? { ...fallback } : {};
  if (!stored || typeof stored !== 'object') return base;
  for (const [key, value] of Object.entries(stored)) {
    if (value == null) base[key] = Number.POSITIVE_INFINITY;
    else {
      const n = Number(value);
      if (Number.isFinite(n)) base[key] = n;
    }
  }
  return base;
};

export const PLAN_RANK = { free: 0, starter: 1, custom: 1, basic: 2, pro: 3, annual: 3 };

/** Catalog written at Part 5. Existing paid users without this version keep legacy limits. */
export const CATALOG_VERSION = 5;

export const formatInr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export const annualSavings = (monthlyPrice, annualPrice) => {
  const monthly = Math.max(0, Math.round(Number(monthlyPrice) || 0));
  const annual = Math.max(0, Math.round(Number(annualPrice) || 0));
  const twelve = monthly * 12;
  const saved = twelve - annual;
  const percent = twelve > 0 && saved > 0 ? Math.round((saved / twelve) * 1000) / 10 : 0;
  return { twelveMonthCost: twelve, annualPrice: annual, saved, percent };
};

export const appendBillingHistory = (existing, entry) => {
  const prev = Array.isArray(existing) ? existing : [];
  const row = {
    at: Number(entry?.at) || Date.now(),
    orderId: String(entry?.orderId || ''),
    paymentId: String(entry?.paymentId || ''),
    amountPaise: Math.max(0, Math.round(Number(entry?.amountPaise) || 0)),
    planId: String(entry?.planId || ''),
    addOnId: String(entry?.addOnId || ''),
    kind: String(entry?.kind || 'plan'),
    status: String(entry?.status || 'paid'),
  };
  return [...prev, row].slice(-25);
};

/**
 * Existing paid cycles keep the limits they already have. New purchases use
 * the current catalog. A stored grantedLimits snapshot always wins.
 */
/** Keep the richer of two limit objects so a renewal cannot cut an active grant. */
export const preferRicherLimits = (current, catalog) => {
  const a = current && typeof current === 'object' ? current : {};
  const b = catalog && typeof catalog === 'object' ? catalog : {};
  const out = { ...b };
  for (const key of Object.keys(a)) {
    const av = Number(a[key]);
    const bv = Number(out[key]);
    if (!Number.isFinite(av)) {
      out[key] = av;
      continue;
    }
    if (!Number.isFinite(bv)) continue;
    out[key] = Math.max(av, bv);
  }
  return out;
};

export const resolvePaidLimits = ({
  plan,
  expiry,
  entitlementsVersion,
  grantedLimits,
  catalogLimits,
  legacyLimits,
  now = Date.now(),
}) => {
  let limits;
  if (grantedLimits && typeof grantedLimits === 'object' && Object.keys(grantedLimits).length > 0) {
    limits = reviveLimits(grantedLimits, catalogLimits);
  } else {
    const active = String(plan || 'free') !== 'free' && Number(expiry) > now;
    limits = active && Number(entitlementsVersion) !== CATALOG_VERSION
      ? { ...legacyLimits }
      : { ...catalogLimits };
  }
  const floor = Number(catalogLimits?.maxSessionChars);
  const n = Number(limits?.maxSessionChars);
  if (Number.isFinite(floor) && Number.isFinite(n) && floor > n) {
    limits = { ...limits, maxSessionChars: floor };
  }
  return limits;
};

export const countMessageChars = (messages = []) =>
  (Array.isArray(messages) ? messages : []).reduce(
    (sum, m) => sum + (typeof m?.text === 'string' ? m.text.length : 0),
    0
  );

export const countCasePhotos = (messages = [], pending = 0) => {
  const saved = (Array.isArray(messages) ? messages : []).reduce((sum, m) => {
    const atts = Array.isArray(m?.attachments) ? m.attachments : [];
    return sum + atts.filter((a) => a && a.type === 'case').length;
  }, 0);
  return saved + Math.max(0, Number(pending) || 0);
};

export const remainingOf = (used, limit) => {
  if (!Number.isFinite(limit)) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - Math.max(0, Number(used) || 0));
};

/** Extend an active cycle. Never shorten an existing expiry. */
export const nextExpiryFrom = (currentExpiry, durationMs, now = Date.now()) => {
  const current = Number(currentExpiry) || 0;
  const base = current > now ? current : now;
  return base + Math.max(0, Number(durationMs) || 0);
};

/**
 * Keep a higher active plan if the customer buys a lower one while the
 * higher grant is still valid. Upgrade when they buy a higher (or equal) plan.
 */
export const nextPlanAfterPurchase = (currentPlan, currentExpiry, purchasedPlan, now = Date.now()) => {
  const bought = String(purchasedPlan || 'basic');
  const current = String(currentPlan || 'free');
  const expiry = Number(currentExpiry) || 0;
  if (expiry <= now) return bought;
  const currentRank = PLAN_RANK[current] ?? 0;
  const boughtRank = PLAN_RANK[bought] ?? 0;
  return currentRank > boughtRank ? current : bought;
};

export const seedMonthDrafts = (aiUsage, draftCount, lastResetDate, month, now = new Date()) => {
  const prev = aiUsage && aiUsage.month === month ? aiUsage : null;
  if (prev && Number.isFinite(Number(prev.monthDrafts))) {
    return Math.max(0, Number(prev.monthDrafts));
  }
  const clientMonth = Number(lastResetDate);
  if (Number.isFinite(clientMonth) && clientMonth === now.getMonth()) {
    return Math.max(0, Number(draftCount) || 0);
  }
  return 0;
};

export const utcMonthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

/** First millisecond of the next UTC month — extra session characters expire here. */
export const utcMonthEndMs = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0);
};

/**
 * Extra characters per chat for the remainder of the current UTC calendar month.
 * Applies to every chat on the account, not a single thread. A previous month's
 * purchase does not carry forward.
 */
export const activeExtraSessionChars = (addOns, now = Date.now()) => {
  if (!addOns || typeof addOns !== 'object') return 0;
  const month = utcMonthKey(now);
  if (String(addOns.extraSessionCharsMonth || '') !== month) return 0;
  const until = Number(addOns.extraSessionCharsUntil || 0);
  if (until > 0 && until <= now) return 0;
  return Math.max(0, Number(addOns.extraSessionChars || 0));
};

export const applyAddOnGrants = (limits, addOns, now = Date.now()) => {
  if (!limits || !addOns || typeof addOns !== 'object') return limits;
  const next = { ...limits };
  const extraDrafts = Number(addOns.extraDrafts || 0);
  const extraImages = Number(addOns.extraMonthlyImages || 0);
  const extraDaily = Number(addOns.extraDailyAi || 0);
  const extraChars = activeExtraSessionChars(addOns, now);
  if (extraDrafts > 0 && Number.isFinite(next.draftLimit)) next.draftLimit += extraDrafts;
  if (extraImages > 0 && Number.isFinite(next.monthlyImages)) next.monthlyImages += extraImages;
  if (extraDaily > 0 && Number.isFinite(next.dailyAiRequests)) next.dailyAiRequests += extraDaily;
  if (extraChars > 0 && Number.isFinite(next.maxSessionChars)) next.maxSessionChars += extraChars;
  return next;
};

export const mergeAddOnGrants = (existing, grants, now = Date.now()) => {
  const prev = existing && typeof existing === 'object' ? existing : {};
  const add = grants && typeof grants === 'object' ? grants : {};
  const out = { ...prev };
  const extraChars = Number(add.extraSessionChars);
  if (Number.isFinite(extraChars) && extraChars > 0) {
    const month = utcMonthKey(now);
    const current = String(prev.extraSessionCharsMonth || '') === month
      ? Math.max(0, Number(prev.extraSessionChars || 0))
      : 0;
    out.extraSessionChars = current + extraChars;
    out.extraSessionCharsMonth = month;
    out.extraSessionCharsUntil = utcMonthEndMs(now);
  }
  for (const [key, value] of Object.entries(add)) {
    if (key === 'extraSessionChars' || key === 'extraSessionCharsMonth' || key === 'extraSessionCharsUntil') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) continue;
    out[key] = Math.max(0, Number(out[key] || 0) + n);
  }
  return out;
};

export const publicDevices = (devices, currentId, now = Date.now(), staleMs = 14 * 24 * 60 * 60 * 1000) =>
  (Array.isArray(devices) ? devices : [])
    .filter((d) => d && d.id && now - Number(d.lastSeen || 0) < staleMs)
    .map((d) => ({
      id: String(d.id),
      lastSeen: Number(d.lastSeen || 0),
      current: Boolean(currentId) && d.id === currentId,
    }));
