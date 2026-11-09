import { db, auth, getAppCheckHeader } from './firebaseService';
import { doc, getDoc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { isAdminEmail } from '../utils/adminIdentity';

export type AppConfigDoc = 'plans' | 'announcement' | 'templates' | 'api_keys' | 'email_keys' | 'promo_codes';

export type CloudLegalTemplate = {
  id: string;
  name: string;
  content: string;
  /** Shown to judges only when 'judge'; everything else is an advocate template. */
  audience?: 'advocate' | 'judge';
};

const configRef = (docId: AppConfigDoc) => doc(db, 'app_config', docId);

const clearLegacyAdminCreds = () => {
  try {
    localStorage.removeItem('casemate_admin_creds');
  } catch {
    /* ignore */
  }
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Admin writes require a live Firebase session for the configured admin email.
 * Passwords are never read from localStorage or created from the client.
 */
export const ensureConfigWriteAuth = async (): Promise<boolean> => {
  clearLegacyAdminCreds();
  if (isAdminEmail(auth.currentUser?.email)) return true;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      unsub();
      resolve(value);
    };
    const unsub = onAuthStateChanged(auth, (user) => {
      if (isAdminEmail(user?.email)) finish(true);
    });
    const timer = window.setTimeout(() => finish(isAdminEmail(auth.currentUser?.email)), 8000);
  });
};

export type AdminOverviewUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
  lastSeen: number;
  createdAt: number;
  lastSignInAt: number;
  emailVerified: boolean;
};

export type AdminOverview = {
  stats: { visits: number; logins: number; signups: number };
  users: AdminOverviewUser[];
};

export const fetchAdminOverview = async (): Promise<AdminOverview | null> => {
  clearLegacyAdminCreds();
  const current = auth.currentUser;
  if (!current || !isAdminEmail(current.email)) return null;
  const base = apiBase();
  if (!base) return null;
  try {
    const token = await current.getIdToken();
    const appCheck = await getAppCheckHeader();
    const res = await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${token}`, ...appCheck },
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || body.ok !== true || !Array.isArray(body.users)) return null;
    return {
      stats: {
        visits: Number(body.stats?.visits) || 0,
        logins: Number(body.stats?.logins) || 0,
        signups: Number(body.stats?.signups) || 0,
      },
      users: body.users,
    };
  } catch {
    return null;
  }
};

const apiBase = () =>
  String((import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

/** Confirms the signed-in Firebase user is accepted by the admin HTTP gate. */
export const verifyAdminSession = async (): Promise<boolean> => {
  clearLegacyAdminCreds();
  const current = auth.currentUser;
  if (!current || !isAdminEmail(current.email)) return false;
  const base = apiBase();
  if (!base) return true;
  try {
    const token = await current.getIdToken();
    const appCheck = await getAppCheckHeader();
    const res = await fetch(`${base}/api/admin/session`, {
      headers: { Authorization: `Bearer ${token}`, ...appCheck },
    });
    if (res.status === 401 || res.status === 403) return false;
    return true;
  } catch {
    return true;
  }
};

export type SaveAppConfigResult = {
  ok: boolean;
  error?: string;
};

/** One-time fetch */
export const getAppConfig = async <T = Record<string, unknown>>(docId: AppConfigDoc): Promise<T | null> => {
  try {
    const snap = await getDoc(configRef(docId));
    if (snap.exists()) return snap.data() as T;
  } catch (error) {
    console.error(`Error fetching app_config/${docId}:`, error);
  }
  return null;
};

/** Realtime listener — updates every phone when admin saves */
export const subscribeAppConfig = (
  docId: AppConfigDoc,
  onData: (data: Record<string, unknown> | null) => void
): Unsubscribe => {
  return onSnapshot(
    configRef(docId),
    (snap) => {
      onData(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    },
    (error) => {
      console.error(`Error listening app_config/${docId}:`, error);
      onData(null);
    }
  );
};

export const saveAppConfig = async (
  docId: AppConfigDoc,
  data: Record<string, unknown>
): Promise<boolean> => {
  const result = await saveAppConfigDetailed(docId, data);
  return result.ok;
};

export const saveAppConfigDetailed = async (
  docId: AppConfigDoc,
  data: Record<string, unknown>
): Promise<SaveAppConfigResult> => {
  const authed = await ensureConfigWriteAuth();
  if (!authed) {
    return {
      ok: false,
      error: 'Firebase Auth failed. Enable Email/Password in Firebase Authentication, then log out and log into admin again.',
    };
  }

  try {
    await withTimeout(
      setDoc(configRef(docId), { ...data, updatedAt: Date.now() }, { merge: true }),
      15000,
      `save ${docId}`
    );
    if (docId === 'plans' && Array.isArray(data.plans)) {
      localStorage.setItem('casemate_subscription_plans', JSON.stringify(data.plans));
    }
    if (docId === 'announcement' && typeof data.text === 'string') {
      localStorage.setItem('casemate_announcement', data.text);
    }
    if (docId === 'templates' && Array.isArray(data.templates)) {
      localStorage.setItem('casemate_cloud_templates', JSON.stringify(data.templates));
    }
    return { ok: true };
  } catch (error: any) {
    console.error(`Error saving app_config/${docId}:`, error);
    const code = String(error?.code || '');
    const msg = String(error?.message || error || '');
    if (code.includes('resource-exhausted') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota')) {
      return {
        ok: false,
        error:
          'Firestore daily write quota is finished (free plan). Upgrade billing in Firebase Console, or wait until quota resets (usually midnight US time), then publish again.',
      };
    }
    if (msg.includes('timed out')) {
      return {
        ok: false,
        error:
          'Cloud save timed out. Usually Firestore quota is exhausted or the network is slow. Check Firebase billing/quota, then try again.',
      };
    }
    return { ok: false, error: msg.slice(0, 240) || 'Cloud save failed.' };
  }
};

/** @deprecated legacy paths — kept for older installs */
export const getCloudAdminConfig = async (configType: 'api_keys' | 'email_keys') => {
  const fromNew = await getAppConfig(configType);
  if (fromNew) return fromNew;
  try {
    const docSnap = await getDoc(doc(db, 'users_data', `admin_config_${configType}`));
    if (docSnap.exists()) return docSnap.data();
  } catch (error) {
    console.error(`Error fetching legacy ${configType}:`, error);
  }
  return null;
};

export const saveCloudAdminConfig = async (configType: 'api_keys' | 'email_keys', data: Record<string, unknown>) => {
  return saveAppConfig(configType, data);
};
