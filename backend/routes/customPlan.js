/**
 * Public custom-plan catalog + quote. Checkout still goes through Razorpay
 * create-order, which re-quotes on the server and locks the price on the order.
 */
import { adminReady, getDb } from '../lib/firebaseAdmin.js';
import {
  DEFAULT_CUSTOM_PRICING,
  sanitizeCustomPricing,
  defaultCustomSelection,
  quoteCustomPlan,
  publicQuote,
} from '../lib/customPlan.js';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

export function customPlanOptionsHandler(_req, res) {
  cors(res);
  res.status(204).end();
}

export async function loadCustomPricing() {
  if (!adminReady()) return sanitizeCustomPricing(DEFAULT_CUSTOM_PRICING);
  try {
    const snap = await getDb().collection('app_config').doc('plans').get();
    const data = snap.exists ? snap.data() || {} : {};
    return sanitizeCustomPricing(data.customPlanPricing);
  } catch (err) {
    console.warn('[customPlan] pricing load failed:', err?.message || err);
    return sanitizeCustomPricing(DEFAULT_CUSTOM_PRICING);
  }
}

export async function customPlanCatalogHandler(_req, res) {
  cors(res);
  try {
    const pricing = await loadCustomPricing();
    const selection = defaultCustomSelection(pricing);
    const quote = quoteCustomPlan(selection, pricing);
    return res.json({
      ok: true,
      pricing,
      defaultSelection: selection,
      notes: {
        photoUpload: 'Selected value is the total photos allowed in one upload, in blocks of 10. It is not additional to another plan.',
        photoChat: 'Optional flat monthly feature. Not priced per photo. The chat total cannot be lower than photos per upload.',
        characters: 'Total characters per chat. Only extra 5,000-character blocks above the included base are charged. Counted as message text; image bytes are not characters.',
        drafts: 'Total completed drafts per month. A draft counts only after a successful generate. Failed or duplicate requests do not keep a draft.',
        devices: 'Total registered devices. The first is included. Each extra device is billed. Devices are random per-install ids, not hardware fingerprints.',
        billing: 'Prepaid 30 days. Casemate does not auto-renew. Refunds follow the refund policy.',
        tax: pricing.taxPercent > 0
          ? `A configured ${pricing.taxPercent}% tax is included in the quoted total.`
          : 'No extra tax is added unless a tax percent is configured on the catalog.',
      },
      sampleQuote: publicQuote(quote),
    });
  } catch (err) {
    console.error('[customPlan] catalog error', err);
    return res.status(500).json({ error: 'CATALOG_FAILED', message: 'Could not load custom-plan pricing.' });
  }
}

export async function customPlanQuoteHandler(req, res) {
  cors(res);
  try {
    const pricing = await loadCustomPricing();
    const quote = quoteCustomPlan(req.body?.selection || req.body, pricing);
    if (!quote.ok) {
      return res.status(400).json({
        error: 'INVALID_SELECTION',
        message: quote.errors[0] || 'That combination cannot be quoted.',
        ...publicQuote(quote),
      });
    }
    return res.json(publicQuote(quote));
  } catch (err) {
    console.error('[customPlan] quote error', err);
    return res.status(500).json({ error: 'QUOTE_FAILED', message: 'Could not price that custom plan.' });
  }
}
