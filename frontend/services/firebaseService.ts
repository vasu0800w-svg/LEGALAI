import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Admin Panel (localStorage) se Firebase keys dynamic uthane ka setup
const getFirebaseConfigFromAdmin = () => {
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
          appId: parsed.appId || ""
        };
      }
    }
  } catch (e) {
    console.error("Error reading Firebase config from Admin Panel", e);
  }

  // Default fallback credentials agar admin panel mein set na ho
  return {
    apiKey: "AIzaSyCvx7vSFA0bY__cz8KSuHVwv9tui6IuIz0",
    authDomain: "casemate-78759.firebaseapp.com",
    projectId: "casemate-78759",
    storageBucket: "casemate-78759.firebasestorage.app",
    messagingSenderId: "556075485433",
    appId: "1:556075485433:web:84868bb428b30dd7623a28"
  };
};

const firebaseConfig = getFirebaseConfigFromAdmin();

// Initialize Firebase securely
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app, "legal");