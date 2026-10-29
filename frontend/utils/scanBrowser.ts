/**
 * Browser-only half of the scanned-template workflow: turning uploaded files into straightened page
 * images, paginating a reconstructed draft into real pages, and writing the two PDF kinds.
 *
 *   loadTemplatePages   file (JPG/PNG/scanned PDF) -> upright, straightened, cropped pages for the AI + pixels
 *   paginateDraft       Draft -> page elements (real pagination, hanging indents, tables, page breaks)
 *   renderFlowPdf       paginated pages -> PDF  (editable-document mode; same Draft the DOCX is built from)
 *   renderFixedPdf      original scan as background + replacement text only inside approved regions
 *
 * Heavy libraries (pdf.js) are imported on demand so the normal app load is not affected.
 */
import { detectPageBounds, estimateSkewDeg, otsuThreshold, toGray, type Gray } from './scanPixels.ts';
import { BLANK, diffOutsideRegions, type Draft, type DraftBlock, type FixedPlan } from './scanReconstruct.ts';
import { splitLabel, type TemplateProfile } from './scanTemplate.ts';
import type { PreparedPage } from './scanFill.ts';

const MAX_PAGES = 8;
const MAX_SIDE_IMAGE = 1800;
const PDF_PAGE_WIDTH_PX = 1500;
const JPEG_QUALITY = 0.82;

export const FONT_STACK = "'Nirmala UI','Noto Sans Devanagari','Kohinoor Devanagari','Devanagari Sangam MN','Mangal','Arial Unicode MS',sans-serif";

/* ------------------------------------------------------------------ */
/* Template pages                                                      */
/* ------------------------------------------------------------------ */

const newCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

const grayOf = (c: HTMLCanvasElement): Gray => {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return toGray(img.data, c.width, c.height);
};

const rotateQuarter = (src: HTMLCanvasElement, deg: number): HTMLCanvasElement => {
  const d = ((deg % 360) + 360) % 360;
  const swap = d === 90 || d === 270;
  const out = newCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
};

const paperTone = (g: Gray): number => {
  const hist = new Array<number>(256).fill(0);
  const step = Math.max(1, Math.floor(Math.sqrt((g.width * g.height) / 200000)));
  let n = 0;
  for (let y = 0; y < g.height; y += step) for (let x = 0; x < g.width; x += step) { hist[g.data[y * g.width + x]]++; n++; }
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.9) return Math.max(180, v); }
  return 255;
};

/** Crop to the paper, then rotate away any tilt. Returns a new canvas and what was done. */
const straighten = (src: HTMLCanvasElement): { canvas: HTMLCanvasElement; skewDeg: number; cropped: boolean } => {
  let canvas = src;
  let g = grayOf(canvas);
  const bounds = detectPageBounds(g);
  let cropped = false;
  if (bounds.w < g.width * 0.97 || bounds.h < g.height * 0.97) {
    const c = newCanvas(bounds.w, bounds.h);
    c.getContext('2d')!.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    canvas = c;
    g = grayOf(canvas);
    cropped = true;
  }
  const skew = estimateSkewDeg(g);
  if (Math.abs(skew) >= 0.4 && Math.abs(skew) <= 8) {
    const tone = paperTone(g);
    const out = newCanvas(canvas.width, canvas.height);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((-skew * Math.PI) / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return { canvas: out, skewDeg: skew, cropped };
  }
  return { canvas, skewDeg: 0, cropped };
};

const toPrepared = (orig: HTMLCanvasElement, rotationDeg: number): PreparedPage & { canvas: HTMLCanvasElement } => {
  const turned = rotationDeg ? rotateQuarter(orig, rotationDeg) : orig;
  const { canvas, skewDeg, cropped } = straighten(turned);
  return {
    canvas,
    gray: grayOf(canvas),
    jpegBase64: canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] || '',
    rotationDeg,
    skewDeg,
    cropped,
    rotate: async (deg: number) => toPrepared(orig, (rotationDeg + deg) % 360),
  };
};

const fitCanvas = (src: CanvasImageSource, w: number, h: number, maxSide: number): HTMLCanvasElement => {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = newCanvas(w * scale, h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
};

export const isPdfFile = (f: File) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
export const isImageFile = (f: File) => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

export interface LoadedTemplate {
  kind: 'image' | 'pdf';
  pages: (PreparedPage & { canvas: HTMLCanvasElement })[];
  note?: string;
}

export const loadTemplatePages = async (file: File): Promise<LoadedTemplate> => {
  if (isPdfFile(file)) {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const worker: any = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const total: number = doc.numPages;
    const count = Math.min(total, MAX_PAGES);
    const pages: LoadedTemplate['pages'] = [];
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PDF_PAGE_WIDTH_PX / base.width });
      const c = newCanvas(viewport.width, viewport.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, canvas: c, viewport }).promise;
      pages.push(toPrepared(c, 0));
    }
    try { await doc.destroy(); } catch { /* ignore */ }
    return { kind: 'pdf', pages, note: total > count ? `Only the first ${count} of ${total} template pages were analysed.` : undefined };
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as any).catch(() => createImageBitmap(file));
  const c = fitCanvas(bitmap, bitmap.width, bitmap.height, MAX_SIDE_IMAGE);
  try { (bitmap as any).close?.(); } catch { /* ignore */ }
  return { kind: 'image', pages: [toPrepared(c, 0)] };
};

export const jpegBlobFromBase64 = (b64: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
};

/* ------------------------------------------------------------------ */
/* Pagination of a Draft into real pages                               */
/* ------------------------------------------------------------------ */

const K = 96 / 72; // CSS px per point

export interface PaginatedDraft {
  pages: HTMLElement[];
  pageWidthPx: number;
  pageHeightPx: number;
  overflow: string[];
}

interface Piece {
  block: DraftBlock;
  /** text of this piece (a block can be split across pages) */
  text: string;
  continuation: boolean;
}

const blockElement = (doc: Document, profile: TemplateProfile, piece: Piece): HTMLElement => {
  const b = piece.block;
  const el = doc.createElement('div');
  el.className = 'casemate-scan-block';
  el.dataset.block = b.templateBlockId;
  const fs = b.fontPt * K;
  const css: string[] = [
    `margin:${piece.continuation ? 0 : b.spaceBeforePt * K}px 0 0 0`,
    `font-size:${fs}px`,
    `line-height:${b.lineHeightPt * K}px`,
    `font-weight:${b.bold ? 700 : 400}`,
    `text-align:${b.align === 'justify' ? 'justify' : b.align}`,
    `font-family:${FONT_STACK}`,
    'white-space:pre-wrap',
    'color:#000',
    'word-break:normal',
    'overflow-wrap:break-word',
  ];
  const left = b.align === 'left' || b.align === 'justify' ? b.leftIndentPt : 0;
  const first = piece.continuation ? 0 : b.align === 'left' || b.align === 'justify' ? b.firstLinePt : 0;
  css.push(`padding-left:${left * K}px`);
  css.push(`text-indent:${first * K}px`);
  el.style.cssText = css.join(';');

  const content = doc.createElement('span');
  if (b.underline) content.style.cssText = 'text-decoration:underline;text-underline-offset:0.12em';
  const { label, rest } = !piece.continuation && b.firstLinePt < -3 ? splitLabel(piece.text.split('\n')[0]) : { label: '', rest: '' };
  if (label) {
    const tab = doc.createElement('span');
    tab.style.cssText = `display:inline-block;min-width:${-b.firstLinePt * K}px;text-indent:0`;
    tab.textContent = label;
    const tail = piece.text.split('\n').slice(1);
    content.appendChild(tab);
    content.appendChild(doc.createTextNode([rest, ...tail].join('\n')));
  } else {
    content.textContent = piece.text;
  }
  el.appendChild(content);
  void profile;
  return el;
};

const tableElement = (doc: Document, b: DraftBlock, rows: string[][], profile: TemplateProfile, continuation: boolean): HTMLElement => {
  const wrap = doc.createElement('div');
  wrap.className = 'casemate-scan-block';
  wrap.dataset.block = b.templateBlockId;
  wrap.style.cssText = `margin:${continuation ? 0 : b.spaceBeforePt * K}px 0 0 0`;
  const table = doc.createElement('table');
  const border = b.table!.borders ? '1px solid #000' : 'none';
  table.style.cssText = `width:100%;border-collapse:collapse;table-layout:fixed;font-family:${FONT_STACK};font-size:${b.fontPt * K}px;line-height:${b.lineHeightPt * K}px;color:#000`;
  for (const r of rows) {
    const tr = doc.createElement('tr');
    for (const c of r) {
      const td = doc.createElement('td');
      td.style.cssText = `border:${border};padding:3px 7px;vertical-align:top;white-space:pre-wrap;overflow-wrap:break-word`;
      td.textContent = c;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  wrap.appendChild(table);
  void profile;
  return wrap;
};

/** Lay a Draft out on real pages (page size, margins, indents, tables and breaks from the profile). */
export const paginateDraft = (draft: Draft, profile: TemplateProfile, doc: Document = document): PaginatedDraft => {
  const pg = profile.pages[0];
  const pageW = pg.paperWidthPt * K;
  const pageH = pg.paperHeightPt * K;
  const contentW = (pg.paperWidthPt - pg.marginLeftPt - pg.marginRightPt) * K;
  const contentH = (pg.paperHeightPt - pg.marginTopPt - pg.marginBottomPt) * K;
  const overflow: string[] = [];

  // Off-screen measuring area with the same width as a page's content.
  const probe = doc.createElement('div');
  probe.style.cssText = `position:absolute;left:-100000px;top:0;width:${contentW}px;visibility:hidden`;
  doc.body.appendChild(probe);
  const measure = (el: HTMLElement) => {
    probe.appendChild(el);
    const h = el.getBoundingClientRect().height + (parseFloat(el.style.marginTop) || 0);
    probe.removeChild(el);
    return h;
  };

  const pages: HTMLElement[] = [];
  let content: HTMLElement | null = null;
  let used = 0;
  const newPage = () => {
    const page = doc.createElement('div');
    page.className = 'casemate-scan-page';
    page.style.cssText = `position:relative;width:${pageW}px;height:${pageH}px;background:#fff;box-sizing:border-box;overflow:hidden`;
    const c = doc.createElement('div');
    c.className = 'casemate-scan-content';
    c.style.cssText = `position:absolute;left:${pg.marginLeftPt * K}px;top:${pg.marginTopPt * K}px;width:${contentW}px;height:${contentH}px;overflow:hidden`;
    page.appendChild(c);
    pages.push(page);
    content = c;
    used = 0;
  };
  newPage();
  const place = (el: HTMLElement, h: number) => {
    content!.appendChild(el);
    used += h;
  };

  const blocks = draft.blocks;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.breakBefore && used > 0) newPage();

    if (b.table) {
      let rows = b.table.cells;
      let continuation = false;
      while (rows.length) {
        const whole = tableElement(doc, b, rows, profile, continuation);
        const h = measure(whole);
        if (used + h <= contentH || (used === 0 && rows.length === 1)) { place(whole, h); rows = []; break; }
        // split by rows
        let fit = 0;
        for (let k = rows.length - 1; k >= 1; k--) {
          const part = tableElement(doc, b, rows.slice(0, k), profile, continuation);
          if (used + measure(part) <= contentH) { fit = k; break; }
        }
        if (fit === 0) {
          if (used === 0) { place(whole, h); overflow.push(`A table row is taller than a page (${b.templateBlockId}).`); rows = []; break; }
          newPage();
          continue;
        }
        const part = tableElement(doc, b, rows.slice(0, fit), profile, continuation);
        place(part, measure(part));
        rows = rows.slice(fit);
        continuation = true;
        newPage();
      }
      continue;
    }

    let piece: Piece = { block: b, text: b.text, continuation: false };
    // keep a heading with the lines that follow it
    if (b.level > 0 && used > 0) {
      const next = blocks[bi + 1];
      const need = measure(blockElement(doc, profile, piece)) + (next ? Math.min(next.lineHeightPt * K * 2 + next.spaceBeforePt * K, 90) : 0);
      if (used + need > contentH) newPage();
    }
    for (let guard = 0; guard < 400; guard++) {
      const el = blockElement(doc, profile, piece);
      const h = measure(el);
      const lineH = b.lineHeightPt * K;
      if (used + h <= contentH + 0.5) { place(el, h); break; }
      const remaining = contentH - used;
      const lines = Math.round(h / lineH);
      // split a long paragraph by words, never leaving fewer than two lines on either side
      if (lines >= 4 && remaining >= lineH * 2.2) {
        const words = piece.text.split(/(\s+)/);
        let lo = 1;
        let hi = words.length - 1;
        let best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const trial = blockElement(doc, profile, { ...piece, text: words.slice(0, mid).join('') });
          if (measure(trial) <= remaining + 0.5) { best = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (best > 0) {
          const headText = words.slice(0, best).join('').replace(/\s+$/, '');
          const tailText = words.slice(best).join('').replace(/^\s+/, '');
          const headEl = blockElement(doc, profile, { ...piece, text: headText });
          const headLines = Math.round(measure(headEl) / lineH);
          const tailLines = Math.round(measure(blockElement(doc, profile, { block: b, text: tailText, continuation: true })) / lineH);
          if (headLines >= 2 && tailLines >= 2 && tailText) {
            place(headEl, measure(headEl));
            piece = { block: b, text: tailText, continuation: true };
            newPage();
            continue;
          }
        }
      }
      if (used === 0) {
        place(el, h);
        overflow.push(`A paragraph is taller than a page (${b.templateBlockId}).`);
        break;
      }
      newPage();
    }
  }
  doc.body.removeChild(probe);
  return { pages, pageWidthPx: pageW, pageHeightPx: pageH, overflow };
};

/* ------------------------------------------------------------------ */
/* Checks on rendered pages                                            */
/* ------------------------------------------------------------------ */

export interface PdfCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const squash = (s: string) => s.replace(/[\s\u00a0\u200b|]+/g, '');

/** Devanagari (and other) characters the current font stack cannot draw, found by comparing with an unassigned code point. */
export const missingGlyphs = (text: string, fontFamily = FONT_STACK, doc: Document = document): string[] => {
  const canvas = doc.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const draw = (s: string) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#000';
    ctx.font = `32px ${fontFamily}`;
    ctx.fillText(s, 8, 44);
    return Array.from(ctx.getImageData(0, 0, 64, 64).data).filter((_, i) => i % 4 === 3).join(',');
  };
  const missing: string[] = [];
  const seen = new Set<string>();
  const base = 'क';
  const ref = draw(base + '\u0378');
  const refBase = draw('\u0378');
  for (const ch of text) {
    if (seen.has(ch) || /[\s\d.,;:'"()\-–—/\\|*_]/.test(ch) || ch.charCodeAt(0) < 0x0900) continue;
    seen.add(ch);
    const isMark = /\p{M}/u.test(ch);
    const same = isMark ? draw(base + ch) === ref : draw(ch) === refBase;
    if (same) missing.push(ch);
    if (seen.size > 120) break;
  }
  return missing;
};

export const checkPaginated = (paged: PaginatedDraft, draft: Draft, profile: TemplateProfile, doc: Document = document): PdfCheck[] => {
  const checks: PdfCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const wantText = squash(draft.blocks.map((b) => (b.table ? b.table.cells.map((r) => r.join('')).join('') : b.text)).join(''));
  const gotText = squash(paged.pages.map((p) => p.textContent || '').join(''));
  add('pdf-text', wantText === gotText, wantText === gotText ? 'The PDF text is identical to the DOCX text (nothing missing, nothing duplicated).' : `The PDF text differs from the DOCX text (${gotText.length} vs ${wantText.length} characters).`);

  let clipped = 0;
  for (const p of paged.pages) {
    const c = p.querySelector('.casemate-scan-content') as HTMLElement | null;
    if (c && c.scrollHeight > c.clientHeight + 2) clipped++;
  }
  add('pdf-clipping', clipped === 0 && paged.overflow.length === 0, clipped || paged.overflow.length ? `${clipped} page(s) clip their content. ${paged.overflow.join(' ')}` : 'No page clips or overflows its content area.');

  const tplPages = profile.pages.length;
  const n = paged.pages.length;
  const last = paged.pages[n - 1]?.querySelector('.casemate-scan-content') as HTMLElement | null;
  const lastFill = last ? Array.from(last.children).reduce((s, c) => s + (c as HTMLElement).getBoundingClientRect().height, 0) / Math.max(1, last.clientHeight) : 1;
  add('pdf-blank-pages', lastFill > 0.04, lastFill > 0.04 ? 'No blank trailing page.' : 'The last page is almost empty.');
  add('pdf-page-count', n <= Math.max(tplPages + 2, Math.ceil(tplPages * 1.6)), `${n} page(s) in the PDF; the template has ${tplPages}. A different count is normal when the case facts are longer or shorter.`);

  const miss = missingGlyphs(draft.blocks.map((b) => (b.table ? b.table.cells.flat().join('') : b.text)).join(''), FONT_STACK, doc);
  add('pdf-glyphs', miss.length === 0, miss.length ? `These characters could not be drawn with the available fonts: ${miss.slice(0, 8).join(' ')}.` : 'Every Hindi character in the text can be drawn with the available fonts.');
  const blanks = draft.blocks.filter((b) => (b.table ? b.table.cells.flat().join(' ') : b.text).includes(BLANK)).length;
  add('pdf-placeholders', true, `${blanks} block(s) show ${BLANK} for facts to be checked.`);
  return checks;
};

/* ------------------------------------------------------------------ */
/* PDF writers                                                         */
/* ------------------------------------------------------------------ */

const jsPdfCtor = (): any => (window as any).jspdf?.jsPDF || (window as any).jsPDF;

export interface PdfResult {
  blob: Blob;
  pageCount: number;
  checks: PdfCheck[];
}

/** Editable-document mode: the PDF is drawn from the same Draft (and the same page setup) as the DOCX. */
export const renderFlowPdf = async (profile: TemplateProfile, draft: Draft, stage: HTMLElement): Promise<PdfResult> => {
  const html2canvas = (window as any).html2canvas;
  const JsPDF = jsPdfCtor();
  if (!html2canvas || !JsPDF) throw new Error('PDF library not loaded');
  if ((document as any).fonts?.ready) await (document as any).fonts.ready.catch(() => undefined);
  const paged = paginateDraft(draft, profile, document);
  const mount = document.createElement('div');
  mount.style.cssText = 'position:absolute;left:0;top:0;z-index:0;background:#fff';
  paged.pages.forEach((p) => mount.appendChild(p));
  stage.appendChild(mount);
  try {
    await new Promise((r) => window.setTimeout(r, 120));
    const checks = checkPaginated(paged, draft, profile);
    const pg = profile.pages[0];
    const pdf = new JsPDF({ unit: 'pt', format: [pg.paperWidthPt, pg.paperHeightPt], orientation: pg.paperWidthPt > pg.paperHeightPt ? 'landscape' : 'portrait' });
    for (let i = 0; i < paged.pages.length; i++) {
      const canvas = await html2canvas(paged.pages[i], { scale: 1.6, backgroundColor: '#ffffff', useCORS: true, logging: false, width: paged.pageWidthPx, height: paged.pageHeightPx, windowWidth: paged.pageWidthPx, windowHeight: paged.pageHeightPx });
      if (!canvas.width || !canvas.height) throw new Error('Empty PDF page');
      if (i > 0) pdf.addPage([pg.paperWidthPt, pg.paperHeightPt], pg.paperWidthPt > pg.paperHeightPt ? 'landscape' : 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pg.paperWidthPt, pg.paperHeightPt);
    }
    const blob = new Blob([pdf.output('blob')], { type: 'application/pdf' });
    if (blob.size < 800) throw new Error('Empty PDF');
    return { blob, pageCount: paged.pages.length, checks };
  } finally {
    mount.remove();
  }
};

/** Mean colour of the clean paper in a ring just outside a region (so the mask blends with a grey scan). */
const paperAround = (ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, W: number, H: number): string => {
  const x1 = Math.max(0, Math.floor(r.x) - 6);
  const y1 = Math.max(0, Math.floor(r.y) - 6);
  const x2 = Math.min(W, Math.ceil(r.x + r.w) + 6);
  const y2 = Math.min(H, Math.ceil(r.y + r.h) + 6);
  const data = ctx.getImageData(x1, y1, x2 - x1, y2 - y1).data;
  let rs = 0, gs = 0, bs = 0, n = 0;
  const ring = (x: number, y: number) => x < r.x - 1 || x > r.x + r.w + 1 || y < r.y - 1 || y > r.y + r.h + 1;
  for (let y = 0; y < y2 - y1; y++) for (let x = 0; x < x2 - x1; x++) {
    if (!ring(x1 + x, y1 + y)) continue;
    const i = (y * (x2 - x1) + x) * 4;
    if (data[i] > 150) { rs += data[i]; gs += data[i + 1]; bs += data[i + 2]; n++; }
  }
  return n ? `rgb(${Math.round(rs / n)},${Math.round(gs / n)},${Math.round(bs / n)})` : '#ffffff';
};

export interface FixedResult extends PdfResult {
  /** share of pixels that changed outside the approved regions (should be ~0) */
  outsideDiff: number;
}

/** Fixed-layout mode: the original scanned page, with new text only where the plan allows. */
export const renderFixedPdf = async (profile: TemplateProfile, plan: FixedPlan, pageBlobs: Blob[]): Promise<FixedResult> => {
  const JsPDF = jsPdfCtor();
  if (!JsPDF) throw new Error('PDF library not loaded');
  if (!plan.eligible) throw new Error('The fixed layout does not fit this draft');
  if ((document as any).fonts?.ready) await (document as any).fonts.ready.catch(() => undefined);
  const pg0 = profile.pages[0];
  const pdf = new JsPDF({ unit: 'pt', format: [pg0.paperWidthPt, pg0.paperHeightPt], orientation: pg0.paperWidthPt > pg0.paperHeightPt ? 'landscape' : 'portrait' });
  let worst = 0;
  for (let i = 0; i < profile.pages.length; i++) {
    const page = profile.pages[i];
    const bitmap = await createImageBitmap(pageBlobs[i]);
    const c = newCanvas(page.widthPx, page.heightPx);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    try { (bitmap as any).close?.(); } catch { /* ignore */ }
    const before = grayOf(c);
    const items = plan.items.filter((it) => it.page === i + 1);
    for (const it of items) {
      ctx.fillStyle = paperAround(ctx, it.region, c.width, c.height);
      ctx.fillRect(it.region.x, it.region.y, it.region.w, it.region.h);
    }
    for (const it of items) {
      ctx.fillStyle = '#111';
      ctx.font = `${it.bold ? 700 : 400} ${it.fontPx}px ${FONT_STACK}`;
      ctx.textBaseline = 'alphabetic';
      if (it.label) ctx.fillText(it.label.text, it.label.x, it.label.y + it.fontPx * 0.98);
      for (const l of it.lines) {
        const baseline = l.y + it.fontPx * 0.98;
        ctx.fillText(l.text, l.x, baseline);
        if (it.underline) {
          const w = ctx.measureText(l.text).width;
          ctx.fillRect(l.x, baseline + it.fontPx * 0.12, w, Math.max(1.2, it.fontPx / 15));
        }
      }
    }
    const after = grayOf(c);
    worst = Math.max(worst, diffOutsideRegions(before, after, items.map((it) => it.region)));
    if (i > 0) pdf.addPage([pg0.paperWidthPt, pg0.paperHeightPt], pg0.paperWidthPt > pg0.paperHeightPt ? 'landscape' : 'portrait');
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, page.paperWidthPt, page.paperHeightPt);
  }
  const blob = new Blob([pdf.output('blob')], { type: 'application/pdf' });
  const checks: PdfCheck[] = [
    { name: 'fixed-outside', ok: worst < 0.002, detail: worst < 0.002 ? 'Everything outside the replaced lines is pixel-identical to the original scan.' : `${(worst * 100).toFixed(2)}% of the page outside the replaced lines changed.` },
    { name: 'fixed-fit', ok: plan.items.every((it) => it.fits), detail: plan.items.every((it) => it.fits) ? `All ${plan.items.length} replaced area(s) fit at ${Math.round(Math.min(1, ...plan.items.map((i) => i.scale)) * 100)}% or more of the original size.` : 'Some text does not fit its area.' },
  ];
  return { blob, pageCount: profile.pages.length, checks, outsideDiff: worst };
};

/** Canvas text measurement for the fixed-layout planner. */
export const canvasMeasure = (): ((text: string, fontPx: number, bold: boolean) => number) => {
  const ctx = document.createElement('canvas').getContext('2d')!;
  return (text, fontPx, bold) => {
    ctx.font = `${bold ? 700 : 400} ${fontPx}px ${FONT_STACK}`;
    return ctx.measureText(text).width;
  };
};

export { otsuThreshold };
