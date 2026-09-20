import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { auth, db } from './firebaseService';
import type { CaseLearning, ChatSession } from '../types';

export type StoredStyle = {
  skeleton: string;
  language: string;
  caseType?: string;
  notes?: string;
  updatedAt: number;
};

const MAX_USER_STYLES = 8;
const MAX_SKELETON_CHARS = 2200;

const stripSecrets = (text: string): string =>
  text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{2,}\b/g, 'XX')
    .replace(/[A-Z]{2,}\s*\d{2,}[A-Z0-9/-]*/g, '[id]');

const looksLikeHeading = (line: string): boolean => {
  const t = line.replace(/\[\/?(CENTER|RIGHT|U|ROW)\]/gi, '').trim();
  if (!t) return false;
  if (t.length <= 90) return true;
  return /^(प्रार्थना|सत्यापन|PRAYER|VERIFICATION|FACT|GROUND|MEMO|IN THE|माननीय|यह कि|कि )/i.test(t);
};

const styleDocId = (skeleton: string): string => {
  let h = 0;
  for (let i = 0; i < skeleton.length; i++) {
    h = (Math.imul(31, h) + skeleton.charCodeAt(i)) | 0;
  }
  return `s${Math.abs(h).toString(36)}`;
};

/** Structure-only fingerprint — no party names, dates, or case story. */
export const extractStyleSkeleton = (draftText: string): string => {
  if (!draftText?.trim()) return '';
  const lines = stripSecrets(draftText).split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (/\[CENTER\]|\[RIGHT\]|\[ROW\]|\[U\]/i.test(line) || looksLikeHeading(line)) {
      out.push(line.length > 120 ? `${line.slice(0, 120)}…` : line);
    } else if (line.length > 70) {
      if (out[out.length - 1] !== '[facts from current case]') {
        out.push('[facts from current case]');
      }
    } else {
      out.push(line);
    }
    if (out.join('\n').length > MAX_SKELETON_CHARS) break;
  }
  return out.join('\n').slice(0, MAX_SKELETON_CHARS).trim();
};

export const collectStylesFromSessions = (sessions: ChatSession[]): string => {
  const skeletons: string[] = [];
  for (const session of sessions) {
    for (const msg of session.messages || []) {
      if (msg.role !== 'model' || !msg.isDocument || !msg.text) continue;
      if (msg.text.startsWith('API Error')) continue;
      const sk = extractStyleSkeleton(msg.text);
      if (sk.length > 80) skeletons.push(sk);
    }
  }
  return skeletons.slice(-MAX_USER_STYLES).join('\n\n---- previous draft style ----\n\n');
};

export const buildLearnedStylePrompt = (
  sessions: ChatSession[],
  caseLearnings: CaseLearning[],
  community: string
): string => {
  const fromChats = collectStylesFromSessions(sessions);
  const fromMemory = caseLearnings
    .slice(0, 10)
    .map((l) => `[${l.caseType}]\n${l.notes}`)
    .join('\n\n');
  const parts: string[] = [];
  if (fromMemory) {
    parts.push(`Drafting patterns remembered from this advocate's past cases:\n${fromMemory}`);
  }
  if (fromChats) {
    parts.push(`Structure remembered from this advocate's recent drafts:\n${fromChats}`);
  }
  if (community) {
    parts.push(`Anonymized community draft styles (structure only — no names or facts):\n${community}`);
  }
  return parts.join('\n\n').slice(0, 8000);
};

export const rememberUserStyle = async (
  draftText: string,
  language: string,
  extra?: { caseType?: string; notes?: string }
): Promise<void> => {
  const uid = auth.currentUser?.uid;
  const skeleton = extractStyleSkeleton(draftText);
  if (!uid || skeleton.length < 80) return;

  const entry: StoredStyle = {
    skeleton,
    language,
    caseType: extra?.caseType,
    notes: extra?.notes,
    updatedAt: Date.now(),
  };

  try {
    const userRef = doc(db, 'users_data', uid);
    const snap = await getDoc(userRef);
    const prev = Array.isArray(snap.data()?.learnedStyles) ? snap.data()!.learnedStyles : [];
    const next = [...prev.filter((s: StoredStyle) => s?.skeleton !== skeleton), entry].slice(-MAX_USER_STYLES);
    await setDoc(userRef, { learnedStyles: next, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn('Could not save user style memory', e);
  }

  try {
    await setDoc(
      doc(db, 'learned_styles', styleDocId(skeleton)),
      {
        skeleton,
        language,
        caseType: extra?.caseType || '',
        notes: extra?.notes || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('Could not publish anonymized style', e);
  }
};

export const loadCommunityStyles = async (): Promise<string> => {
  try {
    const q = query(collection(db, 'learned_styles'), orderBy('createdAt', 'desc'), limit(12));
    const snap = await getDocs(q);
    const parts: string[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const sk = String(data?.skeleton || '').trim();
      const notes = String(data?.notes || '').trim();
      const caseType = String(data?.caseType || '').trim();
      if (sk.length > 80) {
        parts.push(caseType ? `[${caseType}]\n${sk}${notes ? `\n${notes}` : ''}` : sk);
      }
    });
    return parts.slice(0, 6).join('\n\n---- community draft style ----\n\n');
  } catch (e) {
    console.warn('Could not load community styles', e);
    return '';
  }
};
