import type { ChatSession } from '../types';
import { translations } from './translations';
import { languageLocale } from './languages';

const UNKNOWN = /^(unknown|none|n\/a|na|not visible|unclear|unreadable|not found|not readable|अज्ञात|नाम अज्ञात|पता नहीं|-|—|\.{2,}|_{2,})$/i;

const cleanPartyName = (raw: string | undefined): string | null => {
  if (!raw) return null;
  let v = raw.split('\n')[0].trim();
  v = v.replace(/^[\-*•\d.)\s]+/, '').replace(/\*+/g, '').trim();
  v = v.replace(/\s*\((?:complainant|petitioner|applicant|client|plaintiff|accused|informant|वादी|शिकायतकर्ता|आवेदक|फरियादी)\)\s*$/i, '').trim();
  if (v.length > 42 && v.includes(',')) v = v.split(',')[0].trim();
  v = v.replace(/[.,;:]+$/, '').replace(/\s+/g, ' ').trim();
  if (!v || v.length < 2 || v.length > 80) return null;
  if (UNKNOWN.test(v)) return null;
  if (/\b(court|tribunal|police station|thana|न्यायालय|थाना)\b/i.test(v)) return null;
  return v;
};

const cleanCaseDate = (raw: string | undefined): string | null => {
  if (!raw) return null;
  let v = raw.split('\n')[0].trim().replace(/\*+/g, '').replace(/[.,;]+$/, '').trim();
  if (!v || v.length < 4 || v.length > 40) return null;
  if (UNKNOWN.test(v)) return null;
  return v;
};

/** Client name and document date printed on an uploaded case photo. */
export const parseClientFromEvidence = (notes: string): { name: string | null; caseDate: string | null } => {
  if (!notes) return { name: null, caseDate: null };
  const clientLine = notes.match(/(?:^|\n)\s*CLIENT\s*[:\-–]\s*([^\n]+)/i);
  const dateLine = notes.match(/(?:^|\n)\s*CASE_DATE\s*[:\-–]\s*([^\n]+)/i);
  let name = cleanPartyName(clientLine?.[1]);
  let caseDate = cleanCaseDate(dateLine?.[1]);

  if (!name) {
    const labeled = notes.match(
      /(?:^|\n)\s*(?:complainant|petitioner|applicant|plaintiff|informant|client|deponent|वादी|शिकायतकर्ता|आवेदक|फरियादी|याची)\s*[:\-–]\s*([^\n]{2,80})/i
    );
    name = cleanPartyName(labeled?.[1]);
  }
  if (!caseDate) {
    const labeledDate = notes.match(
      /(?:^|\n)\s*(?:date|dated|दिनांक)\s*[:\-–]\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4})/i
    );
    caseDate = cleanCaseDate(labeledDate?.[1]);
  }
  return { name, caseDate };
};

const GENERIC_TITLES = [
  'new case analysis',
  'new chat',
  'legal_document',
  'attached files uploaded.',
  'attached files uploaded',
  'संलग्न फ़ाइलें अपलोड की गईं।',
  'संलग्न फ़ाइलें अपलोड की गईं',
  'please generate the document based on the provided context and files.',
  'put the uploaded file in the editor exactly as it is. do not summarize. keep every point.',
  'अपलोड की गई फ़ाइल को एडिटर में ज्यों का त्यों डालो। सारांश मत बनाओ। हर पॉइंट वही रखो।',
];

/** True when the title was filled in automatically and can be replaced by the client name. */
export const isAutomaticChatTitle = (title: string, firstUserText?: string) => {
  const t = (title || '').trim().toLowerCase();
  if (!t) return true;
  if (GENERIC_TITLES.some((g) => t === g)) return true;
  if (firstUserText) {
    const slice = firstUserText.slice(0, 30) + (firstUserText.length > 30 ? '...' : '');
    if (title.trim() === slice.trim()) return true;
  }
  return false;
};

export const chatStartedAt = (session: Pick<ChatSession, 'id' | 'updatedAt' | 'messages'>): number => {
  const stamps = (session.messages || []).map((m) => m.timestamp || 0).filter((n) => n > 0);
  if (stamps.length) return Math.min(...stamps);
  const idNum = Number(session.id);
  if (Number.isFinite(idNum) && idNum > 1_000_000_000_000 && idNum < 10_000_000_000_000) return idNum;
  return session.updatedAt || 0;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const formatChatDay = (ts: number, language: string): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const words = translations[language] || translations.English;
  if (sameDay(d, today)) return words.today || 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, yesterday)) return words.yesterday || 'Yesterday';
  const locale = languageLocale(language);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const formatChatTime = (ts: number, language: string): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(languageLocale(language), { hour: 'numeric', minute: '2-digit' });
};

export const chatDayKey = (ts: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
