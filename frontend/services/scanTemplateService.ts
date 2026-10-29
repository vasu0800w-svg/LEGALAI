/**
 * Glue between the chat flow and the scanned-template engine. It owns the model calls (through the
 * existing backend proxy, passed in as `generate`), the template-profile cache, and the stored artefacts.
 * Imported by geminiService; it never imports it back.
 */
import { analyzeScanTemplate, fillScanTemplate, ScanTemplateError, type ScanStage, type TextCall, type VisionCall } from '../utils/scanFill';
import { approveProfile, hashBytes, type TemplateProfile } from '../utils/scanTemplate';
import type { Draft } from '../utils/scanReconstruct';
import { getProfile, saveProfile, savePageImages } from '../utils/scanProfileStore';

export { ScanTemplateError };

export type GenerateFn = (
  payload: { model: string; contents: any[]; config: any; workKind?: string },
  signal?: AbortSignal,
  timeoutMs?: number
) => Promise<{ text: string }>;

export interface ScanTemplateRun {
  text: string;
  docx: Uint8Array;
  fileName: string;
  profile: TemplateProfile;
  draft: Draft;
  review: string[];
  checks: { name: string; ok: boolean; detail: string }[];
  /** true when an earlier analysis of this same template file was reused (no vision call) */
  reusedProfile: boolean;
}

const VISION_TIMEOUT_MS = 120000;
const TEXT_ANALYZE_TIMEOUT_MS = 120000;
const TEXT_FILL_TIMEOUT_MS = 170000;

export const runScanTemplate = async (opts: {
  file: File;
  evidence: string;
  userRequest: string;
  language: string;
  today: string;
  model: string;
  generate: GenerateFn;
  thinkingAnalyze: any;
  thinkingFill: any;
  signal?: AbortSignal;
  onStage?: (stage: ScanStage) => void;
}): Promise<ScanTemplateRun> => {
  const bytes = new Uint8Array(await opts.file.arrayBuffer());
  const id = await hashBytes(bytes);

  const callText: TextCall = async ({ system, prompt, kind }) => {
    const res = await opts.generate(
      {
        model: opts.model,
        contents: [{ text: prompt }],
        config: { systemInstruction: system, temperature: 0.1, responseMimeType: 'application/json', ...(kind === 'fill' ? opts.thinkingFill : opts.thinkingAnalyze) },
        workKind: kind === 'fill' ? 'draft' : 'analysis',
      },
      opts.signal,
      kind === 'fill' ? TEXT_FILL_TIMEOUT_MS : TEXT_ANALYZE_TIMEOUT_MS
    );
    return res.text;
  };

  const callVision: VisionCall = async ({ system, prompt, images }) => {
    const res = await opts.generate(
      {
        model: opts.model,
        contents: [{ text: prompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))],
        config: { systemInstruction: system, temperature: 0, responseMimeType: 'application/json', ...opts.thinkingAnalyze },
        workKind: 'analysis',
      },
      opts.signal,
      VISION_TIMEOUT_MS
    );
    return res.text;
  };

  let profile = await getProfile(id);
  let reused = !!profile;
  if (!profile) {
    opts.onStage?.('reading');
    const { loadTemplatePages, jpegBlobFromBase64 } = await import('../utils/scanBrowser');
    const loaded = await loadTemplatePages(opts.file);
    const analysed = await analyzeScanTemplate({
      id,
      name: opts.file.name,
      sourceKind: loaded.kind,
      pages: loaded.pages,
      language: opts.language,
      callVision,
      callText,
      model: opts.model,
      onStage: opts.onStage,
    });
    profile = analysed.profile;
    if (loaded.note) profile = { ...profile, review: [...profile.review, { id: 'N1', severity: 'info', message: loaded.note }] };
    await saveProfile(profile);
    await savePageImages(id, analysed.pages.map((p) => jpegBlobFromBase64(p.jpegBase64)));
    reused = false;
  }

  const filled = await fillScanTemplate({ profile, evidence: opts.evidence, userRequest: opts.userRequest, language: opts.language, today: opts.today, callText, onStage: opts.onStage });
  const fileName = opts.file.name.replace(/\.[^.]+$/, '') || 'draft';
  return { text: filled.tagged, docx: filled.docx, fileName, profile, draft: filled.draft, review: filled.review, checks: filled.validation.checks, reusedProfile: reused };
};

export { approveProfile };
