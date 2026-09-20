/**
 * Gemini generateContent via the server key.
 *
 * The API key never leaves the server. Every call must carry a Firebase ID
 * token, and per-account fair use / device slots are enforced in usageGuard.
 * Concurrent users are not queued — each request hits Google in parallel.
 */
import { verifyRequestUser } from '../lib/authUser.js';
import { reserveAiRequest } from '../lib/usageGuard.js';

const DEFAULT_MODEL = 'gemini-3.8-flash';

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getApiKey = () =>
  String(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();

const isRetryableStatus = (status) =>
  status === 429 || status === 500 || status === 503;

const toRestParts = (item) => {
  if (!item || typeof item !== 'object') return { text: String(item || '') };
  if (item.inlineData?.data) {
    return {
      inline_data: {
        mime_type: item.inlineData.mimeType || 'image/jpeg',
        data: item.inlineData.data,
      },
    };
  }
  if (item.inline_data?.data) return item;
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

const toRestBody = (contents, config, model) => {
  const list = Array.isArray(contents) ? contents : [contents];
  const alreadyRest = list.length > 0 && Array.isArray(list[0]?.parts);
  const restContents = alreadyRest
    ? list
    : [{ role: 'user', parts: list.map(toRestParts) }];

  const body = { contents: restContents };
  const instruction = config?.systemInstruction;
  if (instruction) {
    body.system_instruction = {
      parts: [{ text: typeof instruction === 'string' ? instruction : instruction.text || '' }],
    };
  }
  if (typeof config?.temperature === 'number') {
    body.generationConfig = { ...(body.generationConfig || {}), temperature: config.temperature };
  }
  const think = config?.thinkingConfig;
  if (think && typeof think === 'object') {
    const thinkingConfig = usesThinkingLevel(model)
      ? { thinkingLevel: think.thinkingLevel || budgetToLevel(think.thinkingBudget) }
      : think;
    body.generationConfig = { ...(body.generationConfig || {}), thinkingConfig };
  }
  return body;
};

const extractText = (data) => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => p.text || '').join('');
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

  const apiKey = getApiKey();
  if (!apiKey) {
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

  if (authUser) {
    const reservation = await reserveAiRequest({
      uid: authUser.uid,
      email: authUser.email,
      deviceId: String(req.headers['x-device-id'] || '').slice(0, 64) || null,
      contents,
    });
    if (!reservation.ok) {
      const status = reservation.code === 'DEVICE_LIMIT' ? 403 : 429;
      return res.status(status).json({
        error: reservation.code,
        message: reservation.message,
      });
    }
  }

  const payload = toRestBody(contents, req.body?.config, model);
  let lastStatus = 500;
  let lastBody = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await fetch(`${GEMINI_URL(model)}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000),
      });
      lastStatus = upstream.status;
      lastBody = await upstream.text();

      if (upstream.ok) {
        let data = {};
        try {
          data = JSON.parse(lastBody);
        } catch {
          return res.status(502).json({ error: 'BAD_UPSTREAM', message: 'Gemini returned invalid JSON.' });
        }
        return res.status(200).json({ text: extractText(data) });
      }

      if (!isRetryableStatus(upstream.status) || attempt === 1) break;
      await sleep(500 * (attempt + 1));
    } catch (err) {
      lastBody = err?.name === 'TimeoutError' ? 'Gemini request timed out' : (err?.message || 'Network error');
      if (attempt === 1) break;
      await sleep(500 * (attempt + 1));
    }
  }

  return res.status(lastStatus >= 400 ? lastStatus : 502).json({
    error: 'GEMINI_FAILED',
    message: lastBody.slice(0, 180),
  });
}
