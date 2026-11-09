import { ADMIN_EMAIL } from './adminAuth.js';
import { adminReady, getAdminAuth, getDb } from './firebaseAdmin.js';

const MAX_USERS = 1000;

export const emptySiteStats = () => ({ visits: 0, logins: 0, signups: 0 });

const toMs = (value) => {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
};

export const mergeAdminUsers = (sources) => {
  const map = new Map();
  for (const row of sources || []) {
    const id = String(row?.id || '').trim();
    if (!id || id.startsWith('admin_config')) continue;
    const email = String(row.email || '').trim();
    if (email.toLowerCase() === ADMIN_EMAIL) continue;
    const prev = map.get(id) || {
      id,
      name: 'Advocate',
      email: '',
      plan: 'free',
      lastSeen: 0,
      createdAt: 0,
      lastSignInAt: 0,
      emailVerified: false,
    };
    const name = String(row.name || prev.name || 'Advocate').trim().slice(0, 119) || prev.name;
    map.set(id, {
      id,
      name,
      email: (email || prev.email).slice(0, 199),
      plan: String(row.plan || prev.plan || 'free').slice(0, 39) || 'free',
      lastSeen: Math.max(toMs(row.lastSeen), prev.lastSeen),
      createdAt: prev.createdAt || toMs(row.createdAt),
      lastSignInAt: Math.max(toMs(row.lastSignInAt), prev.lastSignInAt),
      emailVerified: Boolean(row.emailVerified || prev.emailVerified),
    });
  }
  return [...map.values()].sort(
    (a, b) => (b.lastSeen || b.lastSignInAt || b.createdAt) - (a.lastSeen || a.lastSignInAt || a.createdAt)
  );
};

const listAuthUsers = async () => {
  const auth = getAdminAuth();
  const rows = [];
  let pageToken;
  do {
    const page = await auth.listUsers(Math.min(1000, MAX_USERS - rows.length), pageToken);
    for (const user of page.users || []) {
      rows.push({
        id: user.uid,
        name: user.displayName || '',
        email: user.email || '',
        createdAt: toMs(user.metadata?.creationTime),
        lastSignInAt: toMs(user.metadata?.lastSignInTime),
        emailVerified: Boolean(user.emailVerified),
      });
    }
    pageToken = page.pageToken;
  } while (pageToken && rows.length < MAX_USERS);
  return rows;
};

const mapDocs = (snap, extra = {}) =>
  (snap?.docs || []).map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      name: data.name,
      email: data.email,
      plan: data.plan,
      lastSeen: data.lastSeen,
      createdAt: data.createdAt,
      ...extra,
    };
  });

export const loadAdminOverview = async () => {
  if (!adminReady()) {
    const error = new Error('Admin directory is unavailable.');
    error.code = 'UNAVAILABLE';
    throw error;
  }
  const db = getDb();
  const [authUsers, profiles, directory, statsSnap] = await Promise.all([
    listAuthUsers().catch(() => []),
    db.collection('users_data').limit(MAX_USERS).get().catch(() => ({ docs: [] })),
    db.collection('user_directory').limit(MAX_USERS).get().catch(() => ({ docs: [] })),
    db.doc('site_stats/summary').get().catch(() => null),
  ]);
  const statsData = statsSnap?.exists ? statsSnap.data() : {};
  return {
    stats: {
      visits: Number(statsData.visits) || 0,
      logins: Number(statsData.logins) || 0,
      signups: Number(statsData.signups) || 0,
    },
    users: mergeAdminUsers([
      ...authUsers,
      ...mapDocs(profiles),
      ...mapDocs(directory),
    ]),
  };
};
