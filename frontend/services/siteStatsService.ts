import { doc, onSnapshot, runTransaction, Unsubscribe } from 'firebase/firestore';
import { db } from './firebaseService';

export type SiteStats = {
  visits: number;
  logins: number;
  signups: number;
};

const statsRef = () => doc(db, 'site_stats', 'summary');

const empty = (): SiteStats => ({ visits: 0, logins: 0, signups: 0 });

/** Add 1 to a public counter. Returns false if Firestore rejected the write. */
export const bumpSiteStat = async (field: keyof SiteStats): Promise<boolean> => {
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(statsRef());
      const current = snap.exists() ? { ...empty(), ...snap.data() } : empty();
      const next: SiteStats = {
        visits: Number(current.visits) || 0,
        logins: Number(current.logins) || 0,
        signups: Number(current.signups) || 0,
      };
      next[field] += 1;
      tx.set(statsRef(), next);
    });
    return true;
  } catch (err) {
    console.warn('[site_stats] bump failed', field, err);
    return false;
  }
};

export const subscribeSiteStats = (
  onData: (stats: SiteStats, error: string | null) => void
): Unsubscribe => {
  return onSnapshot(
    statsRef(),
    (snap) => {
      if (!snap.exists()) {
        onData(empty(), null);
        return;
      }
      const data = snap.data();
      onData({
        visits: Number(data.visits) || 0,
        logins: Number(data.logins) || 0,
        signups: Number(data.signups) || 0,
      }, null);
    },
    (err) => {
      console.error('[site_stats] listen failed', err);
      onData(empty(), err?.message || 'Could not load site stats.');
    }
  );
};
