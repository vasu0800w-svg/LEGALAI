/**
 * Rebuilds a legal document from a TemplateProfile (a scanned template's analysed structure) plus the
 * replacement values the AI proposed for the approved fields.
 *
 *   profile (structure + formatting)  +  validated replacements (case facts)  ->  Draft
 *   Draft -> editable DOCX (real paragraphs, tabs, tables, page setup)
 *   Draft -> tagged text for the in-app editor
 *   Draft + DOCX -> validation against the profile
 *   Draft + profile -> a fixed-layout plan (text only inside the template's own line regions)
 *
 * The AI decides WHAT goes into a field; this file decides WHERE it goes and how it looks.
 */
import {
  AlignmentType,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  Table,
  TableLayoutType,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  Tab,
  UnderlineType,
  WidthType,
  BorderStyle,
} from 'docx';
import JSZip from 'jszip';
import type { PxBox } from './scanPixels.ts';
import { splitLabel, labelNumber, withLabelNumber, type ScanBlock, type TemplateProfile, type Align } from './scanTemplate.ts';
import type { ValidReplacement } from './templateFill.ts';

export const BLANK = '________';

/* ------------------------------------------------------------------ */
/* Draft                                                               */
/* ------------------------------------------------------------------ */

export interface DraftBlock extends ScanBlock {
  /** the template's own text for the block this came from */
  originalText: string;
  templateBlockId: string;
  changed: boolean;
  fieldId?: string;
  sources: string[];
  needsVerification: boolean;
  origin: 'template' | 'filled' | 'rewritten';
  /** only its number changed because paragraphs were added/removed before it */
  renumbered?: boolean;
  tableOriginal?: string[][];
}

export interface Draft {
  profileId: string;
  blocks: DraftBlock[];
  review: string[];
  renumbered: boolean;
  rewrote: boolean;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const replaceAll = (text: string, find: string, value: string) => (find ? text.split(find).join(value) : text);

export const applyScanReplacements = (profile: TemplateProfile, valid: ValidReplacement[], review: string[] = []): Draft => {
  const byId = new Map(valid.map((v) => [v.id, v]));
  const out: DraftBlock[] = [];
  const notes = [...review];
  let rewrote = false;
  let countChanged = false;

  const base = (b: ScanBlock): DraftBlock => ({
    ...clone(b),
    originalText: b.text,
    templateBlockId: b.id,
    changed: false,
    sources: [],
    needsVerification: false,
    origin: 'template',
  });

  for (const b of profile.blocks) {
    if (b.table) {
      const d = base(b);
      d.tableOriginal = clone(b.table.cells);
      d.table = clone(b.table);
      b.table.cells.forEach((row, r) =>
        row.forEach((cell, c) => {
          const rep = byId.get(`${b.id}.${r + 1}.${c + 1}`);
          if (!rep) return;
          let next = cell;
          if (rep.mode === 'values') for (const v of rep.values) next = replaceAll(next, v.sample, v.value);
          else next = rep.paragraphs.join('\n');
          if (next !== cell) {
            d.table!.cells[r][c] = next;
            d.changed = true;
            d.origin = 'filled';
            d.fieldId = d.fieldId || `${b.id}.${r + 1}.${c + 1}`;
            d.sources.push(...rep.sources);
            if (next.includes(BLANK) || rep.review.length) d.needsVerification = true;
          }
        })
      );
      d.text = d.table.cells.map((row) => row.join(' | ')).join('\n');
      out.push(d);
      continue;
    }

    const rep = byId.get(b.id);
    if (!rep) { out.push(base(b)); continue; }

    if (rep.mode === 'rewrite') {
      rewrote = true;
      if (rep.paragraphs.length !== 1) countChanged = true;
      if (rep.paragraphs.length === 0) { notes.push(`"${b.text.slice(0, 40)}…" does not apply to this case, so that paragraph was left out.`); continue; }
      rep.paragraphs.forEach((p, i) => {
        const d = base(b);
        d.text = p.replace(/\s+\n/g, '\n').trim();
        d.label = splitLabel(d.text).label;
        d.changed = true;
        d.fieldId = b.id;
        d.origin = 'rewritten';
        d.sources = [...rep.sources];
        d.needsVerification = d.text.includes(BLANK) || rep.review.length > 0;
        if (i > 0) { d.breakBefore = false; }
        out.push(d);
      });
      continue;
    }

    const d = base(b);
    let next = b.text;
    for (const v of rep.values) next = replaceAll(next, v.sample, v.value);
    if (next !== b.text) {
      d.text = next;
      d.changed = true;
      d.fieldId = b.id;
      d.origin = 'filled';
      d.sources = [...rep.sources];
      d.needsVerification = next.includes(BLANK) || rep.review.length > 0;
    }
    out.push(d);
  }

  let renumbered = false;
  if (countChanged) {
    let n = 0;
    for (const d of out) {
      if (d.type !== 'numbered') continue;
      const num = labelNumber(d.label);
      if (num === null) continue;
      n++;
      if (num !== n) {
        const nl = withLabelNumber(d.label, n);
        d.text = d.text.replace(d.label, nl);
        d.label = nl;
        renumbered = true;
        if (!d.changed) { d.changed = true; d.renumbered = true; d.origin = 'filled'; }
      }
    }
    if (renumbered) notes.push('Numbered paragraphs were renumbered in order. Please check any reference to a paragraph number inside the text.');
  }

  return { profileId: profile.id, blocks: out, review: notes, renumbered, rewrote };
};

/** Plain reading text of a draft (for comparisons and copy). */
export const draftPlainText = (draft: Draft): string =>
  draft.blocks.map((b) => (b.table ? b.table.cells.map((r) => r.join(' | ')).join('\n') : b.text)).join('\n');

/* ------------------------------------------------------------------ */
/* Editor text (the app's tag model)                                   */
/* ------------------------------------------------------------------ */

/**
 * Carry the advocate's style corrections (made on the profile after the draft was written) into the draft.
 * Only formatting moves across; the draft's wording, replacements and review notes stay exactly as they are.
 */
export const restyleDraft = (profile: TemplateProfile, draft: Draft): Draft => {
  const byId = new Map(profile.blocks.map((b) => [b.id, b]));
  return {
    ...draft,
    blocks: draft.blocks.map((d) => {
      const src = byId.get(d.templateBlockId);
      if (!src || d.table) return d;
      return {
        ...d,
        type: src.type,
        level: src.level,
        align: src.align,
        bold: src.bold,
        underline: src.underline,
        fontPt: src.fontPt,
        leftIndentPt: src.leftIndentPt,
        firstLinePt: src.firstLinePt,
        spaceBeforePt: src.spaceBeforePt,
        lineHeightPt: src.lineHeightPt,
        breakBefore: src.breakBefore,
      };
    }),
  };
};

export const draftToTaggedText = (draft: Draft): string => {
  const parts: string[] = [];
  for (const b of draft.blocks) {
    if (b.table) {
      parts.push(b.table.cells.map((row) => row.join(' | ')).join('\n'));
      continue;
    }
    const lines = b.text.split('\n').map((line) => {
      let t = line.replace(/\*+/g, '');
      if (b.underline) t = `[U]${t}[/U]`;
      if (b.bold) t = `**${t}**`;
      if (b.align === 'center') t = `[CENTER]${t}[/CENTER]`;
      else if (b.align === 'right') t = `[RIGHT]${t}[/RIGHT]`;
      return t;
    });
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
};

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

const tw = (pt: number) => Math.round(pt * 20);

const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.BOTH,
};

export const draftToDocx = async (profile: TemplateProfile, draft: Draft): Promise<Uint8Array> => {
  const page = profile.pages[0];
  const font = profile.base.fontName;
  const fontSpec = { ascii: font, hAnsi: font, cs: font, eastAsia: font };
  const contentWidth = tw(page.paperWidthPt - page.marginLeftPt - page.marginRightPt);

  const run = (text: string, b: ScanBlock, extra: Record<string, any> = {}) =>
    new TextRun({
      text,
      font: fontSpec,
      size: Math.round(b.fontPt * 2),
      sizeComplexScript: Math.round(b.fontPt * 2),
      bold: b.bold,
      boldComplexScript: b.bold,
      underline: b.underline ? { type: UnderlineType.SINGLE } : undefined,
      language: { value: 'en-IN', bidirectional: 'hi-IN' },
      ...extra,
    } as any);

  const children: (Paragraph | Table)[] = [];
  for (const b of draft.blocks) {
    if (b.table) {
      const cols = Math.max(1, b.table.cells[0]?.length || 1);
      const colW = Math.floor(contentWidth / cols);
      const line = { style: b.table.borders ? BorderStyle.SINGLE : BorderStyle.NONE, size: 4, color: '000000' };
      const borders = { top: line, bottom: line, left: line, right: line };
      children.push(
        new Table({
          width: { size: contentWidth, type: WidthType.DXA },
          columnWidths: Array.from({ length: cols }, () => colW),
          layout: TableLayoutType.FIXED,
          borders: { ...borders, insideHorizontal: line, insideVertical: line },
          rows: b.table.cells.map(
            (row) =>
              new TableRow({
                cantSplit: true,
                children: row.map(
                  (cell) =>
                    new TableCell({
                      width: { size: colW, type: WidthType.DXA },
                      borders,
                      margins: { top: 40, bottom: 40, left: 90, right: 90 },
                      children: cell.split('\n').map(
                        (t) => new Paragraph({ spacing: { line: tw(b.lineHeightPt), lineRule: LineRuleType.EXACT }, children: [run(t, b)] })
                      ),
                    })
                ),
              })
          ),
        })
      );
      continue;
    }

    const lines = b.text.split('\n');
    lines.forEach((lineText, li) => {
      const first = li === 0;
      const { label, rest } = first ? splitLabel(lineText) : { label: '', rest: lineText };
      const hanging = b.firstLinePt < -3 && !!label;
      const runs: TextRun[] = [];
      if (label && hanging) {
        runs.push(run(label, b));
        runs.push(new TextRun({ children: [new Tab(), rest], font: fontSpec, size: Math.round(b.fontPt * 2), sizeComplexScript: Math.round(b.fontPt * 2), bold: b.bold, boldComplexScript: b.bold, underline: b.underline ? { type: UnderlineType.SINGLE } : undefined, language: { value: 'en-IN', bidirectional: 'hi-IN' } } as any));
      } else {
        runs.push(run(lineText, b));
      }
      const left = b.align === 'left' || b.align === 'justify' ? b.leftIndentPt : 0;
      const firstLine = b.align === 'left' || b.align === 'justify' ? b.firstLinePt : 0;
      children.push(
        new Paragraph({
          alignment: ALIGN[b.align],
          keepNext: b.level > 0,
          keepLines: b.level > 0,
          pageBreakBefore: first && b.breakBefore,
          spacing: { before: first ? tw(b.spaceBeforePt) : 0, after: 0, line: tw(b.lineHeightPt), lineRule: LineRuleType.EXACT },
          indent: {
            left: tw(left),
            ...(firstLine < 0 ? { hanging: tw(-firstLine) } : firstLine > 0 ? { firstLine: tw(firstLine) } : {}),
          },
          tabStops: hanging ? [{ type: TabStopType.LEFT, position: tw(left) }] : undefined,
          children: runs,
        })
      );
    });
  }

  const doc = new Document({
    creator: 'Casemate',
    title: profile.name,
    styles: { default: { document: { run: { font: fontSpec, size: Math.round(profile.base.fontPt * 2), sizeComplexScript: Math.round(profile.base.fontPt * 2) } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: tw(page.paperWidthPt), height: tw(page.paperHeightPt) },
            margin: { top: tw(page.marginTopPt), bottom: tw(page.marginBottomPt), left: tw(page.marginLeftPt), right: tw(page.marginRightPt) },
          },
        },
        children,
      },
    ],
  });
  // toArrayBuffer works in the browser and in Node. toBuffer needs Node's Buffer and
  // throws "nodebuffer is not supported by this platform" on the website and in the app.
  const buf = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buf);
};

/* ------------------------------------------------------------------ */
/* Validation of the produced DOCX against the profile                 */
/* ------------------------------------------------------------------ */

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DraftValidation {
  ok: boolean;
  checks: Check[];
  problems: string[];
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kids = (el: any): any[] => Array.from(el.childNodes || []).filter((n: any) => n.nodeType === 1) as any[];
const isW = (el: any, local: string) => el && el.localName === local;
const norm = (s: string) => s.replace(/[\t\u00a0]+/g, ' ').replace(/\s+/g, ' ').trim();

interface ParsedPara {
  text: string;
  jc: string;
  bold: boolean;
  underline: boolean;
  pageBreakBefore: boolean;
  fontsOk: boolean;
  hasCs: boolean;
}

const parsePara = (p: any, font: string): ParsedPara => {
  const pPr = kids(p).find((c) => isW(c, 'pPr'));
  const jcEl = pPr && kids(pPr).find((c) => isW(c, 'jc'));
  const jc = jcEl ? jcEl.getAttribute('w:val') || jcEl.getAttributeNS(W_NS, 'val') || 'left' : 'left';
  let text = '';
  let bold = false;
  let underline = false;
  let fontsOk = true;
  let hasCs = false;
  let seen = 0;
  for (const r of Array.from(p.getElementsByTagNameNS(W_NS, 'r')) as any[]) {
    const rPr = kids(r).find((c) => isW(c, 'rPr'));
    const t = Array.from(r.childNodes).map((n: any) => (n.nodeType === 1 && n.localName === 't' ? n.textContent : n.nodeType === 1 && n.localName === 'tab' ? '\t' : n.nodeType === 1 && n.localName === 'br' ? '\n' : '')).join('');
    text += t;
    if (!t.trim()) continue;
    seen++;
    const b = rPr && kids(rPr).find((c) => isW(c, 'b'));
    const bcs = rPr && kids(rPr).find((c) => isW(c, 'bCs'));
    const u = rPr && kids(rPr).find((c) => isW(c, 'u'));
    const off = (el: any) => el && /^(0|false|none)$/i.test(el.getAttribute('w:val') || '');
    // Devanagari takes its weight from bCs, so both must be on for bold to show in Word.
    if (b && !off(b) && bcs && !off(bcs)) bold = bold || true;
    if (u && !off(u)) underline = true;
    const rf = rPr && kids(rPr).find((c) => isW(c, 'rFonts'));
    if (rf) {
      hasCs = hasCs || !!rf.getAttribute('w:cs');
      if (rf.getAttribute('w:ascii') !== font && rf.getAttribute('w:cs') !== font) fontsOk = false;
    } else fontsOk = false;
  }
  void seen;
  return { text, jc, bold, underline, pageBreakBefore: !!(pPr && kids(pPr).find((c) => isW(c, 'pageBreakBefore'))), fontsOk, hasCs };
};

export const validateDraft = async (opts: {
  profile: TemplateProfile;
  draft: Draft;
  docx: Uint8Array;
  /** text that legitimately contains template-like strings (case evidence + the advocate's request) */
  allowedText?: string;
}): Promise<DraftValidation> => {
  const { profile, draft } = opts;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  let xml = '';
  try {
    const zip = await JSZip.loadAsync(opts.docx);
    xml = (await zip.file('word/document.xml')?.async('string')) || '';
  } catch {
    xml = '';
  }
  add('opens', xml.length > 100, xml ? 'The DOCX opens and has a document body.' : 'The DOCX could not be opened.');
  if (!xml) return { ok: false, checks, problems: ['The DOCX could not be opened.'] };

  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const body = kids(dom.documentElement).find((c) => isW(c, 'body'))!;
  const topLevel = kids(body).filter((c) => isW(c, 'p') || isW(c, 'tbl'));
  const font = profile.base.fontName;

  // Expected top-level elements: one per text line of a block, one per table.
  const expected: { block: DraftBlock; line: string; first: boolean }[] = [];
  for (const b of draft.blocks) {
    if (b.table) expected.push({ block: b, line: '', first: true });
    else b.text.split('\n').forEach((line, i) => expected.push({ block: b, line, first: i === 0 }));
  }
  add('structure', topLevel.length === expected.length, `${topLevel.length} paragraphs/tables in the file, ${expected.length} expected.`);

  let textMismatch = 0;
  let styleMismatch = 0;
  let headingMismatch = 0;
  let fontIssues = 0;
  let emptyParas = 0;
  let pageBreaks = 0;
  const outTexts: string[] = [];
  const n = Math.min(topLevel.length, expected.length);
  for (let i = 0; i < n; i++) {
    const el = topLevel[i];
    const exp = expected[i];
    if (isW(el, 'tbl')) {
      const rows = kids(el).filter((c) => isW(c, 'tr'));
      const got = rows.map((tr) => kids(tr).filter((c) => isW(c, 'tc')).map((tc) => norm(Array.from(tc.getElementsByTagNameNS(W_NS, 'p')).map((p: any) => parsePara(p, font).text).join('\n'))));
      const want = exp.block.table ? exp.block.table.cells.map((r) => r.map((c) => norm(c.replace(/\n/g, '\n')))) : [];
      if (JSON.stringify(got) !== JSON.stringify(want)) textMismatch++;
      outTexts.push(got.map((r) => r.join(' | ')).join('\n'));
      continue;
    }
    if (exp.block.table) { textMismatch++; continue; }
    const pp = parsePara(el, font);
    outTexts.push(pp.text);
    if (!pp.text.trim()) emptyParas++;
    if (norm(pp.text) !== norm(exp.line)) textMismatch++;
    // the file must carry the APPROVED profile's formatting, whatever the draft object says
    const tplBlock = profile.blocks.find((b) => b.id === exp.block.templateBlockId) || exp.block;
    const jcWant = tplBlock.align === 'justify' ? 'both' : tplBlock.align;
    const jcGot = pp.jc === 'start' ? 'left' : pp.jc === 'end' ? 'right' : pp.jc;
    if (exp.first) {
      const bad = jcGot !== jcWant || pp.bold !== tplBlock.bold || pp.underline !== tplBlock.underline;
      if (bad) { styleMismatch++; if (exp.block.level > 0) headingMismatch++; }
    }
    if (!pp.fontsOk) fontIssues++;
    if (pp.pageBreakBefore) pageBreaks++;
  }
  add('text', textMismatch === 0, textMismatch ? `${textMismatch} paragraph(s) differ from the reconstructed text.` : 'Every paragraph and table cell matches the reconstructed text.');
  add('styles', styleMismatch === 0, styleMismatch ? `${styleMismatch} paragraph(s) differ in alignment, bold or underline from the approved profile.` : 'Alignment, bold and underline match the approved profile for every block.');
  add('headings', headingMismatch === 0, headingMismatch ? `${headingMismatch} heading(s) lost their bold/underline/alignment.` : 'Headings keep their bold, underline and alignment.');
  add('fonts', fontIssues === 0, fontIssues ? `${fontIssues} paragraph(s) do not carry the Devanagari-capable font ${font}.` : `Every run carries ${font} (including the complex-script font for Hindi).`);
  add('blank-paragraphs', emptyParas === 0, emptyParas ? `${emptyParas} empty paragraph(s) would show as blank lines.` : 'No unintended empty paragraphs.');
  const expectedBreaks = draft.blocks.filter((b) => b.breakBefore).length;
  add('page-breaks', pageBreaks === expectedBreaks, `${pageBreaks} page break(s) in the file, ${expectedBreaks} expected from the template.`);

  // Page setup
  const sect = Array.from(dom.getElementsByTagNameNS(W_NS, 'sectPr'))[0] as any;
  const pgSz = sect && Array.from(sect.getElementsByTagNameNS(W_NS, 'pgSz'))[0] as any;
  const pgMar = sect && Array.from(sect.getElementsByTagNameNS(W_NS, 'pgMar'))[0] as any;
  const g = (el: any, a: string) => (el ? Number(el.getAttribute(`w:${a}`)) : NaN);
  const p0 = profile.pages[0];
  const near = (a: number, b: number) => Math.abs(a - b) <= 25;
  add(
    'page-setup',
    !!pgSz && near(g(pgSz, 'w'), tw(p0.paperWidthPt)) && near(g(pgSz, 'h'), tw(p0.paperHeightPt)) && !!pgMar && near(g(pgMar, 'left'), tw(p0.marginLeftPt)) && near(g(pgMar, 'right'), tw(p0.marginRightPt)) && near(g(pgMar, 'top'), tw(p0.marginTopPt)) && near(g(pgMar, 'bottom'), tw(p0.marginBottomPt)),
    `Page ${p0.paper} ${Math.round(g(pgSz, 'w') / 20)}×${Math.round(g(pgSz, 'h') / 20)} pt, margins L${Math.round(g(pgMar, 'left') / 20)} R${Math.round(g(pgMar, 'right') / 20)} T${Math.round(g(pgMar, 'top') / 20)} B${Math.round(g(pgMar, 'bottom') / 20)} pt (profile: L${p0.marginLeftPt} R${p0.marginRightPt} T${p0.marginTopPt} B${p0.marginBottomPt}).`
  );

  // Only intended content changed
  const unchangedBad = draft.blocks.filter((b) => !b.changed && !b.table && norm(b.text) !== norm(b.originalText));
  // a paragraph that was only renumbered must be identical to the template apart from its number
  const renumberBad = draft.blocks.filter((b) => b.renumbered && norm(splitLabel(b.text).rest) !== norm(splitLabel(b.originalText).rest));
  add('boilerplate', unchangedBad.length === 0 && renumberBad.length === 0, unchangedBad.length || renumberBad.length ? `${unchangedBad.length + renumberBad.length} template paragraph(s) changed without being a field.` : 'Every paragraph that is not an approved field is word-for-word the template (renumbered paragraphs differ only in their number).');
  const fieldIds = new Set(profile.fields.map((f) => f.id.split('.')[0]));
  const stray = draft.blocks.filter((b) => b.changed && !b.renumbered && !fieldIds.has(b.templateBlockId));
  add('only-fields', stray.length === 0, stray.length ? `${stray.length} block(s) changed outside the approved fields.` : 'Only approved fields were changed.');

  // Template sample facts must not leak
  const allowed = (opts.allowedText || '').toLowerCase();
  const changedText = draft.blocks.filter((b) => b.changed).map((b) => (b.table ? b.table.cells.flat().join(' ') : b.text)).join('\n').toLowerCase();
  const leaks: string[] = [];
  for (const f of profile.fields) for (const s of f.samples) {
    if (s.length >= 3 && changedText.includes(s.toLowerCase()) && !allowed.includes(s.toLowerCase())) leaks.push(s);
  }
  add('sample-leak', leaks.length === 0, leaks.length ? `Sample values from the template appear in the new document: ${leaks.slice(0, 4).join('; ')}.` : 'No sample name, date or number from the template appears in the new case.');

  // Missing facts stay visible
  const unmarked = draft.blocks.filter((b) => b.needsVerification && !(b.table ? b.table.cells.flat().join(' ') : b.text).includes(BLANK));
  const blanks = draft.blocks.filter((b) => (b.table ? b.table.cells.flat().join(' ') : b.text).includes(BLANK)).length;
  add('placeholders', unmarked.length === 0, `${blanks} block(s) carry ${BLANK} for facts to verify${unmarked.length ? `; ${unmarked.length} flagged block(s) have no visible placeholder` : ''}.`);

  // Numbering
  const nums = draft.blocks.filter((b) => b.type === 'numbered').map((b) => labelNumber(b.label)).filter((v): v is number => v !== null);
  const seqOk = nums.every((v, i) => v === (nums[0] ?? 1) + i);
  add('numbering', seqOk, seqOk ? `Numbered paragraphs run ${nums[0] ?? '-'}…${nums[nums.length - 1] ?? '-'} without gaps.` : `Numbered paragraphs are not in sequence: ${nums.join(', ')}.`);

  // Section order and presence: the draft must keep the order the template itself has.
  const typeOf: Record<string, (b: DraftBlock) => boolean> = {
    court: (b) => b.type === 'court_heading',
    title: (b) => b.type === 'title',
    parties: (b) => b.type === 'party',
    prayer: (b) => b.level > 0 && /प्रार्थना|prayer/i.test(b.text),
    signature: (b) => b.type === 'signature',
    verification: (b) => b.type === 'verification_heading' || b.type === 'verification',
    annexure: (b) => b.type === 'annexure_heading' || b.type === 'annexure',
  };
  const wanted = profile.anchors
    .filter((a) => typeOf[a.name])
    .map((a) => ({ name: a.name, at: profile.blocks.findIndex((b) => b.id === a.blockId) }))
    .sort((x, y) => x.at - y.at)
    .map((a) => a.name);
  const idx = wanted.map((o) => draft.blocks.findIndex(typeOf[o]));
  const missing = wanted.filter((_, i) => idx[i] < 0);
  const ordered = idx.filter((v) => v >= 0).every((v, i, arr) => i === 0 || v >= arr[i - 1]);
  add('sections', missing.length === 0 && ordered, missing.length ? `Missing sections: ${missing.join(', ')}.` : ordered ? `Sections present and in the template's order: ${wanted.join(' → ')}.` : 'Sections are out of the template order.');

  // Duplicates beyond what the template has
  const count = (list: string[]) => list.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map<string, number>());
  const tplCounts = count(profile.blocks.filter((b) => !b.table && b.text.length >= 30).map((b) => norm(b.text)));
  const outCounts = count(draft.blocks.filter((b) => !b.table && b.text.length >= 30).map((b) => norm(b.text)));
  const dups = [...outCounts].filter(([t, c]) => c > (tplCounts.get(t) || 1));
  add('duplicates', dups.length === 0, dups.length ? `${dups.length} paragraph(s) appear more often than in the template.` : 'No duplicated paragraphs.');

  // Missing content: every block's words are in the file
  const fileText = norm(outTexts.join(' '));
  const lost = draft.blocks.filter((b) => !b.table && b.text.trim() && !fileText.includes(norm(b.text.split('\n')[0]).slice(0, 60)));
  add('content', lost.length === 0, lost.length ? `${lost.length} block(s) are missing from the file.` : 'All reconstructed content is in the file.');

  const problems = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  return { ok: problems.length === 0, checks, problems };
};

/* ------------------------------------------------------------------ */
/* Fixed-layout plan (original scan as background)                     */
/* ------------------------------------------------------------------ */

export type MeasureText = (text: string, fontPx: number, bold: boolean) => number;

export interface FixedItem {
  blockId: string;
  page: number;
  /** area of the original page to clear (pixels of the stored page image) */
  region: PxBox;
  /** where the new lines are drawn */
  lines: { text: string; x: number; y: number }[];
  fontPx: number;
  lineHeightPx: number;
  bold: boolean;
  underline: boolean;
  align: Align;
  fits: boolean;
  /** 1 = same size as the template; < 1 = shrunk (never below the readability floor) */
  scale: number;
  /** the "1." / "(क)" of a hanging paragraph, drawn at the template's own label position */
  label?: { text: string; x: number; y: number };
}

export interface FixedPlan {
  eligible: boolean;
  reasons: string[];
  items: FixedItem[];
}

const wrapWords = (text: string, widthFirst: number, widthRest: number, measure: (s: string) => number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const w0 = lines.length === 0 ? widthFirst : widthRest;
    const trial = cur ? `${cur} ${w}` : w;
    if (cur && measure(trial) > w0) { lines.push(cur); cur = w; } else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
};

export const MIN_READABLE_PT = 9;

export const planFixedLayout = (profile: TemplateProfile, draft: Draft, measure: MeasureText): FixedPlan => {
  const reasons: string[] = [];
  if (draft.rewrote) reasons.push('A paragraph was rewritten, so the text no longer fits the template\'s fixed lines.');
  if (draft.blocks.length !== profile.blocks.length) reasons.push('The number of blocks changed.');
  if (draft.blocks.some((b) => b.table && b.changed)) reasons.push('A table cell changed; table cells have no fixed region on the scan.');
  const lineById = new Map(profile.lines.map((l) => [l.id, l]));
  const items: FixedItem[] = [];
  if (reasons.length) return { eligible: false, reasons, items };

  draft.blocks.forEach((d, bi) => {
    if (!d.changed) return;
    const tpl = profile.blocks[bi];
    const lines = tpl.lineIds.map((id) => lineById.get(id)!).filter(Boolean);
    if (!lines.length) return;
    const pageNos = new Set(lines.map((l) => l.page));
    if (pageNos.size > 1) { reasons.push(`"${tpl.text.slice(0, 30)}…" runs across two pages.`); return; }
    const page = profile.pages[lines[0].page - 1];
    const W = page.widthPx;
    const H = page.heightPx;
    const ptY = page.paperHeightPt / H;
    const boxes = lines.map((l) => ({ x: l.box.x * W, y: l.box.y * H, w: l.box.w * W, h: l.box.h * H }));
    const x1 = Math.min(...boxes.map((b) => b.x));
    const x2 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.min(...boxes.map((b) => b.y));
    const y2 = Math.max(...boxes.map((b) => b.y + b.h));
    const rightLimit = (page.contentBox.x + page.contentBox.w) * W;
    const leftLimit = page.contentBox.x * W;
    const lh = Math.max(tpl.lineHeightPt / ptY, 1);
    const fontPx0 = tpl.fontPt / ptY;
    const minPx = MIN_READABLE_PT / ptY;

    // free space below before the next block starts
    const next = profile.blocks[bi + 1];
    let nextTop = H - page.marginBottomPt / ptY;
    if (next) {
      if (next.table && next.table.page === lines[0].page) nextTop = next.table.box.y * H;
      else {
        const nl = next.lineIds.length ? lineById.get(next.lineIds[0]) : null;
        if (nl && nl.page === lines[0].page) nextTop = nl.box.y * H;
      }
    }
    const freeBelow = Math.max(0, nextTop - y2 - lh * 0.35);

    const hang = d.firstLinePt < -3 ? splitLabel(d.text.split('\n')[0]) : { label: '', rest: '' };
    const bodyText = hang.label ? [hang.rest, ...d.text.split('\n').slice(1)].join('\n') : d.text;
    const layout = (fontPx: number) => {
      const availRight = d.align === 'right' ? x2 : rightLimit;
      const availLeft = d.align === 'right' ? leftLimit : x1;
      const xRest = leftLimit + Math.max(0, d.leftIndentPt) / (page.paperWidthPt / W);
      const first = d.align === 'center' ? rightLimit - leftLimit : hang.label ? availRight - xRest : availRight - availLeft;
      const rest = d.align === 'center' ? first : availRight - (d.align === 'right' ? availLeft : xRest);
      const wrapped = bodyText.split('\n').flatMap((t) => wrapWords(t, first, rest, (s) => measure(s, fontPx, d.bold)));
      return { wrapped, first, rest, availLeft, availRight, xRest };
    };

    let scale = 1;
    let fontPx = fontPx0;
    let lay = layout(fontPx);
    const oneH = boxes.map((b) => b.h).sort((a, b) => a - b)[Math.floor(boxes.length / 2)];
    const availH = y2 - y1 + freeBelow;
    // n lines need (n-1) line pitches plus the ink height of the last one — the same measure the template used.
    const needH = (n: number, sc: number) => (n - 1) * lh * sc + oneH * sc;
    let fits = needH(lay.wrapped.length, 1) <= availH + 1;
    while (!fits && fontPx > minPx) {
      fontPx = Math.max(minPx, fontPx * 0.96);
      scale = fontPx / fontPx0;
      lay = layout(fontPx);
      fits = needH(lay.wrapped.length, scale) <= availH + 1;
      if (fontPx <= minPx) break;
    }
    const lineH = lh * (scale < 1 ? scale : 1);
    const placed = lay.wrapped.map((text, i) => {
      const w = measure(text, fontPx, d.bold);
      const slotW = i === 0 ? lay.first : lay.rest;
      const left = i === 0 ? (hang.label ? lay.xRest : d.align === 'right' ? lay.availLeft : x1) : Math.max(lay.xRest, d.align === 'right' ? lay.availLeft : lay.xRest);
      const x = d.align === 'center' ? leftLimit + (rightLimit - leftLimit - w) / 2 : d.align === 'right' ? lay.availRight - w : left;
      void slotW;
      return { text, x, y: y1 + i * lineH };
    });
    const regionH = Math.max(y2 - y1, needH(lay.wrapped.length, scale));
    items.push({
      blockId: d.templateBlockId,
      page: lines[0].page,
      region: { x: Math.min(x1, ...placed.map((p) => p.x)) - 4, y: y1 - 3, w: Math.max(x2, ...placed.map((p) => p.x + measure(p.text, fontPx, d.bold))) - Math.min(x1, ...placed.map((p) => p.x)) + 8, h: regionH + 6 },
      lines: placed,
      label: hang.label ? { text: hang.label, x: x1, y: y1 } : undefined,
      fontPx,
      lineHeightPx: lineH,
      bold: d.bold,
      underline: d.underline,
      align: d.align,
      fits,
      scale,
    });
    if (!fits) reasons.push(`The text for "${tpl.text.slice(0, 30)}…" does not fit its area on the scan even at the smallest readable size.`);
  });
  return { eligible: reasons.length === 0, reasons, items };
};

/**
 * Compares the rendered page with the original scan everywhere EXCEPT the regions that were meant to change.
 * Returns the share of pixels (0..1) that differ by more than a small tolerance.
 */
export const diffOutsideRegions = (
  a: { data: Uint8Array | Uint8ClampedArray; width: number; height: number },
  b: { data: Uint8Array | Uint8ClampedArray; width: number; height: number },
  regions: PxBox[],
  tolerance = 24
): number => {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let diff = 0;
  let total = 0;
  const inRegion = (x: number, y: number) => regions.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  for (let y = 0; y < a.height; y += 2) {
    for (let x = 0; x < a.width; x += 2) {
      if (inRegion(x, y)) continue;
      total++;
      if (Math.abs(a.data[y * a.width + x] - b.data[y * b.width + x]) > tolerance) diff++;
    }
  }
  return total ? diff / total : 0;
};
