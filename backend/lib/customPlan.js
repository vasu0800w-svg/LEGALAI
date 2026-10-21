/**
 * Custom-plan pricing. One function quotes every combination. The client may
 * display the quote; it must not submit a total of its own.
 *
 * Interpretations (used everywhere: UI copy, quote, grant):
 * - photoUpload: TOTAL photos allowed in one upload, in blocks of 10.
 *   Included blocks: 0. 10 → ₹350, 20 → ₹700.
 * - photoChat: optional FLAT ₹50/month to set a total-photos-per-chat cap.
 *   Quantity is not priced per photo. Cap must be ≥ photos-per-upload.
 * - characters: TOTAL characters per chat. Charge only blocks above `included`
 *   (Free session cap). Image bytes are not characters.
 * - drafts: TOTAL completed drafts per month (successful generate-document).
 *   Included in this calculator: 0, so 5 → ₹29.
 * - devices: TOTAL registered devices. First included; each extra is priced.
 */

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const snapUp = (value, step, min, max) => {
  const raw = Math.round(Number(value));
  const base = Number.isFinite(raw) ? raw : min;
  const snapped = Math.ceil(Math.max(min, base) / step) * step;
  return Math.min(max, Math.max(min, snapped));
};

export const DEFAULT_CUSTOM_PRICING = {
  photoUpload: { blockSize: 10, pricePerBlock: 350, included: 0, min: 10, max: 200 },
  photoChat: { price: 50, included: 18, min: 18, max: 500, step: 10 },
  characters: { blockSize: 5000, pricePerBlock: 249, included: 20000, min: 20000, max: 200000 },
  drafts: { blockSize: 5, pricePerBlock: 29, included: 0, min: 5, max: 500 },
  devices: { included: 1, priceEach: 199, min: 1, max: 10 },
  taxPercent: 0,
};

export const defaultCustomSelection = (pricing = DEFAULT_CUSTOM_PRICING) => ({
  photoUpload: Math.min(
    pricing.photoUpload.max,
    Math.max(pricing.photoUpload.min, pricing.photoUpload.blockSize * 2)
  ),
  photoChatEnabled: false,
  photoChat: Math.max(pricing.photoChat.min, pricing.photoUpload.blockSize * 2),
  characters: pricing.characters.included,
  drafts: pricing.drafts.min,
  devices: pricing.devices.included,
});

export const sanitizeCustomPricing = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const pu = src.photoUpload && typeof src.photoUpload === 'object' ? src.photoUpload : {};
  const pc = src.photoChat && typeof src.photoChat === 'object' ? src.photoChat : {};
  const ch = src.characters && typeof src.characters === 'object' ? src.characters : {};
  const dr = src.drafts && typeof src.drafts === 'object' ? src.drafts : {};
  const dv = src.devices && typeof src.devices === 'object' ? src.devices : {};
  const d = DEFAULT_CUSTOM_PRICING;
  return {
    photoUpload: {
      blockSize: clampInt(pu.blockSize, 1, 50, d.photoUpload.blockSize),
      pricePerBlock: clampInt(pu.pricePerBlock, 0, 100000, d.photoUpload.pricePerBlock),
      included: clampInt(pu.included, 0, 200, d.photoUpload.included),
      min: clampInt(pu.min, 0, 200, d.photoUpload.min),
      max: clampInt(pu.max, 10, 500, d.photoUpload.max),
    },
    photoChat: {
      price: clampInt(pc.price, 0, 100000, d.photoChat.price),
      included: clampInt(pc.included, 1, 500, d.photoChat.included),
      min: clampInt(pc.min, 1, 500, d.photoChat.min),
      max: clampInt(pc.max, 10, 2000, d.photoChat.max),
      step: clampInt(pc.step, 1, 50, d.photoChat.step),
    },
    characters: {
      blockSize: clampInt(ch.blockSize, 1000, 50000, d.characters.blockSize),
      pricePerBlock: clampInt(ch.pricePerBlock, 0, 100000, d.characters.pricePerBlock),
      included: clampInt(ch.included, 0, 500000, d.characters.included),
      min: clampInt(ch.min, 1000, 500000, d.characters.min),
      max: clampInt(ch.max, 5000, 1000000, d.characters.max),
    },
    drafts: {
      blockSize: clampInt(dr.blockSize, 1, 50, d.drafts.blockSize),
      pricePerBlock: clampInt(dr.pricePerBlock, 0, 100000, d.drafts.pricePerBlock),
      included: clampInt(dr.included, 0, 500, d.drafts.included),
      min: clampInt(dr.min, 0, 500, d.drafts.min),
      max: clampInt(dr.max, 5, 2000, d.drafts.max),
    },
    devices: {
      included: clampInt(dv.included, 0, 5, d.devices.included),
      priceEach: clampInt(dv.priceEach, 0, 100000, d.devices.priceEach),
      min: clampInt(dv.min, 1, 5, d.devices.min),
      max: clampInt(dv.max, 1, 20, d.devices.max),
    },
    taxPercent: clampInt(src.taxPercent, 0, 50, d.taxPercent),
  };
};

export const sanitizeCustomSelection = (raw, pricing = DEFAULT_CUSTOM_PRICING) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const photoUpload = snapUp(
    src.photoUpload,
    pricing.photoUpload.blockSize,
    Math.max(pricing.photoUpload.min, pricing.photoUpload.blockSize),
    pricing.photoUpload.max
  );
  const minChat = Math.max(pricing.photoChat.min, photoUpload);
  const photoChat = snapUp(src.photoChat, pricing.photoChat.step, minChat, pricing.photoChat.max);
  const characters = snapUp(
    src.characters,
    pricing.characters.blockSize,
    Math.max(pricing.characters.min, pricing.characters.included),
    pricing.characters.max
  );
  const drafts = snapUp(
    src.drafts,
    pricing.drafts.blockSize,
    Math.max(pricing.drafts.min, pricing.drafts.blockSize),
    pricing.drafts.max
  );
  const devices = clampInt(src.devices, pricing.devices.min, pricing.devices.max, pricing.devices.included);
  return {
    photoUpload,
    photoChatEnabled: src.photoChatEnabled === true || src.photoChatEnabled === 'true',
    photoChat: Math.max(photoChat, minChat),
    characters,
    drafts,
    devices,
  };
};

const extraBlocks = (total, included, blockSize) => {
  const extra = Math.max(0, Number(total) - Number(included));
  if (blockSize <= 0) return 0;
  return Math.ceil(extra / blockSize);
};

/**
 * @returns {{ ok: true, selection, lines, subtotalRupees, taxRupees, totalRupees, taxPercent, limits, errors: [] }
 *  | { ok: false, errors: string[], selection, lines, subtotalRupees, taxRupees, totalRupees, taxPercent }}
 */
export const quoteCustomPlan = (rawSelection, rawPricing) => {
  const pricing = sanitizeCustomPricing(rawPricing);
  const selection = sanitizeCustomSelection(rawSelection, pricing);
  const errors = [];

  if (selection.photoChatEnabled && selection.photoChat < selection.photoUpload) {
    errors.push('Photos per chat cannot be lower than photos per upload.');
  }

  const photoBlocks = extraBlocks(selection.photoUpload, pricing.photoUpload.included, pricing.photoUpload.blockSize);
  const photoRupees = photoBlocks * pricing.photoUpload.pricePerBlock;
  const chatRupees = selection.photoChatEnabled ? pricing.photoChat.price : 0;
  const charBlocks = extraBlocks(selection.characters, pricing.characters.included, pricing.characters.blockSize);
  const charRupees = charBlocks * pricing.characters.pricePerBlock;
  const draftBlocks = extraBlocks(selection.drafts, pricing.drafts.included, pricing.drafts.blockSize);
  const draftRupees = draftBlocks * pricing.drafts.pricePerBlock;
  const extraDevices = Math.max(0, selection.devices - pricing.devices.included);
  const deviceRupees = extraDevices * pricing.devices.priceEach;

  const lines = [
    {
      id: 'photoUpload',
      label: `${selection.photoUpload} photos per upload (${photoBlocks} × ${pricing.photoUpload.blockSize})`,
      detail: 'Total allowed in one upload. Not additional to another plan.',
      rupees: photoRupees,
    },
    {
      id: 'photoChat',
      label: selection.photoChatEnabled
        ? `Total photos per chat: ${selection.photoChat} (flat feature)`
        : 'Total photos per chat: not selected (chat cap follows upload size)',
      detail: 'Flat monthly charge, not per photo. Separate from photos-per-upload.',
      rupees: chatRupees,
    },
    {
      id: 'characters',
      label: `${selection.characters.toLocaleString('en-IN')} characters per chat (${charBlocks} extra ${pricing.characters.blockSize.toLocaleString('en-IN')} blocks above ${pricing.characters.included.toLocaleString('en-IN')} included)`,
      detail: 'Counted as message text only. Image bytes are not characters.',
      rupees: charRupees,
    },
    {
      id: 'drafts',
      label: `${selection.drafts} completed drafts / month (${draftBlocks} × ${pricing.drafts.blockSize})`,
      detail: 'Total monthly quota. A draft counts only after a successful generate.',
      rupees: draftRupees,
    },
    {
      id: 'devices',
      label: `${selection.devices} device${selection.devices === 1 ? '' : 's'} (${extraDevices} extra)`,
      detail: `First ${pricing.devices.included} included. Registered as a random per-install id, not a fingerprint.`,
      rupees: deviceRupees,
    },
  ];

  const subtotalRupees = lines.reduce((sum, line) => sum + line.rupees, 0);
  const taxRupees = Math.round(subtotalRupees * (pricing.taxPercent / 100));
  const totalRupees = subtotalRupees + taxRupees;

  if (totalRupees < 1) {
    errors.push('Select at least one paid option. A ₹0 custom plan cannot be checked out.');
  }

  const photoChatCap = selection.photoChatEnabled
    ? selection.photoChat
    : Math.max(pricing.photoChat.included, selection.photoUpload);

  const limits = {
    draftLimit: selection.drafts,
    maxMessageChars: Math.min(10000, selection.characters),
    maxSessionChars: selection.characters,
    chatSessionLimit: 50,
    dailyUses: Number.POSITIVE_INFINITY,
    dailyAiRequests: 20,
    dailySeconds: 0,
    maxPhotosPerChat: photoChatCap,
    maxPhotosPerUpload: selection.photoUpload,
    monthlyAiRequests: 120,
    monthlyImages: 150,
    maxDevices: selection.devices,
  };

  return {
    ok: errors.length === 0,
    errors,
    selection,
    lines,
    subtotalRupees,
    taxRupees,
    taxPercent: pricing.taxPercent,
    totalRupees,
    billingPeriod: 'month',
    limits,
  };
};

export const publicQuote = (quote) => ({
  ok: quote.ok,
  errors: quote.errors,
  selection: quote.selection,
  lines: quote.lines,
  subtotalRupees: quote.subtotalRupees,
  taxRupees: quote.taxRupees,
  taxPercent: quote.taxPercent,
  totalRupees: quote.totalRupees,
  billingPeriod: quote.billingPeriod,
  limits: quote.ok ? quote.limits : undefined,
});
