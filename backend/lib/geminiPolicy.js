/**
 * Only the model Casemate actually ships may be used. Client-supplied model
 * names, extra tools, and oversized payloads are ignored or rejected.
 */
export const ALLOWED_GEMINI_MODELS = Object.freeze(['gemini-3.8-flash']);
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const MAX_SYSTEM_INSTRUCTION_CHARS = 16000;
export const MAX_TEXT_PART_CHARS = 120000;
export const MAX_INLINE_PARTS = 24;
export const MAX_CONTENTS_BYTES = 12 * 1024 * 1024;

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const GIF = Buffer.from('GIF8', 'ascii');
const PDF = Buffer.from('%PDF', 'ascii');
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const sniffInline = (b64) => {
  let buf;
  try {
    buf = Buffer.from(String(b64 || '').slice(0, 48), 'base64');
  } catch {
    return null;
  }
  if (buf.length >= 3 && buf.subarray(0, 3).equals(JPEG)) return 'image/jpeg';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(PNG)) return 'image/png';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(GIF)) return 'image/gif';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(PDF)) return 'application/pdf';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(OLE)) return 'application/msword';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZIP)) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'image/heic';
  if (buf.toString('ascii').startsWith('{\\rtf')) return 'text/rtf';
  return null;
};

const asTextPart = (b64) => {
  let text = '';
  try {
    text = Buffer.from(String(b64 || ''), 'base64').toString('utf8');
  } catch {
    return null;
  }
  if (!text || text.length > MAX_TEXT_PART_CHARS) return null;
  const sample = text.slice(0, 800);
  const bad = (sample.match(/[^\t\r\n\x20-\x7E\u00A0-\uFFFF]/g) || []).length;
  if (bad > sample.length * 0.1) return null;
  return text;
};

export const resolveGeminiModel = (requested) => {
  const name = String(requested || '').trim();
  if (ALLOWED_GEMINI_MODELS.includes(name)) return name;
  return DEFAULT_GEMINI_MODEL;
};

const payloadBytes = (value) => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

export const sanitizeGeminiRequest = (body) => {
  const model = resolveGeminiModel(body?.model);
  if (body?.model && String(body.model).trim() && !ALLOWED_GEMINI_MODELS.includes(String(body.model).trim())) {
    return { ok: false, code: 'MODEL_NOT_ALLOWED', message: 'That AI model is not available.' };
  }

  const contents = body?.contents;
  if (!contents) {
    return { ok: false, code: 'MISSING_CONTENTS', message: 'contents is required.' };
  }
  if (payloadBytes(contents) > MAX_CONTENTS_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'This request is too large. Split the files and try again.' };
  }

  const list = Array.isArray(contents) ? contents : [contents];
  let inlineCount = 0;
  const cleaned = [];

  const takeInline = (data) => {
    inlineCount += 1;
    if (inlineCount > MAX_INLINE_PARTS) {
      return { error: { ok: false, code: 'TOO_MANY_FILES', message: 'Too many files in one request.' } };
    }
    const sniffed = sniffInline(data);
    if (sniffed) {
      return { part: { inlineData: { mimeType: sniffed, data: String(data) } } };
    }
    const text = asTextPart(data);
    if (text) return { part: { text } };
    return { error: { ok: false, code: 'UNSUPPORTED_FILE', message: 'That file type is not allowed.' } };
  };

  for (const item of list) {
    if (item && Array.isArray(item.parts)) {
      const parts = [];
      for (const part of item.parts) {
        const data = part?.inlineData?.data || part?.inline_data?.data;
        if (data) {
          const taken = takeInline(data);
          if (taken.error) return taken.error;
          parts.push(taken.part);
          continue;
        }
        const text = String(part?.text || item?.text || '').slice(0, MAX_TEXT_PART_CHARS);
        if (text) parts.push({ text });
      }
      if (parts.length) cleaned.push({ role: item.role === 'model' ? 'model' : 'user', parts });
      continue;
    }
    const data = item?.inlineData?.data || item?.inline_data?.data;
    if (data) {
      const taken = takeInline(data);
      if (taken.error) return taken.error;
      cleaned.push(taken.part);
      continue;
    }
    const text = typeof item === 'string' ? item : String(item?.text || '');
    if (text) cleaned.push({ text: text.slice(0, MAX_TEXT_PART_CHARS) });
  }

  if (!cleaned.length) {
    return { ok: false, code: 'MISSING_CONTENTS', message: 'contents is required.' };
  }

  const instructionRaw = body?.config?.systemInstruction;
  const instruction = typeof instructionRaw === 'string'
    ? instructionRaw
    : (instructionRaw?.text || '');
  const config = {};
  if (instruction) {
    config.systemInstruction = String(instruction).slice(0, MAX_SYSTEM_INSTRUCTION_CHARS);
  }
  if (typeof body?.config?.temperature === 'number') {
    const t = body.config.temperature;
    config.temperature = Math.min(1, Math.max(0, t));
  }
  if (body?.config?.responseMimeType === 'application/json') {
    config.responseMimeType = 'application/json';
  }
  if (Array.isArray(body?.config?.tools) && body.config.tools.some((t) => t && t.googleSearch)) {
    config.tools = [{ googleSearch: {} }];
  }
  const think = body?.config?.thinkingConfig;
  if (think && typeof think === 'object') {
    config.thinkingConfig = {
      ...(typeof think.thinkingBudget === 'number' ? { thinkingBudget: think.thinkingBudget } : {}),
      ...(think.thinkingLevel ? { thinkingLevel: String(think.thinkingLevel).slice(0, 16) } : {}),
    };
  }

  return { ok: true, model, contents: cleaned, config };
};
