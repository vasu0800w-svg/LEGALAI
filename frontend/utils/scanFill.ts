/**
 * Orchestrates the scanned-template workflow. Nothing here touches the browser or the network directly:
 * pages and model calls are passed in, so the same code runs in the app and in tests.
 *
 *   1. template pages  --AI vision (sees ONLY the template)-->  lines/tables with boxes
 *   2. pixels check the AI's reading                            --> TemplateProfile (cached by file hash)
 *   3. text-only AI lists which blocks carry the sample case    --> approved fields
 *   4. case evidence (analysed separately) + fields             --> replacement values (JSON)
 *   5. values validated, applied to a copy of the profile       --> Draft --> DOCX --> validation
 */
import {
  FILL_SYSTEM,
  ANALYZE_SYSTEM,
  analyzePrompt,
  fillPrompt,
  parseJsonLoose,
  validateFields,
  validateReplacements,
} from './templateFill.ts';
import {
  SCAN_SYSTEM,
  buildProfile,
  parseVisionPage,
  profileAsModel,
  profileInventory,
  scanPagePrompt,
  type PageInput,
  type RawPage,
  type TemplateProfile,
} from './scanTemplate.ts';
import {
  applyScanReplacements,
  draftToDocx,
  draftToTaggedText,
  validateDraft,
  type Draft,
  type DraftValidation,
} from './scanReconstruct.ts';
import type { Gray } from './scanPixels.ts';

export type ScanErrorCode = 'NO_PAGES' | 'NO_TEXT' | 'BAD_JSON' | 'NO_FIELDS' | 'VALIDATION_FAILED';

export class ScanTemplateError extends Error {
  code: ScanErrorCode;
  constructor(code: ScanErrorCode, message: string) {
    super(message);
    this.name = 'ScanTemplateError';
    this.code = code;
  }
}

/** One template page, already straightened and encoded for the model. */
export interface PreparedPage {
  gray: Gray;
  /** base64 JPEG of exactly the pixels in `gray` */
  jpegBase64: string;
  rotationDeg: number;
  skewDeg: number;
  cropped: boolean;
  /** turn the page clockwise and return the new page (used when the AI says it is sideways/upside-down) */
  rotate?: (deg: number) => Promise<PreparedPage>;
}

export interface VisionCall {
  (req: { system: string; prompt: string; images: { mimeType: string; data: string }[] }): Promise<string>;
}

export interface TextCall {
  (req: { system: string; prompt: string; kind: 'analyze' | 'fill' }): Promise<string>;
}

export type ScanStage = 'reading' | 'fields' | 'filling' | 'building';

const parseJson = (raw: string): any => {
  try {
    return parseJsonLoose(raw);
  } catch {
    throw new ScanTemplateError('BAD_JSON', 'The AI did not return valid JSON.');
  }
};

/** Read every template page (AI) and check it against the pixels. Returns an unapproved profile. */
export const analyzeScanTemplate = async (opts: {
  id: string;
  name: string;
  sourceKind: 'image' | 'pdf';
  pages: PreparedPage[];
  language: string;
  callVision: VisionCall;
  callText: TextCall;
  model?: string;
  onStage?: (stage: ScanStage, detail?: string) => void;
}): Promise<{ profile: TemplateProfile; notes: string[]; pages: PreparedPage[] }> => {
  if (!opts.pages.length) throw new ScanTemplateError('NO_PAGES', 'The template has no readable page.');
  opts.onStage?.('reading');
  const notes: string[] = [];

  const readOne = async (page: PreparedPage, index: number): Promise<{ input: PageInput; page: PreparedPage }> => {
    let current = page;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await opts.callVision({
        system: SCAN_SYSTEM,
        prompt: scanPagePrompt(index + 1, opts.pages.length),
        images: [{ mimeType: 'image/jpeg', data: current.jpegBase64 }],
      });
      const parsed = parseVisionPage(parseJson(raw));
      notes.push(...parsed.notes.map((n) => `Page ${index + 1}: ${n}`));
      const rot = parsed.page.rotateCw;
      if (rot && attempt === 0 && current.rotate) {
        current = await current.rotate(rot);
        continue;
      }
      return { page: current, input: { gray: current.gray, raw: parsed.page as RawPage, rotationDeg: current.rotationDeg, skewDeg: current.skewDeg, cropped: current.cropped } };
    }
    throw new ScanTemplateError('NO_TEXT', 'The page could not be read upright.');
  };

  // two pages at a time keeps the request count polite on a free-tier backend
  const inputs: PageInput[] = new Array(opts.pages.length);
  const finalPages: PreparedPage[] = new Array(opts.pages.length);
  let next = 0;
  const worker = async () => {
    while (next < opts.pages.length) {
      const i = next++;
      const r = await readOne(opts.pages[i], i);
      inputs[i] = r.input;
      finalPages[i] = r.page;
    }
  };
  await Promise.all([worker(), worker()]);

  const totalLines = inputs.reduce((s, p) => s + p.raw.lines.length + p.raw.tables.length, 0);
  if (totalLines === 0) throw new ScanTemplateError('NO_TEXT', 'No text could be read from the template.');

  let profile = buildProfile({ id: opts.id, name: opts.name, sourceKind: opts.sourceKind, pages: inputs, language: opts.language, model: opts.model });

  // Which blocks carry the sample case? (text only — same question the Word workflow asks)
  opts.onStage?.('fields');
  const model = profileAsModel(profile);
  const raw = await opts.callText({ kind: 'analyze', system: ANALYZE_SYSTEM, prompt: analyzePrompt(profileInventory(profile), opts.language) });
  const { fields, notes: fieldNotes } = validateFields(model, parseJson(raw));
  profile = { ...profile, fields, review: [...profile.review, ...fieldNotes.map((m, i) => ({ id: `F${i + 1}`, severity: 'info' as const, message: m }))] };
  return { profile, notes, pages: finalPages };
};

export interface ScanFillResult {
  profile: TemplateProfile;
  draft: Draft;
  docx: Uint8Array;
  tagged: string;
  validation: DraftValidation;
  /** things the advocate should look at, in plain words */
  review: string[];
}

/** Fill an approved/cached profile with the new case. Never calls the vision model. */
export const fillScanTemplate = async (opts: {
  profile: TemplateProfile;
  evidence: string;
  userRequest: string;
  language: string;
  today: string;
  callText: TextCall;
  onStage?: (stage: ScanStage) => void;
}): Promise<ScanFillResult> => {
  const { profile } = opts;
  if (profile.fields.length === 0) throw new ScanTemplateError('NO_FIELDS', 'No replaceable fields are marked in this template.');
  const model = profileAsModel(profile);

  opts.onStage?.('filling');
  const raw = await opts.callText({ kind: 'fill', system: FILL_SYSTEM, prompt: fillPrompt(model, profile.fields, opts.evidence, opts.userRequest, opts.language, opts.today) });
  const { valid, review } = validateReplacements(profile.fields, model, parseJson(raw), opts.evidence, opts.userRequest, opts.today);

  opts.onStage?.('building');
  const draft = applyScanReplacements(profile, valid, review);
  const docx = await draftToDocx(profile, draft);
  const validation = await validateDraft({ profile, draft, docx, allowedText: `${opts.evidence}\n${opts.userRequest}` });
  if (!validation.checks.find((c) => c.name === 'opens')?.ok) throw new ScanTemplateError('VALIDATION_FAILED', 'The generated Word file could not be opened.');

  const notes = [
    ...draft.review,
    ...validation.problems.map((p) => `Check failed — ${p}`),
    ...profile.review.filter((r) => r.severity === 'warn').map((r) => `Template: ${r.message}`),
  ];
  if (!profile.approved) notes.push('The template reading has not been approved yet. Open "Template check" to correct headings, styles or fields.');
  return { profile, draft, docx, tagged: draftToTaggedText(draft), validation, review: notes };
};
