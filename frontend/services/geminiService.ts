import { docxToTaggedText, isDocxFile } from '../utils/docxText';
import { runScanTemplate, ScanTemplateError } from './scanTemplateService';
import type { TemplateProfile } from '../utils/scanTemplate';
import type { Draft } from '../utils/scanReconstruct';
import { fillDocxTemplate, TemplateFillError, type ModelCall } from '../utils/templateFill';
import { Message, Attachment, CaseLearning, UserMode } from '../types';
import {
  fileToBase64,
  resolveMimeTypeFromName,
  fetchAttachmentAsFile,
} from './chatMediaService';
import { getDeviceId } from '../utils/deviceId';
import { greetingFor } from '../utils/languages';

const MODEL = 'gemini-3.8-flash';
/** Images per Gemini request — small enough to avoid payload / quota errors. */
const BATCH_SIZE = 6;
const MAX_RELOAD_PHOTOS = 8;
const MAX_HISTORY_MESSAGES = 6;
const MAX_DOC_CHARS = 1400;
const MAX_MSG_CHARS = 2200;
const MAX_EVIDENCE_CHARS = 22000;
const MAX_EVIDENCE_CHARS_EXACT = 60000;
const MAX_LEARNED_CHARS = 2500;
const MAX_TEMPLATE_CHARS = 8000;
/** Reading/extraction calls: short, and split in half if they ever run out. */
const AI_CALL_TIMEOUT_MS = 90000;
/** Drafting with real reasoning can take over a minute; the server keeps the connection alive for this long. */
const DRAFT_CALL_TIMEOUT_MS = 170000;
const MAX_FORMAT_SKELETON_CHARS = 14000;
/** Keep one request body well under the server's 20 MB JSON limit (base64 adds a third). */
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

export type AnalysisProgress = (info: {
  phase: 'analyzing' | 'answering' | 'format';
  batch: number;
  totalBatches: number;
}) => void;

const geminiBackendUrl = () => {
  const base = String((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/api/gemini` : '/api/gemini';
};

const hasGemini = () => true;

let lastWarmAt = 0;
/**
 * The API runs on a host that sleeps when idle and takes up to a minute to wake.
 * A cheap ping when files are attached means the real request does not pay for it.
 */
export const warmBackend = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastWarmAt < 4 * 60 * 1000) return;
  lastWarmAt = now;
  try {
    const base = String((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
    if (!base) return;
    await fetch(`${base}/health`, { method: 'GET', cache: 'no-store', mode: 'no-cors' });
  } catch {
    lastWarmAt = 0;
  }
};

const userAbortError = () => {
  const err: any = new Error('Aborted');
  err.name = 'AbortError';
  err.userAbort = true;
  return err;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(userAbortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(userAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const isUserAbortError = (error: any) =>
  error?.userAbort === true || (error?.name === 'AbortError' && error?.userAbort);

/** Strip leaked document tags / HTML / markdown symbols from conversational AI replies. */
export const cleanChatReply = (text: string): string => {
  if (!text) return text;
  let out = String(text).replace(/\r\n/g, '\n');
  out = out.replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1');
  out = out.replace(/```+/g, '');
  out = out.replace(/\[\/?(?:ROW|CENTER|RIGHT|LEFT|JUSTIFY|U|B|I|LOGO)\]/gi, '');
  out = out.replace(/\[LOGO:\d+\]/gi, '');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/(?:p|div|h[1-6]|li|ul|ol|tr|table)>/gi, '\n');
  out = out.replace(/<[^>]+>/g, '');
  out = out.replace(/&nbsp;/gi, ' ');
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s*(?:-{3,}|_{3,}|\*{3,}|—{2,})\s*$/gm, '');
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  out = out.replace(/`([^`]+)`/g, '$1');
  out = out.replace(/`+/g, '');
  out = out.replace(/^\s*\|\s*$/gm, '');
  out = out.replace(/^\s*(?:display|justify-content|align-items|page-break(?:-inside)?|flex-direction|white-space)\s*:[^\n]*$/gmi, '');
  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/^[\s\S]{0,900}?(?:here is only the summary|only the summary)\s*:\s*/i, '');
  out = out.replace(/^(?:The user request|Therefore, honoring)[\s\S]{0,700}?(?:summary:)\s*/i, '');
  return out.trim();
};

const FOLLOWUP_MARK = '<<<FOLLOWUPS>>>';

/** Pull the trailing follow-up block out of a reply so it never sits inside the draft. */
export const splitFollowUps = (raw: string): { text: string; questions: string[] } => {
  const source = String(raw || '');
  const idx = source.lastIndexOf(FOLLOWUP_MARK);
  if (idx < 0) return { text: source, questions: [] };
  const questions = source
    .slice(idx + FOLLOWUP_MARK.length)
    .split('\n')
    .map((line) => line.replace(/^[\s>*\-–—•\d.)]+/, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 180 && !line.includes('<<<'));
  return { text: source.slice(0, idx).trim(), questions: questions.slice(0, 4) };
};

/** Used when the model forgets the follow-up block. Still about this matter. */
export const fallbackFollowUps = (userText: string, isDocument: boolean, language: string): string[] => {
  const hi = language === 'Hindi';
  const topic = String(userText || '').replace(/\s+/g, ' ').trim().slice(0, 72);
  if (isDocument) {
    return hi
      ? [
          'इस ड्राफ्ट में खाली जगहों के लिए कौन से तथ्य चाहिए?',
          'इसे उसी प्रारूप में थोड़ा छोटा करके लिखें',
          'दाखिल करने से पहले क्या जाँचें?',
        ]
      : [
          'Which facts are still missing in this draft?',
          'Rewrite this a little shorter, in the same format',
          'What should I check before filing?',
        ];
  }
  return hi
    ? [
        topic ? `इस पर पूरा कोर्ट ड्राफ्ट बनाएं: ${topic}` : 'इस पर पूरा कोर्ट ड्राफ्ट बनाएं',
        'इस मामले में कौन से तथ्य अभी अधूरे हैं?',
        'इसके बाद अगला कदम क्या होना चाहिए?',
      ]
    : [
        topic ? `Draft the full court paper for: ${topic}` : 'Draft the full court paper for this',
        'Which facts are still missing in this matter?',
        'What should I do next in this matter?',
      ];
};

const errText = (error: any) =>
  String(error?.message || error?.status || error || '');

/** The AI answered, but found nothing readable in the files. This is a failure, not an empty success. */
const emptyExtractionError = () => {
  const e: any = new Error('No readable text was found in the uploaded files.');
  e.code = 'EMPTY_EXTRACTION';
  return e;
};

const timeoutError = () => {
  const e: any = new Error('The AI took too long on this request.');
  e.name = 'TimeoutError';
  return e;
};

/** A call that ran out of time. The same input will usually time out again, so callers split it instead of retrying it. */
export const isTimeoutError = (error: any) =>
  error?.name === 'TimeoutError' || error?.code === 'GEMINI_TIMEOUT';

const isRetryable = (error: any) => {
  if (isUserAbortError(error)) return false;
  if (isTimeoutError(error)) return false;
  // Fair-use / device limits are decisions, not hiccups — retrying cannot help.
  if (passThroughError(error)) return false;
  const t = errText(error);
  const code = Number(error?.status || error?.httpStatusCode || 0);
  return (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    /429|500|502|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|quota|Failed to fetch|NetworkError|Load failed/i.test(t)
  );
};

const friendlyApiError = (error: any, language: string, photosAnalyzed: boolean) => {
  const passThrough = passThroughError(error);
  if (passThrough) return passThrough;
  const raw = errText(error);
  const hi = language === 'Hindi';
  if (error?.code === 'EMPTY_EXTRACTION') {
    return hi
      ? 'अपलोड की गई फ़ाइलों में पढ़ने योग्य पाठ नहीं मिला। साफ़ फ़ोटो या सही PDF/DOCX अपलोड करें।'
      : 'No readable text was found in the uploaded files. Upload clear photos or a valid PDF/DOCX and try again.';
  }
  if (isTimeoutError(error)) {
    return hi
      ? 'यह फ़ाइल पढ़ने में बहुत समय लग रहा है। कम पन्नों/फ़ाइलों के साथ भेजें, या एक-एक करके अपलोड करें — आपकी फ़ाइलें सेव हैं।'
      : 'This is taking too long — the file is large or the AI is slow right now. Send fewer pages or files at a time (or one by one) and try again. Your files are saved.';
  }
  if (/429|RESOURCE_EXHAUSTED|quota|overloaded/i.test(raw)) {
    return hi
      ? 'सेवा व्यस्त है। आपकी फ़ाइलें सेव हैं — 20 सेकंड बाद फिर भेजें, फ़ोटो दोबारा अपलोड करने की ज़रूरत नहीं।'
      : 'The AI is busy. Your files are saved — wait 20 seconds and send again. You do not need to re-upload photos.';
  }
  if (/payload|too large|INVALID_ARGUMENT|size/i.test(raw)) {
    return hi
      ? 'अनुरोध बहुत बड़ा था। फ़ोटो सेव हैं — एक बार और भेजें।'
      : 'That request was too large. Your photos are saved — send again.';
  }
  if (/network|Failed to fetch|Load failed|UNAVAILABLE|502|503/i.test(raw)) {
    return hi ? 'नेटवर्क धीमा है। कृपया फिर कोशिश करें।' : 'Network is slow. Please try again.';
  }
  if (photosAnalyzed) {
    return hi
      ? 'फ़ोटो पढ़ ली गईं, उत्तर लिखते समय समस्या आई। फिर भेजें — फ़ोटो दोबारा अपलोड न करें।'
      : 'Photos were read, but writing the reply failed. Send again — do not re-upload photos.';
  }
  return hi ? 'उत्तर नहीं बन सका। कृपया फिर कोशिश करें।' : 'Could not generate a reply. Please try again.';
};

/** Messages the server already wrote for the advocate (fair use, devices). */
const passThroughError = (error: any): string | null => {
  const code = String(error?.code || '');
  if (
    code === 'FAIR_USE_REQUESTS' ||
    code === 'FAIR_USE_IMAGES' ||
    code === 'FAIR_USE_DAILY' ||
    code === 'DEVICE_LIMIT' ||
    code === 'DEVICE_REQUIRED' ||
    code === 'DRAFT_LIMIT' ||
    code === 'UPLOAD_PHOTO_LIMIT' ||
    code === 'USAGE_UNAVAILABLE' ||
    code === 'MODEL_NOT_ALLOWED' ||
    code === 'UNSUPPORTED_FILE' ||
    code === 'PAYLOAD_TOO_LARGE'
  ) {
    return String(error?.message || '');
  }
  return null;
};

const getAuthHeader = async (): Promise<Record<string, string>> => {
  try {
    const { auth, getAppCheckHeader } = await import('./firebaseService');
    const token = await auth.currentUser?.getIdToken();
    const appCheck = await getAppCheckHeader();
    return token ? { Authorization: `Bearer ${token}`, ...appCheck } : {};
  } catch {
    return {};
  }
};

const generateViaBackend = async (
  args: { model: string; contents: any; config?: any; workKind?: 'draft' | 'analysis' },
  signal?: AbortSignal,
  timeoutMs = 90000
): Promise<{ text: string; sources?: { title: string; uri: string }[] }> => {
  if (signal?.aborted) throw userAbortError();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  let res: Response;
  try {
    res = await fetch(geminiBackendUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        'X-Work-Kind': args.workKind === 'draft' ? 'draft' : 'analysis',
        // Long calls: tell the server how long we will wait and ask it to keep the connection alive meanwhile.
        'X-Max-Wait-Ms': String(Math.max(10000, timeoutMs - 5000)),
        'X-Keepalive': '1',
        ...(await getAuthHeader()),
      },
      body: JSON.stringify({ model: args.model, contents: args.contents, config: args.config }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw userAbortError();
    if (timedOut) throw timeoutError();
    throw e;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  // Long calls arrive as a 200 with spaces first and the JSON last, so errors can be inside the body.
  let data: any = {};
  try {
    const raw = (await res.text()).trim();
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  const status = Number(data?.status) || res.status;
  if (!res.ok || data?.error) {
    const err: any = new Error(data?.message || data?.error || `Gemini ${status}`);
    err.status = status;
    err.code = data?.error || '';
    // 504/524 come from the server or Render's edge giving up on a slow call.
    if (status === 504 || status === 524 || err.code === 'GEMINI_TIMEOUT') {
      err.name = 'TimeoutError';
    }
    throw err;
  }
  return { text: data?.text || '', sources: Array.isArray(data?.sources) ? data.sources : [] };
};

const FAST_CONFIG = { thinkingConfig: { thinkingBudget: 0 } };
/** Legal questions need real reasoning, not a zero-thinking guess. */
const ADVICE_THINKING = { thinkingConfig: { thinkingBudget: 4096 } };
/** Live web search so rules, circulars and institution policies are looked up, not guessed. */
const WEB_SEARCH = { tools: [{ googleSearch: {} }] };
const ANALYZE_THINKING = { thinkingConfig: { thinkingBudget: 2048 } };
const LAYOUT_THINKING = { thinkingConfig: { thinkingBudget: 1024 } };
/** Full court drafts at "high" thinking took 75s+ on a single PDF; "medium" is accurate and fits the 90s limit. */
const DRAFT_THINKING = { thinkingConfig: { thinkingBudget: 3072 } };
/** Copying a file word for word needs no reasoning — thinking only made it 2.5x slower. */
const TRANSCRIBE_THINKING = { thinkingConfig: { thinkingBudget: 0 } };
const CHAT_THINKING = { thinkingConfig: { thinkingBudget: 1024 } };

const generateWithRetry = async (
  args: { model: string; contents: any; config?: any; workKind?: 'draft' | 'analysis' },
  tries = 2,
  signal?: AbortSignal,
  timeoutMs = 90000
): Promise<{ text: string; sources?: { title: string; uri: string }[] }> => {
  const payload = {
    ...args,
    config: { ...(args.config || {}) },
  };
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await generateViaBackend(payload, signal, timeoutMs);
    } catch (e) {
      last = e;
      if (isUserAbortError(e) || i === tries - 1 || !isRetryable(e)) break;
      // A dropped connection is usually the server waking from sleep: give it a few seconds instead of hammering it.
      await sleep(/Failed to fetch|NetworkError|Load failed/i.test(errText(e)) ? 4000 : 600 * (i + 1), signal);
    }
  }
  if (signal?.aborted) throw userAbortError();
  // No client-side Gemini fallback on purpose: the API key must never ship
  // inside the web bundle or the Play Store APK.
  throw last;
};

const pushFileParts = async (parts: any[], files: File[], label: string) => {
  const encoded = await Promise.all(
    files.map(async (file) => {
      // A Word file loses its bold/underline when sent raw, so read it here and keep the formatting as tags.
      if (isDocxFile(file)) {
        const tagged = await docxToTaggedText(file);
        if (tagged) return { name: file.name, tagged };
      }
      return {
        name: file.name,
        mimeType: resolveMimeTypeFromName(file),
        data: await fileToBase64(file),
      };
    })
  );
  for (const file of encoded) {
    parts.push({ text: `\n[${label}: ${file.name}]\n` });
    if ('tagged' in file) {
      parts.push({
        text:
          `(This Word document was read with its formatting kept as tags: **bold**, [U]underline[/U], [CENTER]centered[/CENTER], [RIGHT]right-aligned[/RIGHT], [ROW]same-line pairs[/ROW]. ` +
          `Treat a tagged line as bold/underlined/centered/right-aligned in the original.)\n${file.tagged}\n`,
      });
      continue;
    }
    parts.push({
      inlineData: {
        mimeType: file.mimeType,
        data: file.data,
      },
    });
  }
};

const collectPriorEvidenceNotes = (history: Message[]): string => {
  const notes: string[] = [];
  history.forEach((msg, idx) => {
    if (msg.evidenceNotes?.trim()) {
      notes.push(`--- Evidence from message ${idx + 1} (${msg.attachments?.length || 0} file(s)) ---\n${msg.evidenceNotes.trim()}`);
    }
  });
  return notes.join('\n\n');
};

const collectPriorCaseAttachments = (history: Message[]): Attachment[] => {
  const out: Attachment[] = [];
  for (const msg of history) {
    for (const att of msg.attachments || []) {
      if (att.type === 'case' && att.url) out.push(att);
    }
  }
  return out.slice(-MAX_RELOAD_PHOTOS);
};

const collectPriorSourceAttachments = (history: Message[]): Attachment[] => {
  const out: Attachment[] = [];
  for (const msg of history) {
    for (const att of msg.attachments || []) {
      if (att.url && (att.type === 'case' || att.type === 'format')) out.push(att);
    }
  }
  return out.slice(-8);
};

const isDocLikeFile = (file: File) => {
  const t = `${file.type || ''} ${file.name || ''}`.toLowerCase();
  return /\.pdf|application\/pdf|\.docx?|msword|officedocument|\.rtf|\.txt|text\/plain/.test(t);
};

/** Advocate asked to keep uploaded wording — not a summary or a rewritten draft. */
export const wantsExactSourceCopy = (prompt: string) => {
  const p = String(prompt || '');
  if (!p.trim()) return false;
  const en = p.toLowerCase();
  return (
    /as[\s-]?it[\s-]?is|as[\s-]?is\b|verbatim|word[\s-]?for[\s-]?word|line[\s-]?to[\s-]?line|exact(ly)?|do not summar|don't summar|without summar|no summar|full text|all (the )?(points?|lines?|content|text)|every (point|line)|transcribe|copy (it|this|the )?(pdf|file|document)|same as|same (rakh|daal|likh)|editor (me|mein)|jaisa (hai|ka)|jaisa ka taisa|hubahu|bina (change|summar)|mat summar|saare point|sare point|pura (likh|text|copy)|poora (likh|text)/.test(en)
    || /जैसा है|जैसा का तैसा|जस का तस|ज्यों का त्यों|हूबहू|शब्दशः|शब्दश:|एग्जैक्ट|एग्जैकली|वही (रखो|लिखो|डालो)|जैसे अपलोड|जैसा अपलोड|जैसे का तैसा|बिना सारांश|सारे पॉइंट|सभी बिंदु|सारे बिंदु|एडिटर में/.test(p)
  );
};

/** A hello with no case question. These stay a short welcome, not a case brief. */
export const isCasualGreeting = (prompt: string) => {
  const p = String(prompt || '').trim();
  if (!p || p.length > 48) return false;
  return /^(h+i+|hello+|hey+|hi there|good (morning|evening|afternoon|night)|namaste|namaskar|thanks|thank you|ok+|okay|how are you|who are you)[.!?\s]*$/i.test(p)
    || /^(हाय+|हैलो|नमस्ते|नमस्कार|धन्यवाद|शुभ प्रभात|शुभ संध्या|आप कौन हैं|নমস্কার|নমস্কাৰ|ନମସ୍କାର|नमस्कार|નમસ્તે|ਨਮਸਤੇ|ਸਤ ਸ੍ਰੀ ਅਕਾਲ|నమస్కారం|வணக்கம்|ನಮಸ್ಕಾರ|നമസ്കാരം)[.!?\s]*$/.test(p)
    || /^السلام( علیکم)?[.!?\s]*$/.test(p);
};

/** True only when the whole request is just a summary. Analysis always wins. */
export const userAskedForSummary = (prompt: string) => {
  const p = String(prompt || '').trim();
  if (!p) return false;
  if (/analy[sz]|विश्लेष|पूरी|पूरा|full|detail|examine|review/i.test(p)) return false;
  return /^(please |pls )?(give |write |make )?(me |a |the )?(short |brief )?(summar(y|ise|ize)|key points only|short note)\b/i.test(p)
    || /^(कृपया )?(सारांश|संक्षेप|संक्षिप्त सारांश)/.test(p);
};

const askedToSummarize = (prompt: string) => userAskedForSummary(prompt);

const askedNewDraft = (prompt: string) =>
  /new (petition|draft|application|notice)|draft a |prepare a |write a new|नई याचिका|नया ड्राफ्ट|ड्राफ्ट बनाओ|blank form/.test(String(prompt || ''));

const shouldExactSourceCopy = (
  prompt: string,
  caseFiles: File[],
  formatFiles: File[],
  templateContent: string | null,
  isGenerateDocument: boolean
) => {
  if (askedToSummarize(prompt) && !wantsExactSourceCopy(prompt)) return false;
  if (askedNewDraft(prompt)) return false;
  const mixing = caseFiles.length > 0 && (formatFiles.length > 0 || !!templateContent);
  // Case papers + a format/template means "draft the case in that layout". Words like "same as" then
  // describe the layout, and must never turn the template itself into the answer.
  if (mixing) return false;
  if (wantsExactSourceCopy(prompt)) return true;
  const uploaded = [...caseFiles, ...formatFiles];
  const onlyDocs = uploaded.length > 0 && uploaded.every(isDocLikeFile);
  // A bare "Generate" on documents only (the app's own default text) keeps the file as it is. Any real
  // instruction from the advocate is followed instead of being replaced by a copy.
  const bareGenerate = /^please generate the document based on the provided context and files\.?$/i.test(String(prompt || '').trim());
  if (isGenerateDocument && onlyDocs && bareGenerate) return true;
  return false;
};

const compactHistory = (history: Message[], omitDocuments = false): string => {
  const recent = history
    .filter((msg) => !(omitDocuments && msg.isDocument))
    .slice(-MAX_HISTORY_MESSAGES);
  return recent
    .map((msg) => {
      let text = msg.text || '';
      const limit = msg.isDocument ? MAX_DOC_CHARS : MAX_MSG_CHARS;
      if (text.length > limit) text = `${text.slice(0, limit)}\n[…]`;
      const line = `${msg.role === 'user' ? 'Advocate' : 'casemate'}: ${text}`;
      if (msg.attachments?.length) {
        return `${line}\n  [Attachments: ${msg.attachments.map((a) => a.name).join(', ')}]`;
      }
      return line;
    })
    .join('\n');
};

const capText = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}\n[…]`;

const splitIntoBatches = (files: File[]): File[][] => {
  const out: File[][] = [];
  let cur: File[] = [];
  let bytes = 0;
  for (const f of files) {
    if (cur.length > 0 && (cur.length >= BATCH_SIZE || bytes + f.size > MAX_BATCH_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(f);
    bytes += f.size;
  }
  if (cur.length > 0) out.push(cur);
  return out;
};

const analyzeFileBatch = async (
  files: File[],
  batchIndex: number,
  totalBatches: number,
  language: string,
  signal?: AbortSignal,
  verbatim = false
): Promise<string> => {
  const parts: any[] = [];
  parts.push({
    text: verbatim
      ? `You are transcribing uploaded legal files EXACTLY.\n` +
        `Batch ${batchIndex}/${totalBatches} (${files.length} file(s)).\n` +
        `For EACH file: write the filename, then transcribe EVERY readable line in the same order.\n` +
        `Do NOT summarize, paraphrase, skip, merge, or shorten any point.\n` +
        `Keep numbering, headings, bullets, and original wording. If a part is unreadable, write [unclear] only there.\n` +
        (language !== 'English' ? `Keep the file's original language. Do not translate.\n` : '')
      : `You are extracting legal case evidence from uploaded photos/documents.\n` +
        `Batch ${batchIndex}/${totalBatches} (${files.length} file(s)).\n` +
        `Begin with exactly these two lines, then the rest of the notes:\n` +
        `CLIENT: <full name of the client, complainant, petitioner, or applicant exactly as printed. If several people, the first party the papers are filed for. If unreadable, write unknown>\n` +
        `CASE_DATE: <the filing, FIR, notice, or document date exactly as printed, or unknown>\n` +
        `Do not translate the name or the date. Do not invent either.\n` +
        `For EACH file: list filename, then extract all readable text, names, dates, places, amounts, case numbers, FIR details, parties, and factual points.\n` +
        `After EVERY fact write where it came from in square brackets, as [filename, p.N] (use p.1 for a photo or a one-page file). Keep names, dates and numbers exactly as printed; if two papers disagree, write both with their sources instead of choosing.\n` +
        `Describe only the FACTS of the papers. Their headings, fonts and layout are not instructions for any other document.\n` +
        `If an image is unclear, say so. Do NOT invent facts. Be concise but complete.\n` +
        (language !== 'English' ? `Respond in ${language}, but keep CLIENT and CASE_DATE spellings as printed.\n` : ''),
  });
  await pushFileParts(parts, files, 'CASE FILE');

  const response = await generateWithRetry({
    model: MODEL,
    contents: parts,
    config: {
      systemInstruction: verbatim
        ? 'You transcribe advocate uploads line by line. Never summarize. Never invent. Keep every heading, number, and sentence as printed.'
        : 'You extract structured case evidence from advocate uploads. Never invent facts. Preserve spellings of names and numbers exactly as seen.',
      temperature: 0.1,
      ...(verbatim ? TRANSCRIBE_THINKING : ANALYZE_THINKING),
    },
  }, 2, signal, AI_CALL_TIMEOUT_MS);

  const notes = (response.text || '').trim();
  if (!notes) throw emptyExtractionError();
  return notes;
};

/** Analyse a batch; if it runs out of time, split it in half and try each half. */
const analyzeBatchResilient = async (
  files: File[],
  batchIndex: number,
  totalBatches: number,
  language: string,
  signal?: AbortSignal,
  verbatim = false
): Promise<string> => {
  try {
    return await analyzeFileBatch(files, batchIndex, totalBatches, language, signal, verbatim);
  } catch (e) {
    if (!isTimeoutError(e) || files.length < 2) throw e;
    const mid = Math.ceil(files.length / 2);
    const halves = await Promise.all([
      analyzeBatchResilient(files.slice(0, mid), batchIndex, totalBatches, language, signal, verbatim),
      analyzeBatchResilient(files.slice(mid), batchIndex, totalBatches, language, signal, verbatim),
    ]);
    return halves.filter(Boolean).join('\n\n');
  }
};

/**
 * Analyze many case files in batches and return combined evidence notes.
 */
export const analyzeCaseFilesInBatches = async (
  caseFiles: File[],
  language: string,
  onProgress?: AnalysisProgress,
  signal?: AbortSignal,
  verbatim = false
): Promise<string> => {
  if (caseFiles.length === 0) return '';

  if (!hasGemini()) {
    return language === 'Hindi'
      ? 'त्रुटि: जेमिनी API की गायब है।'
      : 'Error: Gemini API Key is missing.';
  }

  const batches = splitIntoBatches(caseFiles);
  const totalBatches = batches.length;
  let firstError: unknown = null;
  let readBatches = 0;
  const runBatch = async (b: number): Promise<string> => {
    if (signal?.aborted) throw userAbortError();
    onProgress?.({ phase: 'analyzing', batch: b + 1, totalBatches });
    const slice = batches[b];
    try {
      const notes = await analyzeBatchResilient(slice, b + 1, totalBatches, language, signal, verbatim);
      readBatches += 1;
      return `### Batch ${b + 1}/${totalBatches}\n${notes}`;
    } catch (e) {
      if (isUserAbortError(e)) throw e;
      // Fair-use / device limits are decisions the advocate must see, not a quietly skipped batch.
      if (passThroughError(e)) throw e;
      console.warn('Batch analyze skipped', b + 1, e);
      if (!firstError) firstError = e;
      return `### Batch ${b + 1}/${totalBatches}\n(${slice.map((f) => f.name).join(', ')} — could not read this batch; other batches were kept.)`;
    }
  };

  const indices = Array.from({ length: totalBatches }, (_, i) => i);
  const sections: string[] = new Array(totalBatches);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, totalBatches) }, async () => {
    while (cursor < indices.length) {
      const b = cursor++;
      sections[b] = await runBatch(b);
    }
  });
  await Promise.all(workers);

  // Nothing could be read at all: say so, instead of letting the AI answer from empty notes.
  if (readBatches === 0 && firstError) throw firstError;

  return sections.filter(Boolean).join('\n\n');
};

/**
 * Copy uploaded files word for word, one file per request, a few at a time.
 * One request per file keeps every call well inside the server time limit, and
 * no thinking is used because copying needs none.
 */
export const transcribeFilesExact = async (
  files: File[],
  language: string,
  onProgress?: AnalysisProgress,
  signal?: AbortSignal
): Promise<string> => {
  if (files.length === 0) return '';
  const total = files.length;
  const results: string[] = new Array(total).fill('');
  let firstError: unknown = null;
  let ok = 0;
  let cursor = 0;
  const run = async (i: number) => {
    if (signal?.aborted) throw userAbortError();
    onProgress?.({ phase: 'analyzing', batch: i + 1, totalBatches: total });
    const parts: any[] = [{
      text:
        `Transcribe this uploaded file EXACTLY, line by line, in the same order.\n` +
        `Keep every heading, number, bullet, sentence, name, date and amount as printed. Do NOT summarize, paraphrase, skip, merge or shorten anything.\n` +
        `If a part is unreadable write [unclear] only there. Keep the file's original language; do not translate.\n` +
        `If the file text already carries **bold**, [U]underline[/U], [CENTER], [RIGHT] or [ROW] markers, keep them exactly. Add none of your own, and no HTML or code fences.\n` +
        `Output ONLY the transcribed text, no commentary.\n`,
    }];
    await pushFileParts(parts, [files[i]], 'SOURCE FILE');
    try {
      const response = await generateWithRetry({
        model: MODEL,
        contents: parts,
        config: {
          systemInstruction: 'You transcribe advocate uploads line by line. Never summarize. Never invent. Keep every heading, number and sentence as printed.',
          temperature: 0.1,
          ...TRANSCRIBE_THINKING,
        },
      }, 2, signal, AI_CALL_TIMEOUT_MS);
      results[i] = (response.text || '').trim();
      if (results[i]) {
        ok += 1;
      } else {
        if (!firstError) firstError = emptyExtractionError();
        results[i] = `[${files[i]?.name || 'file'}: no readable text found — check that the file is clear and not blank.]`;
      }
    } catch (e) {
      if (isUserAbortError(e) || passThroughError(e)) throw e;
      console.warn('Transcribe skipped', files[i]?.name, e);
      if (!firstError) firstError = e;
      results[i] = `[${files[i]?.name || 'file'} could not be read in time — upload it again on its own.]`;
    }
  };
  const workers = Array.from({ length: Math.min(3, total) }, async () => {
    while (cursor < total) {
      const i = cursor++;
      await run(i);
    }
  });
  await Promise.all(workers);
  if (ok === 0 && firstError) throw firstError;
  return results.filter(Boolean).join('\n\n');
};

/** Read a newly uploaded format and extract a compact clone skeleton (no facts). */
export const extractFormatSkeleton = async (
  formatFiles: File[],
  language: string,
  signal?: AbortSignal
): Promise<string> => {
  if (formatFiles.length === 0) return '';
  const files = formatFiles.slice(0, 4);
  const parts: any[] = [];
  parts.push({
    text:
      `Extract a FORMAT SKELETON from this advocate's PAST draft. This is a DIFFERENT case used only as a blank form.\n` +
      `Output a line-by-line recipe. For EACH visual line/block, write:\n` +
      `N. TEXT | ALIGN=center|right|left|justify|row | STYLE=bold/underline/plain\n` +
      `Look closely at each line: write STYLE=bold, STYLE=underline or STYLE=bold+underline wherever the original line is bold and/or underlined (headings, court title, PRAYER, VERIFICATION are often both). Use plain only for ordinary text.\n` +
      `Rules:\n` +
      `- Keep heading titles, numbering, court-title / memo / facts / grounds / prayer / verification order EXACTLY.\n` +
      `- Keep structural Hindi/English phrases only (यह कि, प्रार्थना, सत्यापन, IN THE COURT OF, etc.).\n` +
      `- REPLACE with ________ every party name, parentage, caste, age, occupation, address, village/city, date, year, case/FIR/CR number, police station, court case title parties, amount, vehicle number, phone, email, allegation, incident story, and prayer-specific fact.\n` +
      `- Do NOT keep even one fact from this old case. The skeleton must be a blank form.\n` +
      `- Note same-line pairs as ALIGN=row (left | right).\n` +
      `- Do not invent extra sections that are not on the page.\n` +
      (language !== 'English' ? `Write the skeleton headings in the document's original language.\n` : ''),
  });
  await pushFileParts(parts, files, 'FORMAT REFERENCE FILE');
  const response = await generateWithRetry({
    model: MODEL,
    contents: parts,
    config: {
      systemInstruction:
        'You extract only a blank document layout. This upload is a different past case. Never copy its party names, dates, case numbers, addresses, allegations, amounts, or any facts. Output a complete blank line-by-line skeleton.',
      temperature: 0.1,
      ...LAYOUT_THINKING,
    },
  }, 2, signal, 120000);
  return capText((response.text || '').trim(), MAX_FORMAT_SKELETON_CHARS);
};

/** Distill anonymized drafting memory when a document chat completes (no party PII). */
export const distillCaseLearning = async (
  messages: Message[],
  language: string
): Promise<CaseLearning | null> => {
  try {
    if (!hasGemini()) return null;
    const docMsg = [...messages].reverse().find((m) => m.isDocument && m.role === 'model');
    if (!docMsg) return null;
    const snippet = messages
      .slice(-8)
      .map((m) => `${m.role}: ${m.text.slice(0, 400)}`)
      .join('\n');
    const response = await generateWithRetry({
      model: MODEL,
      contents: [
        {
          text:
            `A legal drafting chat just completed with a generated document.\n` +
            `Extract reusable LEARNING for future similar cases. Output EXACTLY:\n` +
            `CASE_TYPE: <short type e.g. bail application / mutual divorce / legal notice>\n` +
            `NOTES: <5-10 bullet tips on structure, headings, tone, common blanks, clauses — NO party names, case numbers, addresses, or phone numbers>\n` +
            (language !== 'English' ? `Write NOTES in ${language}.\n` : '') +
            `\nCHAT+DOCUMENT EXCERPT:\n${snippet}\n\nDOCUMENT HEAD:\n${docMsg.text.slice(0, 1800)}`,
        },
      ],
      config: {
        systemInstruction:
          'You distill reusable legal drafting patterns. Never include personal names, case numbers, phone numbers, addresses, or other PII. Case type + structural tips only.',
        temperature: 0.2,
        ...FAST_CONFIG,
      },
    }, 2);
    const raw = (response.text || '').trim();
    const typeMatch = raw.match(/CASE_TYPE:\s*(.+)/i);
    const notesMatch = raw.match(/NOTES:\s*([\s\S]+)/i);
    const caseType = (typeMatch?.[1] || 'general legal drafting').trim().slice(0, 80);
    const notes = (notesMatch?.[1] || raw).trim().slice(0, 2500);
    if (!notes) return null;
    return {
      id: `${Date.now()}`,
      caseType,
      notes,
      updatedAt: Date.now(),
      useCount: 1,
    };
  } catch (e) {
    console.warn('distillCaseLearning failed', e);
    return null;
  }
};

/* ------------------------------------------------------------------ */
/* Judge mode drafting. Used only when the signed-in user chose "Judge". */
/* Advocate drafting prompts above/below are untouched.                  */
/* ------------------------------------------------------------------ */

const JUDGE_DOC_SYSTEM =
  'You are casemate, a drafting assistant for Indian judges and judicial officers. Output only the complete judgment or order, in the court\'s own neutral voice, using [CENTER], [RIGHT], [ROW], **bold** and [U] tags. Never write it as an advocate: no "most respectfully showeth", no prayer, no verification. Use facts only from the current case papers, evidence notes, chat and the judge\'s instruction. Never invent names, dates, exhibits, section numbers or citations; leave missing items as ________. The decision belongs to the judge: follow the outcome the judge states; if none is stated, do not choose a winner. After the document add <<<FOLLOWUPS>>>.';

const JUDGE_DOC_SYSTEM_FORMAT =
  'You are casemate, a drafting assistant for Indian judges and judicial officers. Output only the complete judgment or order. Clone the chosen format\'s layout (headings, order, numbering, alignment) and fill it only from the current case papers, evidence notes, chat and the judge\'s instruction. Write in the court\'s neutral voice. Never copy facts from a sample format. Never invent names, dates, exhibits, section numbers or citations; leave missing items as ________. The decision belongs to the judge: follow the outcome the judge states; if none is stated, do not choose a winner. After the document add <<<FOLLOWUPS>>>.';

const JUDGE_FORMAT_NOTE = `

JUDGE MODE NOTE: The format above is a judgment / order layout. Write in the court's voice (third person, "this Court"), with reasoned findings drawn only from the current case papers. The decision belongs to the judge: use the outcome stated in the request or the papers; if none is stated, set out both sides neutrally and mark the finding and the final order as [FINDING OF THE COURT: ________] and [ORDER OF THE COURT: ________] instead of deciding. Do not quote case law from memory; where a precedent is needed write [CITATION TO BE VERIFIED].`;

const JUDGE_DRAFT_TASK = (prompt: string) => `
TASK: Draft the JUDGMENT or ORDER for this matter, as the presiding judge would write it, from the case papers.
INSTRUCTIONS:
1. FACTS SOURCE (ONLY): names, dates, places, case / FIR numbers, amounts, parties, evidence and exhibits come ONLY from the current case files, evidence notes, conversation history and the judge's request. Never invent a fact, exhibit number, witness or section. If something is missing, leave ________.
2. TYPE: Follow the document type the judge asked for (for example conviction, acquittal, bail order, decree, final order, interim order). If none is named, infer it from the papers (criminal trial, civil suit, application, appeal) and use the matching standard form.
3. VOICE: Neutral, formal, third person ("this Court", "the prosecution", "the plaintiff"). Never write as counsel. No "most respectfully showeth", no prayer clause, no verification.
4. STRUCTURE (numbered paragraphs, in this order):
   - Court heading, presiding officer, case type and number, parties with their designations, dates (institution, arguments, judgment)
   - Title: JUDGMENT (or ORDER)
   - Nature of the case / accusation and brief facts
   - Case of each side (pleadings, or charge and plea in a criminal trial)
   - Evidence led: witnesses and documents with exhibit marks, as in the papers
   - Arguments of both sides
   - Issues or points for determination
   - Appreciation of evidence and findings, issue by issue, each with reasons drawn from the record
   - Conclusion
   - Operative ORDER as a separate heading, with clear numbered directions (sentence / decree / relief, costs, disposal of property, compliance)
   - Signature block: place, date, judge's name and designation
5. THE DECISION BELONGS TO THE JUDGE. If the judge's request or the papers state the outcome, write the reasoning that supports it, fairly and from the record. If no outcome is stated, set out both sides neutrally and write the findings and the operative order as [FINDING OF THE COURT: ________] and [ORDER OF THE COURT: ________]. Never pick the winner on your own.
6. LAW: Cite only Acts and sections that appear in the papers or the request, or that are certain and standard for this kind of case. Choose CrPC / IPC or BNSS / BNS according to the offence date in the papers; if unclear, use the law named in the papers. Do not quote case law from memory; where a precedent is needed write [CITATION TO BE VERIFIED].
7. FORMATTING RULES (CRITICAL):
   - Body paragraphs stay plain lines with no alignment tags (the system justifies them).
   - Use [CENTER]text[/CENTER] for the court name, case number line, and the headings JUDGMENT / ORDER.
   - Use **text** for paragraph headings and **[U]text[/U]** style underline only where a heading needs it.
   - Place / date on the left and the judge's signature on the right in the same row:
     [ROW]
     Place: ________
     Date: ________
     |
     (Name of Presiding Officer)
     Designation
     [/ROW]
   - Do not use tables, HTML or code fences.
8. Output ONLY the complete document. No summary, no commentary, no questions inside the document. The <<<FOLLOWUPS>>> block comes only after the document is finished.

JUDGE'S REQUEST: ${prompt}
      `;

const ANALYSIS_STRUCTURE_RULES = `
Structure the reply in two clearly labelled parts. Never invent facts, names, dates, sections, or citations.

## From the papers
Only what is actually written in the uploaded material or this chat:
- Case summary
- Parties and important dates
- Key facts

If an item is not in the papers, write "Not in the papers".

## Observations (review these)
These are suggestions, not findings from the papers:
- Missing information or questions to investigate
- Possible inconsistencies in the provided material
- Suggested next steps for the advocate to review

Do not treat observations as facts.
`;

export const analysisUploadPrompt = (language: string) =>
  language === 'Hindi'
    ? 'इन कागजों का विश्लेषण करें। पहले केवल कागजों से सारांश, पक्षकार, तारीखें और तथ्य लिखें। फिर अलग से लिखें क्या गायब है, क्या असंगत लग सकता है, और अगले कदम — ये सुझाव हैं, कागजों के तथ्य नहीं। कोई तथ्य या citation न गढ़ें।'
    : 'Analyse these papers. First write only what is in the papers: summary, parties, dates, and key facts. Then separately list missing information, possible inconsistencies, and suggested next steps as observations to review. Do not invent facts or citations.';

export const ANALYSIS_ACTIONS = (language: string) =>
  language === 'Hindi'
    ? [
        { id: 'summary', label: 'केस सारांश', prompt: 'केवल अपलोड किए कागजों से मामला सारांश लिखें। जो नहीं है वह न जोड़ें।' },
        { id: 'parties', label: 'पक्षकार और तारीखें', prompt: 'कागजों से पक्षकारों के नाम और महत्वपूर्ण तारीखें निकालें। जो छपा नहीं है उसे न लिखें।' },
        { id: 'facts', label: 'मुख्य तथ्य', prompt: 'कागजों में लिखे मुख्य तथ्य सूचीबद्ध करें। कोई तथ्य न गढ़ें।' },
        { id: 'missing', label: 'क्या गायब है', prompt: 'कागजों में क्या जानकारी गायब लगती है — इसे सुझाव के रूप में लिखें, तथ्य के रूप में नहीं।' },
        { id: 'next', label: 'अगले कदम', prompt: 'अधिवक्ता के लिए सुझाए अगले कदम लिखें। साफ़ कहें कि ये सुझाव हैं, कागजों के निष्कर्ष नहीं।' },
      ]
    : [
        { id: 'summary', label: 'Case summary', prompt: 'Write a case summary using only the uploaded papers. Do not add anything that is not in them.' },
        { id: 'parties', label: 'Parties and dates', prompt: 'List the parties and important dates exactly as they appear in the papers. If a date is missing, say it is not in the papers.' },
        { id: 'facts', label: 'Key facts', prompt: 'List the key facts found in the papers. Do not invent facts.' },
        { id: 'missing', label: 'Missing information', prompt: 'What information appears to be missing from these papers? Label this as observations to review, not as facts.' },
        { id: 'next', label: 'Next steps', prompt: 'Suggest next steps for the advocate to review. Say clearly that these are suggestions, not findings from the papers.' },
      ];

/** A document produced by filling the advocate's own Word template in place. */
export interface FilledTemplate {
  docx: Uint8Array;
  fileName: string;
  /** things the advocate should check (blanks left on purpose, unsupported dates, ...) */
  review: string[];
}

/** A document rebuilt from a scanned/photographed template (image or scanned PDF). */
export interface ScanDraftResult {
  docx: Uint8Array;
  fileName: string;
  profile: TemplateProfile;
  draft: Draft;
  review: string[];
  checks: { name: string; ok: boolean; detail: string }[];
  reusedProfile: boolean;
}

export interface GeneratedReply {
  text: string;
  /** set when the template was a scan; the DOCX/PDF exports come from this, not from the editor text */
  scanDraft?: ScanDraftResult;
  evidenceNotes?: string;
  suggestedQuestions?: string[];
  filledTemplate?: FilledTemplate;
  /** plain-language notes, e.g. why a template could not be reproduced exactly */
  notices?: string[];
}

export const generateLegalResponse = async (
  prompt: string,
  history: Message[],
  caseFiles: File[],
  formatFiles: File[],
  templateContent: string | null,
  isGenerateDocument: boolean,
  language: string,
  onProgress?: AnalysisProgress,
  learnedStyleText?: string,
  signal?: AbortSignal,
  userMode: UserMode = 'advocate'
): Promise<GeneratedReply> => {
  const isJudge = userMode === 'judge';
  if (!hasGemini()) {
    return {
      text:
        language === 'Hindi'
          ? 'त्रुटि: जेमिनी API की (Gemini API Key) .env फाइल में गायब है!'
          : 'Error: Gemini API Key is missing in the .env file!',
    };
  }

  if (
    !isGenerateDocument
    && isCasualGreeting(prompt)
    && caseFiles.length === 0
    && formatFiles.length === 0
    && !templateContent
  ) {
    const greet = greetingFor(language);
    return {
      text: greet.text,
      suggestedQuestions: greet.questions,
    };
  }

  const exactCopy = shouldExactSourceCopy(
    prompt,
    caseFiles,
    formatFiles,
    templateContent,
    isGenerateDocument
  );

  let copyFiles: File[] = [...caseFiles, ...formatFiles];
  let newEvidence = '';
  let reloadedEvidence = '';
  const priorNotes = exactCopy ? '' : collectPriorEvidenceNotes(history);

  if (exactCopy) {
    if (copyFiles.length === 0) {
      for (const att of collectPriorSourceAttachments(history)) {
        const f = await fetchAttachmentAsFile(att);
        if (f) copyFiles.push(f);
      }
    }
    copyFiles = copyFiles.slice(0, 6);
    if (copyFiles.length > 0) {
      try {
        // Plain-text transcript first (fast, one request per file); the final call below then applies the
        // advocate's instruction and the court layout tags, so the prompt is always followed.
        newEvidence = await transcribeFilesExact(copyFiles, language, onProgress, signal);
        copyFiles = [];
      } catch (e) {
        if (isUserAbortError(e)) throw e;
        console.error('Exact copy failed', e);
        return { text: friendlyApiError(e, language, false) };
      }
    }
  } else {
    try {
      if (caseFiles.length > 0) {
        newEvidence = await analyzeCaseFilesInBatches(caseFiles, language, onProgress, signal, false);
      }
    } catch (e) {
      if (isUserAbortError(e)) throw e;
      console.warn('Full analyze failed', e);
      // Answering without the papers the advocate just uploaded would be a made-up reply; say what happened instead.
      if (!priorNotes) return { text: friendlyApiError(e, language, false) };
    }

    if (!newEvidence && !priorNotes) {
      const priorAtts = collectPriorCaseAttachments(history);
      if (priorAtts.length > 0) {
        const reloaded: File[] = [];
        for (const att of priorAtts) {
          const f = await fetchAttachmentAsFile(att);
          if (f) reloaded.push(f);
        }
        if (reloaded.length > 0) {
          try {
            reloadedEvidence = await analyzeCaseFilesInBatches(reloaded, language, onProgress, signal, false);
          } catch (e) {
            if (isUserAbortError(e)) throw e;
            console.warn('Reload analyze failed', e);
          }
        }
      }
    }
  }

  const allEvidence = capText(
    [priorNotes, newEvidence, reloadedEvidence].filter(Boolean).join('\n\n'),
    exactCopy ? MAX_EVIDENCE_CHARS_EXACT : MAX_EVIDENCE_CHARS
  );
  const photosAnalyzed = !!newEvidence || !!priorNotes || !!reloadedEvidence;
  const hasNewFormat = formatFiles.length > 0 || !!templateContent;
  const hi = language === 'Hindi';
  const notices: string[] = [];

  // A Word template is the MASTER DOCUMENT: its own file is filled in place, so its tables, numbering,
  // headers, footers, logos and page breaks stay exactly as they are. The AI only supplies replacement
  // values for fields it found in the template; the document engine decides where they go.
  if (isGenerateDocument && !exactCopy && formatFiles.length > 0) {
    const master = formatFiles.find(isDocxFile);
    if (master) {
      if (formatFiles.filter(isDocxFile).length > 1 || formatFiles.length > 1) {
        notices.push(hi
          ? `केवल पहली Word फ़ाइल (${master.name}) को टेम्पलेट माना गया; अन्य फ़ॉर्मेट फ़ाइलें इस ड्राफ्ट के लिए इस्तेमाल नहीं हुईं।`
          : `Only the first Word file (${master.name}) was used as the template; the other format files were not used for this draft.`);
      }
      try {
        onProgress?.({ phase: 'format', batch: 1, totalBatches: 1 });
        const callModel: ModelCall = async ({ system, prompt, kind }) => {
          const res = await generateWithRetry({
            model: MODEL,
            contents: [{ text: prompt }],
            config: {
              systemInstruction: system,
              temperature: 0.1,
              responseMimeType: 'application/json',
              ...(kind === 'fill' ? ANALYZE_THINKING : LAYOUT_THINKING),
            },
            workKind: kind === 'fill' ? 'draft' : 'analysis',
          }, 2, signal, kind === 'fill' ? DRAFT_CALL_TIMEOUT_MS : 120000);
          return res.text;
        };
        const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '/');
        const filled = await fillDocxTemplate({
          template: new Uint8Array(await master.arrayBuffer()),
          evidence: allEvidence,
          userRequest: prompt,
          language,
          today,
          callModel,
          onStage: (stage) => onProgress?.({ phase: stage === 'analyzing' ? 'format' : 'answering', batch: 1, totalBatches: 1 }),
        });
        const filledFile = new File([filled.docx], master.name, {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const shown = await docxToTaggedText(filledFile);
        if (shown) {
          return {
            text: shown,
            evidenceNotes: newEvidence || undefined,
            suggestedQuestions: fallbackFollowUps(prompt, true, language),
            filledTemplate: { docx: filled.docx, fileName: master.name, review: filled.review },
            notices: notices.length ? notices : undefined,
          };
        }
        notices.push(hi
          ? 'भरी हुई Word फ़ाइल एडिटर में दिखाई नहीं जा सकी, इसलिए ड्राफ्ट टेम्पलेट की रूपरेखा से लिखा गया।'
          : 'The filled Word file could not be shown in the editor, so the draft was written from the template outline instead.');
      } catch (e) {
        if (isUserAbortError(e)) throw e;
        if (passThroughError(e)) return { text: String((e as any)?.message || '') };
        console.warn('Template fill failed; using the outline workflow', e);
        const why = e instanceof TemplateFillError ? e.message : isTimeoutError(e) ? (hi ? 'समय सीमा पार हो गई' : 'it took too long') : (hi ? 'तकनीकी समस्या' : 'a technical problem');
        notices.push(hi
          ? `आपके Word टेम्पलेट को सीधे भरा नहीं जा सका (${why})। ड्राफ्ट टेम्पलेट की रूपरेखा से लिखा गया है, इसलिए उसका लेआउट मूल फ़ाइल से अलग हो सकता है।`
          : `Your Word template could not be filled in place (${why}). The draft was written from the template's outline instead, so its layout can differ from your original file.`);
      }
    } else {
      const scan = formatFiles.find((f) => /^image\//i.test(f.type) || /pdf/i.test(f.type) || /\.(jpe?g|png|webp|pdf)$/i.test(f.name));
      if (formatFiles.length > 1) {
        notices.push(hi
          ? `केवल पहली टेम्पलेट फ़ाइल (${scan?.name || formatFiles[0].name}) को टेम्पलेट माना गया।`
          : `Only the first template file (${scan?.name || formatFiles[0].name}) was used as the template.`);
      }
      if (scan) {
        try {
          onProgress?.({ phase: 'format', batch: 1, totalBatches: 1 });
          const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const run = await runScanTemplate({
            file: scan,
            evidence: allEvidence,
            userRequest: prompt,
            language,
            today,
            model: MODEL,
            generate: (payload, sig, timeoutMs) => generateWithRetry(payload, 2, sig, timeoutMs),
            thinkingAnalyze: LAYOUT_THINKING,
            thinkingFill: ANALYZE_THINKING,
            signal,
            onStage: (stage) => onProgress?.({ phase: stage === 'reading' || stage === 'fields' ? 'format' : 'answering', batch: 1, totalBatches: 1 }),
          });
          notices.push(hi
            ? `टेम्पलेट स्कैन/फ़ोटो से पढ़ा गया${run.reusedProfile ? ' (पहले का विश्लेषण दोबारा इस्तेमाल हुआ)' : ''}। ढाँचा और फ़ॉर्मेटिंग अनुमान से बनी है — Word और PDF को मूल से मिलाकर जाँचें। "टेम्पलेट जाँच" से हेडिंग/शैली सुधारी जा सकती है।`
            : `The template was read from the ${scan.type === 'application/pdf' ? 'scanned PDF' : 'photo'}${run.reusedProfile ? ' (the earlier reading of this same file was reused)' : ''}. Structure and formatting are estimated from the image — compare the Word and PDF with your original. Use "Template check" to correct headings or styles.`);
          return {
            text: run.text,
            evidenceNotes: newEvidence || undefined,
            suggestedQuestions: fallbackFollowUps(prompt, true, language),
            scanDraft: run,
            filledTemplate: { docx: run.docx, fileName: `${run.fileName}.docx`, review: run.review },
            notices,
          };
        } catch (e) {
          if (isUserAbortError(e)) throw e;
          if (passThroughError(e)) return { text: String((e as any)?.message || '') };
          console.warn('Scanned template could not be rebuilt; using the outline workflow', e);
          const why = e instanceof ScanTemplateError ? e.message : isTimeoutError(e) ? (hi ? 'समय सीमा पार हो गई' : 'it took too long') : (hi ? 'तकनीकी समस्या' : 'a technical problem');
          notices.push(hi
            ? `स्कैन/फ़ोटो टेम्पलेट का लेआउट नहीं बन सका (${why})। ड्राफ्ट टेम्पलेट की रूपरेखा से लिखा गया है, इसलिए उसका लेआउट मूल से अलग हो सकता है।`
            : `The scanned template's layout could not be rebuilt (${why}). The draft was written from the template's outline instead, so its layout can differ from your original.`);
        }
      }
    }
  }

  let formatSkeleton = '';
  if (isGenerateDocument && formatFiles.length > 0 && !exactCopy) {
    try {
      onProgress?.({ phase: 'format', batch: 1, totalBatches: 1 });
      formatSkeleton = await extractFormatSkeleton(formatFiles, language, signal);
    } catch (e) {
      if (isUserAbortError(e)) throw e;
      console.warn('Format skeleton failed', e);
    }
  }

  onProgress?.({
    phase: 'answering',
    batch: 1,
    totalBatches: 1,
  });

  const buildParts = async (includeFormatFiles: boolean) => {
    const currentParts: any[] = [];
    const sourceFiles = (exactCopy ? copyFiles : formatFiles).slice(0, 6);

    if (exactCopy && sourceFiles.length > 0) {
      currentParts.push({
        text: `\n--- SOURCE FILE(S) TO COPY EXACTLY ---\nTranscribe these files as printed. Do not summarize. Do not drop names, dates, numbers, or points.\n`,
      });
      await pushFileParts(currentParts, sourceFiles, 'SOURCE FILE');
      currentParts.push({ text: `\n--- END SOURCE FILES ---\n` });
    } else if (includeFormatFiles && formatFiles.length > 0 && !formatSkeleton && !exactCopy) {
      const formats = formatFiles.slice(0, 4);
      currentParts.push({
        text: `\n--- FORMAT FROM ADVOCATE'S PAST CASE (STRUCTURE ONLY — A DIFFERENT MATTER) ---\nClone headings, sequence, numbering, alignment, prayer/verification style ONLY. This file's names, dates, FIR/case numbers, addresses, allegations, amounts, and story are FORBIDDEN. Never copy them. Never mix them with the current case.\n`,
      });
      await pushFileParts(currentParts, formats, 'FORMAT REFERENCE FILE');
      currentParts.push({ text: `\n--- END FORMAT REFERENCE FILES ---\n` });
    }

    let finalPromptText = '';
    if (formatSkeleton && !exactCopy) {
      finalPromptText +=
        `--- MANDATORY BLANK FORMAT SKELETON (LAYOUT ONLY — NO FACTS FROM THE FORMAT CASE) ---\n` +
        `Clone this layout line-by-line. It is a blank form. Any leftover name/date/number here is an error — treat it as ________.\n` +
        `${formatSkeleton}\n` +
        `--- END FORMAT SKELETON ---\n\n`;
    }

    const historyText = compactHistory(history, hasNewFormat && !exactCopy);
    if (historyText) {
      finalPromptText += exactCopy
        ? `--- Previous Conversation Context ---\n${historyText}\n--- End Context ---\n\n`
        : `--- Previous Conversation Context (facts only — do NOT copy layout from any earlier draft) ---\n${historyText}\n--- End Context ---\n\n`;
    }

    if (allEvidence) {
      finalPromptText += exactCopy
        ? `--- FULL TRANSCRIPT OF UPLOADED FILE(S) (copy these points — do not shorten) ---\n${allEvidence}\n--- END TRANSCRIPT ---\n\n`
        : `--- CURRENT CASE EVIDENCE ONLY (the only allowed facts) ---\n` +
          `These notes come from CURRENT case files / this chat. They are the ONLY source of names, dates, numbers, and story.\n` +
          `Format-upload files are a different past case and are NOT evidence. Do not mix format-case facts into this draft.\n` +
          `${allEvidence}\n` +
          `--- END CURRENT CASE EVIDENCE ---\n\n`;
    }

    if (learnedStyleText && isGenerateDocument && !hasNewFormat && !exactCopy && !isJudge) {
      finalPromptText +=
        `--- LEARNED DRAFT STYLES (optional structure/phrasing hints — never copy names, dates, numbers, or facts) ---\n` +
        `${capText(learnedStyleText, MAX_LEARNED_CHARS)}\n` +
        `--- END LEARNED DRAFT STYLES ---\n\n`;
    }

    if (templateContent) {
      finalPromptText += exactCopy
        ? `--- SOURCE TEMPLATE TEXT TO COPY EXACTLY ---\n${capText(templateContent, MAX_TEMPLATE_CHARS)}\n--- END SOURCE TEMPLATE ---\n\n`
        : `--- FORMAT TEMPLATE TO CLONE (BLANK FORM ONLY — IGNORE EVERY NAME/DATE/NUMBER/FACT IN THE SAMPLE) ---\n${capText(templateContent, MAX_TEMPLATE_CHARS)}\n--- END FORMAT TEMPLATE ---\n\n`;
    }

    if (exactCopy && isGenerateDocument) {
      finalPromptText += `
TASK: Put the uploaded file into the document editor AS IT IS.
FOLLOW THE USER COMMAND FIRST.
INSTRUCTIONS:
1. Reproduce the uploaded file (the transcript above, or the attached file) line by line. Keep every heading, numbered point, sentence, name, date, and number.
2. Do NOT summarize, paraphrase, skip, merge, or rewrite. Do not make a "better" draft.
3. Do not blank names/dates and do not treat this upload as a different past case.
4. Apply editor tags only to match visible alignment:
   - [CENTER] for court name / main titles / PRAYER / VERIFICATION
   - [RIGHT] for signatures, place, date
   - [ROW] for same-line left|right pairs
   - **bold** and [U]underline[/U] where the source is bold/underlined
   - Body paragraphs stay plain (justify is automatic)
5. Output ONLY the document. No "here is a summary" and no extra commentary.

USER REQUEST: ${prompt}
      `;
    } else if (exactCopy) {
      finalPromptText += `
TASK: Give the EXACT points / full text from the uploaded file(s).
FOLLOW THE USER COMMAND FIRST.
RULES:
- Do NOT summarize, paraphrase, or give "key points".
- List every heading, number, and sentence in the same order as the file.
- Keep original wording. If something is unreadable, write [unclear].
- Do NOT use document formatting tags such as [ROW], [CENTER], [RIGHT], HTML, or code fences.
- You may use **bold** only if the source is bold.

USER REQUEST: ${prompt}`;
    } else if (isGenerateDocument && isJudge && !hasNewFormat) {
      finalPromptText += JUDGE_DRAFT_TASK(prompt);
    } else if (isGenerateDocument) {
      finalPromptText += `
TASK: Draft this advocate's CURRENT case in the EXACT format of their uploaded past-case document / template.
INSTRUCTIONS:
1. FACTS SOURCE (ONLY): All names, dates, places, FIR/case numbers, amounts, parties, allegations, and story must come ONLY from CURRENT case files, current-case evidence notes, conversation history, and the user request. Never invent facts. Format files / format skeleton / templates are NEVER a facts source.
2. FORMAT CLONE RULE: If a format skeleton or template is provided, clone LAYOUT only: same heading titles and order, same numbering style, same court-title / memo / facts / grounds / prayer / verification pattern, same language register, and same alignment. Follow the blank skeleton line-by-line. Do not add extra sections and do not drop sections. Carry the skeleton's STYLE and ALIGN into the editor tags: STYLE=bold -> **text**, STYLE=underline -> [U]text[/U], STYLE=bold+underline -> **[U]text[/U]**, ALIGN=center -> [CENTER]...[/CENTER], ALIGN=right -> [RIGHT]...[/RIGHT], ALIGN=row -> [ROW]. Keep structural connecting phrases (e.g. "यह कि", "प्रार्थना", "सत्यापन") but not any fact attached to them in the old case.
3. NO MIXING RULE (CRITICAL): The uploaded format is a DIFFERENT past case. NEVER combine that old case with the current case. Do not copy, merge, or "fill from the format" any party names, parentage, addresses, dates, case/FIR numbers, police station, amounts, vehicles, allegations, incident story, or prayer-specific facts. If a heading exists in the format but this current case has no matching fact, leave ________. Two separate matters — layout from format, facts from current case only.
4. SELF-CHECK: Before finishing, confirm no name/date/number that appears only in the format file appears in the output.
5. MISSING DETAILS: If date (दिनांक), place (स्थान), or identification numbers are not in the case files/prompt, leave them blank with underscores. Do not invent and do not write instructions like "yahan date dale".
6. FORMATTING RULES (CRITICAL):
   - Body paragraphs (facts, pleadings, narrative text) MUST be left as plain lines without alignment tags. The system applies full JUSTIFY alignment so both left and right edges line up evenly.
   - You MUST use [CENTER]text[/CENTER] for Court Names, Main Titles, "PRAYER", and "VERIFICATION".
   - You MUST use [RIGHT]text[/RIGHT] for Signatures, Dates, Place, or any text that should be right-aligned.
   - Do NOT wrap normal body paragraphs in [CENTER] or [RIGHT].
   - For elements that must appear on the EXACT SAME LINE (e.g., Date/Place on the left and Signature/Name on the right), you MUST use the format: 
     [ROW]
     स्थान:- ________
     दिनांक:- ________
     |
     वादीगण / हस्ताक्षर
     [/ROW]
   - The system will automatically convert [ROW] into a strict flexbox container (\`display: flex; justify-content: space-between;\`) to prevent line breaks.
   - You MUST use **text** for bolding important terms, names, and headings.
   - You MUST use [U]text[/U] for underlining text.
   - Combine them if needed, e.g., [CENTER]**[U]HEADING[/U]**[/CENTER].
7. Output ONLY the complete document, using the tags above so the editor and PDF keep court layout (centered titles, justified body, right-aligned signature, same-line rows).
8. Do NOT write a summary, analysis, key points, or commentary inside the document. If a fact is missing, leave ________ inside the document. Do not ask the advocate anything inside the document. The <<<FOLLOWUPS>>> block comes only after the document is finished.
9. Ensure the output is professional, legally sound, and ready for review.
10. Write a summary ONLY if the user explicitly asked for a summary. In that case output only the summary in plain paragraphs, with no document tags and no questions.

USER REQUEST: ${prompt}
      `;
    } else {
      const hasCaseMaterial = !!(allEvidence || caseFiles.length || formatFiles.length);
      const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      const wantsAnalysis = /analy[sz]|summary|key facts|parties|dates|missing|inconsisten|next steps|विश्लेष|सारांश|पक्षकार|तथ्य/.test(prompt);
      finalPromptText += `
Today is ${today}.${hasCaseMaterial ? ' Study the papers and chat above properly before answering.' : ''}

${hasCaseMaterial && wantsAnalysis ? ANALYSIS_STRUCTURE_RULES : ''}

${prompt}`;
      if (caseFiles.length > 0) {
        finalPromptText += `\n\nNote: ${caseFiles.length} case files were uploaded and analyzed in batches. Use the persisted evidence notes above covering all of them.`;
      }
    }

    if (isJudge && isGenerateDocument && !exactCopy && hasNewFormat) {
      finalPromptText += JUDGE_FORMAT_NOTE;
    }

    if (language !== 'English' && !exactCopy) {
      finalPromptText += `\n\nIMPORTANT: Write the entire response in ${language}, using that language's own script. Do not switch to Hindi or English unless the advocate wrote in that language.`;
    } else if (exactCopy) {
      finalPromptText += `\n\nIMPORTANT: Keep the uploaded file's original language. Do not translate. Do not summarize.`;
    }

    finalPromptText += `\n\nAfter the answer is completely finished, write this marker on its own line:\n<<<FOLLOWUPS>>>\nThen write exactly 3 short follow-up questions about this same matter, one per line. Do not number them. Write them in ${language}. Do not put the marker or those questions inside the court draft or the copied text.`;

    currentParts.push({ text: finalPromptText });
    return currentParts;
  };

  const chatSystem = exactCopy
    ? 'You are casemate. The advocate wants the EXACT uploaded wording. Follow their command. Never summarize, paraphrase, or drop points. Never invent facts.'
    : 'You are casemate, a brilliant, experienced Indian lawyer talking to the person in front of you. Think the problem through yourself, look up current rules and the other side\'s own policies, and give the answer and advice you would give if this were your own client. Be accurate, never invent facts, figures or links, and write naturally. Do not use [ROW], [CENTER], [RIGHT], HTML, tables or code fences.';
  const docSystem = exactCopy
    ? 'You are casemate. The advocate wants the uploaded file placed in the document editor AS IT IS. Follow their command. Transcribe every line. Do not summarize, rewrite, or blank names and dates.'
    : hasNewFormat
    ? 'You are casemate, an expert legal drafter. Output only the complete formatted document. Do not write a summary or analysis inside the document. After it, add <<<FOLLOWUPS>>>. A format file is only a blank form from a DIFFERENT past case. Clone its layout (headings, order, numbering, alignment, prayer/verification). NEVER copy or mix that old case\'s names, dates, numbers, addresses, allegations, or story into the new draft. Fill ONLY from current case files / evidence notes / chat. If a layout field has no current-case fact, leave ________. Do not combine the two matters.'
    : 'You are casemate, an expert legal assistant and drafter. Output only a complete court-formatted document using [CENTER], [RIGHT], [ROW], **bold**, and [U] tags. Never reply with a summary or analysis inside the draft. After the draft, add <<<FOLLOWUPS>>>. Missing facts stay as ________ inside the draft. You improve by following learned draft styles and this advocate\'s past heading/numbering patterns, but NEVER copy names, dates, numbers, or facts from learned styles or format samples. When the advocate uploads a past-case format plus current case files, you MUST draft the new document by cloning that format (headings, order, numbering, legal style, prayer/verification pattern) and filling it only with facts from the current case files / evidence notes / chat. NEVER mix names, dates, numbers, or facts from the format into the new draft. If a format field has no matching current-case fact, leave ________. Leave missing fields blank with underscores.';

  const isAdviceChat = !isGenerateDocument && !exactCopy;

  const judgeDocSystem = hasNewFormat ? JUDGE_DOC_SYSTEM_FORMAT : JUDGE_DOC_SYSTEM;
  const useJudgeDoc = isJudge && isGenerateDocument && !exactCopy;

  try {
    if (signal?.aborted) throw userAbortError();
    let currentParts = await buildParts(true);
    let response: { text: string; sources?: { title: string; uri: string }[] };
    try {
      response = await generateWithRetry({
        model: MODEL,
        contents: currentParts,
        config: {
          systemInstruction: useJudgeDoc ? judgeDocSystem : (isGenerateDocument ? docSystem : chatSystem),
          ...(exactCopy ? { temperature: 0.1 } : {}),
          ...(exactCopy ? TRANSCRIBE_THINKING : isGenerateDocument ? DRAFT_THINKING : ADVICE_THINKING),
          // Live web search roughly doubles the wait (23s -> 47s on 3 photos). Skip it on turns that carry uploads so those answers arrive in time.
          ...(isAdviceChat && caseFiles.length === 0 && formatFiles.length === 0 ? WEB_SEARCH : {}),
        },
        workKind: isGenerateDocument ? 'draft' : 'analysis',
      }, 2, signal, DRAFT_CALL_TIMEOUT_MS);
    } catch (first) {
      if (isUserAbortError(first)) throw first;
      // Dropping the raw format files only helps when they were sent; otherwise a second slow try just doubles the wait.
      const sentRawFormat = formatFiles.length > 0 && !formatSkeleton && !exactCopy;
      if (isTimeoutError(first) && !sentRawFormat) throw first;
      // Retry once with text-only (no format images) — common after large photo analysis
      currentParts = await buildParts(false);
      response = await generateWithRetry({
        model: MODEL,
        contents: currentParts,
        config: {
          ...(exactCopy ? { temperature: 0.1 } : {}),
          systemInstruction: useJudgeDoc
            ? judgeDocSystem
            : exactCopy
            ? (isGenerateDocument
              ? 'You are casemate. Place the uploaded file in the editor AS IT IS. Transcribe every line. Do not summarize.'
              : chatSystem)
            : isGenerateDocument
            ? (hasNewFormat
              ? 'You are casemate, an expert legal drafter. Output only the complete formatted document. Do not write a summary or analysis inside the document. After it, add <<<FOLLOWUPS>>>. Clone the blank FORMAT SKELETON / template layout only. Use CURRENT case evidence notes for facts only. Never use format-case facts. Never invent facts. Leave missing fields as ________. Do not combine the two matters.'
              : 'You are casemate, an expert legal assistant and drafter. Output only the complete formatted document. Do not write a summary or analysis inside the document. After it, add <<<FOLLOWUPS>>>. Use persisted evidence notes and the user request. Clone format from any template text. Never invent facts. Leave missing fields as ________.')
            : chatSystem,
          ...(exactCopy ? TRANSCRIBE_THINKING : isGenerateDocument ? DRAFT_THINKING : ADVICE_THINKING),
        },
        workKind: isGenerateDocument ? 'draft' : 'analysis',
      }, 1, signal, DRAFT_CALL_TIMEOUT_MS);
      void first;
    }

    const raw = response.text || 'No response generated.';
    const split = splitFollowUps(raw);
    const questions = split.questions.length >= 2
      ? split.questions
      : fallbackFollowUps(prompt, isGenerateDocument, language);
    let answer = isGenerateDocument ? split.text : cleanChatReply(split.text);
    if (isAdviceChat && response.sources?.length) {
      answer += `\n\n**Sources**\n${response.sources.map((s) => `- ${s.title} ${s.uri}`).join('\n')}`;
    }
    return {
      text: answer,
      evidenceNotes: newEvidence || undefined,
      suggestedQuestions: questions,
      notices: notices.length ? notices : undefined,
    };
  } catch (error: any) {
    if (isUserAbortError(error)) throw error;
    console.error('Error calling Gemini:', error);
    return {
      text: friendlyApiError(error, language, photosAnalyzed),
      evidenceNotes: newEvidence || undefined,
    };
  }
};
