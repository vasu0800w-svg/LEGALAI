import { auth } from './firebaseService';

export const PENDING_PROMO_KEY = 'casemate_pending_promo';

export type PromoRedeemResult = {
  ok: boolean;
  kind?: '14d' | 'forever';
  expiresAt?: number | null;
  alreadyUnlimited?: boolean;
  alreadyActive?: boolean;
  code?: string;
  message?: string;
};

const apiBase = () =>
  String((import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

const authHeader = async () => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in, then enter the promo code.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export const redeemPromoCode = async (code: string): Promise<PromoRedeemResult> => {
  const base = apiBase();
  const res = await fetch(`${base}/api/redeem-promo`, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || 'That promo code is not valid.');
  }
  return data as PromoRedeemResult;
};

export const fetchPromoStatus = async (): Promise<{ active: boolean; source?: string; kind?: string | null; expiresAt?: number | null }> => {
  const base = apiBase();
  const res = await fetch(`${base}/api/promo-status`, {
    method: 'POST',
    headers: await authHeader(),
  });
  if (!res.ok) return { active: true };
  return res.json();
};
