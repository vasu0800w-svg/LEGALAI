import { auth } from './firebaseService';

export const PENDING_CUSTOM_PLAN_KEY = 'casemate_pending_custom_plan';

export type CustomPlanSelection = {
  photoUpload: number;
  photoChatEnabled: boolean;
  photoChat: number;
  characters: number;
  drafts: number;
  devices: number;
};

export type CustomPlanPricing = {
  photoUpload: { blockSize: number; pricePerBlock: number; included: number; min: number; max: number };
  photoChat: { price: number; included: number; min: number; max: number; step: number };
  characters: { blockSize: number; pricePerBlock: number; included: number; min: number; max: number };
  drafts: { blockSize: number; pricePerBlock: number; included: number; min: number; max: number };
  devices: { included: number; priceEach: number; min: number; max: number };
  taxPercent: number;
};

export type CustomQuoteLine = {
  id: string;
  label: string;
  detail?: string;
  rupees: number;
};

export type CustomQuote = {
  ok: boolean;
  errors?: string[];
  selection: CustomPlanSelection;
  lines: CustomQuoteLine[];
  subtotalRupees: number;
  taxRupees: number;
  taxPercent: number;
  totalRupees: number;
  billingPeriod?: string;
};

export type CustomPlanCatalog = {
  ok: boolean;
  pricing: CustomPlanPricing;
  defaultSelection: CustomPlanSelection;
  notes?: Record<string, string>;
};

export const DEFAULT_CUSTOM_PRICING: CustomPlanPricing = {
  photoUpload: { blockSize: 10, pricePerBlock: 350, included: 0, min: 10, max: 200 },
  photoChat: { price: 50, included: 18, min: 18, max: 500, step: 10 },
  characters: { blockSize: 5000, pricePerBlock: 249, included: 20000, min: 20000, max: 200000 },
  drafts: { blockSize: 5, pricePerBlock: 29, included: 0, min: 5, max: 500 },
  devices: { included: 1, priceEach: 199, min: 1, max: 10 },
  taxPercent: 0,
};

export const defaultCustomSelection = (pricing: CustomPlanPricing = DEFAULT_CUSTOM_PRICING): CustomPlanSelection => ({
  photoUpload: Math.min(pricing.photoUpload.max, Math.max(pricing.photoUpload.min, pricing.photoUpload.blockSize * 2)),
  photoChatEnabled: false,
  photoChat: Math.max(pricing.photoChat.min, pricing.photoUpload.blockSize * 2),
  characters: pricing.characters.included,
  drafts: pricing.drafts.min,
  devices: pricing.devices.included,
});

const apiBase = () =>
  String((import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

const failedQuote = (selection: CustomPlanSelection, errors: string[]): CustomQuote => ({
  ok: false,
  errors,
  selection,
  lines: [],
  subtotalRupees: 0,
  taxRupees: 0,
  taxPercent: 0,
  totalRupees: 0,
});

const readJson = async (res: Response): Promise<Record<string, unknown>> => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const pricingUnavailable = (status?: number) =>
  status === 404
    ? 'Custom Plan pricing is not available on the server yet. Retry in a minute.'
    : 'Could not reach Casemate pricing. Check your connection and retry.';

export const fetchCustomPlanCatalog = async (): Promise<CustomPlanCatalog | null> => {
  const res = await fetch(`${apiBase()}/api/custom-plan`);
  const data = await readJson(res);
  if (!res.ok || data.ok !== true || !data.pricing) {
    const err = new Error(
      String(data.message || pricingUnavailable(res.status))
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data as unknown as CustomPlanCatalog;
};

export const quoteCustomPlan = async (selection: CustomPlanSelection): Promise<CustomQuote> => {
  try {
    const res = await fetch(`${apiBase()}/api/custom-plan/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection }),
    });
    const data = await readJson(res) as CustomQuote & { message?: string; errors?: string[] };
    if (!res.ok || !data?.ok) {
      const errors = Array.isArray(data?.errors) && data.errors.length
        ? data.errors
        : [data?.message || pricingUnavailable(res.status)];
      return {
        ...failedQuote(selection, errors),
        lines: Array.isArray(data?.lines) ? data.lines : [],
        subtotalRupees: Number(data?.subtotalRupees) || 0,
        taxRupees: Number(data?.taxRupees) || 0,
        taxPercent: Number(data?.taxPercent) || 0,
        totalRupees: Number(data?.totalRupees) || 0,
      };
    }
    return data;
  } catch (err) {
    const message = err instanceof Error && err.message && !err.message.startsWith('Failed to fetch')
      ? err.message
      : pricingUnavailable();
    return failedQuote(selection, [message]);
  }
};

export const readPendingCustomSelection = (): CustomPlanSelection | null => {
  try {
    const raw = sessionStorage.getItem(PENDING_CUSTOM_PLAN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomPlanSelection;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

export const writePendingCustomSelection = (selection: CustomPlanSelection) => {
  try {
    sessionStorage.setItem(PENDING_CUSTOM_PLAN_KEY, JSON.stringify(selection));
  } catch { /* ignore */ }
};

export const clearPendingCustomSelection = () => {
  try {
    sessionStorage.removeItem(PENDING_CUSTOM_PLAN_KEY);
  } catch { /* ignore */ }
};

export const signedInForCheckout = (): boolean => Boolean(auth.currentUser);
