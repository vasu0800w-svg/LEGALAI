/**
 * Gemini generateContent via the server key.
 *
 * The API key never leaves the server. Every call must carry a Firebase ID
 * token, and per-account fair use / device slots are enforced in usageGuard.
 * Concurrent users are not queued — each request hits Google in parallel.
 */
import { GoogleGenAI } from '@google/genai';
import { verifyRequestUser } from '../lib/authUser.js';
import { reserveAiRequest, releaseAiRequest, reserveDraft, releaseDraft } from '../lib/usageGuard.js';

const DEFAULT_MODEL = 'gemini-3.8-flash';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id, X-Work-Kind');
};

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

const isRetryableError = (err) => {
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

const toSdkConfig = (config, model) => {
  const out = {};
  const instruction = config?.systemInstruction;
  if (instruction) {
    out.systemInstruction = typeof instruction === 'string'
      ? instruction
      : instruction.text || '';
  }
  if (typeof config?.temperature === 'number') out.temperature = config.temperature;

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
  out.httpOptions = { timeout: 90000 };
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
  cors(res);
  res.status(204).end();
}

export async function geminiHandler(req, res) {
  cors(res);

  const requireAuth = process.env.GEMINI_REQUIRE_AUTH !== '0';
  const authUser = await verifyRequestUser(req);
  if (requireAuth && !authUser) {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Sign in required for AI requests.',
    });
  }

  const ai = getClient();
  if (!ai) {
    return res.status(503).json({
      error: 'GEMINI_NOT_CONFIGURED',
      message: 'Gemini API key is not configured on the server.',
    });
  }

  const model = String(req.body?.model || DEFAULT_MODEL).slice(0, 80);
  const contents = req.body?.contents;
  if (!contents) {
    return res.status(400).json({ error: 'MISSING_CONTENTS', message: 'contents is required.' });
  }

  let reserved = false;
  let reservedDraft = false;
  const workKind = String(req.headers['x-work-kind'] || req.body?.workKind || 'analysis').toLowerCase();
  if (authUser) {
    const reservation = await reserveAiRequest({
      uid: authUser.uid,
      email: authUser.email,
      deviceId: String(req.headers['x-device-id'] || '').slice(0, 64) || null,
      contents,
    });
    if (!reservation.ok) {
      const status = reservation.code === 'DEVICE_LIMIT' || reservation.code === 'UPLOAD_PHOTO_LIMIT' ? 403 : 429;
      return res.status(status).json({
        error: reservation.code,
        message: reservation.message,
      });
    }
    reserved = !reservation.skipped;
    if (workKind === 'draft') {
      const draft = await reserveDraft({ uid: authUser.uid, email: authUser.email });
      if (!draft.ok) {
        if (reserved) await releaseAiRequest({ uid: authUser.uid, contents }).catch(() => {});
        return res.status(429).json({
          error: draft.code,
          message: draft.message,
        });
      }
      reservedDraft = !draft.skipped;
    }
  }

  const request = {
    model,
    contents: toSdkContents(contents),
    config: toSdkConfig(req.body?.config, model),
  };

  let lastStatus = 502;
  let lastMessage = 'Gemini request failed';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent(request);
      return res.status(200).json({
        text: extractText(response),
        sources: extractSources(response),
      });
    } catch (err) {
      lastStatus = errStatus(err) || 502;
      lastMessage = String(err?.message || 'Gemini request failed');
      if (!isRetryableError(err) || attempt === 1) break;
      await sleep(500 * (attempt + 1));
    }
  }

  if (reserved && authUser) {
    await releaseAiRequest({ uid: authUser.uid, contents }).catch(() => {});
  }
  if (reservedDraft && authUser) {
    await releaseDraft({ uid: authUser.uid }).catch(() => {});
  }

  console.error('[gemini] upstream failed:', lastStatus, String(lastMessage).slice(0, 180));
  return res.status(lastStatus >= 400 ? lastStatus : 502).json({
    error: 'GEMINI_FAILED',
    message: lastMessage.slice(0, 180),
  });
}
