import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Prefer Vite .env (correct project), then optional admin-panel override, then safe fallback
const getFirebaseConfig = () => {
  const envConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  };

  if (envConfig.apiKey && envConfig.projectId) {
    return {
      apiKey: envConfig.apiKey,
      authDomain: envConfig.authDomain || `${envConfig.projectId}.firebaseapp.com`,
      projectId: envConfig.projectId,
      storageBucket: envConfig.storageBucket || `${envConfig.projectId}.firebasestorage.app`,
      messagingSenderId: envConfig.messagingSenderId || "",
      appId: envConfig.appId || "",
    };
  }

  try {
    const savedKeys = localStorage.getItem('casemate_api_keys');
    if (savedKeys) {
      const parsed = JSON.parse(savedKeys);
      if (parsed.firebaseApiKey && parsed.firebaseProjectId) {
        return {
          apiKey: parsed.firebaseApiKey,
          authDomain: parsed.authDomain || `${parsed.firebaseProjectId}.firebaseapp.com`,
          projectId: parsed.firebaseProjectId,
          storageBucket: parsed.storageBucket || `${parsed.firebaseProjectId}.firebasestorage.app`,
          messagingSenderId: parsed.messagingSenderId || "",
          appId: parsed.appId || "",
        };
      }
    }
  } catch (e) {
    console.error("Error reading Firebase config from Admin Panel", e);
  }

  return {
    apiKey: "AIzaSyCvx7vSFA0bY__cz8KSuHVwv9tui6IuIz0",
    authDomain: "legalai-78759.firebaseapp.com",
    projectId: "legalai-78759",
    storageBucket: "legalai-78759.firebasestorage.app",
    messagingSenderId: "556075485433",
    appId: "1:556075485433:web:84868bb428b30dd7623a28",
  };
};

const firebaseConfig = getFirebaseConfig();

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const makeAuth = () => {
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
  } catch {
    return getAuth(app);
  }
};

export const auth = makeAuth();

// Your Firebase console uses the NAMED database "legal" (not "(default)")
// Collection users_data lives there — admin_config_api_keys etc.
const firestoreDatabaseId =
  (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE as string | undefined)?.trim() || "legal";

export const db = getFirestore(app, firestoreDatabaseId);
export const storage = getStorage(app);

export const sendPasswordReset = async (email: string) => {
  const trimmed = email.trim();
  if (!trimmed) {
    const err = Object.assign(new Error('missing-email'), { code: 'auth/missing-email' });
    throw err;
  }
  await sendPasswordResetEmail(auth, trimmed);
};

console.info("[Firebase] Connected to project:", firebaseConfig.projectId, "| DB:", firestoreDatabaseId);
