/**
 * CORS allowlist + generic API security headers.
 * CORS is not authentication — every private route still verifies a Firebase token.
 */

const PRODUCTION_ORIGINS = [
  'https://meetcasemate.com',
  'https://www.meetcasemate.com',
  'https://legalai-78759.web.app',
  'https://legalai-78759.firebaseapp.com',
];

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const extraOrigins = () =>
  String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const isAllowedOrigin = (origin) => {
  const value = String(origin || '').trim();
  if (!value) return true;
  if (PRODUCTION_ORIGINS.includes(value)) return true;
  if (extraOrigins().includes(value)) return true;
  if (LOCAL_ORIGIN.test(value)) return true;
  return false;
};

export const applyCors = (req, res, methods = 'GET, POST, OPTIONS') => {
  const origin = String(req?.headers?.origin || '').trim();
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Device-Id, X-Work-Kind, X-Keepalive, X-Max-Wait-Ms, X-Firebase-AppCheck'
  );
  res.setHeader('Access-Control-Max-Age', '600');
};

export const applySecurityHeaders = (_req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
};

export const publicError = (code, message) => ({ error: code, message });

/** Strip stack traces and secret-looking strings from errors shown to clients. */
export const safeErrorMessage = (err, fallback = 'Request failed.') => {
  const raw = String(err?.message || fallback).slice(0, 180);
  if (/api[_-]?key|secret|service.account|BEGIN PRIVATE|token/i.test(raw)) {
    return fallback;
  }
  return raw || fallback;
};
