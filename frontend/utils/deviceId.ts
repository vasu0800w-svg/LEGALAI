/**
 * Stable per-install id, sent with AI requests so the server can enforce how
 * many devices share one subscription. Not used for tracking or analytics.
 */
const KEY = 'casemate_device_id';

const randomId = () => {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
};

let cached: string | null = null;

export const getDeviceId = (): string => {
  if (cached) return cached;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved.length >= 8) {
      cached = saved;
      return cached;
    }
    const next = randomId();
    localStorage.setItem(KEY, next);
    cached = next;
    return next;
  } catch {
    cached = randomId();
    return cached;
  }
};
