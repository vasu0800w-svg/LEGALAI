import { collection, doc, getDoc, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { auth, db } from './firebaseService';

export type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
  lastSeen: number;
  createdAt: number;
};

const created = new Set<string>();

/** Tell the admin panel this account is using the app. Fails quietly if rules are not deployed yet. */
export const touchUserDirectory = async (user: {
  id: string;
  name?: string | null;
  email?: string | null;
  plan?: string | null;
}): Promise<void> => {
  const email = (auth.currentUser?.email || '').trim();
  if (!user.id || !email || auth.currentUser?.uid !== user.id) return;

  const ref = doc(db, 'user_directory', user.id);
  const base = {
    name: String(user.name || 'Advocate').trim().slice(0, 119) || 'Advocate',
    email,
    plan: String(user.plan || 'free').slice(0, 39) || 'free',
    lastSeen: Date.now(),
  };

  if (!created.has(user.id)) {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { ...base, createdAt: base.lastSeen });
    } else {
      await setDoc(ref, base, { merge: true });
    }
    created.add(user.id);
    return;
  }

  await setDoc(ref, base, { merge: true });
};

export const subscribeUserDirectory = (
  onData: (users: DirectoryUser[], error: string | null) => void
): Unsubscribe => {
  return onSnapshot(
    collection(db, 'user_directory'),
    (snap) => {
      const users = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name || 'Advocate'),
            email: String(data.email || ''),
            plan: String(data.plan || 'free'),
            lastSeen: Number(data.lastSeen || 0),
            createdAt: Number(data.createdAt || 0),
          };
        })
        .sort((a, b) => b.lastSeen - a.lastSeen);
      onData(users, null);
    },
    (err) => {
      console.error('[user_directory] listen failed', err);
      onData([], err?.message || 'Could not load users.');
    }
  );
};
