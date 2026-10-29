/**
 * PDF export for drafts rebuilt from a scanned template. Browser only.
 *
 *   original-layout : the template's own scan, text placed only inside approved regions (values-only fills)
 *   flowing         : pages drawn from the same Draft and page setup as the DOCX (any other case)
 *
 * Every export returns the automatic checks it ran so they can be shown instead of claiming a match.
 */
import { canvasMeasure, renderFixedPdf, renderFlowPdf, type PdfCheck } from './scanBrowser.ts';
import { planFixedLayout, type Draft, type FixedPlan } from './scanReconstruct.ts';
import type { TemplateProfile } from './scanTemplate.ts';
import { getPageImages } from './scanProfileStore.ts';

export interface ScanPdfOutcome {
  blob: Blob;
  mode: 'original-layout' | 'flowing';
  pageCount: number;
  checks: PdfCheck[];
  /** why the original-layout mode was not used (empty when it was) */
  notes: string[];
}

/** Can the original scan be used as the page background for this draft? */
export const planOriginalLayout = (profile: TemplateProfile, draft: Draft): FixedPlan => planFixedLayout(profile, draft, canvasMeasure());

export const exportScanPdf = async (opts: {
  profile: TemplateProfile;
  draft: Draft;
  stage: HTMLElement;
  /** called only when both modes are possible; true = original layout */
  chooseOriginal: (plan: FixedPlan) => boolean;
}): Promise<ScanPdfOutcome> => {
  const { profile, draft } = opts;
  const plan = planOriginalLayout(profile, draft);
  const images = plan.eligible ? await getPageImages(profile.id) : null;
  const canFixed = plan.eligible && !!images && images.length === profile.pages.length;
  const notes: string[] = [];
  if (!canFixed) notes.push(...(plan.eligible ? ['The stored scan pages were not found on this device.'] : plan.reasons));

  if (canFixed && opts.chooseOriginal(plan)) {
    const fixed = await renderFixedPdf(profile, plan, images!);
    const checks: PdfCheck[] = [...fixed.checks];
    return { blob: fixed.blob, mode: 'original-layout', pageCount: fixed.pageCount, checks, notes };
  }
  const flow = await renderFlowPdf(profile, draft, opts.stage);
  return { blob: flow.blob, mode: 'flowing', pageCount: flow.pageCount, checks: flow.checks, notes };
};
