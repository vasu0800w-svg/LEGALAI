import { Message, Attachment, CaseLearning } from '../types';
import {
  fileToBase64,
  resolveMimeTypeFromName,
  fetchAttachmentAsFile,
} from './chatMediaService';
import { getDeviceId } from '../utils/deviceId';

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
const MAX_FORMAT_SKELETON_CHARS = 9000;

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
  return out.trim();
};

const errText = (error: any) =>
  String(error?.message || error?.status || error || '');

const isRetryable = (error: any) => {
  if (isUserAbortError(error)) return false;
  // Fair-use / device limits are decisions, not hiccups — retrying cannot help.
  if (passThroughError(error)) return false;
  const t = errText(error);
  const code = Number(error?.status || error?.code || error?.httpStatusCode || 0);
  return (
    code === 429 ||
    code === 500 ||
    code === 503 ||
    /429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|quota|timeout|Deadline|fetch/i.test(t)
  );
};

const friendlyApiError = (error: any, language: string, photosAnalyzed: boolean) => {
  const passThrough = passThroughError(error);
  if (passThrough) return passThrough;
  const raw = errText(error);
  const hi = language === 'Hindi';
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
  if (/timeout|network|Failed to fetch|UNAVAILABLE/i.test(raw)) {
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
  if (code === 'FAIR_USE_REQUESTS' || code === 'FAIR_USE_IMAGES' || code === 'DEVICE_LIMIT') {
    return String(error?.message || '');
  }
  return null;
};

const getAuthHeader = async (): Promise<Record<string, string>> => {
  try {
    const { auth } = await import('./firebaseService');
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

const generateViaBackend = async (
  args: { model: string; contents: any; config?: any },
  signal?: AbortSignal,
  timeoutMs = 90000
): Promise<{ text: string }> => {
  if (signal?.aborted) throw userAbortError();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(geminiBackendUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        ...(await getAuthHeader()),
      },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw userAbortError();
    throw e;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data?.message || data?.error || `Gemini ${res.status}`);
    err.status = res.status;
    err.code = data?.error || '';
    throw err;
  }
  return { text: data?.text || '' };
};

const FAST_CONFIG = { thinkingConfig: { thinkingBudget: 0 } };
const ANALYZE_THINKING = { thinkingConfig: { thinkingBudget: 2048 } };
const LAYOUT_THINKING = { thinkingConfig: { thinkingBudget: 1024 } };
const DRAFT_THINKING = { thinkingConfig: { thinkingBudget: 8192 } };
const CHAT_THINKING = { thinkingConfig: { thinkingBudget: 1024 } };

const generateWithRetry = async (
  args: { model: string; contents: any; config?: any },
  tries = 2,
  signal?: AbortSignal,
  timeoutMs = 90000
): Promise<{ text: string }> => {
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
      await sleep(600 * (i + 1), signal);
    }
  }
  if (signal?.aborted) throw userAbortError();
  // No client-side Gemini fallback on purpose: the API key must never ship
  // inside the web bundle or the Play Store APK.
  throw last;
};

const pushFileParts = async (parts: any[], files: File[], label: string) => {
  const encoded = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: resolveMimeTypeFromName(file),
      data: await fileToBase64(file),
    }))
  );
  for (const file of encoded) {
    parts.push({ text: `\n[${label}: ${file.name}]\n` });
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

const askedToSummarize = (prompt: string) =>
  /summar(y|ise|ize)|key points only|brief|short note|सारांश|संक्षेप/.test(String(prompt || ''));

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
  if (wantsExactSourceCopy(prompt)) return true;
  const uploaded = [...caseFiles, ...formatFiles];
  const onlyDocs = uploaded.length > 0 && uploaded.every(isDocLikeFile);
  const mixing = caseFiles.length > 0 && (formatFiles.length > 0 || !!templateContent);
  if (isGenerateDocument && onlyDocs && !mixing) return true;
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
        `For EACH file: list filename, then extract all readable text, names, dates, places, amounts, case numbers, FIR details, parties, and factual points.\n` +
        `If an image is unclear, say so. Do NOT invent facts. Be concise but complete.\n` +
        (language !== 'English' ? `Respond in ${language}.\n` : ''),
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
      ...ANALYZE_THINKING,
    },
  }, 2, signal, 60000);

  return (response.text || '').trim();
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

  const totalBatches = Math.ceil(caseFiles.length / BATCH_SIZE);
  const runBatch = async (b: number): Promise<string> => {
    if (signal?.aborted) throw userAbortError();
    onProgress?.({ phase: 'analyzing', batch: b + 1, totalBatches });
    const slice = caseFiles.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    try {
      const notes = await analyzeFileBatch(slice, b + 1, totalBatches, language, signal, verbatim);
      return `### Batch ${b + 1}/${totalBatches}\n${notes}`;
    } catch (e) {
      if (isUserAbortError(e)) throw e;
      console.warn('Batch analyze skipped', b + 1, e);
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

  return sections.filter(Boolean).join('\n\n');
};

/** Read a newly uploaded format and extract a line-by-line clone skeleton (no facts). */
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
  }, 2, signal, 45000);
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
  signal?: AbortSignal
): Promise<{ text: string; evidenceNotes?: string }> => {
  if (!hasGemini()) {
    return {
      text:
        language === 'Hindi'
          ? 'त्रुटि: जेमिनी API की (Gemini API Key) .env फाइल में गायब है!'
          : 'Error: Gemini API Key is missing in the .env file!',
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
  } else {
    try {
      if (caseFiles.length > 0) {
        newEvidence = await analyzeCaseFilesInBatches(caseFiles, language, onProgress, signal, false);
      }
    } catch (e) {
      if (isUserAbortError(e)) throw e;
      console.warn('Full analyze failed', e);
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

    if (learnedStyleText && isGenerateDocument && !hasNewFormat && !exactCopy) {
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
1. Transcribe the uploaded PDF/file line by line. Keep every heading, numbered point, sentence, name, date, and number.
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
    } else if (isGenerateDocument) {
      finalPromptText += `
TASK: Draft this advocate's CURRENT case in the EXACT format of their uploaded past-case document / template.
INSTRUCTIONS:
1. FACTS SOURCE (ONLY): All names, dates, places, FIR/case numbers, amounts, parties, allegations, and story must come ONLY from CURRENT case files, current-case evidence notes, conversation history, and the user request. Never invent facts. Format files / format skeleton / templates are NEVER a facts source.
2. FORMAT CLONE RULE: If a format skeleton or template is provided, clone LAYOUT only: same heading titles and order, same numbering style, same court-title / memo / facts / grounds / prayer / verification pattern, same language register, and same alignment. Follow the blank skeleton line-by-line. Do not add extra sections and do not drop sections. Keep structural connecting phrases (e.g. "यह कि", "प्रार्थना", "सत्यापन") but not any fact attached to them in the old case.
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
7. Output ONLY the document content. Do not include conversational filler like "Here is the document".
8. Ensure the output is professional, legally sound, and ready for review.

USER REQUEST: ${prompt}
      `;
    } else {
      finalPromptText += `
TASK: Reply as a helpful legal assistant in plain conversational language.
RULES:
- Do NOT use document formatting tags such as [ROW], [/ROW], [CENTER], [RIGHT], [LEFT], [JUSTIFY], [U], [LOGO], HTML, CSS, markdown headings (###), horizontal rules (---), or code fences.
- Do NOT output programming markup unless the user explicitly asked for code.
- Write normal paragraphs. You may use **bold** for emphasis only.
- Be concise, professional, and legally useful.

USER REQUEST: ${prompt}`;
      if (caseFiles.length > 0) {
        finalPromptText += `\n\nNote: ${caseFiles.length} case files were uploaded and analyzed in batches. Use the persisted evidence notes above covering all of them.`;
      }
    }

    if (language !== 'English' && !exactCopy) {
      finalPromptText += `\n\nIMPORTANT: Please provide your entire response in ${language}.`;
    } else if (exactCopy) {
      finalPromptText += `\n\nIMPORTANT: Keep the uploaded file's original language. Do not translate. Do not summarize.`;
    }

    currentParts.push({ text: finalPromptText });
    return currentParts;
  };

  const chatSystem = exactCopy
    ? 'You are casemate. The advocate wants the EXACT uploaded wording. Follow their command. Never summarize, paraphrase, or drop points. Never invent facts.'
    : 'You are casemate, an expert legal assistant. Answer in plain conversational text. Never use [ROW], [CENTER], [RIGHT], [LEFT], [JUSTIFY], [U], [LOGO], HTML, CSS, or code fences unless the user explicitly asked for code. Never invent facts.';
  const docSystem = exactCopy
    ? 'You are casemate. The advocate wants the uploaded file placed in the document editor AS IT IS. Follow their command. Transcribe every line. Do not summarize, rewrite, or blank names and dates.'
    : hasNewFormat
    ? 'You are casemate, an expert legal drafter. A format file is only a blank form from a DIFFERENT past case. Clone its layout (headings, order, numbering, alignment, prayer/verification). NEVER copy or mix that old case\'s names, dates, numbers, addresses, allegations, or story into the new draft. Fill ONLY from current case files / evidence notes / chat. If a layout field has no current-case fact, leave ________. Do not combine the two matters.'
    : 'You are casemate, an expert legal assistant and drafter. You improve by following learned draft styles and this advocate\'s past heading/numbering patterns, but NEVER copy names, dates, numbers, or facts from learned styles or format samples. When the advocate uploads a past-case format plus current case files, you MUST draft the new document by cloning that format (headings, order, numbering, legal style, prayer/verification pattern) and filling it only with facts from the current case files / evidence notes / chat. NEVER mix names, dates, numbers, or facts from the format into the new draft. If a format field has no matching current-case fact, leave ________. Leave missing fields blank with underscores.';

  try {
    if (signal?.aborted) throw userAbortError();
    let currentParts = await buildParts(true);
    let response: { text: string };
    try {
      response = await generateWithRetry({
        model: MODEL,
        contents: currentParts,
        config: {
          systemInstruction: isGenerateDocument ? docSystem : chatSystem,
          ...(exactCopy ? { temperature: 0.1 } : {}),
          ...(isGenerateDocument || exactCopy ? DRAFT_THINKING : CHAT_THINKING),
        },
      }, 2, signal, 90000);
    } catch (first) {
      if (isUserAbortError(first)) throw first;
      // Retry once with text-only (no format images) — common after large photo analysis
      currentParts = await buildParts(false);
      response = await generateWithRetry({
        model: MODEL,
        contents: currentParts,
        config: {
          ...(exactCopy ? { temperature: 0.1 } : {}),
          systemInstruction: exactCopy
            ? (isGenerateDocument
              ? 'You are casemate. Place the uploaded file in the editor AS IT IS. Transcribe every line. Do not summarize.'
              : chatSystem)
            : isGenerateDocument
            ? (hasNewFormat
              ? 'You are casemate, an expert legal drafter. Clone the blank FORMAT SKELETON / template layout only. Use CURRENT case evidence notes for facts only. Never use format-case facts. Never invent facts. Leave missing fields as ________. Do not combine the two matters.'
              : 'You are casemate, an expert legal assistant and drafter. Use persisted evidence notes and the user request. Clone format from any template text. Never invent facts. Leave missing fields as ________.')
            : chatSystem,
          ...(isGenerateDocument || exactCopy ? DRAFT_THINKING : CHAT_THINKING),
        },
      }, 1, signal, 60000);
      void first;
    }

    const raw = response.text || 'No response generated.';
    return {
      text: isGenerateDocument ? raw : cleanChatReply(raw),
      evidenceNotes: newEvidence || undefined,
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
