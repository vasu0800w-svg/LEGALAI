/**
 * Gemini generateContent via the server key.
 *
 * The API key never leaves the server. Every call must carry a Firebase ID
 * token, and per-account fair use / device slots are enforced in usageGuard.
 * Concurrent users are not queued — each request hits Google in parallel.
 */
import { GoogleGenAI } from '@google/genai';
import { verifyRequestUser } from '../lib/authUser.js';
import { verifyAppCheckIfEnforced } from '../lib/firebaseAdmin.js';
import { reserveAiRequest, releaseAiRequest, reserveDraft, releaseDraft } from '../lib/usageGuard.js';
import { applyCors } from '../lib/httpSecurity.js';
import { parseDeviceId } from '../lib/devicePolicy.js';
import { sanitizeGeminiRequest, DEFAULT_GEMINI_MODEL } from '../lib/geminiPolicy.js';

const DEFAULT_MODEL = 'gemini-3.8-flash';
const UPSTREAM_TIMEOUT_MS = 80000;
/** Longest a client may ask the server to wait on Gemini (needs keep-alive bytes to survive the edge). */
const MAX_WAIT_MS = 170000;
/** Beyond this, bytes must keep flowing or Render's edge drops the connection at ~100s. */
const KEEPALIVE_ABOVE_MS = 70000;
const HEARTBEAT_MS = 10000;
/** A retry is only worth it when the first try failed fast (overload, reset). */
const RETRY_ONLY_IF_FASTER_THAN_MS = 20000;

const cors = (req, res) => applyCors(req, res, 'POST, OPTIONS');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getApiKey = () =>
  String(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();

/**
 * The official SDK, so the server works with either key format Google issues
 * (AI Studio "AIza..." keys and Vertex express "AQ..." keys).
 */
let client = null;
const getClient = () => {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
};

const errStatus = (err) =>
  Number(err?.status || err?.code || err?.response?.status || 0);

const isTimeoutError = (err) =>
  err?.name === 'TimeoutError'
  || errStatus(err) === 408
  || errStatus(err) === 504
  || /timed? ?out|deadline|aborted/i.test(String(err?.message || ''));

const isRetryableError = (err) => {
  if (isTimeoutError(err)) return false;
  const status = errStatus(err);
  if (status === 429 || status === 500 || status === 503) return true;
  return /overloaded|unavailable|timeout|deadline|ECONNRESET|fetch failed/i.test(
    String(err?.message || '')
  );
};

/** Normalise whatever the client sent into SDK parts. */
const toSdkParts = (item) => {
  if (!item || typeof item !== 'object') return { text: String(item || '') };
  if (item.inlineData?.data) {
    return {
      inlineData: {
        mimeType: item.inlineData.mimeType || 'image/jpeg',
        data: item.inlineData.data,
      },
    };
  }
  if (item.inline_data?.data) {
    return {
      inlineData: {
        mimeType: item.inline_data.mime_type || 'image/jpeg',
        data: item.inline_data.data,
      },
    };
  }
  return { text: item.text || '' };
};

/**
 * Gemini 3.7+ takes thinking *levels*; older Flash models take token budgets.
 * Clients send a budget, so translate when the target model wants a level.
 */
const budgetToLevel = (budget) => {
  const n = Number(budget);
  if (!Number.isFinite(n)) return 'medium';
  if (n < 0) return 'high';       // -1 = dynamic
  if (n === 0) return 'low';
  if (n <= 1024) return 'low';
  if (n <= 4096) return 'medium';
  return 'high';
};

const usesThinkingLevel = (model) => /gemini-3\.(7|8|9)|gemini-[4-9]/.test(String(model));

const toSdkContents = (contents) => {
  const list = Array.isArray(contents) ? contents : [contents];
  if (list.length > 0 && Array.isArray(list[0]?.parts)) return list;
  return [{ role: 'user', parts: list.map(toSdkParts) }];
};

const toSdkConfig = (config, model, waitMs = UPSTREAM_TIMEOUT_MS) => {
  const out = {};
  const instruction = config?.systemInstruction;
  if (instruction) {
    out.systemInstruction = typeof instruction === 'string'
      ? instruction
      : instruction.text || '';
  }
  if (typeof config?.temperature === 'number') out.temperature = config.temperature;

  // A JSON-only answer is used by the template filler; no other response options pass through.
  if (config?.responseMimeType === 'application/json') out.responseMimeType = 'application/json';

  // Only live web search is allowed through; clients cannot request other tools.
  if (Array.isArray(config?.tools) && config.tools.some((t) => t && t.googleSearch)) {
    out.tools = [{ googleSearch: {} }];
  }

  const think = config?.thinkingConfig;
  if (think && typeof think === 'object') {
    out.thinkingConfig = usesThinkingLevel(model)
      ? { thinkingLevel: think.thinkingLevel || budgetToLevel(think.thinkingBudget) }
      : think;
  }
  out.httpOptions = { timeout: waitMs };
  return out;
};

const extractText = (response) => {
  if (typeof response?.text === 'string') return response.text;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => p.text || '').join('');
};

/** Web pages Gemini actually used when search was on (deduped by site title). */
const extractSources = (response) => {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (!uri || !/^https?:\/\//i.test(uri)) continue;
    const title = String(c?.web?.title || '').slice(0, 80) || 'source';
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, uri });
    if (out.length >= 5) break;
  }
  return out;
};

export function geminiOptionsHandler(req, res) {
  cors(req, res);
  res.status(204).end();
}

export async function geminiHandler(req, res) {
  cors(req, res);

  const authUser = await verifyRequestUser(req);
  if (!authUser) {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Sign in required for AI requests.',
    });
  }
  if (!(await verifyAppCheckIfEnforced(req))) {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Sign in required for AI requests.',
    });
  }

  const deviceId = parseDeviceId(req.headers['x-device-id']);
  if (!deviceId) {
    return res.status(400).json({
      error: 'DEVICE_REQUIRED',
      message: 'This app install could not be verified. Please reopen Casemate and try again.',
    });
  }

  const ai = getClient();
  if (!ai) {
    return res.status(503).json({
      error: 'GEMINI_NOT_CONFIGURED',
      message: 'The assistant is temporarily unavailable.',
    });
  }

  const sanitized = sanitizeGeminiRequest(req.body);
  if (!sanitized.ok) {
    return res.status(400).json({ error: sanitized.code, message: sanitized.message });
  }
  const model = sanitized.model || DEFAULT_GEMINI_MODEL;
  const contents = sanitized.contents;

  let reserved = false;
  let reservedDraft = false;
  const workKind = String(req.headers['x-work-kind'] || req.body?.workKind || 'analysis').toLowerCase();
  const reservation = await reserveAiRequest({
    uid: authUser.uid,
    email: authUser.email,
    deviceId,
    contents,
  });
  if (!reservation.ok) {
    const status = reservation.code === 'USAGE_UNAVAILABLE'
      ? 503
      : reservation.code === 'DEVICE_REQUIRED'
        ? 400
        : reservation.code === 'DEVICE_LIMIT' || reservation.code === 'UPLOAD_PHOTO_LIMIT'
          ? 403
          : 429;
    return res.status(status).json({
      error: reservation.code,
      message: reservation.message,
    });
  }
  reserved = true;
  if (workKind === 'draft') {
    const draft = await reserveDraft({ uid: authUser.uid, email: authUser.email });
    if (!draft.ok) {
      await releaseAiRequest({ uid: authUser.uid, contents }).catch(() => {});
      const status = draft.code === 'USAGE_UNAVAILABLE' ? 503 : 429;
      return res.status(status).json({
        error: draft.code,
        message: draft.message,
      });
    }
    reservedDraft = true;
  }

  // A client that is willing to wait longer says so; short calls stay short so
  // the edge never cuts them off. Long calls send a space every few seconds,
  // which keeps the connection alive past Render's ~100s idle limit.
  const askedWait = Number(req.headers['x-max-wait-ms']);
  const waitMs = Number.isFinite(askedWait)
    ? Math.min(MAX_WAIT_MS, Math.max(10000, askedWait))
    : UPSTREAM_TIMEOUT_MS;
  const keepAlive = req.headers['x-keepalive'] === '1' && waitMs > KEEPALIVE_ABOVE_MS;
  let heartbeat = null;
  if (keepAlive) {
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!res.writableEnded) res.write(' '); }, HEARTBEAT_MS);
    res.on('close', () => clearInterval(heartbeat));
  }
  // Once the 200 header is out, an error has to travel inside the body.
  const reply = (status, payload) => {
    if (heartbeat) {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end(JSON.stringify(status === 200 ? payload : { ...payload, status }));
      return;
    }
    res.status(status).json(payload);
  };

  const request = {
    model,
    contents: toSdkContents(contents),
    config: toSdkConfig(sanitized.config, model, waitMs),
  };

  let lastStatus = 502;

  let timedOut = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await ai.models.generateContent(request);
      return reply(200, {
        text: extractText(response),
        sources: extractSources(response),
      });
    } catch (err) {
      lastStatus = errStatus(err) || 502;
      timedOut = isTimeoutError(err);
      const fastFailure = Date.now() - startedAt < RETRY_ONLY_IF_FASTER_THAN_MS;
      if (!isRetryableError(err) || attempt === 1 || !fastFailure) break;
      await sleep(500 * (attempt + 1));
    }
  }

  if (reserved && authUser) {
    await releaseAiRequest({ uid: authUser.uid, contents }).catch(() => {});
  }
  if (reservedDraft && authUser) {
    await releaseDraft({ uid: authUser.uid }).catch(() => {});
  }

  console.error('[gemini] upstream failed:', lastStatus);
  if (timedOut) {
    return reply(504, {
      error: 'GEMINI_TIMEOUT',
      message: 'The AI took too long on this request.',
    });
  }
  return reply(lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502, {
    error: 'GEMINI_FAILED',
    message: 'The assistant could not complete this request. Please try again.',
  });
}
