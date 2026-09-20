import { db, auth } from './firebaseService';
import { doc, getDoc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
} from 'firebase/auth';

export type AppConfigDoc = 'plans' | 'announcement' | 'templates' | 'api_keys' | 'email_keys';

export type CloudLegalTemplate = {
  id: string;
  name: string;
  content: string;
};

const configRef = (docId: AppConfigDoc) => doc(db, 'app_config', docId);

const getAdminLocalCreds = (): { email: string; password: string } => {
  try {
    return JSON.parse(
      localStorage.getItem('casemate_admin_creds') ||
        '{"email":"admin@casemate.com","password":"admin123"}'
    );
  } catch {
    return { email: 'admin@casemate.com', password: 'admin123' };
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
 * Ensure Firebase Auth so Firestore write rules pass.
 * Prefers Email/Password using admin panel credentials; falls back to Anonymous.
 */
export const ensureConfigWriteAuth = async (): Promise<boolean> => {
  try {
    if (auth.currentUser) return true;

    const { email, password } = getAdminLocalCreds();
    if (email && password && password.length >= 6) {
      try {
        await withTimeout(signInWithEmailAndPassword(auth, email, password), 12000, 'signIn');
        return !!auth.currentUser;
      } catch (signInErr: any) {
        const code = signInErr?.code || '';
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
          try {
            await withTimeout(createUserWithEmailAndPassword(auth, email, password), 12000, 'createUser');
            return !!auth.currentUser;
          } catch (createErr: any) {
            if (createErr?.code === 'auth/email-already-in-use') {
              try {
                await withTimeout(signInWithEmailAndPassword(auth, email, password), 12000, 'signInRetry');
                return !!auth.currentUser;
              } catch {
                /* fall through */
              }
            }
            console.warn('[app_config] Email admin auth failed, trying anonymous', createErr);
          }
        } else {
          console.warn('[app_config] Email sign-in failed, trying anonymous', signInErr);
        }
      }
    }

    await withTimeout(signInAnonymously(auth), 12000, 'anonymous');
    return !!auth.currentUser;
  } catch (error) {
    console.error('[app_config] Auth required for cloud write failed:', error);
    return false;
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
