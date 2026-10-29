/**
 * Template-faithful DOCX filling.
 *
 *   The uploaded Word template is the MASTER DOCUMENT.
 *   Case papers are FACT SOURCES ONLY.
 *   The AI decides WHAT replacement content is right; this engine decides
 *   WHERE it goes. The original OOXML is edited in place — it is never
 *   rebuilt — so tables, numbering, headers, footers, logos, page breaks and
 *   styles stay exactly as the template has them.
 *
 * Stages (each is a separate function with its own data):
 *   1. readTemplate          – open the .docx and inventory its paragraphs
 *   2. analyzeTemplate       – AI sees ONLY the template and names the fields
 *                              that hold sample-case content (everything else
 *                              is boilerplate and is kept untouched)
 *   3. fillFields            – AI sees the fields + the case evidence and
 *                              returns replacement values as JSON
 *   4. validate*             – deterministic checks on both AI answers
 *   5. applyReplacements     – edit a copy of the original XML
 *   6. verifyOutput          – re-open the result and prove nothing else moved
 *
 * No browser-only APIs besides DOMParser / XMLSerializer, which tests inject.
 */
import JSZip from 'jszip';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const BLANK = '________';

export class TemplateFillError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TemplateFillError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* DOM helpers (childNodes only, so they work in browsers and xmldom)  */
/* ------------------------------------------------------------------ */

const els = (node: any): any[] => {
  const out: any[] = [];
  const kids = node?.childNodes;
  if (!kids) return out;
  for (let i = 0; i < kids.length; i++) if (kids[i].nodeType === 1) out.push(kids[i]);
  return out;
};
const isW = (el: any, local: string) => el && el.nodeType === 1 && el.localName === local && (!el.namespaceURI || el.namespaceURI === W_NS);
const childW = (el: any, local: string) => els(el).find((c) => isW(c, local)) || null;
const descendantsW = (root: any, local: string): any[] => Array.from(root.getElementsByTagNameNS(W_NS, local)) as any[];

const parseXml = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new TemplateFillError('BAD_XML', 'Part is not well-formed XML');
  return doc;
};
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const serializeXml = (doc: any) => {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith('<?xml') ? xml : XML_DECL + xml;
};

/* ------------------------------------------------------------------ */
/* 1. Read the template                                                */
/* ------------------------------------------------------------------ */

export interface RunSeg {
  run: any;
  /** true when the run holds only <w:t> text and may be edited in place */
  editable: boolean;
  text: string;
  start: number;
}

export interface TemplatePara {
  id: string;
  part: string;
  el: any;
  text: string;
  inTable: boolean;
  numbered: boolean;
  hasDrawing: boolean;
}

export interface PartDoc {
  path: string;
  doc: any;
  dirty: boolean;
}

export interface TemplateModel {
  zip: JSZip;
  parts: PartDoc[];
  paras: TemplatePara[];
  byId: Map<string, TemplatePara>;
}

const PART_PATTERN = /^word\/(document|header\d*|footer\d*)\.xml$/;
const SKIP_CONTAINERS = new Set(['txbxContent', 'drawing', 'pict', 'object', 'del', 'moveFrom', 'AlternateContent']);

/** Runs that belong to this paragraph's own text (not to nested text boxes, not deleted text). */
const paragraphRuns = (p: any): any[] => {
  const out: any[] = [];
  const walk = (node: any) => {
    for (const c of els(node)) {
      if (isW(c, 'r')) out.push(c);
      else if (SKIP_CONTAINERS.has(c.localName)) continue;
      else if (isW(c, 'p')) continue;
      else walk(c);
    }
  };
  walk(p);
  return out;
};

const runIsPlainText = (r: any): boolean => {
  const kids = els(r).filter((c) => !isW(c, 'rPr'));
  return kids.length > 0 && kids.every((c) => isW(c, 't'));
};

const runText = (r: any): string => {
  let t = '';
  for (const c of els(r)) {
    if (isW(c, 't')) t += c.textContent || '';
    else if (isW(c, 'tab')) t += '\t';
    else if (isW(c, 'br') || isW(c, 'cr')) {
      if (c.getAttribute('w:type') !== 'page') t += '\n';
    }
  }
  return t;
};

export const paragraphSegments = (p: any): RunSeg[] => {
  const segs: RunSeg[] = [];
  let pos = 0;
  for (const r of paragraphRuns(p)) {
    const text = runText(r);
    const editable = runIsPlainText(r);
    segs.push({ run: r, editable, text, start: pos });
    pos += text.length;
  }
  return segs;
};

export const paragraphText = (p: any): string => paragraphSegments(p).map((s) => s.text).join('');

const hasAncestorW = (el: any, local: string): boolean => {
  let cur = el?.parentNode;
  while (cur) {
    if (isW(cur, local)) return true;
    cur = cur.parentNode;
  }
  return false;
};

const paragraphHasDrawing = (p: any): boolean =>
  ['drawing', 'pict', 'object'].some((n) => descendantsW(p, n).length > 0)
  || Array.from(p.getElementsByTagName('w:drawing')).length > 0;

export const readTemplate = async (bytes: Uint8Array | ArrayBuffer): Promise<TemplateModel> => {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new TemplateFillError('NOT_DOCX', 'The template is not a readable .docx file.');
  }
  if (!zip.file('word/document.xml')) throw new TemplateFillError('NOT_DOCX', 'The template has no word/document.xml.');
  const paths = Object.keys(zip.files).filter((p) => PART_PATTERN.test(p)).sort((a, b) => {
    // body first, then headers, then footers
    const rank = (x: string) => (x.includes('document.xml') ? 0 : x.includes('header') ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true });
  });
  const parts: PartDoc[] = [];
  const paras: TemplatePara[] = [];
  const byId = new Map<string, TemplatePara>();
  for (const path of paths) {
    const xml = await zip.file(path)!.async('string');
    const doc = parseXml(xml);
    parts.push({ path, doc, dirty: false });
    const prefix = path.includes('document.xml') ? 'B' : path.includes('header') ? `H${path.replace(/\D/g, '') || '1'}-` : `F${path.replace(/\D/g, '') || '1'}-`;
    let n = 0;
    for (const p of descendantsW(doc, 'p')) {
      n += 1;
      const text = paragraphText(p);
      if (!text.trim()) continue;
      const pPr = childW(p, 'pPr');
      const id = `${prefix}${n}`;
      const para: TemplatePara = {
        id,
        part: path,
        el: p,
        text,
        inTable: hasAncestorW(p, 'tc'),
        numbered: !!(pPr && childW(pPr, 'numPr')),
        hasDrawing: paragraphHasDrawing(p),
      };
      paras.push(para);
      byId.set(id, para);
    }
  }
  if (paras.length === 0) throw new TemplateFillError('NO_PARAGRAPHS', 'The template has no text to work from.');
  return { zip, parts, paras, byId };
};

/** Inventory handed to the AI: ids and text only — nothing from any case paper. */
export const inventoryText = (model: TemplateModel, maxChars = 60000): string => {
  let out = '';
  for (const p of model.paras) {
    const flags = [p.part.includes('header') ? 'header' : p.part.includes('footer') ? 'footer' : '', p.inTable ? 'table' : '', p.numbered ? 'numbered' : ''].filter(Boolean).join(',');
    const line = `${p.id}${flags ? ` [${flags}]` : ''}: ${p.text.replace(/\s+/g, ' ').slice(0, 1500)}\n`;
    if (out.length + line.length > maxChars) { out += '[…inventory truncated…]\n'; break; }
    out += line;
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* 2. Template analysis (AI sees the template ONLY)                    */
/* ------------------------------------------------------------------ */

export type FieldMode = 'values' | 'rewrite';

export interface TemplateField {
  id: string;
  mode: FieldMode;
  purpose: string;
  /** exact substrings of the paragraph that belong to the sample case (mode 'values') */
  samples: string[];
}

export const ANALYZE_SYSTEM =
  'You analyse a legal document TEMPLATE that was originally written for a DIFFERENT, past case. ' +
  'You find which paragraphs carry that past case\'s own facts. You never invent text and never change anything.';

export const analyzePrompt = (inventory: string, language: string): string =>
  `Below are the paragraphs of an advocate's Word template, each with an id. The template was written for a past case; its names, dates, numbers and story are SAMPLE content that will be replaced by a new case.\n` +
  `Decide, for each paragraph, whether it is BOILERPLATE (keep untouched) or carries SAMPLE-CASE content.\n\n` +
  `KEEP (do not list): court headings and titles, section/heading labels, standard legal formulae and statutory text, precedents, prayer wording that is generic, labels such as स्थान / दिनांक / Place / Date, signature captions, headers and footers that are not case specific.\n` +
  `LIST a paragraph only if it contains facts of the sample case: party names and parentage, addresses, dates, case/FIR/crime numbers, police station, court/place of the sample matter, amounts, vehicle or document numbers, or the narrative of the sample events/grounds.\n\n` +
  `For each listed paragraph choose a mode:\n` +
  `- "values": the wording is reusable and only some words are sample facts. Give "samples": the exact sample-fact substrings, copied CHARACTER FOR CHARACTER from the paragraph.\n` +
  `- "rewrite": the whole paragraph is the sample case's own story/grounds and must be rewritten for the new case.\n` +
  `Add a short "purpose" (for example "applicant name and parentage", "FIR details", "ground about ownership").\n\n` +
  `Return ONLY JSON: {"fields":[{"id":"B12","mode":"values","purpose":"...","samples":["..."]},{"id":"B20","mode":"rewrite","purpose":"..."}]}\n` +
  `Use only ids that appear below. Document language: ${language}.\n\n` +
  `--- TEMPLATE PARAGRAPHS ---\n${inventory}--- END ---`;

export const parseJsonLoose = (raw: string): any => {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { /* fall through */ }
    }
    throw new TemplateFillError('BAD_JSON', 'The AI did not return valid JSON.');
  }
};

export const validateFields = (model: TemplateModel, analysis: any): { fields: TemplateField[]; notes: string[] } => {
  const notes: string[] = [];
  const list = Array.isArray(analysis?.fields) ? analysis.fields : [];
  const fields: TemplateField[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    const id = String(f?.id || '');
    const para = model.byId.get(id);
    if (!para || seen.has(id)) { if (id) notes.push(`Ignored unknown or repeated field ${id}.`); continue; }
    const mode: FieldMode = f?.mode === 'rewrite' ? 'rewrite' : f?.mode === 'values' ? 'values' : (null as any);
    if (!mode) { notes.push(`Ignored field ${id}: unknown mode.`); continue; }
    const purpose = String(f?.purpose || '').slice(0, 120) || id;
    if (mode === 'rewrite') {
      fields.push({ id, mode, purpose, samples: [] });
      seen.add(id);
      continue;
    }
    const samples = (Array.isArray(f?.samples) ? f.samples : [])
      .map((s: any) => String(s || ''))
      .filter((s: string) => s.length > 0 && para.text.includes(s));
    const unique = Array.from(new Set<string>(samples)) as string[];
    if (unique.length === 0) { notes.push(`Field ${id} (${purpose}): the sample values were not found in the paragraph, so it was left as in the template.`); continue; }
    fields.push({ id, mode, purpose, samples: unique });
    seen.add(id);
  }
  return { fields, notes };
};

/* ------------------------------------------------------------------ */
/* 3. Fill the fields (AI sees fields + case evidence)                 */
/* ------------------------------------------------------------------ */

export const FILL_SYSTEM =
  'You fill specific fields of a legal template with facts of the NEW case. ' +
  'The only source of facts is the CASE EVIDENCE and the advocate\'s instruction. ' +
  'The template text shown is a different past case: never reuse its names, dates, numbers or story. ' +
  'Never invent a fact. Return JSON only.';

export const fillPrompt = (model: TemplateModel, fields: TemplateField[], evidence: string, userRequest: string, language: string, today: string): string => {
  const fieldBlock = fields.map((f) => {
    const p = model.byId.get(f.id)!;
    return f.mode === 'values'
      ? `${f.id} | mode=values | ${f.purpose}\n  paragraph: ${p.text.replace(/\s+/g, ' ').slice(0, 1500)}\n  samples: ${JSON.stringify(f.samples)}`
      : `${f.id} | mode=rewrite | ${f.purpose}\n  sample paragraph (different case — structure and register only): ${p.text.replace(/\s+/g, ' ').slice(0, 1500)}`;
  }).join('\n');
  return (
    `Fill the fields below for the NEW case.\n\n` +
    `RULES\n` +
    `1. Use only facts found in CASE EVIDENCE or the ADVOCATE INSTRUCTION. Copy names, dates and numbers exactly as written there.\n` +
    `2. mode=values: give a replacement "value" for EACH sample, same order. Keep the value short and in the form the sentence needs.\n` +
    `3. mode=rewrite: return "paragraphs": an array of new paragraphs for this field (as many as the new case needs, in the sample's legal register and numbering style such as "1." or "(क)", renumbered from the sample's first number). An empty array means this ground does not apply to the new case.\n` +
    `4. If a needed fact is missing, or the evidence contradicts itself (for example two different dates for the same event), do NOT guess: use "${BLANK}" for that value, set "needsReview": true and explain in "uncertainty".\n` +
    `5. List the source of the facts you used in "sources" as ["file name, page N"].\n` +
    `6. Write in ${language}. Today's date is ${today} (use it only for a signing/filing date field).\n\n` +
    `Return ONLY JSON:\n` +
    `{"replacements":[{"id":"B12","values":[{"sample":"<exact sample>","value":"<new value>"}],"sources":["..."],"needsReview":false,"uncertainty":""},{"id":"B20","paragraphs":["..."],"sources":["..."],"needsReview":false,"uncertainty":""}]}\n\n` +
    `--- FIELDS ---\n${fieldBlock}\n--- END FIELDS ---\n\n` +
    `--- CASE EVIDENCE (the only source of facts) ---\n${evidence || '(none)'}\n--- END CASE EVIDENCE ---\n\n` +
    `--- ADVOCATE INSTRUCTION ---\n${userRequest || '(none)'}\n--- END INSTRUCTION ---`
  );
};

/* ------------------------------------------------------------------ */
/* 4. Validation of the AI's replacements                              */
/* ------------------------------------------------------------------ */

export interface ValidReplacement {
  id: string;
  mode: FieldMode;
  values: { sample: string; value: string }[];
  paragraphs: string[];
  sources: string[];
  review: string[];
}

const DEV_DIGITS = '०१२३४५६७८९';
export const asciiDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d)));
const norm = (s: string) => asciiDigits(s).replace(/\s+/g, ' ').toLowerCase();

const DATE_RE = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;
const dateKey = (d: string, m: string, y: string) => `${Number(d)}-${Number(m)}-${y.length === 2 ? 2000 + Number(y) : Number(y)}`;
const dateKeys = (s: string): Set<string> => {
  const out = new Set<string>();
  const t = asciiDigits(s);
  let m: RegExpExecArray | null;
  const re = new RegExp(DATE_RE.source, 'g');
  while ((m = re.exec(t))) out.add(dateKey(m[1], m[2], m[3]));
  return out;
};
const NUM_RE = /\d{2,}(?:[\/.\-]\d+)*/g;

export const validateReplacements = (
  fields: TemplateField[],
  model: TemplateModel,
  answer: any,
  evidence: string,
  userRequest: string,
  today: string
): { valid: ValidReplacement[]; review: string[] } => {
  const review: string[] = [];
  const list = Array.isArray(answer?.replacements) ? answer.replacements : [];
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const sourceText = norm(`${evidence}\n${userRequest}\n${today}`);
  const knownDates = dateKeys(`${evidence}\n${userRequest}\n${today}`);

  // Every sample fact of the template, so none of them can leak into the new case.
  const sampleStrings = new Set<string>();
  const sampleNumbers = new Set<string>();
  for (const f of fields) {
    const orig = model.byId.get(f.id)!.text;
    f.samples.forEach((s) => sampleStrings.add(s));
    if (f.mode === 'rewrite') (asciiDigits(orig).match(NUM_RE) || []).forEach((n) => sampleNumbers.add(n));
    else f.samples.forEach((s) => (asciiDigits(s).match(NUM_RE) || []).forEach((n) => sampleNumbers.add(n)));
  }

  const scrub = (text: string, label: string, notes: string[]): string => {
    let out = String(text ?? '');
    // 1) a sample string of the template that the new case's papers do not contain
    for (const s of sampleStrings) {
      if (s.length < 2) continue;
      if (norm(out).includes(norm(s)) && !sourceText.includes(norm(s))) {
        const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        out = out.replace(re, BLANK);
        notes.push(`${label}: a value from the template's sample case ("${s.slice(0, 40)}") was removed; please fill it.`);
      }
    }
    // 2) numbers that exist only in the template
    for (const n of sampleNumbers) {
      if (!sourceText.includes(norm(n)) && asciiDigits(out).includes(n)) {
        out = asciiDigits(out).split(n).join(BLANK);
        notes.push(`${label}: number ${n} came from the template's sample case and was removed; please fill it.`);
      }
    }
    // 3) dates the case papers (and today) do not support
    const t = asciiDigits(out);
    out = t.replace(new RegExp(DATE_RE.source, 'g'), (match, d, m, y) => {
      if (knownDates.has(dateKey(d, m, y))) return match;
      notes.push(`${label}: date ${match} is not in the case papers and was left blank.`);
      return BLANK;
    });
    return out === asciiDigits(String(text ?? '')) ? String(text ?? '') : out;
  };

  const valid: ValidReplacement[] = [];
  const done = new Set<string>();
  for (const r of list) {
    const id = String(r?.id || '');
    const field = fieldById.get(id);
    if (!field || done.has(id)) { review.push(`Ignored a replacement for ${id || 'an unknown field'}: it is not an approved field.`); continue; }
    done.add(id);
    const label = `${field.purpose} (${id})`;
    const notes: string[] = [];
    const sources = (Array.isArray(r?.sources) ? r.sources : []).map((x: any) => String(x)).slice(0, 8);
    const flagged = r?.needsReview === true || (typeof r?.uncertainty === 'string' && r.uncertainty.trim().length > 0);
    if (flagged) notes.push(`${label}: ${String(r?.uncertainty || 'needs your review').slice(0, 200)}`);

    if (field.mode === 'values') {
      const given = Array.isArray(r?.values) ? r.values : [];
      const values: { sample: string; value: string }[] = [];
      for (const s of field.samples) {
        const hit = given.find((v: any) => String(v?.sample || '') === s);
        let value = hit && typeof hit.value === 'string' ? hit.value : '';
        if (!value.trim()) { value = BLANK; notes.push(`${label}: no value was found for "${s.slice(0, 40)}"; left blank.`); }
        else if (flagged || hit?.needsReview === true) { value = BLANK; }
        else value = scrub(value, label, notes);
        values.push({ sample: s, value });
      }
      valid.push({ id, mode: 'values', values, paragraphs: [], sources, review: notes });
    } else {
      const paras = (Array.isArray(r?.paragraphs) ? r.paragraphs : []).map((x: any) => String(x ?? '')).filter((x: string) => x.trim().length > 0);
      const cleaned = paras.map((p: string) => scrub(p, label, notes));
      valid.push({ id, mode: 'rewrite', values: [], paragraphs: cleaned, sources, review: notes });
    }
    review.push(...notes);
  }
  for (const f of fields) {
    if (!done.has(f.id)) review.push(`${f.purpose} (${f.id}): the AI returned nothing, so this paragraph was left as in the template — please check it.`);
  }
  return { valid, review };
};

/* ------------------------------------------------------------------ */
/* 5. Apply the replacements to the original XML                       */
/* ------------------------------------------------------------------ */

const setRunText = (run: any, text: string) => {
  const ts = els(run).filter((c) => isW(c, 't'));
  if (ts.length === 0) return;
  ts[0].textContent = text;
  ts[0].setAttribute('xml:space', 'preserve');
  for (let i = 1; i < ts.length; i++) run.removeChild(ts[i]);
};

/** Replace every occurrence of `find` while keeping each run's own formatting. */
export const replaceInParagraph = (p: any, find: string, replacement: string): { replaced: number; failed: number } => {
  if (!find) return { replaced: 0, failed: 0 };
  const segs = paragraphSegments(p);
  const full = segs.map((s) => s.text).join('');
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = full.indexOf(find, from);
    if (at < 0) break;
    hits.push(at);
    from = at + find.length;
  }
  if (hits.length === 0) return { replaced: 0, failed: 0 };
  const texts = segs.map((s) => s.text);
  let replaced = 0;
  let failed = 0;
  // from the end so earlier offsets stay valid
  for (const at of hits.slice().reverse()) {
    const end = at + find.length;
    const touched = segs.map((s, i) => ({ s, i })).filter(({ s }) => s.start < end && s.start + s.text.length > at);
    if (touched.some(({ s }) => !s.editable)) { failed += 1; continue; }
    touched.forEach(({ s, i }, k) => {
      const localStart = Math.max(0, at - s.start);
      const localEnd = Math.min(s.text.length, end - s.start);
      const t = texts[i];
      texts[i] = t.slice(0, localStart) + (k === 0 ? replacement : '') + t.slice(localEnd);
    });
    replaced += 1;
  }
  segs.forEach((s, i) => { if (s.editable && texts[i] !== s.text) setRunText(s.run, texts[i]); });
  return { replaced, failed };
};

const stripForClone = (clone: any) => {
  const kill: any[] = [];
  const walk = (n: any) => {
    for (const c of els(n)) {
      if (['drawing', 'pict', 'object', 'bookmarkStart', 'bookmarkEnd', 'sectPr', 'lastRenderedPageBreak'].includes(c.localName)) kill.push(c);
      else if (isW(c, 'br') && c.getAttribute('w:type') === 'page') kill.push(c);
      else walk(c);
    }
  };
  walk(clone);
  kill.forEach((k) => k.parentNode && k.parentNode.removeChild(k));
};

const writeParagraphText = (p: any, text: string) => {
  const segs = paragraphSegments(p).filter((s) => s.editable);
  if (segs.length === 0) return false;
  // the longest run carries the body formatting; label runs (bold numbers etc.) must not dominate
  const dominant = segs.slice().sort((a, b) => b.text.length - a.text.length)[0];
  setRunText(dominant.run, text);
  segs.forEach((s) => { if (s !== dominant) setRunText(s.run, ''); });
  return true;
};

export interface ApplyReport {
  changed: string[];
  failed: string[];
  removed: string[];
}

export const applyReplacements = (model: TemplateModel, valid: ValidReplacement[]): ApplyReport => {
  const report: ApplyReport = { changed: [], failed: [], removed: [] };
  const partOf = (path: string) => model.parts.find((x) => x.path === path)!;
  for (const r of valid) {
    const para = model.byId.get(r.id)!;
    const part = partOf(para.part);
    if (r.mode === 'values') {
      let ok = true;
      for (const v of r.values) {
        const res = replaceInParagraph(para.el, v.sample, v.value);
        if (res.failed > 0 || res.replaced === 0) ok = false;
      }
      (ok ? report.changed : report.failed).push(r.id);
      part.dirty = true;
      continue;
    }
    // rewrite
    if (r.paragraphs.length === 0) {
      const parent = para.el.parentNode;
      const siblingParas = els(parent).filter((c) => isW(c, 'p'));
      if (para.hasDrawing || siblingParas.length <= 1) {
        writeParagraphText(para.el, '');
        report.failed.push(r.id);
      } else {
        parent.removeChild(para.el);
        report.removed.push(r.id);
      }
      part.dirty = true;
      continue;
    }
    if (!writeParagraphText(para.el, r.paragraphs[0])) { report.failed.push(r.id); continue; }
    let anchor = para.el;
    for (let i = 1; i < r.paragraphs.length; i++) {
      const clone = para.el.cloneNode(true);
      stripForClone(clone);
      writeParagraphText(clone, r.paragraphs[i]);
      anchor.parentNode.insertBefore(clone, anchor.nextSibling);
      anchor = clone;
    }
    report.changed.push(r.id);
    part.dirty = true;
  }
  return report;
};

export const serializeResult = async (model: TemplateModel): Promise<Uint8Array> => {
  const out = new JSZip();
  for (const name of Object.keys(model.zip.files)) {
    const entry = model.zip.files[name];
    if (entry.dir) { out.folder(name); continue; }
    const part = model.parts.find((x) => x.path === name);
    if (part && part.dirty) out.file(name, serializeXml(part.doc));
    else out.file(name, await entry.async('uint8array'), { binary: true });
  }
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
};

/* ------------------------------------------------------------------ */
/* 6. Verify the finished file                                         */
/* ------------------------------------------------------------------ */

export interface VerifyReport {
  ok: boolean;
  problems: string[];
  counts: Record<string, number>;
}

const structureCounts = (doc: any): Record<string, number> => ({
  tables: descendantsW(doc, 'tbl').length,
  sections: descendantsW(doc, 'sectPr').length,
  numbering: descendantsW(doc, 'numPr').length,
  drawings: descendantsW(doc, 'drawing').length + descendantsW(doc, 'pict').length,
  pageBreaks: descendantsW(doc, 'br').filter((b) => b.getAttribute('w:type') === 'page').length,
});

export const verifyOutput = async (
  original: Uint8Array | ArrayBuffer,
  output: Uint8Array,
  touchedIds: Set<string>,
  originalModel: TemplateModel,
  /** structures that may legitimately change (paragraphs added or removed) */
  allow: { removedIds: Set<string>; clonedAny: boolean }
): Promise<VerifyReport> => {
  const problems: string[] = [];
  const counts: Record<string, number> = {};
  let outZip: JSZip;
  try {
    outZip = await JSZip.loadAsync(output);
  } catch {
    return { ok: false, problems: ['The finished file is not a valid zip.'], counts };
  }
  const origZip = await JSZip.loadAsync(original);
  // every part is still present
  for (const name of Object.keys(origZip.files)) if (!outZip.file(name) && !origZip.files[name].dir) problems.push(`Missing part ${name}.`);
  // untouched parts are byte-identical
  const dirtyPaths = new Set(originalModel.parts.filter((p) => p.dirty).map((p) => p.path));
  for (const name of Object.keys(origZip.files)) {
    if (origZip.files[name].dir || dirtyPaths.has(name)) continue;
    const a = await origZip.file(name)!.async('uint8array');
    const bf = outZip.file(name);
    if (!bf) continue;
    const b = await bf.async('uint8array');
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) problems.push(`Part ${name} changed although it was not edited.`);
  }
  // edited parts parse, and keep their structure
  for (const part of originalModel.parts) {
    const f = outZip.file(part.path);
    if (!f) continue;
    let doc: any;
    try { doc = parseXml(await f.async('string')); } catch { problems.push(`${part.path} is not well-formed.`); continue; }
    const before = structureCounts(parseXml(await origZip.file(part.path)!.async('string')));
    const after = structureCounts(doc);
    if (part.path.includes('document.xml')) Object.assign(counts, Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v])));
    for (const key of ['tables', 'sections', 'pageBreaks'] as const) {
      if (before[key] !== after[key]) problems.push(`${part.path}: number of ${key} changed (${before[key]} → ${after[key]}).`);
    }
    if (before.drawings !== after.drawings) problems.push(`${part.path}: logos/images changed (${before.drawings} → ${after.drawings}).`);
    if (!allow.clonedAny && !allow.removedIds.size && before.numbering !== after.numbering) problems.push(`${part.path}: numbering changed.`);
    // paragraphs that were not approved fields keep their exact text
    const afterTexts = descendantsW(doc, 'p').map((p) => paragraphText(p)).filter((t) => t.trim());
    const afterBag = new Map<string, number>();
    afterTexts.forEach((t) => afterBag.set(t, (afterBag.get(t) || 0) + 1));
    for (const p of originalModel.paras.filter((x) => x.part === part.path && !touchedIds.has(x.id))) {
      const n = afterBag.get(p.text) || 0;
      if (n === 0) problems.push(`Boilerplate paragraph ${p.id} was altered.`);
      else afterBag.set(p.text, n - 1);
    }
  }
  return { ok: problems.length === 0, problems, counts };
};

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export type ModelCall = (req: { system: string; prompt: string; kind: 'analyze' | 'fill' }) => Promise<string>;

export interface FillResult {
  docx: Uint8Array;
  fields: TemplateField[];
  replacements: ValidReplacement[];
  apply: ApplyReport;
  review: string[];
  verify: VerifyReport;
  keptParagraphs: number;
}

export const fillDocxTemplate = async (opts: {
  template: Uint8Array | ArrayBuffer;
  evidence: string;
  userRequest: string;
  language: string;
  today: string;
  callModel: ModelCall;
  onStage?: (stage: 'analyzing' | 'filling') => void;
}): Promise<FillResult> => {
  const templateBytes = opts.template instanceof Uint8Array ? opts.template : new Uint8Array(opts.template);
  // Stage 1 + 2: the template, on its own. No case paper is visible here.
  const model = await readTemplate(templateBytes);
  opts.onStage?.('analyzing');
  const analysisRaw = await opts.callModel({ kind: 'analyze', system: ANALYZE_SYSTEM, prompt: analyzePrompt(inventoryText(model), opts.language) });
  const { fields, notes: fieldNotes } = validateFields(model, parseJsonLoose(analysisRaw));
  if (fields.length === 0) throw new TemplateFillError('NO_FIELDS', 'No fields that hold sample-case content could be identified in the template.');

  // Stage 3: the case facts fill only those fields.
  opts.onStage?.('filling');
  const fillRaw = await opts.callModel({ kind: 'fill', system: FILL_SYSTEM, prompt: fillPrompt(model, fields, opts.evidence, opts.userRequest, opts.language, opts.today) });
  const { valid, review } = validateReplacements(fields, model, parseJsonLoose(fillRaw), opts.evidence, opts.userRequest, opts.today);

  // Stage 4: deterministic edit of a copy of the original XML.
  const apply = applyReplacements(model, valid);
  const out = await serializeResult(model);
  const touched = new Set(valid.map((v) => v.id));
  const verify = await verifyOutput(templateBytes, out, touched, model, {
    removedIds: new Set(apply.removed),
    clonedAny: valid.some((v) => v.mode === 'rewrite' && v.paragraphs.length > 1),
  });
  if (!verify.ok) throw new TemplateFillError('VERIFY_FAILED', `The filled file failed its integrity check: ${verify.problems.slice(0, 3).join(' ')}`);

  const allReview = [...fieldNotes, ...review, ...apply.failed.map((id) => `Could not replace ${id} without disturbing its formatting; it was left as in the template — please edit it.`)];
  return { docx: out, fields, replacements: valid, apply, review: allReview, verify, keptParagraphs: model.paras.length - touched.size };
};
