import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { User, ChatSession, Message, CaseLearning, Attachment, UserMode, normalizeUserMode } from '../types';
import { auth, db } from '../services/firebaseService';
import { doc, onSnapshot, setDoc, deleteDoc, runTransaction, collection, getDocs, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { getPlanLimits, todayKey, PLAN_FEATURES, DEFAULT_PLAN_PRICES, hasUnlimitedAccess, sanitizeSubscriptionPlans, applyFreePlanConfig, applyPaidPlanConfig } from '../utils/planLimits';
import { fetchPromoStatus, PENDING_PROMO_KEY, redeemPromoCode as requestPromoCode } from '../services/promoService';
import { PENDING_CUSTOM_PLAN_KEY } from '../services/customPlanService';
import { fetchEntitlements } from '../services/entitlementsService';
import { subscribeAppConfig, CloudLegalTemplate } from '../services/adminConfigService';
import { checkAndSendExpiryReminder } from '../services/emailService';
import { touchUserDirectory } from '../services/userDirectoryService';
import { consumeColdStart } from '../utils/nativeNavigation';
import { isAutomaticChatTitle } from '../utils/chatLabel';
import { isAdminEmail } from '../utils/adminIdentity';

export interface SubscriptionPlanConfig {
  id: string;
  name: string;
  price: number;
  features?: string[];
}

const DEFAULT_SUBSCRIPTION_PLANS: SubscriptionPlanConfig[] = [
  { id: 'starter', name: 'Casemate Starter', price: DEFAULT_PLAN_PRICES.starter, features: [...PLAN_FEATURES.starter] },
  { id: 'basic', name: 'Casemate Basic', price: DEFAULT_PLAN_PRICES.basic, features: [...PLAN_FEATURES.basic] },
  { id: 'pro', name: 'Casemate Pro', price: DEFAULT_PLAN_PRICES.pro, features: [...PLAN_FEATURES.pro] },
  { id: 'annual', name: 'Annual Plan', price: DEFAULT_PLAN_PRICES.annual, features: [...PLAN_FEATURES.annual] },
];

const sessionMessageCount = (s: ChatSession) => (Array.isArray(s.messages) ? s.messages.length : 0);

/** Chats made before modes existed have no tag and belong to the advocate history. */
const sessionMode = (s: ChatSession): UserMode => (s?.userMode === 'judge' ? 'judge' : 'advocate');

/** Merge local + cloud chats without wiping richer history */
const attachmentUrlCount = (messages: Message[]) =>
  messages.reduce((n, m) => n + (m.attachments || []).filter((a) => !!a.url).length, 0);

const mergeMessageLists = (a: Message[], b: Message[]): Message[] => {
  const map = new Map<string, Message>();
  const take = (m: Message) => {
    if (!m?.id) return;
    const prev = map.get(m.id);
    if (!prev) {
      map.set(m.id, m);
      return;
    }
    const prevUrls = (prev.attachments || []).filter((x) => !!x.url);
    const nextUrls = (m.attachments || []).filter((x) => !!x.url);
    const attachments =
      nextUrls.length > prevUrls.length
        ? m.attachments
        : prev.attachments?.length
          ? prev.attachments
          : m.attachments;
    const evidenceNotes =
      (m.evidenceNotes?.length || 0) >= (prev.evidenceNotes?.length || 0)
        ? m.evidenceNotes || prev.evidenceNotes
        : prev.evidenceNotes;
    const prevTs = prev.timestamp || 0;
    const nextTs = m.timestamp || 0;
    // On a timestamp tie keep the text already in the map (local edits). Same-length
    // cloud copies used to overwrite in-place edits and make Save look like a no-op.
    const text =
      nextTs > prevTs ? m.text : prevTs > nextTs ? prev.text : prev.text;
    map.set(m.id, { ...prev, ...m, text, attachments, evidenceNotes, timestamp: Math.max(prevTs, nextTs) });
  };
  a.forEach(take);
  b.forEach(take);
  const orderSrc = a.length >= b.length ? a : b;
  const seen = new Set<string>();
  const out: Message[] = [];
  for (const m of orderSrc) {
    if (m?.id && map.has(m.id) && !seen.has(m.id)) {
      out.push(map.get(m.id)!);
      seen.add(m.id);
    }
  }
  map.forEach((m, id) => {
    if (!seen.has(id)) out.push(m);
  });
  return out;
};

const mergeDeletedChatIds = (a: string[] = [], b: string[] = []) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...a, ...b]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-300);
};

const mergeChatSessions = (
  local: ChatSession[],
  cloud: ChatSession[],
  deletedIds: Iterable<string> = []
): ChatSession[] => {
  const deleted = new Set(Array.from(deletedIds).filter(Boolean));
  const map = new Map<string, ChatSession>();

  const consider = (session: ChatSession) => {
    if (!session?.id) return;
    const normalized: ChatSession = {
      ...session,
      messages: Array.isArray(session.messages) ? session.messages : [],
      updatedAt: session.updatedAt || 0,
      title: session.title || 'New Case Analysis',
      ...(session.caseDate ? { caseDate: String(session.caseDate) } : {}),
    };
    const existing = map.get(normalized.id);
    if (!existing) {
      map.set(normalized.id, normalized);
      return;
    }
    const existingCount = sessionMessageCount(existing);
    const nextCount = sessionMessageCount(normalized);
    const messages = mergeMessageLists(existing.messages, normalized.messages);
    const richer =
      nextCount > existingCount
        ? normalized
        : existingCount > nextCount
          ? existing
          : attachmentUrlCount(normalized.messages) >= attachmentUrlCount(existing.messages)
            ? normalized
            : existing;
    const incomingNewer = (normalized.updatedAt || 0) > (existing.updatedAt || 0);
    const caseDate = incomingNewer
      ? (normalized.caseDate || existing.caseDate)
      : (existing.caseDate || normalized.caseDate);
    map.set(normalized.id, {
      ...existing,
      ...richer,
      messages,
      updatedAt: Math.max(existing.updatedAt || 0, normalized.updatedAt || 0),
      title: incomingNewer ? (normalized.title || existing.title) : (existing.title || normalized.title),
      ...(caseDate ? { caseDate } : {}),
    });
  };

  local.forEach(consider);
  cloud.forEach(consider);

  return Array.from(map.values())
    .filter((s) => !deleted.has(s.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

const sessionsUnchanged = (a: ChatSession[], b: ChatSession[]) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].title !== b[i].title) return false;
    if ((a[i].updatedAt || 0) !== (b[i].updatedAt || 0)) return false;
    if (sessionMessageCount(a[i]) !== sessionMessageCount(b[i])) return false;
    const am = a[i].messages;
    const bm = b[i].messages;
    const lastA = am[am.length - 1];
    const lastB = bm[bm.length - 1];
    if ((lastA?.id || '') !== (lastB?.id || '')) return false;
    if ((lastA?.text || '') !== (lastB?.text || '')) return false;
    if ((lastA?.timestamp || 0) !== (lastB?.timestamp || 0)) return false;
    if (attachmentUrlCount(am) !== attachmentUrlCount(bm)) return false;
    // Document edits are often not the last message — compare any changed timestamps.
    for (let m = 0; m < am.length; m++) {
      if ((am[m]?.timestamp || 0) !== (bm[m]?.timestamp || 0)) return false;
      if ((am[m]?.text || '') !== (bm[m]?.text || '')) return false;
    }
  }
  return true;
};

const totalMessages = (sessions: ChatSession[]) =>
  sessions.reduce((sum, s) => sum + sessionMessageCount(s), 0);

const mergeCaseLearnings = (local: CaseLearning[], cloud: CaseLearning[]): CaseLearning[] => {
  const map = new Map<string, CaseLearning>();
  [...local, ...cloud].forEach((item) => {
    const key = (item?.caseType || '').trim().toLowerCase();
    if (!key) return;
    const existing = map.get(key);
    if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 40);
};

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  createNewSession: () => void;
  addMessageToActiveSession: (message: Message) => void;
  updateMessageText: (messageId: string, newText: string) => void;
  updateMessageFields: (messageId: string, fields: Partial<Message>) => void;
  trimMessagesAfter: (messageId: string) => void;
  deleteChatSession: (sessionId: string) => void;
  renameChatSession: (sessionId: string, newTitle: string) => void;
  nameChatFromClient: (sessionId: string, clientName: string, caseDate?: string | null) => void;
  usageSeconds: number;
  subscribeUsageSeconds: (listener: (seconds: number) => void) => () => void;
  isTimeUp: boolean;
  draftCount: number;
  incrementDraftCount: () => boolean;
  decrementDraftCount: () => void;
  consumeDailyUse: () => boolean;
  aiUsage: { month?: string; requests?: number; images?: number; day?: string; dayRequests?: number; monthDrafts?: number } | null;
  language: string;
  setLanguage: (lang: string) => void;
  userMode: UserMode;
  setUserMode: (mode: UserMode) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (isOpen: boolean) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isSubscriptionModalOpen: boolean;
  setIsSubscriptionModalOpen: (isOpen: boolean) => void;
  isUpgradeModalOpen: boolean;
  setIsUpgradeModalOpen: (isOpen: boolean) => void;
  isMockRazorpayOpen: boolean;
  setIsMockRazorpayOpen: (isOpen: boolean) => void;
  upgradeToPro: (planId?: string, serverExpiry?: number | null) => void;
  logout: () => void;
  isCloudSyncing: boolean;
  globalAnnouncement: string;
  subscriptionPlans: SubscriptionPlanConfig[];
  cloudTemplates: CloudLegalTemplate[];
  caseLearnings: CaseLearning[];
  upsertCaseLearning: (learning: CaseLearning) => void;
  redeemPromoCode: (code: string) => Promise<{ ok: boolean; kind?: '14d' | 'forever'; expiresAt?: number | null; alreadyUnlimited?: boolean; alreadyActive?: boolean }>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const loadState = <T,>(key: string, defaultValue: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
};

/** Firestore rejects `undefined` — strip it from nested chat payloads */
const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
};

type ChatCloudWrite = {
  sessions: ChatSession[];
  deleted: string[];
  updatedAt: number;
};

const FIRESTORE_SAFE_BYTES = 900_000;

const payloadBytes = (value: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return JSON.stringify(value || '').length;
  }
};

const sanitizeAttachment = (a: Attachment): Attachment => ({
  name: String(a?.name || 'file'),
  type: a?.type === 'format' ? 'format' : 'case',
  ...(a?.url ? { url: String(a.url) } : {}),
  ...(a?.storagePath ? { storagePath: String(a.storagePath) } : {}),
  ...(a?.mimeType ? { mimeType: String(a.mimeType) } : {}),
  ...(typeof a?.size === 'number' ? { size: a.size } : {}),
});

const sanitizeMessage = (m: Message): Message => ({
  id: String(m?.id || ''),
  role: m?.role === 'user' ? 'user' : 'model',
  text: typeof m?.text === 'string' ? m.text : '',
  timestamp: typeof m?.timestamp === 'number' ? m.timestamp : 0,
  ...(m?.isDocument ? { isDocument: true } : {}),
  ...(typeof m?.evidenceNotes === 'string' && m.evidenceNotes ? { evidenceNotes: m.evidenceNotes } : {}),
  ...(Array.isArray(m?.suggestedQuestions) && m.suggestedQuestions.length
    ? {
        suggestedQuestions: m.suggestedQuestions
          .map((q) => String(q || '').trim())
          .filter((q) => q.length >= 8 && q.length <= 180)
          .slice(0, 4),
      }
    : {}),
  ...(Array.isArray(m?.attachments) && m.attachments.length
    ? { attachments: m.attachments.map(sanitizeAttachment) }
    : {}),
});

const sanitizeSession = (s: ChatSession): ChatSession => ({
  id: String(s?.id || ''),
  title: String(s?.title || 'New Case Analysis'),
  updatedAt: typeof s?.updatedAt === 'number' ? s.updatedAt : 0,
  ...(s?.userMode === 'judge' || s?.userMode === 'advocate' ? { userMode: s.userMode } : {}),
  ...(typeof s?.caseDate === 'string' && s.caseDate.trim() ? { caseDate: s.caseDate.trim().slice(0, 40) } : {}),
  messages: Array.isArray(s?.messages) ? s.messages.map(sanitizeMessage).filter((m) => m.id) : [],
});

const sessionStub = (s: ChatSession): ChatSession => ({
  id: String(s?.id || ''),
  title: String(s?.title || 'New Case Analysis'),
  updatedAt: typeof s?.updatedAt === 'number' ? s.updatedAt : 0,
  ...(s?.userMode === 'judge' || s?.userMode === 'advocate' ? { userMode: s.userMode } : {}),
  ...(typeof s?.caseDate === 'string' && s.caseDate.trim() ? { caseDate: s.caseDate.trim().slice(0, 40) } : {}),
  messages: [],
});

const chatIndexFromSessions = (sessions: ChatSession[]) =>
  sessions
    .filter((s) => s.id)
    .map((s) => ({
      id: s.id,
      title: s.title || 'New Case Analysis',
      updatedAt: s.updatedAt || 0,
      messageCount: sessionMessageCount(s),
      ...(s.userMode === 'judge' || s.userMode === 'advocate' ? { userMode: s.userMode } : {}),
      ...(typeof s.caseDate === 'string' && s.caseDate.trim() ? { caseDate: s.caseDate.trim().slice(0, 40) } : {}),
    }));

const sessionsFromChatIndex = (rows: unknown): ChatSession[] => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return sessionStub({
        id: String(r?.id || ''),
        title: String(r?.title || 'New Case Analysis'),
        updatedAt: typeof r?.updatedAt === 'number' ? r.updatedAt : 0,
        ...(r?.userMode === 'judge' || r?.userMode === 'advocate' ? { userMode: r.userMode } : {}),
        ...(typeof r?.caseDate === 'string' && r.caseDate ? { caseDate: String(r.caseDate) } : {}),
        messages: [],
      });
    })
    .filter((s) => s.id);
};

const truncateSessionToBytes = (s: ChatSession, maxBytes: number): ChatSession => {
  let out = sanitizeSession(s);
  if (maxBytes < 2000) return { ...out, messages: [] };
  if (payloadBytes(out) <= maxBytes) return out;
  const messages = [...out.messages];
  while (messages.length > 1 && payloadBytes({ ...out, messages }) > maxBytes) {
    messages.shift();
  }
  if (messages.length && payloadBytes({ ...out, messages }) > maxBytes) {
    const last = messages[messages.length - 1];
    let text = last.text || '';
    while (text.length > 400 && payloadBytes({ ...out, messages: [...messages.slice(0, -1), { ...last, text }] }) > maxBytes) {
      text = text.slice(-Math.floor(text.length * 0.6));
    }
    messages[messages.length - 1] = { ...last, text };
  }
  return { ...out, messages };
};

const trimSessionsForCloud = (sessions: ChatSession[], activeSessionId: string | null): ChatSession[] => {
  const sanitized = sessions.map(sanitizeSession).filter((s) => s.id);
  if (payloadBytes(sanitized) <= FIRESTORE_SAFE_BYTES) return sanitized;
  // Keep every chat id on the user document so another phone can list them.
  // Fill messages for the newest chats until the Firestore size budget is used.
  const ranked = [...sanitized].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const byId = new Map(ranked.map((s) => [s.id, sessionStub(s)]));
  const tryFill = (s: ChatSession) => {
    const remaining = FIRESTORE_SAFE_BYTES - payloadBytes([...byId.values()]) - 2048;
    if (remaining < 2000) return;
    const sized = truncateSessionToBytes(s, remaining);
    const next = new Map(byId);
    next.set(s.id, sized);
    if (payloadBytes([...next.values()]) <= FIRESTORE_SAFE_BYTES) {
      byId.set(s.id, sized);
    }
  };
  const active = ranked.find((s) => s.id === activeSessionId);
  if (active) tryFill(active);
  for (const s of ranked) {
    if (s.id === activeSessionId) continue;
    tryFill(s);
  }
  return ranked.map((s) => byId.get(s.id) || sessionStub(s));
};

const chatDocRef = (userId: string, chatId: string) => doc(db, 'users_data', userId, 'chats', chatId);
const chatsCollection = (userId: string) => collection(db, 'users_data', userId, 'chats');

const persistChatDocs = async (userId: string, sessions: ChatSession[], deleted: string[]) => {
  const bodies = sessions
    .map(sanitizeSession)
    .filter((s) => s.id && sessionMessageCount(s) > 0)
    .map((s) => truncateSessionToBytes(s, FIRESTORE_SAFE_BYTES));
  const keep = new Set(bodies.map((s) => s.id));
  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (!ops) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };
  const queueSet = async (id: string, data: Record<string, unknown>) => {
    batch.set(chatDocRef(userId, id), data);
    ops += 1;
    if (ops >= 400) await flush();
  };
  const queueDelete = async (id: string) => {
    batch.delete(chatDocRef(userId, id));
    ops += 1;
    if (ops >= 400) await flush();
  };
  try {
    for (const s of bodies) {
      await queueSet(s.id, stripUndefined(s) as Record<string, unknown>);
    }
    for (const id of deleted) {
      if (!id || keep.has(id)) continue;
      await queueDelete(id);
    }
    await flush();
  } catch (err) {
    console.warn('[Firebase] Chat batch write failed; writing each chat separately', err);
    for (const s of bodies) {
      try {
        await setDoc(chatDocRef(userId, s.id), stripUndefined(s) as Record<string, unknown>);
      } catch (one) {
        console.warn('[Firebase] Chat doc write failed', s.id, one);
      }
    }
    for (const id of deleted) {
      if (!id || keep.has(id)) continue;
      try {
        await deleteDoc(chatDocRef(userId, id));
      } catch {
        /* ignore */
      }
    }
  }
};

const sessionsFromChatDocs = (docs: { id: string; data: () => Record<string, unknown> }[]): ChatSession[] =>
  docs.map((d) => sanitizeSession({ id: d.id, ...(d.data() as ChatSession) }));

let lastChatPersistSig = '';

const chatsPersistSig = (userId: string, sessions: ChatSession[], deleted: string[]) =>
  `${userId}:${sessions.map((s) => `${s.id}:${s.updatedAt || 0}:${sessionMessageCount(s)}`).join('|')}::${[...deleted].sort().join(',')}`;

const writeChatsToCloud = async (opts: {
  userId: string;
  localSessions: ChatSession[];
  localDeleted: string[];
  activeSessionId: string | null;
  extras?: Record<string, unknown>;
}): Promise<ChatCloudWrite | null> => {
  const ref = doc(db, 'users_data', opts.userId);
  let colSessions: ChatSession[] = [];
  try {
    const colSnap = await getDocs(chatsCollection(opts.userId));
    colSessions = sessionsFromChatDocs(colSnap.docs);
  } catch (err) {
    console.warn('[Firebase] Chat collection read skipped', err);
  }
  const local = opts.localSessions.map(sanitizeSession);
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remote = snap.exists() ? snap.data() as Record<string, any> : {};
    const remoteSessions: ChatSession[] = Array.isArray(remote.chatSessions) ? remote.chatSessions : [];
    const remoteDeleted: string[] = Array.isArray(remote.deletedChatIds) ? remote.deletedChatIds : [];
    const deleted = mergeDeletedChatIds(opts.localDeleted, remoteDeleted);
    const merged = mergeChatSessions(local, mergeChatSessions(remoteSessions, colSessions, deleted), deleted);
    const toSave = trimSessionsForCloud(
      merged.filter((s) => sessionMessageCount(s) > 0 || s.id === opts.activeSessionId),
      opts.activeSessionId
    );
    const updatedAt = Date.now();
    tx.set(ref, stripUndefined({
      ...(opts.extras || {}),
      chatSessions: toSave,
      chatIndex: chatIndexFromSessions(merged),
      deletedChatIds: deleted,
      activeSessionId: opts.activeSessionId ?? null,
      updatedAt,
    }), { merge: true });
    return { sessions: merged.filter((s) => sessionMessageCount(s) > 0 || s.id === opts.activeSessionId), deleted, updatedAt };
  });
  const sig = chatsPersistSig(opts.userId, result.sessions, result.deleted);
  if (sig !== lastChatPersistSig) {
    try {
      await persistChatDocs(opts.userId, result.sessions, result.deleted);
      lastChatPersistSig = sig;
    } catch (err) {
      console.warn('[Firebase] Per-chat cloud docs failed; user document still saved', err);
    }
  }
  return { sessions: result.sessions, deleted: result.deleted, updatedAt: result.updatedAt };
};

const withAdminRole = (user: User | null): User | null => {
  if (!user) return null;
  if (isAdminEmail(user.email)) {
    return { ...user, role: 'admin', plan: user.plan && user.plan !== 'free' ? user.plan : 'pro' };
  }
  if (user.role === 'admin') {
    return { ...user, role: 'user' };
  }
  return user;
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const initialUser = withAdminRole(loadState<User | null>('casemate_current_user', null));
  const isColdStart = consumeColdStart();
  const bootRef = useRef<{ activeId: string | null; sessions: ChatSession[] } | null>(null);
  if (!bootRef.current) {
    if (!initialUser) {
      bootRef.current = { activeId: null, sessions: [] };
    } else {
      const loaded = loadState<ChatSession[]>(`casemate_chats_${initialUser.id}`, []);
      const history = loaded.filter((s) => sessionMessageCount(s) > 0);
      const bootMode = normalizeUserMode(loadState('casemate_user_mode', 'advocate'));
      const inMode = history.filter((s) => sessionMode(s) === bootMode);
      if (isColdStart) {
        const fresh: ChatSession = {
          id: Date.now().toString(),
          title: 'New Case Analysis',
          messages: [],
          updatedAt: Date.now(),
          userMode: bootMode,
        };
        bootRef.current = { activeId: fresh.id, sessions: [fresh, ...history] };
      } else {
        const savedActive = loadState<string | null>(`casemate_active_session_${initialUser.id}`, null);
        const resumeId =
          (savedActive && inMode.some((s) => s.id === savedActive) ? savedActive : null) ||
          inMode[0]?.id ||
          null;
        bootRef.current = { activeId: resumeId, sessions: loaded };
      }
    }
  }
  const boot = bootRef.current;
  
  const [user, setUserState] = useState<User | null>(initialUser);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(boot.sessions);
  const [deletedChatIds, setDeletedChatIds] = useState<string[]>(() =>
    initialUser ? loadState(`casemate_deleted_chats_${initialUser.id}`, []) : []
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(boot.activeId);
  // Free tier: usageSeconds = remaining seconds of the 1-hour daily allowance
  const [usageSeconds, setUsageSeconds] = useState(() => {
    if (!initialUser) return 3600;
    if (initialUser.plan && initialUser.plan !== 'free') return 3600;
    const saved = loadState(`casemate_usage_${initialUser.id}`, 3600);
    // Migrate legacy 1-use model (0/1) to full hour when still allowed
    if (saved === 0 || saved === 1) {
      const timeUp = loadState(`casemate_timeup_${initialUser.id}`, false);
      return timeUp ? 0 : 3600;
    }
    return saved;
  });
  const [isTimeUp, setIsTimeUp] = useState(() => {
    if (!initialUser) return false;
    if (hasUnlimitedAccess(initialUser.email, initialUser) || (initialUser.plan && initialUser.plan !== 'free')) return false;
    return loadState(`casemate_timeup_${initialUser.id}`, false);
  });
  const [dailyUseDate, setDailyUseDate] = useState(() =>
    initialUser ? loadState(`casemate_daily_date_${initialUser.id}`, todayKey()) : todayKey()
  );
  
  const [draftCount, setDraftCount] = useState(() => initialUser ? loadState(`casemate_drafts_${initialUser.id}`, 0) : 0);
  const [aiUsage, setAiUsage] = useState<{ month?: string; requests?: number; images?: number; day?: string; dayRequests?: number; monthDrafts?: number } | null>(null);
  const [lastResetDate, setLastResetDate] = useState(() => initialUser ? loadState(`casemate_reset_${initialUser.id}`, new Date().getMonth()) : new Date().getMonth());

  const [language, setLanguageState] = useState(() => loadState('casemate_lang', 'English'));
  const languageAtRef = useRef<number>(loadState('casemate_lang_at', 0));
  const [userMode, setUserModeState] = useState<UserMode>(() => normalizeUserMode(loadState('casemate_user_mode', 'advocate')));
  const userModeAtRef = useRef<number>(loadState('casemate_user_mode_at', 0));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isMockRazorpayOpen, setIsMockRazorpayOpen] = useState(false);
  const [globalAnnouncement, setGlobalAnnouncement] = useState(() => {
    try {
      return localStorage.getItem('casemate_announcement') || '';
    } catch {
      return '';
    }
  });
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlanConfig[]>(() => {
    try {
      const saved = localStorage.getItem('casemate_subscription_plans');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return sanitizeSubscriptionPlans(parsed);
      }
    } catch { /* ignore */ }
    return DEFAULT_SUBSCRIPTION_PLANS;
  });
  const [cloudTemplates, setCloudTemplates] = useState<CloudLegalTemplate[]>(() => {
    try {
      const saved = localStorage.getItem('casemate_cloud_templates');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    return [];
  });
  const [caseLearnings, setCaseLearnings] = useState<CaseLearning[]>(() => {
    try {
      if (!initialUser?.id) return [];
      const saved = localStorage.getItem(`casemate_case_learnings_${initialUser.id}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Only write to Firestore after cloud data has been loaded (prevents wiping history on new devices)
  const [isCloudReady, setIsCloudReady] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authUid, setAuthUid] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  const cloudUserIdRef = useRef<string | null>(null);
  const freshChatOpenedForUserRef = useRef<string | null>(
    isColdStart && boot.activeId && initialUser ? initialUser.id : null
  );
  /** True only on first launch after process kill — open a fresh chat (ChatGPT-style). */
  const coldStartNewChatRef = useRef(isColdStart);
  const lastCloudMessageCountRef = useRef(0);
  const lastAppliedCloudSessionsRef = useRef<ChatSession[]>([]);
  const lastCloudApplySigRef = useRef('');
  const lastSeenCloudUpdatedAtRef = useRef(0);
  const chatSessionsRef = useRef<ChatSession[]>(boot.sessions);
  const deletedChatIdsRef = useRef<string[]>(
    initialUser ? loadState(`casemate_deleted_chats_${initialUser.id}`, []) : []
  );
  /** Only write to cloud after a real Firestore read (never after a timeout/guess). */
  const cloudReadOkRef = useRef(false);
  const appliedCloudProfileRef = useRef(false);
  const preferFreshChatRef = useRef(isColdStart);
  const userRef = useRef(user);
  const activeSessionIdRef = useRef(activeSessionId);
  const isTimeUpRef = useRef(isTimeUp);
  const extrasRef = useRef<Record<string, unknown>>({});
  const rejectedPromoRef = useRef('');
  const flushInFlightRef = useRef(false);
  const pendingCloudFlushRef = useRef(false);
  const flushChatsToCloudNowRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);
  const usageSecondsRef = useRef(usageSeconds);
  const usageListenersRef = useRef(new Set<(seconds: number) => void>());

  userRef.current = user;
  activeSessionIdRef.current = activeSessionId;
  isTimeUpRef.current = isTimeUp;
  extrasRef.current = {
    draftCount,
    lastResetDate,
    usageSeconds: usageSecondsRef.current,
    isTimeUp,
    dailyUseDate,
    // plan / subscriptionExpiryDate are written by the backend only, after a
    // verified payment. Firestore rules reject any change from the client.
    name: user?.name,
    email: user?.email,
    language,
    languageUpdatedAt: languageAtRef.current,
    userMode,
    userModeUpdatedAt: userModeAtRef.current,
    caseLearnings,
  };

  const setUserMode = useCallback((mode: UserMode) => {
    const next = normalizeUserMode(mode);
    const at = Date.now();
    userModeAtRef.current = at;
    extrasRef.current = { ...extrasRef.current, userMode: next, userModeUpdatedAt: at };
    try {
      localStorage.setItem('casemate_user_mode', JSON.stringify(next));
      localStorage.setItem('casemate_user_mode_at', JSON.stringify(at));
      localStorage.setItem('casemate_user_mode_chosen', '1');
    } catch { /* ignore */ }
    setUserModeState(next);
  }, []);

  const setLanguage = useCallback((lang: string) => {
    const at = Date.now();
    languageAtRef.current = at;
    extrasRef.current = { ...extrasRef.current, language: lang, languageUpdatedAt: at };
    try {
      localStorage.setItem('casemate_lang', JSON.stringify(lang));
      localStorage.setItem('casemate_lang_at', JSON.stringify(at));
      localStorage.setItem('casemate_lang_chosen', '1');
    } catch { /* ignore */ }
    setLanguageState(lang);
  }, []);

  const publishUsageSeconds = (seconds: number) => {
    usageSecondsRef.current = seconds;
    extrasRef.current = { ...extrasRef.current, usageSeconds: seconds };
    usageListenersRef.current.forEach((listener) => listener(seconds));
  };

  const commitUsageSeconds = (seconds: number) => {
    publishUsageSeconds(seconds);
    setUsageSeconds(seconds);
  };

  const subscribeUsageSeconds = useCallback((listener: (seconds: number) => void) => {
    usageListenersRef.current.add(listener);
    listener(usageSecondsRef.current);
    return () => {
      usageListenersRef.current.delete(listener);
    };
  }, []);

  const flushChatsToCloudNow = async (silent = true) => {
    const u = userRef.current;
    if (!u?.id || u.role === 'admin') return;
    if (!auth.currentUser || auth.currentUser.uid !== u.id) {
      console.warn('[Firebase] Skip sync — Auth not ready or uid mismatch.');
      return;
    }
    if (!cloudReadOkRef.current) {
      console.warn('[Firebase] Skip sync — waiting for a confirmed cloud read so another phone\'s chats are not overwritten.');
      return;
    }
    if (flushInFlightRef.current) {
      pendingCloudFlushRef.current = true;
      return;
    }
    flushInFlightRef.current = true;
    if (!silent) setIsCloudSyncing(true);
    try {
      const result = await writeChatsToCloud({
        userId: u.id,
        localSessions: chatSessionsRef.current,
        localDeleted: deletedChatIdsRef.current,
        activeSessionId: activeSessionIdRef.current,
        extras: extrasRef.current,
      });
      if (result) {
        lastAppliedCloudSessionsRef.current = result.sessions;
        lastCloudMessageCountRef.current = totalMessages(result.sessions);
        lastSeenCloudUpdatedAtRef.current = result.updatedAt;
        deletedChatIdsRef.current = result.deleted;
        console.info(
          '[Firebase] Saved to legal/users_data/' + u.id,
          '| sessions:',
          result.sessions.length,
          '| messages:',
          lastCloudMessageCountRef.current
        );
      }
    } catch (error: any) {
      console.error('Error syncing chat history to cloud', error?.code || error, error?.message || error);
      if (error?.code === 'permission-denied') {
        console.error(
          "[Firebase] permission-denied on database 'legal'. In Firebase Console → Firestore → Rules, allow:\n" +
          'match /users_data/{userId} { allow read, write: if request.auth != null && request.auth.uid == userId; }'
        );
      }
    } finally {
      flushInFlightRef.current = false;
      if (!silent) setIsCloudSyncing(false);
      if (pendingCloudFlushRef.current) {
        pendingCloudFlushRef.current = false;
        queueMicrotask(() => {
          void flushChatsToCloudNowRef.current(true);
        });
      }
    }
  };
  flushChatsToCloudNowRef.current = flushChatsToCloudNow;

  useEffect(() => {
    deletedChatIdsRef.current = deletedChatIds;
  }, [deletedChatIds]);

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  // Advocate and judge keep separate histories. Each mode opens on its own chat,
  // and a mode with no chats yet gets a blank one instead of an empty screen.
  const blankChatForModeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    const mine = chatSessions.filter((s) => sessionMode(s) === userMode);
    if (mine.some((s) => s.id === activeSessionId)) {
      blankChatForModeRef.current = null;
      return;
    }
    if (mine.length === 0) {
      if (blankChatForModeRef.current && chatSessions.some((s) => s.id === blankChatForModeRef.current)) return;
      const fresh: ChatSession = {
        id: Date.now().toString(),
        title: 'New Case Analysis',
        messages: [],
        updatedAt: Date.now(),
        userMode,
      };
      blankChatForModeRef.current = fresh.id;
      activeSessionIdRef.current = fresh.id;
      setChatSessions((prev) => (prev.some((s) => sessionMode(s) === userMode) ? prev : [fresh, ...prev]));
      setActiveSessionId(fresh.id);
      return;
    }
    blankChatForModeRef.current = null;
    const latest = mine.reduce((best, s) => ((s.updatedAt || 0) >= (best.updatedAt || 0) ? s : best));
    setActiveSessionId(latest.id);
  }, [userMode, chatSessions, activeSessionId, user?.id]);

  // Wait for Firebase Auth to restore before cloud read/write (Capacitor cold start)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setAuthUid(fbUser?.uid ?? null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Live admin config (plans + announcement + templates) on every device
  useEffect(() => {
    const unsubPlans = subscribeAppConfig('plans', (data) => {
      if (data && Array.isArray(data.plans) && data.plans.length > 0) {
        const plans = sanitizeSubscriptionPlans(data.plans as SubscriptionPlanConfig[]);
        setSubscriptionPlans(plans);
        try {
          localStorage.setItem('casemate_subscription_plans', JSON.stringify(plans));
        } catch { /* ignore */ }
      }
      if (data && data.freeLimits && typeof data.freeLimits === 'object') {
        applyFreePlanConfig(data.freeLimits as Record<string, number>);
      }
      if (data && data.paidLimits && typeof data.paidLimits === 'object') {
        applyPaidPlanConfig(data.paidLimits as Record<string, Record<string, number>>);
      }
    });
    const unsubAnn = subscribeAppConfig('announcement', (data) => {
      const text = typeof data?.text === 'string' ? data.text : '';
      setGlobalAnnouncement(text);
      try {
        localStorage.setItem('casemate_announcement', text);
      } catch { /* ignore */ }
    });
    const unsubTemplates = subscribeAppConfig('templates', (data) => {
      const list = Array.isArray(data?.templates) ? (data.templates as CloudLegalTemplate[]) : [];
      const cleaned = list.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.content === 'string');
      setCloudTemplates(cleaned);
      try {
        localStorage.setItem('casemate_cloud_templates', JSON.stringify(cleaned));
      } catch { /* ignore */ }
    });
    return () => {
      unsubPlans();
      unsubAnn();
      unsubTemplates();
    };
  }, []);

  // Presence ping so the admin panel can see who is using the app right now.
  useEffect(() => {
    if (!user?.id || user.role === 'admin' || !authReady || authUid !== user.id) return;
    let cancelled = false;
    const ping = () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      const planLabel = hasUnlimitedAccess(user.email, user) ? 'unlimited' : (user.plan || 'free');
      void touchUserDirectory({
        id: user.id,
        name: user.name,
        email: user.email,
        plan: planLabel,
      }).catch((err) => console.warn('[user_directory] presence write failed', err));
    };
    ping();
    const id = window.setInterval(ping, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user?.id, user?.name, user?.email, user?.plan, user?.role, authReady, authUid]);

  // Reminder email when paid plan is close to expiry (7 / 3 / 1 days left)
  useEffect(() => {
    if (!user?.id || !isCloudReady) return;
    if (!user.plan || user.plan === 'free') return;
    void checkAndSendExpiryReminder({
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      subscriptionExpiryDate: user.subscriptionExpiryDate,
    });
  }, [user?.id, user?.plan, user?.subscriptionExpiryDate, user?.email, user?.name, isCloudReady]);

  useEffect(() => {
    const currentMonth = new Date().getMonth();
    if (lastResetDate !== currentMonth) {
      setDraftCount(0);
      setLastResetDate(currentMonth);
      if (user?.id) {
        localStorage.setItem(`casemate_drafts_${user.id}`, '0');
        localStorage.setItem(`casemate_reset_${user.id}`, JSON.stringify(currentMonth));
      }
    }
  }, [user, lastResetDate]);

  // Free tier: reset 1-hour daily allowance once per calendar day
  useEffect(() => {
    if (!user?.id) return;
    if (hasUnlimitedAccess(user.email, user) || (user.plan && user.plan !== 'free')) {
      setIsTimeUp(false);
      return;
    }
    const today = todayKey();
    const allowance = getPlanLimits(user.plan, user.email, user).dailySeconds;
    if (!allowance) {
      setIsTimeUp(false);
      return;
    }
    if (dailyUseDate !== today) {
      setDailyUseDate(today);
      commitUsageSeconds(allowance);
      setIsTimeUp(false);
      localStorage.setItem(`casemate_daily_date_${user.id}`, JSON.stringify(today));
      localStorage.setItem(`casemate_usage_${user.id}`, JSON.stringify(allowance));
      localStorage.setItem(`casemate_timeup_${user.id}`, JSON.stringify(false));
    } else if (usageSecondsRef.current <= 0) {
      setIsTimeUp(true);
    }
  }, [user?.id, user?.email, user?.plan, user?.promoKind, user?.promoExpiresAt, dailyUseDate]);

  // Free tier: countdown the 1-hour daily timer while the app is open.
  // Tick subscribers (sidebar clock) without re-rendering the whole app every second.
  useEffect(() => {
    if (!user?.id || hasUnlimitedAccess(user.email, user) || (user.plan && user.plan !== 'free') || isTimeUp) return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const prev = usageSecondsRef.current;
      if (prev <= 1) {
        commitUsageSeconds(0);
        setIsTimeUp(true);
        return;
      }
      const next = prev - 1;
      publishUsageSeconds(next);
      if (next % 30 === 0) {
        setUsageSeconds(next);
        try {
          localStorage.setItem(`casemate_usage_${user.id}`, JSON.stringify(next));
        } catch { /* ignore */ }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [user?.id, user?.email, user?.plan, user?.promoKind, user?.promoExpiresAt, isTimeUp]);

  // Keep chats readable when the daily window ends. Do not auto-open a second upgrade modal.
  useEffect(() => {
    if (hasUnlimitedAccess(user?.email, user)) {
      if (isTimeUp) setIsTimeUp(false);
    }
  }, [isTimeUp, user?.plan, user?.email, user?.promoKind, user?.promoExpiresAt]);

  // Live cloud chats — same account on every phone (wait for real Auth, not localStorage)
  useEffect(() => {
    if (!user?.id) {
      setIsCloudReady(false);
      cloudUserIdRef.current = null;
      cloudReadOkRef.current = false;
      appliedCloudProfileRef.current = false;
      return;
    }

    if (user.role === 'admin') {
      setIsCloudReady(true);
      cloudUserIdRef.current = user.id;
      cloudReadOkRef.current = true;
      return;
    }

    if (!authReady) return;

    if (authUid !== user.id) {
      cloudReadOkRef.current = false;
      setIsCloudReady(false);
      setIsCloudSyncing(true);
      const giveUp = window.setTimeout(() => {
        if (cloudUserIdRef.current !== user.id) return;
        if (!cloudReadOkRef.current) {
          setIsCloudReady(true);
          setIsCloudSyncing(false);
        }
      }, 10000);
      return () => window.clearTimeout(giveUp);
    }

    setIsCloudReady(false);
    setIsCloudSyncing(true);
    cloudUserIdRef.current = user.id;
    cloudReadOkRef.current = false;
    appliedCloudProfileRef.current = false;
    lastCloudApplySigRef.current = '';

    const userRefDoc = doc(db, 'users_data', user.id);
    const cloudDocSessionsRef = { current: [] as ChatSession[] };
    const cloudColSessionsRef = { current: [] as ChatSession[] };
    const seenCloud = { user: false, col: false };
    const markCloudReady = (force = false) => {
      if (cloudUserIdRef.current !== user.id) return;
      if (cloudReadOkRef.current) return;
      if (!force && !(seenCloud.user && seenCloud.col)) return;
      cloudReadOkRef.current = true;
      setIsCloudReady(true);
      setIsCloudSyncing(false);
    };
    const readyFallback = window.setTimeout(() => {
      if (seenCloud.user) markCloudReady(true);
    }, 4000);

    const applyCloudChats = (deleted: string[], first: boolean, data?: Record<string, any>) => {
      const cloudDeleted = mergeDeletedChatIds(
        deletedChatIdsRef.current,
        deleted
      );
      deletedChatIdsRef.current = cloudDeleted;
      const cloudSessions = mergeChatSessions(
        cloudDocSessionsRef.current,
        cloudColSessionsRef.current,
        cloudDeleted
      );
      const cloudSig = chatsPersistSig(user.id, cloudSessions, cloudDeleted);
      if (!first && cloudSig === lastCloudApplySigRef.current) return;
      lastCloudApplySigRef.current = cloudSig;
      setDeletedChatIds(cloudDeleted);
      lastAppliedCloudSessionsRef.current = cloudSessions;
      lastCloudMessageCountRef.current = totalMessages(cloudSessions);
      const cloudIds = new Set(cloudSessions.map((s) => s.id));
      setChatSessions((prev) => {
        const next = mergeChatSessions(prev, cloudSessions, cloudDeleted).filter(
          (s) => sessionMessageCount(s) > 0 || s.id === activeSessionIdRef.current || cloudIds.has(s.id)
        );
        chatSessionsRef.current = next;
        return sessionsUnchanged(prev, next) ? prev : next;
      });
      if (first && !preferFreshChatRef.current && data) {
        const cloudActive = typeof data.activeSessionId === 'string' ? data.activeSessionId : '';
        if (cloudActive && !cloudDeleted.includes(cloudActive)) {
          setActiveSessionId((cur) => {
            const merged = chatSessionsRef.current;
            const cloudSession = merged.find((s) => s.id === cloudActive);
            if (!cloudSession || sessionMessageCount(cloudSession) === 0) return cur;
            const current = merged.find((s) => s.id === cur);
            if (current && sessionMessageCount(current) > 0) return cur;
            if (current && sessionMessageCount(current) === 0) return cur;
            return cloudActive;
          });
        }
      }
    };

    const unsubUser = onSnapshot(
      userRefDoc,
      (docSnap) => {
        if (cloudUserIdRef.current !== user.id) return;
        const first = !appliedCloudProfileRef.current;

        if (docSnap.exists()) {
          const data = docSnap.data();

          if (typeof data.updatedAt === 'number') {
            lastSeenCloudUpdatedAtRef.current = data.updatedAt;
          }

          const fromDoc = Array.isArray(data.chatSessions) ? (data.chatSessions as ChatSession[]) : [];
          const fromIndex = sessionsFromChatIndex(data.chatIndex);
          cloudDocSessionsRef.current = mergeChatSessions(fromIndex, fromDoc, []);
          applyCloudChats(
            Array.isArray(data.deletedChatIds) ? data.deletedChatIds : [],
            first,
            data
          );

          // The backend owns plan + expiry, so always trust the cloud copy —
          // this is how an activated (or expired) subscription reaches the app.
          setUserState((prev) => {
            if (!prev) return prev;
            const promoKind = data.promoKind === '14d' || data.promoKind === 'forever' ? data.promoKind : undefined;
            const promoExpiresAt = typeof data.promoExpiresAt === 'number' ? data.promoExpiresAt : undefined;
            const promoCode = typeof data.promoCode === 'string' ? data.promoCode : undefined;
            const rejected = promoCode && promoCode === rejectedPromoRef.current;
            let next = prev;
            if (data.plan) {
              const nextExpiry = data.subscriptionExpiryDate ?? prev.subscriptionExpiryDate;
              if (prev.plan !== data.plan || prev.subscriptionExpiryDate !== nextExpiry) {
                next = { ...next, plan: data.plan as User['plan'], subscriptionExpiryDate: nextExpiry };
              }
            }
            const nextKind = rejected ? undefined : promoKind;
            const nextExpiryAt = rejected ? undefined : promoExpiresAt;
            const nextCode = rejected ? undefined : promoCode;
            if (next.promoKind !== nextKind || next.promoExpiresAt !== nextExpiryAt || next.promoCode !== nextCode) {
              next = { ...next, promoKind: nextKind, promoExpiresAt: nextExpiryAt, promoCode: nextCode };
            }
            return next === prev ? prev : next;
          });

          if (data.aiUsage && typeof data.aiUsage === 'object') {
            const usage = data.aiUsage as { month?: string; requests?: number; images?: number; day?: string; dayRequests?: number; monthDrafts?: number };
            setAiUsage(usage);
            const month = new Date().toISOString().slice(0, 7);
            if (usage.month === month && typeof usage.monthDrafts === 'number') {
              setDraftCount(usage.monthDrafts);
            }
          }
          if (data.addOns && typeof data.addOns === 'object') {
            setUserState((prev) => (prev ? { ...prev, addOns: data.addOns as Record<string, number | string> } : prev));
          }
          if (data.grantedLimits || data.entitlementsVersion || data.paymentStatus || data.billingCycleStart || data.customPlan) {
            setUserState((prev) => prev ? {
              ...prev,
              grantedLimits: data.grantedLimits && typeof data.grantedLimits === 'object' ? data.grantedLimits : prev.grantedLimits,
              entitlementsVersion: typeof data.entitlementsVersion === 'number' ? data.entitlementsVersion : prev.entitlementsVersion,
              paymentStatus: typeof data.paymentStatus === 'string' ? data.paymentStatus : prev.paymentStatus,
              billingCycleStart: typeof data.billingCycleStart === 'number' ? data.billingCycleStart : prev.billingCycleStart,
              customPlan: data.customPlan && typeof data.customPlan === 'object' ? data.customPlan : prev.customPlan,
            } : prev);
          }
          if (first) {
            if (typeof data.draftCount === 'number' && !(data.aiUsage && typeof data.aiUsage.monthDrafts === 'number')) {
              setDraftCount(data.draftCount);
            }
            const cloudDailyDate = data.dailyUseDate;
            const today = todayKey();
            const planAfterLoad = data.plan || user.plan;
            const unlimited = hasUnlimitedAccess(user.email, user) || hasUnlimitedAccess(data.email, data);
            const isFreePlan = !unlimited && (!planAfterLoad || planAfterLoad === 'free');
            if (unlimited) {
              setIsTimeUp(false);
              setDailyUseDate(today);
            } else if (cloudDailyDate === today) {
              if (typeof data.usageSeconds === 'number') {
                let secs = data.usageSeconds;
                if (isFreePlan && (secs === 0 || secs === 1) && !data.isTimeUp) secs = 3600;
                if (isFreePlan && secs === 1 && data.isTimeUp) secs = 0;
                commitUsageSeconds(secs);
              }
              if (typeof data.isTimeUp === 'boolean') {
                setIsTimeUp(isFreePlan ? !!data.isTimeUp : false);
              }
              setDailyUseDate(today);
            } else if (isFreePlan) {
              setDailyUseDate(today);
              commitUsageSeconds(3600);
              setIsTimeUp(false);
            } else {
              if (typeof data.usageSeconds === 'number') {
                commitUsageSeconds(data.usageSeconds);
              }
              setIsTimeUp(false);
            }
            if (data.lastResetDate !== undefined) {
              setLastResetDate(data.lastResetDate);
            }
            if (typeof data.language === 'string' && data.language) {
              const cloudAt = typeof data.languageUpdatedAt === 'number' ? data.languageUpdatedAt : 0;
              const localAt = languageAtRef.current;
              let chosenHere = false;
              try { chosenHere = localStorage.getItem('casemate_lang_chosen') === '1'; } catch { /* ignore */ }
              const keepLocal = chosenHere && localAt >= cloudAt;
              if (!keepLocal) {
                languageAtRef.current = Math.max(cloudAt, localAt);
                try {
                  localStorage.setItem('casemate_lang', JSON.stringify(data.language));
                  if (cloudAt > 0) localStorage.setItem('casemate_lang_at', JSON.stringify(cloudAt));
                } catch { /* ignore */ }
                setLanguageState(data.language);
              }
            }
            if (data.userMode === 'advocate' || data.userMode === 'judge') {
              const cloudModeAt = typeof data.userModeUpdatedAt === 'number' ? data.userModeUpdatedAt : 0;
              const localModeAt = userModeAtRef.current;
              let modeChosenHere = false;
              try { modeChosenHere = localStorage.getItem('casemate_user_mode_chosen') === '1'; } catch { /* ignore */ }
              const keepLocalMode = modeChosenHere && localModeAt >= cloudModeAt;
              if (!keepLocalMode) {
                userModeAtRef.current = Math.max(cloudModeAt, localModeAt);
                try {
                  localStorage.setItem('casemate_user_mode', JSON.stringify(data.userMode));
                  if (cloudModeAt > 0) localStorage.setItem('casemate_user_mode_at', JSON.stringify(cloudModeAt));
                } catch { /* ignore */ }
                setUserModeState(data.userMode);
              }
            }
            if (Array.isArray(data.caseLearnings)) {
              setCaseLearnings((prev) => mergeCaseLearnings(prev, data.caseLearnings as CaseLearning[]));
            }
            if (data.plan || data.name) {
              setUserState((prev) => prev ? {
                ...prev,
                plan: (data.plan as User['plan']) || prev.plan,
                subscriptionExpiryDate: data.subscriptionExpiryDate ?? prev.subscriptionExpiryDate,
                name: data.name || prev.name,
              } : null);
            }
            appliedCloudProfileRef.current = true;
          }
        } else if (first) {
          appliedCloudProfileRef.current = true;
        }

        seenCloud.user = true;
        markCloudReady();
      },
      (error) => {
        console.error("Error fetching cloud data", error);
        cloudReadOkRef.current = false;
        setIsCloudSyncing(false);
      }
    );

    const unsubChats = onSnapshot(
      chatsCollection(user.id),
      (snap) => {
        if (cloudUserIdRef.current !== user.id) return;
        cloudColSessionsRef.current = sessionsFromChatDocs(snap.docs);
        applyCloudChats(deletedChatIdsRef.current, !seenCloud.user);
        seenCloud.col = true;
        markCloudReady();
      },
      (error) => {
        console.warn('[Firebase] Per-chat collection listen failed', error);
        seenCloud.col = true;
        markCloudReady();
      }
    );

    return () => {
      window.clearTimeout(readyFallback);
      unsubUser();
      unsubChats();
    };
  }, [user?.id, authReady, authUid]);

  // Resume chats after cloud load. A new device must wait for Firestore so it
  // does not look like a blank local-only account.
  useEffect(() => {
    if (!user?.id) {
      freshChatOpenedForUserRef.current = null;
      preferFreshChatRef.current = false;
      setActiveSessionId(null);
      return;
    }

    const history = mergeChatSessions(chatSessionsRef.current, [], deletedChatIdsRef.current)
      .filter((s) => sessionMessageCount(s) > 0);
    const openMode: UserMode = extrasRef.current.userMode === 'judge' ? 'judge' : 'advocate';
    const modeHistory = history.filter((s) => sessionMode(s) === openMode);
    const savedActive = loadState<string | null>(`casemate_active_session_${user.id}`, null);
    const resumeId =
      (savedActive && modeHistory.some((s) => s.id === savedActive) ? savedActive : null) ||
      modeHistory[0]?.id ||
      null;

    // Cold start after a full close: open a blank chat immediately.
    // Never restore the last chat first — that caused a last-then-new flash.
    if (coldStartNewChatRef.current) {
      preferFreshChatRef.current = true;
      if (freshChatOpenedForUserRef.current !== user.id) {
        const newSession: ChatSession = {
          id: Date.now().toString(),
          title: 'New Case Analysis',
          messages: [],
          updatedAt: Date.now(),
          userMode: openMode,
        };
        setChatSessions([newSession, ...history]);
        setActiveSessionId(newSession.id);
        freshChatOpenedForUserRef.current = user.id;
      } else if (isCloudReady) {
        setChatSessions((prev) => {
          const merged = mergeChatSessions(prev, history, deletedChatIdsRef.current).filter(
            (s) => sessionMessageCount(s) > 0 || s.id === activeSessionIdRef.current
          );
          chatSessionsRef.current = merged;
          return sessionsUnchanged(prev, merged) ? prev : merged;
        });
        coldStartNewChatRef.current = false;
      }
      return;
    }

    if (!isCloudReady) {
      if (!history.length) return;
      if (freshChatOpenedForUserRef.current === user.id) return;
      freshChatOpenedForUserRef.current = `local:${user.id}`;
      setChatSessions((prev) => {
        const blank = prev.find((s) => sessionMode(s) === openMode && sessionMessageCount(s) === 0);
        return blank ? [blank, ...history.filter((s) => s.id !== blank.id)] : history;
      });
      if (resumeId) setActiveSessionId(resumeId);
      return;
    }

    if (freshChatOpenedForUserRef.current === user.id) return;
    freshChatOpenedForUserRef.current = user.id;

    preferFreshChatRef.current = false;
    if (resumeId) {
      setChatSessions(history);
      setActiveSessionId((cur) => {
        const current = history.find((s) => s.id === cur);
        if (current && sessionMessageCount(current) > 0) return cur;
        return resumeId;
      });
      return;
    }

    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Case Analysis',
      messages: [],
      updatedAt: Date.now(),
      userMode: openMode,
    };
    setChatSessions([newSession, ...history]);
    setActiveSessionId(newSession.id);
  }, [user?.id, isCloudReady]);

  // Device cache only — Firestore is the source of truth. Debounce JSON writes so
  // large histories do not block typing; flush immediately on hide/unload.
  useEffect(() => {
    if (!user?.id) return;
    const persist = () => {
      try {
        const u = userRef.current;
        if (!u?.id) return;
        localStorage.setItem('casemate_current_user', JSON.stringify(u));
        localStorage.setItem(`casemate_chats_${u.id}`, JSON.stringify(chatSessionsRef.current));
        localStorage.setItem(`casemate_deleted_chats_${u.id}`, JSON.stringify(deletedChatIdsRef.current));
        localStorage.setItem(`casemate_active_session_${u.id}`, JSON.stringify(activeSessionIdRef.current));
      } catch (e) {
        console.error('Failed to persist local chat cache', e);
      }
    };
    const timeoutId = window.setTimeout(persist, 280);
    return () => window.clearTimeout(timeoutId);
  }, [user, chatSessions, deletedChatIds, activeSessionId]);

  useEffect(() => {
    if (!user?.id) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(`casemate_drafts_${user.id}`, JSON.stringify(draftCount));
        localStorage.setItem(`casemate_reset_${user.id}`, JSON.stringify(lastResetDate));
        localStorage.setItem(`casemate_usage_${user.id}`, JSON.stringify(usageSecondsRef.current));
        localStorage.setItem(`casemate_timeup_${user.id}`, JSON.stringify(isTimeUp));
        localStorage.setItem(`casemate_daily_date_${user.id}`, JSON.stringify(dailyUseDate));
        localStorage.setItem('casemate_lang', JSON.stringify(language));
        localStorage.setItem(`casemate_case_learnings_${user.id}`, JSON.stringify(caseLearnings));
      } catch (e) {
        console.error('Failed to persist local usage cache', e);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftCount, lastResetDate, user?.id, usageSeconds, isTimeUp, dailyUseDate, language, caseLearnings]);

  // Chat content → Firestore. Do NOT depend on usageSeconds: the free-tier timer
  // ticks every second and used to cancel this write forever.
  useEffect(() => {
    if (!user?.id || !isCloudReady || !authReady || user.role === 'admin') return;
    const timeoutId = window.setTimeout(() => {
      void flushChatsToCloudNowRef.current();
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [chatSessions, deletedChatIds, activeSessionId, isCloudReady, authReady, user?.id, user?.role]);

  useEffect(() => {
    if (!user?.id || !isCloudReady || !authReady || user.role === 'admin') return;
    const timeoutId = window.setTimeout(() => {
      void flushChatsToCloudNowRef.current();
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [draftCount, lastResetDate, language, userMode, caseLearnings, user?.plan, isCloudReady, authReady, user?.id, user?.role]);

  useEffect(() => {
    if (!user?.id || !isCloudReady || !authReady || user.role === 'admin') return;
    const id = window.setInterval(() => {
      void flushChatsToCloudNowRef.current();
    }, 30000);
    return () => window.clearInterval(id);
  }, [isCloudReady, authReady, user?.id, user?.role]);

  useEffect(() => {
    if (isTimeUp) void flushChatsToCloudNowRef.current();
  }, [isTimeUp]);

  useEffect(() => {
    const persistLocal = () => {
      const u = userRef.current;
      if (!u?.id) return;
      try {
        localStorage.setItem('casemate_current_user', JSON.stringify(u));
        localStorage.setItem(`casemate_chats_${u.id}`, JSON.stringify(chatSessionsRef.current));
        localStorage.setItem(`casemate_deleted_chats_${u.id}`, JSON.stringify(deletedChatIdsRef.current));
        localStorage.setItem(`casemate_active_session_${u.id}`, JSON.stringify(activeSessionIdRef.current));
        localStorage.setItem(`casemate_usage_${u.id}`, JSON.stringify(usageSecondsRef.current));
        localStorage.setItem(`casemate_timeup_${u.id}`, JSON.stringify(isTimeUpRef.current));
      } catch { /* ignore */ }
    };
    const flush = () => {
      persistLocal();
      void flushChatsToCloudNowRef.current(true);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const incrementDraftCount = useCallback(() => {
    const u = userRef.current;
    if (hasUnlimitedAccess(u?.email, u)) return true;
    const limit = getPlanLimits(u?.plan, u?.email, u).draftLimit;
    let allowed = true;
    setDraftCount((prev) => {
      if (prev >= limit) {
        allowed = false;
        return prev;
      }
      return prev + 1;
    });
    if (!allowed) {
      setIsSubscriptionModalOpen(true);
      return false;
    }
    return true;
  }, []);

  const decrementDraftCount = useCallback(() => {
    setDraftCount((prev) => Math.max(0, prev - 1));
  }, []);

  /** Kept for API compatibility — free tier uses the 1-hour timer instead of per-message uses. */
  const consumeDailyUse = useCallback(() => true, []);

  const handleSetUser = useCallback((newUser: User | null) => {
    newUser = withAdminRole(newUser);
    // Block cloud writes until this user's cloud data is loaded
    setIsCloudReady(false);
    cloudReadOkRef.current = false;
    appliedCloudProfileRef.current = false;
    lastCloudMessageCountRef.current = 0;
    lastSeenCloudUpdatedAtRef.current = 0;
    lastAppliedCloudSessionsRef.current = [];
    lastCloudApplySigRef.current = '';
    lastChatPersistSig = '';
    freshChatOpenedForUserRef.current = null;
    preferFreshChatRef.current = coldStartNewChatRef.current;
    setUserState(newUser);

    if (newUser) {
      // Show local cache instantly; Firestore will overwrite with cloud truth
      setChatSessions(loadState(`casemate_chats_${newUser.id}`, []));
      const loadedDeleted = loadState(`casemate_deleted_chats_${newUser.id}`, [] as string[]);
      deletedChatIdsRef.current = loadedDeleted;
      setDeletedChatIds(loadedDeleted);
      lastAppliedCloudSessionsRef.current = [];
      setActiveSessionId(null);
      setDraftCount(loadState(`casemate_drafts_${newUser.id}`, 0));
      const unlimited = hasUnlimitedAccess(newUser.email, newUser);
      const isFree = !unlimited && (!newUser.plan || newUser.plan === 'free');
      const storedDate = loadState(`casemate_daily_date_${newUser.id}`, todayKey());
      const today = todayKey();
      if (unlimited) {
        setDailyUseDate(today);
        commitUsageSeconds(3600);
        setIsTimeUp(false);
      } else if (isFree && storedDate !== today) {
        setDailyUseDate(today);
        commitUsageSeconds(3600);
        setIsTimeUp(false);
      } else {
        setDailyUseDate(storedDate);
        let secs = loadState(`casemate_usage_${newUser.id}`, 3600);
        const timeUp = isFree ? loadState(`casemate_timeup_${newUser.id}`, false) : false;
        if (isFree && (secs === 0 || secs === 1) && !timeUp) secs = 3600;
        if (isFree && secs === 1 && timeUp) secs = 0;
        commitUsageSeconds(secs);
        setIsTimeUp(timeUp);
      }
      setLastResetDate(loadState(`casemate_reset_${newUser.id}`, new Date().getMonth()));
      setCaseLearnings(loadState(`casemate_case_learnings_${newUser.id}`, []));
    } else {
      localStorage.removeItem('casemate_current_user');
      setChatSessions([]);
      deletedChatIdsRef.current = [];
      setDeletedChatIds([]);
      lastAppliedCloudSessionsRef.current = [];
      setActiveSessionId(null);
      setDraftCount(0);
      setUsageSeconds(3600);
      publishUsageSeconds(3600);
      setIsTimeUp(false);
      setDailyUseDate(todayKey());
      setCaseLearnings([]);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Error signing out of Firebase", e);
    }
    handleSetUser(null);
  }, [handleSetUser]);

  useEffect(() => {
    if (!authReady || !user?.id || user.role === 'admin') return;
    if (auth.currentUser?.uid !== user.id) return;
    let cancelled = false;
    void fetchEntitlements().then((snap) => {
      if (cancelled || !snap?.ok) return;
      if (snap.addOns) {
        setUserState((prev) => (prev ? { ...prev, addOns: snap.addOns } : prev));
      }
      if (snap.usage) {
        setAiUsage(snap.usage);
        const month = new Date().toISOString().slice(0, 7);
        if (snap.usage.month === month && typeof snap.usage.monthDrafts === 'number') {
          setDraftCount(snap.usage.monthDrafts);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authReady, user?.id, user?.role]);

  useEffect(() => {
    if (!authReady) return;
    if (!user?.id) return;
    const fb = auth.currentUser;
    if (user.role === 'admin' || isAdminEmail(user.email)) {
      if (fb && isAdminEmail(fb.email)) {
        if (user.id !== fb.uid || user.role !== 'admin') {
          setUserState((prev) =>
            prev
              ? { ...prev, id: fb.uid, email: String(fb.email), role: 'admin', plan: prev.plan === 'free' ? 'pro' : prev.plan }
              : prev
          );
        }
        return;
      }
      const timer = window.setTimeout(() => {
        if (auth.currentUser && isAdminEmail(auth.currentUser.email)) return;
        handleSetUser(null);
      }, 1500);
      return () => window.clearTimeout(timer);
    }
    if (authUid === user.id || fb?.uid === user.id) return;
    const timer = window.setTimeout(() => {
      if (auth.currentUser?.uid === user.id) return;
      handleSetUser(null);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [authReady, authUid, user?.id, user?.role, user?.email, handleSetUser]);

  const redeemPromoCode = useCallback(async (code: string) => {
    const result = await requestPromoCode(code);
    if (result.alreadyUnlimited) return result;
    const u = userRef.current;
    if (u && result.ok && (result.kind === '14d' || result.kind === 'forever')) {
      rejectedPromoRef.current = '';
      setUserState({
        ...u,
        promoKind: result.kind,
        promoExpiresAt: result.expiresAt ?? undefined,
        promoCode: result.code || code.trim().toUpperCase().replace(/\s+/g, ''),
      });
      setIsTimeUp(false);
      commitUsageSeconds(3600);
    }
    return result;
  }, []);

  useEffect(() => {
    if (!user?.id || user.role === 'admin') return;
    let cancelled = false;
    let pending = '';
    try { pending = sessionStorage.getItem(PENDING_PROMO_KEY) || ''; } catch { /* ignore */ }
    if (pending) {
      try { sessionStorage.removeItem(PENDING_PROMO_KEY); } catch { /* ignore */ }
      void redeemPromoCode(pending).catch((err) => {
        if (!cancelled) alert(err?.message || 'That promo code is not valid.');
      });
    }
    if (user.promoKind !== 'forever') return () => { cancelled = true; };
    void fetchPromoStatus().then((status) => {
      if (cancelled || status.active || status.source === 'email') return;
      rejectedPromoRef.current = user.promoCode || rejectedPromoRef.current;
      setUserState((prev) => prev ? { ...prev, promoKind: undefined, promoExpiresAt: undefined, promoCode: undefined } : prev);
      setIsTimeUp(false);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id, user?.role, user?.promoKind, user?.promoCode, redeemPromoCode]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      if (sessionStorage.getItem(PENDING_CUSTOM_PLAN_KEY)) {
        setIsSubscriptionModalOpen(true);
      }
    } catch { /* ignore */ }
  }, [user?.id]);

  /**
   * Reflect a plan that the backend has already granted after verifying the
   * payment. This only updates local state — the subscription itself lives in
   * Firestore, written by the server, and arrives via the user-doc listener.
   */
  const upgradeToPro = useCallback(async (planId: string = 'pro', serverExpiry?: number | null) => {
    const u = userRef.current;
    if (!u) return;
    const validPlan = (['starter', 'basic', 'pro', 'annual', 'custom'].includes(planId) ? planId : 'pro') as User['plan'];
    const days = validPlan === 'annual' ? 365 : 30;
    const expiryDate = serverExpiry && serverExpiry > Date.now()
      ? serverExpiry
      : Date.now() + days * 24 * 60 * 60 * 1000;
    setUserState({ ...u, plan: validPlan, subscriptionExpiryDate: expiryDate });
    setIsTimeUp(false);
    try {
      [7, 3, 1].forEach((t) => localStorage.removeItem(`casemate_expiry_email_${u.id}_${t}`));
    } catch { /* ignore */ }
  }, []);

  const createNewSession = useCallback(() => {
    const u = userRef.current;
    const chatLimit = getPlanLimits(u?.plan, u?.email, u).chatSessionLimit;
    if (chatSessionsRef.current.length >= chatLimit) {
      setIsSubscriptionModalOpen(true);
      return;
    }
    const mode: UserMode = extrasRef.current.userMode === 'judge' ? 'judge' : 'advocate';
    const newSession: ChatSession = { id: Date.now().toString(), title: 'New Case Analysis', messages: [], updatedAt: Date.now(), userMode: mode };
    setChatSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  }, []);

  const addMessageToActiveSession = useCallback((message: Message) => {
    const sessionId = activeSessionIdRef.current;
    setChatSessions((prev) => {
      const next = prev.map((session) => {
        if (session.id === sessionId) {
          let title = session.title;
          if (session.messages.length === 0 && message.role === 'user') {
            title = message.text.slice(0, 30) + (message.text.length > 30 ? '...' : '');
          }
          return { ...session, title, messages: [...session.messages, message], updatedAt: Date.now() };
        }
        return session;
      });
      chatSessionsRef.current = next;
      return next;
    });
    queueMicrotask(() => {
      void flushChatsToCloudNowRef.current(true);
    });
  }, []);

  const updateMessageText = useCallback((messageId: string, newText: string) => {
    const now = Date.now();
    setChatSessions((prev) => {
      const next = prev.map((session) => {
        if (!session.messages.some((msg) => msg.id === messageId)) return session;
        return {
          ...session,
          messages: session.messages.map((msg) =>
            msg.id === messageId ? { ...msg, text: newText, timestamp: now } : msg
          ),
          updatedAt: now,
        };
      });
      chatSessionsRef.current = next;
      return next;
    });
    queueMicrotask(() => {
      void flushChatsToCloudNowRef.current(true);
    });
  }, []);

  const updateMessageFields = useCallback((messageId: string, fields: Partial<Message>) => {
    const sessionId = activeSessionIdRef.current;
    setChatSessions((prev) => {
      const next = prev.map((session) => {
        if (session.id === sessionId) {
          return {
            ...session,
            messages: session.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...fields } : msg
            ),
            updatedAt: Date.now(),
          };
        }
        return session;
      });
      chatSessionsRef.current = next;
      return next;
    });
    queueMicrotask(() => {
      void flushChatsToCloudNowRef.current(true);
    });
  }, []);

  const trimMessagesAfter = useCallback((messageId: string) => {
    const sessionId = activeSessionIdRef.current;
    setChatSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const idx = session.messages.findIndex((msg) => msg.id === messageId);
        if (idx < 0) return session;
        return {
          ...session,
          messages: session.messages.slice(0, idx + 1),
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  const deleteChatSession = useCallback((sessionId: string) => {
    const nextDeleted = mergeDeletedChatIds(deletedChatIdsRef.current, [sessionId]);
    deletedChatIdsRef.current = nextDeleted;
    setDeletedChatIds(nextDeleted);
    lastAppliedCloudSessionsRef.current = (lastAppliedCloudSessionsRef.current || []).filter(
      (s) => s.id !== sessionId
    );

    const persistDelete = (sessions: ChatSession[], nextActive: string | null) => {
      const u = userRef.current;
      if (!u?.id || auth.currentUser?.uid !== u.id) return;
      void writeChatsToCloud({
        userId: u.id,
        localSessions: sessions,
        localDeleted: nextDeleted,
        activeSessionId: nextActive,
      }).then((result) => {
        if (!result) return;
        lastAppliedCloudSessionsRef.current = result.sessions;
        lastCloudMessageCountRef.current = totalMessages(result.sessions);
        lastSeenCloudUpdatedAtRef.current = result.updatedAt;
        deletedChatIdsRef.current = result.deleted;
      }).catch((err) => console.error('Error syncing chat delete', err));
    };

    setChatSessions((prev) => {
      const removedMode = sessionMode(prev.find((s) => s.id === sessionId) || { id: '', title: '', messages: [], updatedAt: 0 });
      const updated = prev.filter((s) => s.id !== sessionId);
      const wasActive = activeSessionIdRef.current === sessionId;
      if (!wasActive) {
        chatSessionsRef.current = updated;
        persistDelete(updated, activeSessionIdRef.current);
        return updated;
      }
      const sameMode = updated.filter((s) => sessionMode(s) === removedMode);
      if (sameMode.length > 0) {
        chatSessionsRef.current = updated;
        queueMicrotask(() => setActiveSessionId(sameMode[0].id));
        persistDelete(updated, sameMode[0].id);
        return updated;
      }
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title: 'New Case Analysis',
        messages: [],
        updatedAt: Date.now(),
        userMode: removedMode,
      };
      const withNew = [newSession];
      chatSessionsRef.current = withNew;
      queueMicrotask(() => setActiveSessionId(newSession.id));
      persistDelete(withNew, newSession.id);
      return withNew;
    });
  }, []);

  const renameChatSession = useCallback((sessionId: string, newTitle: string) => {
    setChatSessions((prev) =>
      prev.map((session) => session.id === sessionId ? { ...session, title: newTitle, updatedAt: Date.now() } : session)
    );
  }, []);

  const nameChatFromClient = useCallback((sessionId: string, clientName: string, caseDate?: string | null) => {
    const cleaned = clientName.trim().replace(/\s+/g, ' ').slice(0, 80);
    const date = (caseDate || '').trim().slice(0, 40);
    if (!cleaned && !date) return;
    setChatSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const firstUser = session.messages.find((m) => m.role === 'user');
        const title = cleaned && isAutomaticChatTitle(session.title, firstUser?.text) ? cleaned : session.title;
        const nextDate = date || session.caseDate;
        if (title === session.title && nextDate === session.caseDate) return session;
        return { ...session, title, ...(nextDate ? { caseDate: nextDate } : {}), updatedAt: Date.now() };
      })
    );
  }, []);

  const upsertCaseLearning = useCallback((learning: CaseLearning) => {
    setCaseLearnings((prev) => {
      const key = (learning.caseType || '').trim().toLowerCase();
      const existing = prev.find((p) => (p.caseType || '').trim().toLowerCase() === key);
      let next: CaseLearning[];
      if (existing) {
        next = prev.map((p) =>
          p.id === existing.id
            ? {
                ...p,
                notes: learning.notes || p.notes,
                updatedAt: Date.now(),
                useCount: (p.useCount || 1) + 1,
              }
            : p
        );
      } else {
        next = [
          {
            ...learning,
            id: learning.id || String(Date.now()),
            useCount: learning.useCount || 1,
            updatedAt: Date.now(),
          },
          ...prev,
        ];
      }
      return next.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
    });
  }, []);

  const contextValue = useMemo<AppContextType>(() => ({
    user,
    setUser: handleSetUser,
    chatSessions,
    activeSessionId,
    setActiveSessionId,
    createNewSession,
    addMessageToActiveSession,
    updateMessageText,
    updateMessageFields,
    trimMessagesAfter,
    deleteChatSession,
    renameChatSession,
    nameChatFromClient,
    usageSeconds,
    subscribeUsageSeconds,
    isTimeUp,
    draftCount,
    incrementDraftCount,
    decrementDraftCount,
    consumeDailyUse,
    aiUsage,
    language,
    setLanguage,
    userMode,
    setUserMode,
    isSettingsOpen,
    setIsSettingsOpen,
    isSidebarOpen,
    setIsSidebarOpen,
    isSubscriptionModalOpen,
    setIsSubscriptionModalOpen,
    isUpgradeModalOpen,
    setIsUpgradeModalOpen,
    isMockRazorpayOpen,
    setIsMockRazorpayOpen,
    upgradeToPro,
    logout,
    isCloudSyncing,
    globalAnnouncement,
    subscriptionPlans,
    cloudTemplates,
    caseLearnings,
    upsertCaseLearning,
    redeemPromoCode,
  }), [
    userMode,
    setUserMode,
    user,
    chatSessions,
    activeSessionId,
    usageSeconds,
    subscribeUsageSeconds,
    isTimeUp,
    draftCount,
    decrementDraftCount,
    aiUsage,
    language,
    isSettingsOpen,
    isSidebarOpen,
    isSubscriptionModalOpen,
    isUpgradeModalOpen,
    isMockRazorpayOpen,
    isCloudSyncing,
    globalAnnouncement,
    subscriptionPlans,
    cloudTemplates,
    caseLearnings,
    redeemPromoCode,
    createNewSession,
    addMessageToActiveSession,
    updateMessageText,
    updateMessageFields,
    trimMessagesAfter,
    deleteChatSession,
    renameChatSession,
    nameChatFromClient,
    incrementDraftCount,
    decrementDraftCount,
    consumeDailyUse,
    upgradeToPro,
    logout,
    upsertCaseLearning,
    handleSetUser,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within an AppProvider');
  return context;
};
