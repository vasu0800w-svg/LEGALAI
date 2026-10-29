import { auth } from './firebaseService';
import { getDeviceId } from '../utils/deviceId';

export type RegisteredDevice = {
  id: string;
  lastSeen: number;
  current?: boolean;
};

export type EntitlementsSnapshot = {
  ok: boolean;
  plan?: string;
  subscriptionExpiryDate?: number | null;
  billingCycleStart?: number | null;
  billingCycleEnd?: number | null;
  status?: string;
  paymentStatus?: string;
  addOns?: Record<string, number | string>;
  chatLimit?: {
    maxSessionChars?: number | null;
    extraSessionChars?: number;
    extraUntil?: number | null;
    extraMonth?: string | null;
    scope?: string;
    options?: Array<{
      id: string;
      name: string;
      price: number;
      billingPeriod?: string;
      extraSessionChars: number;
      features?: string[];
      eligible?: boolean;
    }>;
  };
  usage?: {
    day?: string;
    dayRequests?: number;
    month?: string;
    requests?: number;
    images?: number;
    monthDrafts?: number;
  };
  remaining?: {
    dailyAi?: number | null;
    monthlyAi?: number | null;
    monthlyImages?: number | null;
    drafts?: number | null;
    devices?: number;
  };
  devices?: RegisteredDevice[];
  grandfathered?: boolean;
  billingHistory?: Array<{
    at: number;
    orderId?: string;
    paymentId?: string;
    amountPaise: number;
    planId?: string;
    addOnId?: string;
    kind?: string;
    status?: string;
  }>;
  customPlan?: {
    selection?: {
      photoUpload?: number;
      photoChatEnabled?: boolean;
      photoChat?: number;
      characters?: number;
      drafts?: number;
      devices?: number;
    };
    lines?: Array<{ id?: string; label?: string; rupees?: number }>;
    totalRupees?: number;
    taxPercent?: number;
  } | null;
  catalog?: {
    plans?: Array<{ id: string; name: string; price: number; billingDays?: number; features?: string[] }>;
    addOns?: Array<{ id: string; name: string; price: number; grants?: Record<string, number> }>;
  };
};

const apiBase = () =>
  String((import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in required.');
  const { getAppCheckHeader } = await import('./firebaseService');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
    ...(await getAppCheckHeader()),
  };
};

export const fetchEntitlements = async (): Promise<EntitlementsSnapshot | null> => {
  try {
    const res = await fetch(`${apiBase()}/api/entitlements`, {
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as EntitlementsSnapshot;
  } catch {
    return null;
  }
};

export const fetchDevices = async (): Promise<RegisteredDevice[]> => {
  try {
    const res = await fetch(`${apiBase()}/api/devices`, {
      headers: await authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data?.devices)) return [];
    return data.devices as RegisteredDevice[];
  } catch {
    return [];
  }
};

export const revokeDevice = async (deviceId: string): Promise<RegisteredDevice[]> => {
  const res = await fetch(`${apiBase()}/api/devices/revoke`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ deviceId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || 'Could not remove that device.');
  }
  return Array.isArray(data?.devices) ? data.devices : [];
};

export const validateChatLimits = async (body: {
  chatId?: string | null;
  message: string;
  sessionMessages: { text?: string }[];
  photoCount?: number;
  uploadPhotoCount?: number;
}): Promise<{ ok: boolean; message?: string; error?: string }> => {
  try {
    const res = await fetch(`${apiBase()}/api/validate-chat-limits`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    if (res.status !== 400 && res.status !== 403) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: String(data?.error || ''),
      message: data?.message || 'This chat is over the limit for your plan.',
    };
  } catch {
    return { ok: true };
  }
};
