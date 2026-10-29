/**
 * Template analysis for SCANNED / PHOTOGRAPHED templates (JPG, PNG, scanned PDF pages).
 *
 * Stage 1 (AI, sees ONLY the template page): reads every printed line with a bounding box, a confidence,
 *   its own bold/underline/alignment estimate, and any tables.
 * Stage 2 (pixels, no AI): snaps each box to the ink that is really on the page, checks underline and
 *   stroke weight, measures margins/indents/spacing/font size, finds table ruling and records everything
 *   that disagrees as a review item.
 * Stage 3: groups lines into blocks (paragraphs, headings, numbered paragraphs, signature, verification,
 *   annexure, tables) and stores the result as a TemplateProfile that the advocate can correct and reuse.
 *
 * The original OCR (`lines`) is never edited; corrections go on `blocks`.
 */
import {
  type Gray,
  type PxBox,
  findUnderline,
  inkDensity,
  inkThreshold,
  median,
  countRuleLines,
  snapToInk,
} from './scanPixels.ts';
import type { TemplateField } from './templateFill.ts';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Align = 'left' | 'center' | 'right' | 'justify';

export type LineKind =
  | 'court_heading'
  | 'title'
  | 'heading'
  | 'party'
  | 'para'
  | 'numbered'
  | 'subpara'
  | 'signature'
  | 'verification_heading'
  | 'verification'
  | 'annexure_heading'
  | 'annexure'
  | 'other';

export type BlockType = LineKind | 'table';

const LINE_KINDS: LineKind[] = [
  'court_heading', 'title', 'heading', 'party', 'para', 'numbered', 'subpara', 'signature',
  'verification_heading', 'verification', 'annexure_heading', 'annexure', 'other',
];

/** Box in fractions of the page (0..1), so it survives any rescaling of the stored image. */
export interface NBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawLine {
  t: string;
  box: [number, number, number, number]; // ymin, xmin, ymax, xmax in 0..1000
  c: number;
  bold: boolean;
  u: boolean;
  al: Align;
  isNew: boolean;
  k: LineKind;
}

export interface RawTable {
  box: [number, number, number, number];
  rows: string[][];
  borders: boolean;
}

export interface RawPage {
  rotateCw: number;
  lines: RawLine[];
  tables: RawTable[];
  /** stamps, seals, logos, handwriting the AI saw but did not transcribe */
  marks: { what: string; box: [number, number, number, number] }[];
  notes: string[];
}

export interface ScanLine {
  id: string;
  page: number;
  /** exactly what the AI read — never edited */
  ocrText: string;
  /** reading used for drafting; the advocate may correct it */
  text: string;
  box: NBox;
  /** model-estimated, then lowered by pixel checks. Not an OCR-engine score. */
  conf: number;
  bold: boolean;
  underline: boolean;
  align: Align;
  startsParagraph: boolean;
  kind: LineKind;
  /** ink-weight ratio vs the page's regular text; > ~1.3 suggests bold */
  boldRatio: number;
  underlineCoverage: number;
  flags: string[];
}

export interface ScanBlock {
  id: string;
  type: BlockType;
  lineIds: string[];
  pages: number[];
  /** text as read (lines joined); labels such as "1." or "(क)" stay in the text */
  text: string;
  label: string;
  align: Align;
  bold: boolean;
  underline: boolean;
  fontPt: number;
  leftIndentPt: number;
  /** negative = hanging (numbered paragraphs) */
  firstLinePt: number;
  spaceBeforePt: number;
  /** exact line pitch in points */
  lineHeightPt: number;
  /** a deliberate page break precedes this block in the template */
  breakBefore: boolean;
  /** 1 = main title, 2 = section heading; 0 = not a heading */
  level: 0 | 1 | 2;
  table?: { cells: string[][]; borders: boolean; box: NBox; page: number };
  /** the advocate corrected this block */
  edited?: boolean;
}

export interface PageGeometry {
  index: number;
  widthPx: number;
  heightPx: number;
  paper: 'A4' | 'Letter' | 'Legal' | 'Custom';
  paperWidthPt: number;
  paperHeightPt: number;
  marginLeftPt: number;
  marginRightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  contentBox: NBox;
  rotationAppliedDeg: number;
  skewCorrectedDeg: number;
  cropped: boolean;
  /** stamps / seals / logos the AI saw (not reproduced) */
  marks: { what: string; box: NBox }[];
}

export interface ReviewItem {
  id: string;
  severity: 'info' | 'warn';
  message: string;
  blockId?: string;
  lineId?: string;
}

export interface TemplateProfile {
  version: 1;
  /** hash of the uploaded template file: the same file always finds the same profile */
  id: string;
  name: string;
  sourceKind: 'image' | 'pdf';
  createdAt: number;
  approved: boolean;
  approvedAt?: number;
  language: string;
  pages: PageGeometry[];
  lines: ScanLine[];
  blocks: ScanBlock[];
  fields: TemplateField[];
  base: { fontName: string; fontPt: number; lineHeightPt: number };
  anchors: { name: string; blockId: string }[];
  review: ReviewItem[];
  analysis: { confidenceSource: 'model-estimated'; pixelChecks: true; model: string };
}

/* ------------------------------------------------------------------ */
/* Prompt + parsing of the AI's page reading                           */
/* ------------------------------------------------------------------ */

export const SCAN_SYSTEM =
  'You read a scanned or photographed page of a legal document template and report its LAYOUT. ' +
  'You transcribe exactly what is printed (Hindi in Devanagari, English as printed). ' +
  'You never correct, translate, complete or invent text, and you never add anything that is not on the page.';

export const scanPagePrompt = (page: number, total: number): string =>
  `This is page ${page} of ${total} of a legal template. Report every printed line with its position and style.\n\n` +
  `Return ONLY JSON:\n` +
  `{"rotate_cw":0,"lines":[{"t":"<ONE printed line, exactly as printed>","b":[ymin,xmin,ymax,xmax],"c":0.0,"bold":false,"u":false,"al":"left","new":true,"k":"para"}],` +
  `"tables":[{"b":[ymin,xmin,ymax,xmax],"rows":[["cell","cell"],["cell","cell"]],"borders":true}],` +
  `"marks":[{"what":"stamp|seal|logo|handwriting","b":[ymin,xmin,ymax,xmax]}],"notes":["anything unclear"]}\n\n` +
  `RULES\n` +
  `- Boxes use 0-1000 coordinates relative to THIS image, tight around the ink of that one line. "lines" are in reading order, top to bottom, ONE entry per printed line (do not merge lines, do not split a line).\n` +
  `- "rotate_cw": degrees (0, 90, 180 or 270) this image must be turned clockwise to read upright. Boxes are for the image as given.\n` +
  `- "c": your confidence in that line's transcription, 0 to 1. Use below 0.6 for blurry, faint, cut-off or handwritten text.\n` +
  `- "bold" / "u": true only if the line is visibly heavier than the body text / visibly underlined. Do not guess.\n` +
  `- "al": left, center, right or justify as the line sits on the page.\n` +
  `- "new": true if this line begins a new paragraph (first line, a numbered or lettered item, an indented first line, or after extra space); false if it continues the paragraph above it.\n` +
  `- "k": court_heading (court name/place at the top), title (the matter's title, e.g. application under section…), heading (section heading such as prayer/facts), party (party names block), para, numbered (1., 2.), subpara ((क), (ख), (a)), signature (advocate/applicant signature lines), verification_heading, verification, annexure_heading, annexure, other.\n` +
  `- Text inside a table is NOT listed in "lines": put the table in "tables" with every cell's text, row by row.\n` +
  `- Stamps, seals, logos and handwriting are listed in "marks" and are NOT transcribed.\n` +
  `- If a line is unreadable, still list it with t "" is NOT allowed: put a note in "notes" instead.`;

const num = (v: any): number => (typeof v === 'number' && isFinite(v) ? v : NaN);

const parseBox = (b: any): [number, number, number, number] | null => {
  if (!Array.isArray(b) || b.length < 4) return null;
  const [y1, x1, y2, x2] = b.slice(0, 4).map(num);
  if ([y1, x1, y2, x2].some((v) => isNaN(v))) return null;
  const c = (v: number) => Math.max(0, Math.min(1000, v));
  const out: [number, number, number, number] = [c(Math.min(y1, y2)), c(Math.min(x1, x2)), c(Math.max(y1, y2)), c(Math.max(x1, x2))];
  if (out[2] - out[0] < 2 || out[3] - out[1] < 2) return null;
  return out;
};

export const parseVisionPage = (answer: any): { page: RawPage; notes: string[] } => {
  const notes: string[] = [];
  const lines: RawLine[] = [];
  for (const l of Array.isArray(answer?.lines) ? answer.lines : []) {
    const t = String(l?.t ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const box = parseBox(l?.b);
    if (!t) { notes.push('A line without text was ignored.'); continue; }
    if (!box) { notes.push(`Ignored "${t.slice(0, 30)}": its position was not usable.`); continue; }
    const al: Align = ['left', 'center', 'right', 'justify'].includes(l?.al) ? l.al : 'left';
    const k: LineKind = LINE_KINDS.includes(l?.k) ? l.k : 'other';
    const c = num(l?.c);
    lines.push({ t, box, c: isNaN(c) ? 0.7 : Math.max(0, Math.min(1, c)), bold: l?.bold === true, u: l?.u === true, al, isNew: l?.new !== false, k });
  }
  const tables: RawTable[] = [];
  for (const t of Array.isArray(answer?.tables) ? answer.tables : []) {
    const box = parseBox(t?.b);
    const rows: string[][] = (Array.isArray(t?.rows) ? t.rows : [])
      .slice(0, 60)
      .map((r: any) => (Array.isArray(r) ? r.slice(0, 12).map((c: any) => String(c ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)) : []))
      .filter((r: string[]) => r.length > 0);
    if (!box || rows.length === 0) { notes.push('A table without usable position or cells was ignored.'); continue; }
    const cols = Math.max(...rows.map((r) => r.length));
    tables.push({ box, rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')), borders: t?.borders !== false });
  }
  const marks = (Array.isArray(answer?.marks) ? answer.marks : [])
    .map((m: any) => ({ what: String(m?.what || 'mark').slice(0, 20), box: parseBox(m?.b) }))
    .filter((m: any) => m.box) as RawPage['marks'];
  const rot = num(answer?.rotate_cw);
  const rotateCw = [90, 180, 270].includes(rot) ? rot : 0;
  const aiNotes = (Array.isArray(answer?.notes) ? answer.notes : []).map((n: any) => String(n)).filter(Boolean).slice(0, 8);
  return { page: { rotateCw, lines, tables, marks, notes: aiNotes }, notes };
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const PAPERS = [
  { name: 'A4' as const, w: 595.28, h: 841.89 },
  { name: 'Letter' as const, w: 612, h: 792 },
  { name: 'Legal' as const, w: 612, h: 1008 },
];

export const pickPaper = (widthPx: number, heightPx: number) => {
  const portrait = heightPx >= widthPx;
  const ratio = portrait ? heightPx / widthPx : widthPx / heightPx;
  let best = PAPERS[0];
  let bestD = Infinity;
  for (const p of PAPERS) {
    const d = Math.abs(p.h / p.w - ratio);
    if (d < bestD) { bestD = d; best = p; }
  }
  // A page that is not close to any standard size is kept as A4 width with its own proportions.
  if (bestD > 0.08) {
    const w = 595.28;
    return { name: 'Custom' as const, wPt: portrait ? w : w * ratio, hPt: portrait ? w * ratio : w };
  }
  return { name: best.name, wPt: portrait ? best.w : best.h, hPt: portrait ? best.h : best.w };
};

const toNBox = (b: PxBox, W: number, H: number): NBox => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });
const toPx = (b: NBox, W: number, H: number): PxBox => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H });

const DEV_DIGITS = '०१२३४५६७८९';
/** A leading item label: "1." "1)" "(1)" "(क)" "(a)" "(iv)". */
const LABEL_RE = /^(\(?(?:\d{1,3}|[०-९]{1,3}|[क-ह]{1,2}|[a-zA-Z]|[ivxIVX]{1,4})[.)])(?=\s)/;

export const splitLabel = (text: string): { label: string; rest: string } => {
  const m = LABEL_RE.exec(text.trimStart());
  if (!m) return { label: '', rest: text };
  const rest = text.trimStart().slice(m[1].length).replace(/^\s+/, '');
  return { label: m[1], rest };
};

export const labelNumber = (label: string): number | null => {
  const core = label.replace(/[().]/g, '');
  if (/^[0-9०-९]+$/.test(core)) {
    const asc = core.replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d)));
    return Number(asc);
  }
  return null;
};

export const withLabelNumber = (label: string, n: number): string => {
  const core = label.replace(/[().]/g, '');
  const deva = /[०-९]/.test(core);
  const digits = deva ? String(n).replace(/\d/g, (d) => DEV_DIGITS[Number(d)]) : String(n);
  return label.replace(core, digits);
};

const BODY_KINDS = new Set<LineKind>(['para', 'numbered', 'subpara', 'party', 'verification', 'annexure']);
const HEADING_KINDS = new Set<LineKind>(['court_heading', 'title', 'heading', 'verification_heading', 'annexure_heading']);

const round = (v: number, step: number) => Math.round(v / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ */
/* Profile construction                                                */
/* ------------------------------------------------------------------ */

export interface PageInput {
  /** the (straightened, cropped) page image the AI looked at */
  gray: Gray;
  raw: RawPage;
  rotationDeg: number;
  skewDeg: number;
  cropped: boolean;
}

interface PageLine extends ScanLine {
  px: PxBox;
  textHpx: number;
  pageW: number;
  pageH: number;
  ptX: number;
  ptY: number;
}

interface Item {
  line?: PageLine;
  table?: { raw: RawTable; px: PxBox; page: number; ptY: number; pageH: number; rules: { horizontal: number; vertical: number } };
}

export const buildProfile = (opts: {
  id: string;
  name: string;
  sourceKind: 'image' | 'pdf';
  pages: PageInput[];
  language?: string;
  model?: string;
  now?: number;
}): TemplateProfile => {
  const review: ReviewItem[] = [];
  const addReview = (severity: 'info' | 'warn', message: string, ref: { blockId?: string; lineId?: string } = {}) =>
    review.push({ id: `R${review.length + 1}`, severity, message, ...ref });

  const pages: PageGeometry[] = [];
  const allLines: PageLine[] = [];
  const itemsByPage: Item[][] = [];
  let lineSeq = 0;

  opts.pages.forEach((input, pi) => {
    const pageNo = pi + 1;
    const { gray } = input;
    const W = gray.width;
    const H = gray.height;
    const paper = pickPaper(W, H);
    const ptX = paper.wPt / W;
    const ptY = paper.hPt / H;
    const thr = inkThreshold(gray);
    const items: Item[] = [];
    const pageLines: PageLine[] = [];

    const tablePx: { raw: RawTable; px: PxBox }[] = input.raw.tables.map((t) => ({
      raw: t,
      px: { x: (t.box[1] / 1000) * W, y: (t.box[0] / 1000) * H, w: ((t.box[3] - t.box[1]) / 1000) * W, h: ((t.box[2] - t.box[0]) / 1000) * H },
    }));
    const inTable = (b: PxBox) =>
      tablePx.some((t) => {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        return cx >= t.px.x - 4 && cx <= t.px.x + t.px.w + 4 && cy >= t.px.y - 4 && cy <= t.px.y + t.px.h + 4;
      });

    for (const r of input.raw.lines) {
      const approx: PxBox = { x: (r.box[1] / 1000) * W, y: (r.box[0] / 1000) * H, w: ((r.box[3] - r.box[1]) / 1000) * W, h: ((r.box[2] - r.box[0]) / 1000) * H };
      if (inTable(approx)) continue;
      const snap = snapToInk(gray, approx, thr);
      const ul = snap.found ? findUnderline(gray, snap.box, thr) : { underlined: false, coverage: 0, y: undefined as number | undefined };
      const textH = ul.underlined && ul.y !== undefined ? Math.max(4, ul.y - snap.box.y) : snap.box.h;
      const density = snap.found ? inkDensity(gray, snap.box, ul.underlined ? ul.y : undefined, thr) : 0;
      const id = `L${++lineSeq}`;
      const flags: string[] = [];
      let conf = r.c;
      if (!snap.found) { conf = 0; flags.push('no-ink'); }
      const line: PageLine = {
        id,
        page: pageNo,
        ocrText: r.t,
        text: r.t,
        box: toNBox(snap.box, W, H),
        conf,
        bold: r.bold,
        underline: ul.underlined || r.u,
        align: r.al,
        startsParagraph: r.isNew,
        kind: r.k,
        boldRatio: density,
        underlineCoverage: ul.coverage,
        flags,
        px: snap.box,
        textHpx: textH,
        pageW: W,
        pageH: H,
        ptX,
        ptY,
      };
      if (r.u && snap.found && !ul.underlined) flags.push('underline-unconfirmed');
      pageLines.push(line);
    }
    pageLines.sort((a, b) => a.px.y - b.px.y || a.px.x - b.px.x);

    // Stroke weight is judged against the page's own regular text.
    const regular = pageLines.filter((l) => !l.bold && l.boldRatio > 0).map((l) => l.boldRatio);
    const regMedian = regular.length >= 3 ? median(regular) : 0;
    for (const l of pageLines) {
      if (!regMedian || l.boldRatio <= 0) { l.boldRatio = 0; continue; }
      const ratio = l.boldRatio / regMedian;
      l.boldRatio = Math.round(ratio * 100) / 100;
      if (l.bold && ratio < 1.12) l.flags.push('bold-unconfirmed');
      if (!l.bold && ratio >= 1.45) l.flags.push('bold-maybe');
      // Confirmed by ink weight but the AI missed it (and it is a heading-like line).
      if (!l.bold && ratio >= 1.55 && HEADING_KINDS.has(l.kind)) l.bold = true;
    }

    // Per-page geometry.
    const body = pageLines.length ? pageLines : [];
    const tablesBoxes = tablePx.map((t) => t.px);
    const xs1 = [...body.map((l) => l.px.x), ...tablesBoxes.map((b) => b.x)];
    const xs2 = [...body.map((l) => l.px.x + l.px.w), ...tablesBoxes.map((b) => b.x + b.w)];
    const ys1 = [...body.map((l) => l.px.y), ...tablesBoxes.map((b) => b.y)];
    const ys2 = [...body.map((l) => l.px.y + l.px.h), ...tablesBoxes.map((b) => b.y + b.h)];
    const leftAligned = body.filter((l) => l.align === 'left' || l.align === 'justify').map((l) => l.px.x);
    const left = leftAligned.length ? Math.min(...leftAligned) : xs1.length ? Math.min(...xs1) : W * 0.12;
    const right = xs2.length ? Math.max(...xs2) : W * 0.88;
    const top = ys1.length ? Math.min(...ys1) : H * 0.1;
    const bottom = ys2.length ? Math.max(...ys2) : H * 0.9;
    const mLeft = clamp(left * ptX, 36, 126);
    const mRight = clamp((W - right) * ptX, 36, 126);
    const mTop = clamp(top * ptY, 36, 126);
    const mBottom = clamp((H - bottom) * ptY, 36, 126);

    pages.push({
      index: pageNo,
      widthPx: W,
      heightPx: H,
      paper: paper.name,
      paperWidthPt: Math.round(paper.wPt * 10) / 10,
      paperHeightPt: Math.round(paper.hPt * 10) / 10,
      marginLeftPt: Math.round(mLeft),
      marginRightPt: Math.round(mRight),
      marginTopPt: Math.round(mTop),
      marginBottomPt: Math.round(mBottom),
      contentBox: toNBox({ x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, W, H),
      rotationAppliedDeg: input.rotationDeg,
      skewCorrectedDeg: input.skewDeg,
      cropped: input.cropped,
      marks: input.raw.marks.map((m) => ({ what: m.what, box: { x: m.box[1] / 1000, y: m.box[0] / 1000, w: (m.box[3] - m.box[1]) / 1000, h: (m.box[2] - m.box[0]) / 1000 } })),
    });

    if (Math.abs(input.skewDeg) >= 0.4) addReview('info', `Page ${pageNo} was tilted ${input.skewDeg}° and has been straightened before reading.`);
    if (input.rotationDeg) addReview('info', `Page ${pageNo} was turned ${input.rotationDeg}° to read upright.`);
    if (pageLines.length + tablePx.length < 3) addReview('warn', `Page ${pageNo}: very little text was found. The page may be blank, cut off or too faint.`);
    for (const m of input.raw.marks) addReview('info', `Page ${pageNo}: a ${m.what} was seen. It is not transcribed or reproduced in the editable document.`);
    for (const n of input.raw.notes) addReview('info', `Page ${pageNo}: ${n}`);

    // Table ruling by pixels.
    for (const t of tablePx) {
      const rules = countRuleLines(gray, t.px, thr);
      items.push({ table: { raw: t.raw, px: t.px, page: pageNo, ptY, pageH: H, rules } });
    }
    for (const l of pageLines) items.push({ line: l });
    items.sort((a, b) => (a.line ? a.line.px.y : a.table!.px.y) - (b.line ? b.line.px.y : b.table!.px.y));
    itemsByPage.push(items);
    allLines.push(...pageLines);
  });

  /* ---- one set of margins for the document (Word has one per section) ---- */
  {
    const real = pages.filter((_, i) => itemsByPage[i].length >= 3);
    const use = real.length ? real : pages;
    const L = Math.round(median(use.map((p) => p.marginLeftPt)));
    const R = Math.round(median(use.map((p) => p.marginRightPt)));
    const T = Math.round(median(use.map((p) => p.marginTopPt)));
    // the lowest ink on any page shows how far down text may run
    const B = clamp(Math.round(Math.min(...use.map((p) => p.marginBottomPt))), 36, 90);
    for (const p of pages) {
      p.marginLeftPt = L;
      p.marginRightPt = R;
      p.marginTopPt = T;
      p.marginBottomPt = B;
    }
  }

  /* ---- font size, line pitch (document-wide) ---- */
  const bodyLines = allLines.filter((l) => BODY_KINDS.has(l.kind) && !l.bold);
  const refLines = bodyLines.length >= 3 ? bodyLines : allLines;
  const inkPts = refLines.map((l) => l.textHpx * l.ptY).sort((a, b) => a - b);
  const inkP80 = inkPts.length ? inkPts[Math.min(inkPts.length - 1, Math.floor(inkPts.length * 0.8))] : 14;
  const basePt = clamp(round(inkP80 / 1.2, 0.5), 9, 16);

  // Pitch between lines that continue the same paragraph.
  const pitchesPt: number[] = [];
  for (const items of itemsByPage) {
    const ls = items.filter((i) => i.line).map((i) => i.line!);
    for (let i = 1; i < ls.length; i++) if (!ls[i].startsParagraph && ls[i].kind === ls[i - 1].kind) pitchesPt.push((ls[i].px.y - ls[i - 1].px.y) * ls[i].ptY);
  }
  // With no multi-line paragraph, fall back to the distance between consecutive body lines.
  const fallbackPitch: number[] = [];
  for (const items of itemsByPage) {
    const ls = items.filter((i) => i.line && BODY_KINDS.has(i.line.kind)).map((i) => i.line!);
    for (let i = 1; i < ls.length; i++) fallbackPitch.push((ls[i].px.y - ls[i - 1].px.y) * ls[i].ptY);
  }
  const rawPitch = pitchesPt.length ? median(pitchesPt) : fallbackPitch.length ? Math.min(...fallbackPitch.filter((v) => v > 0).concat([basePt * 1.5])) : basePt * 1.5;
  const baseLineHeightPt = clamp(round(Math.max(rawPitch, basePt * 1.3), 0.5), basePt * 1.3, basePt * 3);

  /* ---- pixel evidence for alignment ---- */
  const pageOf = (i: number) => pages[i];
  const alignOf = (l: PageLine, geom: PageGeometry, blockLineCount: number, isLast: boolean): Align => {
    const W = l.pageW;
    const L = geom.contentBox.x * W;
    const R = (geom.contentBox.x + geom.contentBox.w) * W;
    const tol = W * 0.015;
    const x1 = l.px.x;
    const x2 = l.px.x + l.px.w;
    const cx = (x1 + x2) / 2;
    const midMargin = ((geom.marginLeftPt / l.ptX + (W - geom.marginRightPt / l.ptX)) / 2);
    const fullWidth = x1 <= L + tol && x2 >= R - tol;
    if (!fullWidth && Math.abs(cx - midMargin) <= tol && x1 - L > W * 0.04 && R - x2 > W * 0.04) return 'center';
    if (!fullWidth && R - x2 <= tol && x1 - L > W * 0.12) return 'right';
    void blockLineCount; void isLast;
    return l.align === 'justify' ? 'justify' : 'left';
  };

  /* ---- group lines into blocks ---- */
  const blocks: ScanBlock[] = [];
  let blockSeq = 0;
  let pitchPx = median(pitchesPt) / (opts.pages[0] ? pages[0].paperHeightPt / pages[0].heightPx : 1) || 0;
  if (!pitchPx) pitchPx = baseLineHeightPt / (pages[0].paperHeightPt / pages[0].heightPx);

  interface Open { lines: PageLine[]; kind: LineKind }
  let open: Open | null = null;
  const closeOpen = () => {
    if (!open) return;
    blocks.push(makeBlock(open));
    open = null;
  };

  const makeBlock = (o: Open): ScanBlock => {
    const first = o.lines[0];
    const geom = pageOf(first.page - 1);
    const joined = o.lines.reduce((acc, l, i) => {
      if (i === 0) return l.text;
      return acc.endsWith('-') ? acc + l.text : `${acc} ${l.text}`;
    }, '');
    const { label } = splitLabel(joined);
    let type: BlockType = o.kind;
    if (label && !['annexure', 'verification', 'party', 'signature'].includes(type)) type = /^\(?[क-हa-zA-Z]|^\(?[ivxIVX]+[.)]/.test(label) && /^\(/.test(label) ? 'subpara' : 'numbered';
    const weight = (pick: (l: PageLine) => boolean) => o.lines.reduce((s, l) => s + (pick(l) ? l.text.length : 0), 0) / Math.max(1, o.lines.reduce((s, l) => s + l.text.length, 0));
    const bold = weight((l) => l.bold) >= 0.5;
    const underline = weight((l) => l.underline) >= 0.5;

    // alignment: pixel evidence first (centre/right are decisive); justify needs >=2 full-width lines.
    const aligns = o.lines.map((l, i) => alignOf(l, geom, o.lines.length, i === o.lines.length - 1));
    const R = (geom.contentBox.x + geom.contentBox.w) * first.pageW;
    const nonLast = o.lines.slice(0, -1);
    const flush = nonLast.length >= 2 && nonLast.every((l) => Math.abs(l.px.x + l.px.w - R) <= first.pageW * 0.012);
    let align: Align = aligns.filter((a) => a === 'center').length > aligns.length / 2 ? 'center'
      : aligns.filter((a) => a === 'right').length > aligns.length / 2 ? 'right'
      : flush ? 'justify'
      : o.lines.filter((l) => l.align === 'justify').length > o.lines.length / 2 && nonLast.length < 2 ? 'justify' : 'left';
    const modelCenter = o.lines.filter((l) => l.align === 'center').length > o.lines.length / 2;
    const modelRight = o.lines.filter((l) => l.align === 'right').length > o.lines.length / 2;
    if ((modelCenter && align !== 'center') || (modelRight && align !== 'right') || (!modelCenter && !modelRight && (align === 'center' || align === 'right'))) {
      addReview('warn', `Alignment of "${joined.slice(0, 40)}" is uncertain: the AI said ${modelCenter ? 'center' : modelRight ? 'right' : 'left/justify'}, the page measures ${align}.`, { blockId: `S${blockSeq + 1}` });
    }

    // indents (points) relative to the page's left margin
    const Lpx = geom.contentBox.x * first.pageW;
    let leftIndentPt = 0;
    let firstLinePt = 0;
    if (align === 'left' || align === 'justify') {
      const firstX = (first.px.x - Lpx) * first.ptX;
      if (o.lines.length === 1) {
        leftIndentPt = Math.max(0, firstX);
      } else {
        const restX = median(o.lines.slice(1).map((l) => (l.px.x - Lpx) * l.ptX));
        leftIndentPt = Math.max(0, restX);
        firstLinePt = firstX - restX;
      }
      leftIndentPt = Math.abs(leftIndentPt) < 4 ? 0 : round(leftIndentPt, 1);
      firstLinePt = Math.abs(firstLinePt) < 4 ? 0 : round(firstLinePt, 1);
      // a hanging label cannot start left of the margin
      if (leftIndentPt + firstLinePt < 0) firstLinePt = -leftIndentPt;
    }

    // font size: only a clear difference from the body size is carried over
    const ink = median(o.lines.map((l) => l.textHpx * l.ptY)) / 1.2;
    const own = clamp(round(ink, 0.5), 8, 28);
    const fontPt = own >= basePt * 1.15 && HEADING_KINDS.has(o.kind) ? own : basePt;

    const pitch = o.lines.length > 1 ? median(o.lines.slice(1).map((l, i) => (l.px.y - o.lines[i].px.y) * l.ptY)) : 0;
    const lineHeightPt = pitch > 0 ? clamp(round(Math.max(pitch, fontPt * 1.3), 0.5), fontPt * 1.3, fontPt * 3) : Math.max(baseLineHeightPt, round(fontPt * 1.3, 0.5));

    const level: 0 | 1 | 2 = o.kind === 'title' || o.kind === 'court_heading' ? 1 : HEADING_KINDS.has(o.kind) ? 2 : 0;
    const id = `S${++blockSeq}`;
    const conf = Math.min(...o.lines.map((l) => l.conf));
    if (conf < 0.6) addReview('warn', `Low reading confidence (${Math.round(conf * 100)}%) for "${joined.slice(0, 50)}". Please check the text.`, { blockId: id });
    for (const l of o.lines) {
      if (l.flags.includes('no-ink')) addReview('warn', `The AI reported "${l.text.slice(0, 40)}" but no printing was found there. It may not exist.`, { blockId: id, lineId: l.id });
      if (l.flags.includes('underline-unconfirmed') && HEADING_KINDS.has(l.kind)) addReview('info', `Underline on "${l.text.slice(0, 40)}" was reported by the AI but could not be confirmed from the pixels.`, { blockId: id, lineId: l.id });
      if (l.flags.includes('bold-unconfirmed') && HEADING_KINDS.has(l.kind)) addReview('info', `Bold on "${l.text.slice(0, 40)}" was reported by the AI but the ink weight does not clearly confirm it.`, { blockId: id, lineId: l.id });
      if (l.flags.includes('bold-maybe') && BODY_KINDS.has(l.kind)) addReview('info', `"${l.text.slice(0, 40)}" looks heavier than the body text but was not marked bold.`, { blockId: id, lineId: l.id });
    }
    return {
      id,
      type,
      lineIds: o.lines.map((l) => l.id),
      pages: Array.from(new Set(o.lines.map((l) => l.page))),
      text: joined,
      label,
      align,
      bold,
      underline,
      fontPt,
      leftIndentPt,
      firstLinePt,
      spaceBeforePt: 0,
      lineHeightPt,
      breakBefore: false,
      level,
    };
  };

  itemsByPage.forEach((items) => {
    items.forEach((it, idx) => {
      if (it.table) {
        closeOpen();
        const t = it.table;
        const W = pages[t.page - 1].widthPx;
        const H = t.pageH;
        const ruled = t.rules.horizontal >= 2 && t.rules.vertical >= 2;
        const id = `S${++blockSeq}`;
        if (ruled !== t.raw.borders) addReview('warn', `The AI said the table ${t.raw.borders ? 'has' : 'has no'} borders, but the page shows ${t.rules.horizontal} horizontal and ${t.rules.vertical} vertical rules. Please check.`, { blockId: id });
        const cols = t.raw.rows[0]?.length || 0;
        if (ruled && t.rules.horizontal - 1 !== t.raw.rows.length && t.rules.horizontal !== t.raw.rows.length) addReview('info', `The table has ${t.raw.rows.length} rows by the AI's reading but ${Math.max(0, t.rules.horizontal - 1)} by its ruling.`, { blockId: id });
        void cols;
        blocks.push({
          id, type: 'table', lineIds: [], pages: [t.page],
          text: t.raw.rows.map((r) => r.join(' | ')).join('\n'), label: '',
          align: 'left', bold: false, underline: false, fontPt: basePt, leftIndentPt: 0, firstLinePt: 0,
          spaceBeforePt: 0, lineHeightPt: baseLineHeightPt, breakBefore: false, level: 0,
          table: { cells: t.raw.rows, borders: ruled || t.raw.borders, box: toNBox(t.px, W, H), page: t.page },
        });
        return;
      }
      const l = it.line!;
      const geom = pageOf(l.page - 1);
      const continues = (() => {
        if (!open || l.startsParagraph) return false;
        const last = open.lines[open.lines.length - 1];
        if (splitLabel(l.text).label && l.kind !== 'annexure') return false;
        if (l.kind !== open.kind && !(BODY_KINDS.has(l.kind) && BODY_KINDS.has(open.kind))) return false;
        if (last.align !== l.align && (l.align === 'center' || l.align === 'right' || last.align === 'center' || last.align === 'right')) return false;
        if (last.page === l.page && (l.px.y - last.px.y) > pitchPx * 1.5) return false;
        return true;
      })();
      if (!continues) {
        closeOpen();
        open = { lines: [l], kind: l.kind };
      } else {
        open!.lines.push(l);
      }
      void geom; void idx;
    });
    closeOpen();
  });
  closeOpen();

  // Spacing before: extra distance beyond the ordinary leading, from the positions of consecutive blocks.
  const lineById = new Map(allLines.map((l) => [l.id, l]));
  const pageHpx = (n: number) => pages[n - 1].heightPx;
  const ptYof = (n: number) => pages[n - 1].paperHeightPt / pages[n - 1].heightPx;
  /** top/bottom of a block on its page, in pixels, or null when it spans nothing measurable */
  const extent = (b: ScanBlock, end: 'first' | 'last') => {
    if (b.table) {
      const t = b.table;
      const H = pageHpx(t.page);
      return { page: t.page, top: t.box.y * H, bottom: (t.box.y + t.box.h) * H, h: t.box.h * H };
    }
    const id = end === 'first' ? b.lineIds[0] : b.lineIds[b.lineIds.length - 1];
    const l = id ? lineById.get(id) : null;
    if (!l) return null;
    const H = pageHpx(l.page);
    return { page: l.page, top: l.box.y * H, bottom: (l.box.y + l.box.h) * H, h: l.box.h * H };
  };
  for (let i = 1; i < blocks.length; i++) {
    const prev = extent(blocks[i - 1], 'last');
    const cur = extent(blocks[i], 'first');
    if (!prev || !cur || prev.page !== cur.page) continue;
    const gap = cur.top - prev.bottom;
    const leading = Math.max(0, pitchPx - cur.h);
    const extra = (gap - leading) * ptYof(cur.page);
    blocks[i].spaceBeforePt = extra >= 3 ? clamp(Math.round(extra), 0, 60) : 0;
  }
  // Page breaks that look deliberate: lots of empty page before a heading-like block starts the next page.
  for (let i = 1; i < blocks.length; i++) {
    const cur = blocks[i];
    const prev = blocks[i - 1];
    const firstCur = cur.lineIds.length ? lineById.get(cur.lineIds[0]) : null;
    const lastPrev = prev.lineIds.length ? lineById.get(prev.lineIds[prev.lineIds.length - 1]) : null;
    if (!firstCur || !lastPrev || firstCur.page === lastPrev.page) continue;
    const geom = pageOf(lastPrev.page - 1);
    const contentBottom = (geom.contentBox.y + geom.contentBox.h) * geom.heightPx;
    const pageBottomLimit = geom.heightPx - geom.marginBottomPt / lastPrev.ptY;
    const usedTo = lastPrev.px.y + lastPrev.px.h;
    const emptyFrac = (pageBottomLimit - usedTo) / Math.max(1, pageBottomLimit - geom.marginTopPt / lastPrev.ptY);
    void contentBottom;
    if (emptyFrac >= 0.4 && HEADING_KINDS.has(cur.type as LineKind)) {
      cur.breakBefore = true;
      addReview('info', `A page break before "${cur.text.slice(0, 40)}" is kept: the previous page of the template ends with a large empty area.`, { blockId: cur.id });
    }
  }

  // A block that opens a template page has no neighbour above it there; give it the spacing its kind has elsewhere.
  for (let i = 1; i < blocks.length; i++) {
    const prev = extent(blocks[i - 1], 'last');
    const cur = extent(blocks[i], 'first');
    if (!prev || !cur || prev.page === cur.page || blocks[i].breakBefore) continue;
    const peers = blocks.filter((b) => b.type === blocks[i].type && b.spaceBeforePt > 0).map((b) => b.spaceBeforePt);
    blocks[i].spaceBeforePt = peers.length ? Math.round(median(peers)) : 0;
  }

  // Numbering sequence in the template itself.
  let expected = 1;
  for (const b of blocks) {
    if (b.type !== 'numbered') continue;
    const n = labelNumber(b.label);
    if (n === null) continue;
    if (n !== expected) addReview('info', `Numbering in the template jumps from ${expected - 1} to ${n}. It is kept as printed.`, { blockId: b.id });
    expected = n + 1;
  }

  // Section anchors.
  const anchors: { name: string; blockId: string }[] = [];
  const anchor = (name: string, pred: (b: ScanBlock) => boolean) => {
    const b = blocks.find(pred);
    if (b) anchors.push({ name, blockId: b.id });
  };
  anchor('court', (b) => b.type === 'court_heading');
  anchor('title', (b) => b.type === 'title');
  anchor('parties', (b) => b.type === 'party');
  anchor('prayer', (b) => HEADING_KINDS.has(b.type as LineKind) && /प्रार्थना|prayer/i.test(b.text));
  anchor('signature', (b) => b.type === 'signature');
  anchor('verification', (b) => b.type === 'verification_heading' || b.type === 'verification');
  anchor('annexure', (b) => b.type === 'annexure_heading' || b.type === 'annexure');
  if (!blocks.some((b) => b.type === 'signature')) addReview('info', 'No signature block was detected in the template.');
  if (!blocks.some((b) => b.type === 'court_heading')) addReview('warn', 'No court heading was detected at the top of the template. Please check the first block.');

  return {
    version: 1,
    id: opts.id,
    name: opts.name,
    sourceKind: opts.sourceKind,
    createdAt: opts.now ?? Date.now(),
    approved: false,
    language: opts.language || 'Hindi',
    pages,
    lines: allLines.map(({ px, textHpx, pageW, pageH, ptX, ptY, ...line }) => { void px; void textHpx; void pageW; void pageH; void ptX; void ptY; return line; }),
    blocks,
    fields: [],
    base: { fontName: 'Nirmala UI', fontPt: basePt, lineHeightPt: baseLineHeightPt },
    anchors,
    review,
    analysis: { confidenceSource: 'model-estimated', pixelChecks: true, model: opts.model || '' },
  };
};

/* ------------------------------------------------------------------ */
/* Inventory for field analysis (text only: same flow as DOCX)         */
/* ------------------------------------------------------------------ */

export interface ParaLike {
  id: string;
  text: string;
}

/** Every editable piece of text in the profile as paragraph-like entries: blocks and table cells. */
export const profileParagraphs = (profile: TemplateProfile): ParaLike[] => {
  const out: ParaLike[] = [];
  for (const b of profile.blocks) {
    if (b.table) {
      b.table.cells.forEach((row, r) => row.forEach((cell, c) => { if (cell.trim()) out.push({ id: `${b.id}.${r + 1}.${c + 1}`, text: cell }); }));
    } else out.push({ id: b.id, text: b.text });
  }
  return out;
};

export const profileInventory = (profile: TemplateProfile, maxChars = 60000): string => {
  let out = '';
  for (const p of profileParagraphs(profile)) {
    const b = profile.blocks.find((x) => x.id === p.id.split('.')[0])!;
    const flags = [b.type, b.table ? 'table-cell' : ''].filter(Boolean).join(',');
    const line = `${p.id} [${flags}]: ${p.text.replace(/\s+/g, ' ').slice(0, 1500)}\n`;
    if (out.length + line.length > maxChars) { out += '[…inventory truncated…]\n'; break; }
    out += line;
  }
  return out;
};

/** The shape templateFill's validators expect (they only ever look paragraphs up by id). */
export const profileAsModel = (profile: TemplateProfile): any => ({
  byId: new Map(profileParagraphs(profile).map((p) => [p.id, p])),
  paras: profileParagraphs(profile),
});

/* ------------------------------------------------------------------ */
/* Corrections by the advocate                                         */
/* ------------------------------------------------------------------ */

export interface BlockPatch {
  type?: BlockType;
  text?: string;
  align?: Align;
  bold?: boolean;
  underline?: boolean;
  fontPt?: number;
  leftIndentPt?: number;
  firstLinePt?: number;
  spaceBeforePt?: number;
  breakBefore?: boolean;
}

/** Returns a corrected copy; the OCR lines and the original asset are never touched. */
export const patchBlock = (profile: TemplateProfile, blockId: string, patch: BlockPatch): TemplateProfile => {
  const blocks = profile.blocks.map((b) => {
    if (b.id !== blockId) return b;
    const next: ScanBlock = { ...b, ...patch, edited: true };
    if (patch.text !== undefined) next.label = splitLabel(patch.text).label;
    if (patch.type !== undefined) next.level = patch.type === 'title' || patch.type === 'court_heading' ? 1 : HEADING_KINDS.has(patch.type as LineKind) ? 2 : 0;
    return next;
  });
  // text changes can invalidate sample strings
  const fields = profile.fields.filter((f) => {
    const base = f.id.split('.')[0];
    if (base !== blockId || patch.text === undefined) return true;
    return f.mode === 'rewrite' || f.samples.every((s) => patch.text!.includes(s));
  });
  return { ...profile, blocks, fields, approved: false, approvedAt: undefined };
};

/** The advocate chooses which blocks are replaceable and how. */
export const setFieldMode = (profile: TemplateProfile, paraId: string, mode: 'keep' | 'rewrite' | 'values', samples: string[] = []): TemplateProfile => {
  const rest = profile.fields.filter((f) => f.id !== paraId);
  if (mode === 'keep') return { ...profile, fields: rest, approved: false, approvedAt: undefined };
  const para = profileParagraphs(profile).find((p) => p.id === paraId);
  if (!para) return profile;
  if (mode === 'rewrite') return { ...profile, fields: [...rest, { id: paraId, mode: 'rewrite', purpose: para.text.slice(0, 40), samples: [] }], approved: false, approvedAt: undefined };
  const valid = samples.filter((s) => s && para.text.includes(s));
  if (!valid.length) return profile;
  return { ...profile, fields: [...rest, { id: paraId, mode: 'values', purpose: para.text.slice(0, 40), samples: valid }], approved: false, approvedAt: undefined };
};

export const approveProfile = (profile: TemplateProfile, now = Date.now()): TemplateProfile => ({ ...profile, approved: true, approvedAt: now });

/** Hash of the uploaded file (SHA-256, hex): the same template file always maps to the same profile. */
export const hashBytes = async (bytes: ArrayBuffer | Uint8Array): Promise<string> => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
};

export { toPx };
