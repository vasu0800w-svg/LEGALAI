/**
 * Regression tests for template-faithful filling.
 * Run: node --test frontend/utils/templateFill.test.ts
 *
 * The AI is replaced by a stub that answers like a model would, so these tests
 * check the thing that matters: the real OUTPUT FILE (re-opened from bytes),
 * not a model's text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  fillDocxTemplate,
  readTemplate,
  replaceInParagraph,
  paragraphText,
  TemplateFillError,
  type ModelCall,
} from './templateFill.ts';

(globalThis as any).DOMParser = DOMParser;
(globalThis as any).XMLSerializer = XMLSerializer;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS = `xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const r = (text: string, o: { b?: boolean; u?: boolean } = {}) =>
  `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.u ? '<w:u w:val="single"/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const p = (inner: string, o: { jc?: string; num?: boolean; extra?: string } = {}) =>
  `<w:p><w:pPr>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}${o.num ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>${o.extra || ''}${inner}</w:p>`;
const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
const logo = `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="x"/></a:graphic></wp:inline></w:drawing></w:r>`;

const buildDocx = async (bodyXml: string, extra: Record<string, string> = {}): Promise<Uint8Array> => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles ${NS}/>`);
  zip.file('word/numbering.xml', `<?xml version="1.0"?><w:numbering ${NS}/>`);
  for (const [name, xml] of Object.entries(extra)) zip.file(name, xml);
  return zip.generateAsync({ type: 'uint8array' });
};

const partXml = async (bytes: Uint8Array, name: string) => (await JSZip.loadAsync(bytes)).file(name)!.async('string');
const bodyTexts = async (bytes: Uint8Array): Promise<string[]> => {
  const m = await readTemplate(bytes);
  return m.paras.filter((x) => x.part === 'word/document.xml').map((x) => x.text);
};
const allText = async (bytes: Uint8Array) => (await bodyTexts(bytes)).join('\n');

const SAMPLE_NAME = 'विकास उर्फ रिंकू शोरी';
const SAMPLE_FIR = '145/2024';
const SAMPLE_DATE = '12/03/2024';

const bailTemplate = async () =>
  buildDocx(
    [
      p(r('IN THE COURT OF SESSIONS JUDGE', { b: true, u: true }), { jc: 'center' }),
      p(r('BAIL APPLICATION', { b: true }), { jc: 'center' }),
      p(r('Applicant: ') + r(SAMPLE_NAME, { b: true }) + r(' son of Dinesh, resident of Rampur.')),
      p(r(`That the applicant was arrested on ${SAMPLE_DATE} in FIR No. ${SAMPLE_FIR} at P.S. Kotwali under Section 420 IPC.`), { num: true }),
      p(r('That the applicant is innocent and was falsely implicated by the complainant over a land dispute.'), { num: true }),
      p(r('The applicant undertakes to abide by every condition this Hon\'ble Court may impose.')),
      p(r('PRAYER', { b: true, u: true }), { jc: 'center' }),
      p(r('It is therefore prayed that the applicant be released on bail on such terms as this Court deems fit.')),
      p(r('Place: ________')),
      p(r('Date: ________')),
    ].join('')
  );

const EVIDENCE = [
  '### Batch 1/1',
  'CLIENT: Narendra Jaiswal',
  'CASE_DATE: 28/09/2026',
  '[fir.pdf, p.1] FIR No. 77/2026, P.S. Bhanupratappur, Section 303(2) BNS, registered 25/09/2026.',
  '[fir.pdf, p.2] Applicant Narendra Jaiswal, son of Dinesh Jaiswal, resident of Bhanupratappur.',
  '[notice.pdf, p.1] The complainant is Vikas Rathore; the dispute concerns a mobile phone.',
].join('\n');

/** Id of the paragraph whose text contains `snippet` (works for the inventory and the fields block). */
const idOf = (prompt: string, snippet: string): string => {
  const lines = prompt.split('\n');
  let at = lines.findIndex((l) => l.includes(snippet));
  assert.ok(at >= 0, `no prompt line contains ${snippet}`);
  for (; at >= 0; at--) {
    const m = lines[at].match(/^([BHF][0-9-]*\d+)(?=[ :\[|])/);
    if (m) return m[1];
  }
  throw new Error(`no id found for ${snippet}`);
};

const stubModel = (handlers: {
  analyze: (prompt: string) => any;
  fill: (prompt: string) => any;
}, seen?: { analyze?: string; fill?: string }): ModelCall => async ({ kind, prompt }) => {
  if (kind === 'analyze') { if (seen) seen.analyze = prompt; return JSON.stringify(handlers.analyze(prompt)); }
  if (seen) seen.fill = prompt;
  return JSON.stringify(handlers.fill(prompt));
};

const baseOpts = (template: Uint8Array, callModel: ModelCall) => ({
  template,
  evidence: EVIDENCE,
  userRequest: 'Prepare the bail application',
  language: 'English',
  today: '27/10/2026',
  callModel,
});

/* ---------------------------------------------------------------- */

test('A: bail template + FIR evidence — template wording stays, case facts go in, files stay separate', async () => {
  const tpl = await bailTemplate();
  const seen: { analyze?: string; fill?: string } = {};
  const model = stubModel({
    analyze: (prompt) => ({
      fields: [
        { id: idOf(prompt, 'Applicant:'), mode: 'values', purpose: 'applicant', samples: [SAMPLE_NAME, 'Dinesh', 'Rampur'] },
        { id: idOf(prompt, 'was arrested on'), mode: 'rewrite', purpose: 'FIR details' },
        { id: idOf(prompt, 'falsely implicated'), mode: 'rewrite', purpose: 'ground' },
      ],
    }),
    fill: (prompt) => ({
      replacements: [
        { id: idOf(prompt, 'Applicant:'), values: [
          { sample: SAMPLE_NAME, value: 'Narendra Jaiswal' }, { sample: 'Dinesh', value: 'Dinesh Jaiswal' }, { sample: 'Rampur', value: 'Bhanupratappur' },
        ], sources: ['fir.pdf, p.2'] },
        { id: idOf(prompt, 'was arrested on'), paragraphs: ['That the applicant was arrested on 25/09/2026 in FIR No. 77/2026 at P.S. Bhanupratappur under Section 303(2) BNS.'], sources: ['fir.pdf, p.1'] },
        { id: idOf(prompt, 'falsely implicated'), paragraphs: ['That the applicant is innocent; the complaint by Vikas Rathore concerns a mobile phone.'], sources: ['notice.pdf, p.1'] },
      ],
    }),
  }, seen);
  const res = await fillDocxTemplate(baseOpts(tpl, model));
  const text = await allText(res.docx);

  assert.ok(res.verify.ok, res.verify.problems.join('; '));
  assert.match(text, /Applicant: Narendra Jaiswal son of Dinesh Jaiswal, resident of Bhanupratappur\./);
  assert.match(text, /FIR No\. 77\/2026/);
  assert.doesNotMatch(text, new RegExp(SAMPLE_NAME));
  assert.doesNotMatch(text, /145\/2024/);
  // template-only wording is untouched
  assert.match(text, /BAIL APPLICATION/);
  assert.match(text, /The applicant undertakes to abide by every condition/);
  // separation: the template analysis never saw any case paper; the fill saw the evidence
  assert.ok(!seen.analyze!.includes('Narendra'), 'analysis prompt leaked case evidence');
  assert.ok(!seen.analyze!.includes('fir.pdf'), 'analysis prompt leaked case file names');
  assert.ok(seen.fill!.includes('fir.pdf, p.1'), 'fill prompt must carry source references');
  assert.ok(res.replacements.every((x) => x.sources.length > 0), 'every replacement keeps its source reference');
});

test('B: Word template and a petition with different headings/order — only the template controls structure', async () => {
  const tpl = await bailTemplate();
  const petitionEvidence = EVIDENCE + '\nHEADING: WRIT PETITION UNDER ARTICLE 226 — GROUNDS — SYNOPSIS — LIST OF DATES';
  const model = stubModel({
    analyze: (prompt) => ({ fields: [{ id: idOf(prompt, 'was arrested on'), mode: 'rewrite', purpose: 'FIR' }] }),
    fill: (prompt) => ({
      replacements: [{ id: idOf(prompt, 'was arrested on'), paragraphs: ['That the applicant was arrested on 25/09/2026 in FIR No. 77/2026.'], sources: ['fir.pdf, p.1'] }],
    }),
  });
  const res = await fillDocxTemplate({ ...baseOpts(tpl, model), evidence: petitionEvidence });
  const before = await bodyTexts(tpl);
  const after = await bodyTexts(res.docx);
  assert.equal(after.length, before.length, 'paragraph count (structure) is unchanged');
  // headings and their ORDER are exactly the template's
  const heads = (xs: string[]) => xs.filter((x) => /COURT OF|BAIL APPLICATION|PRAYER/.test(x));
  assert.deepEqual(heads(after), heads(before));
  assert.doesNotMatch(after.join('\n'), /WRIT PETITION|SYNOPSIS|LIST OF DATES|ARTICLE 226/);
  // formatting of the court title run is byte-for-byte what the template had
  const o = await partXml(tpl, 'word/document.xml');
  const n = await partXml(res.docx, 'word/document.xml');
  const title = /<w:p>(?:(?!<\/w:p>).)*IN THE COURT OF SESSIONS JUDGE.*?<\/w:p>/s;
  assert.equal(n.match(title)![0].replace(/\s+/g, ''), o.match(title)![0].replace(/\s+/g, ''));
});

test('C: sample party names, numbers and dates from the template never reach the new case', async () => {
  const tpl = await bailTemplate();
  // A careless model that copies the template's sample facts into the new draft
  const model = stubModel({
    analyze: (prompt) => ({
      fields: [
        { id: idOf(prompt, 'Applicant:'), mode: 'values', purpose: 'applicant', samples: [SAMPLE_NAME] },
        { id: idOf(prompt, 'was arrested on'), mode: 'rewrite', purpose: 'FIR details' },
      ],
    }),
    fill: (prompt) => ({
      replacements: [
        { id: idOf(prompt, 'Applicant:'), values: [{ sample: SAMPLE_NAME, value: SAMPLE_NAME }], sources: [] },
        { id: idOf(prompt, 'was arrested on'), paragraphs: [`That the applicant was arrested on ${SAMPLE_DATE} in FIR No. ${SAMPLE_FIR} at P.S. Kotwali.`], sources: [] },
      ],
    }),
  });
  const res = await fillDocxTemplate(baseOpts(tpl, model));
  const text = await allText(res.docx);
  assert.doesNotMatch(text, new RegExp(SAMPLE_NAME), 'sample name leaked');
  assert.doesNotMatch(text, /145\/2024/, 'sample FIR number leaked');
  assert.doesNotMatch(text, /12\/03\/2024/, 'sample date leaked');
  assert.match(text, /________/, 'unknowns are left blank, not guessed');
  assert.ok(res.review.length > 0, 'the advocate is told what to check');
});

test('D: boilerplate clauses stay unchanged (same XML, ignoring empty-tag spelling)', async () => {
  const tpl = await bailTemplate();
  const model = stubModel({
    analyze: (prompt) => ({ fields: [{ id: idOf(prompt, 'falsely implicated'), mode: 'rewrite', purpose: 'ground' }] }),
    fill: (prompt) => ({ replacements: [{ id: idOf(prompt, 'falsely implicated'), paragraphs: ['That the applicant is innocent.'], sources: ['n.pdf, p.1'] }] }),
  });
  const res = await fillDocxTemplate(baseOpts(tpl, model));
  const o = await partXml(tpl, 'word/document.xml');
  const n = await partXml(res.docx, 'word/document.xml');
  for (const clause of [
    'The applicant undertakes to abide by every condition this Hon&apos;ble Court may impose.',
    'It is therefore prayed that the applicant be released on bail on such terms as this Court deems fit.',
    'PRAYER',
  ]) {
    const plain = clause.replace(/&apos;/g, "'");
    assert.ok(n.includes(plain) || n.includes(clause), `clause missing: ${plain}`);
    const grab = (xml: string) => (xml.match(new RegExp(`<w:p>(?:(?!</w:p>).)*?${plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "(?:'|&apos;)")}.*?</w:p>`, 's')) || [''])[0].replace(/\s+/g, '').replace(/&apos;/g, "'").replace(/<(w:\w+)><\/\1>/g, '<$1/>');
    assert.equal(grab(n), grab(o), `boilerplate XML changed: ${plain.slice(0, 30)}`);
  }
});

test('E: missing or contradictory facts become blanks plus a review note, never a guess', async () => {
  const tpl = await bailTemplate();
  const model = stubModel({
    analyze: (prompt) => ({
      fields: [
        { id: idOf(prompt, 'was arrested on'), mode: 'values', purpose: 'arrest date', samples: [SAMPLE_DATE, SAMPLE_FIR] },
        { id: idOf(prompt, 'Applicant:'), mode: 'values', purpose: 'applicant', samples: [SAMPLE_NAME] },
      ],
    }),
    fill: (prompt) => ({
      replacements: [
        // contradictory: the model reports it instead of picking one
        { id: idOf(prompt, 'was arrested on'), values: [{ sample: SAMPLE_DATE, value: '25/09/2026' }, { sample: SAMPLE_FIR, value: '77/2026' }], needsReview: true, uncertainty: 'FIR says 25/09/2026 but the notice says 26/09/2026', sources: ['fir.pdf, p.1', 'notice.pdf, p.1'] },
        // invented date that no paper supports
        { id: idOf(prompt, 'Applicant:'), values: [{ sample: SAMPLE_NAME, value: 'Narendra Jaiswal 15/01/2099' }], sources: [] },
      ],
    }),
  });
  const res = await fillDocxTemplate(baseOpts(tpl, model));
  const text = await allText(res.docx);
  assert.doesNotMatch(text, /25\/09\/2026/, 'a flagged contradictory value must not be written in');
  assert.doesNotMatch(text, /15\/01\/2099/, 'an unsupported date must not be written in');
  assert.match(text, /________/);
  assert.ok(res.review.some((x) => /26\/09\/2026/.test(x)), 'the contradiction is reported');
  assert.ok(res.review.some((x) => /15\/01\/2099/.test(x)), 'the unsupported date is reported');
});

test('F: tables, numbering, headers, footers, logos and page breaks all survive', async () => {
  const table = `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>${SAMPLE_NAME}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>....... Applicant</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const header = `<?xml version="1.0"?><w:hdr ${NS}>${p(logo + r('Law Chambers, Raipur'))}</w:hdr>`;
  const footer = `<?xml version="1.0"?><w:ftr ${NS}>${p(r('Page ') + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>')}</w:ftr>`;
  const tpl = await buildDocx(
    [
      p(r('MEMO OF PARTIES', { b: true }), { jc: 'center' }),
      table,
      p(r('That the applicant was arrested in FIR No. 145/2024.'), { num: true }),
      p(r('That the applicant has no criminal history.'), { num: true }),
      p(r('That the applicant has deep roots in Rampur.'), { num: true }),
      pageBreak,
      p(r('PRAYER', { b: true }), { jc: 'center' }),
    ].join(''),
    { 'word/header1.xml': header, 'word/footer1.xml': footer }
  );
  const model = stubModel({
    analyze: (prompt) => ({
      fields: [
        { id: idOf(prompt, SAMPLE_NAME), mode: 'rewrite', purpose: 'party in table' },
        { id: idOf(prompt, 'was arrested in FIR'), mode: 'rewrite', purpose: 'grounds' },
        { id: idOf(prompt, 'no criminal history'), mode: 'rewrite', purpose: 'ground 2' },
        { id: idOf(prompt, 'deep roots'), mode: 'rewrite', purpose: 'ground 3' },
      ],
    }),
    fill: (prompt) => ({
      replacements: [
        { id: idOf(prompt, SAMPLE_NAME), paragraphs: ['Narendra Jaiswal'], sources: ['fir.pdf, p.2'] },
        { id: idOf(prompt, 'was arrested in FIR'), paragraphs: ['That the applicant was arrested in FIR No. 77/2026.', 'That the arrest was made at P.S. Bhanupratappur.', 'That the Section is 303(2) BNS.'], sources: ['fir.pdf, p.1'] },
        { id: idOf(prompt, 'no criminal history'), paragraphs: ['That the applicant has no criminal history.'], sources: ['fir.pdf, p.2'] },
        { id: idOf(prompt, 'deep roots'), paragraphs: [], sources: [] },
      ],
    }),
  });
  const res = await fillDocxTemplate(baseOpts(tpl, model));
  assert.ok(res.verify.ok, res.verify.problems.join('; '));

  const o = await partXml(tpl, 'word/document.xml');
  const n = await partXml(res.docx, 'word/document.xml');
  const count = (xml: string, re: RegExp) => (xml.match(re) || []).length;
  assert.equal(count(n, /<w:tbl>/g), count(o, /<w:tbl>/g), 'table kept');
  assert.equal(count(n, /w:type="page"/g), 1, 'the one page break is kept (and not duplicated into added paragraphs)');
  assert.equal(count(n, /<w:sectPr/g), count(o, /<w:sectPr/g), 'section properties kept');
  // numbering: 3 original numbered paragraphs → 3 + 2 clones − 1 removed = 4, all still numbered
  assert.equal(count(n, /<w:numPr>/g), 4, 'added paragraphs inherit the numbering of the template paragraph');
  // header (with logo) and footer (with PAGE field) are untouched, byte for byte
  assert.equal(await partXml(res.docx, 'word/header1.xml'), header);
  assert.equal(await partXml(res.docx, 'word/footer1.xml'), footer);
  assert.match(await partXml(res.docx, 'word/header1.xml'), /<w:drawing>/);
  assert.match(await partXml(res.docx, 'word/footer1.xml'), /PAGE/);
  // table cell content replaced inside the table
  assert.match(n, /<w:tc><w:p>.*Narendra Jaiswal.*<\/w:p><\/w:tc>/s);
  const text = await allText(res.docx);
  assert.doesNotMatch(text, /deep roots/);
  assert.match(text, /That the Section is 303\(2\) BNS\./);
  // the result is a real .docx that re-opens and re-parses
  const reread = await readTemplate(res.docx);
  assert.ok(reread.paras.length > 0);
});

test('values mode keeps the formatting of every run (split runs, bold name)', async () => {
  const tpl = await buildDocx(p(r('Applicant: ') + r('Vikas ', { b: true }) + r('Shori', { b: true }) + r(' of Rampur')));
  const m = await readTemplate(tpl);
  const para = m.paras[0].el;
  const res = replaceInParagraph(para, 'Vikas Shori', 'Narendra Jaiswal');
  assert.equal(res.replaced, 1);
  assert.equal(paragraphText(para), 'Applicant: Narendra Jaiswal of Rampur');
  const xml = new XMLSerializer().serializeToString(para);
  // the replacement sits in the first bold run; the plain runs on either side stay plain
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>Narendra Jaiswal<\/w:t>/);
  assert.match(xml, /<w:t[^>]*>Applicant: <\/w:t>/);
  assert.match(xml, /<w:t[^>]*> of Rampur<\/w:t>/);
});

test('refuses safely: not a docx, bad JSON, nothing to fill', async () => {
  await assert.rejects(() => readTemplate(new Uint8Array([1, 2, 3])), (e: any) => e instanceof TemplateFillError && e.code === 'NOT_DOCX');
  const tpl = await bailTemplate();
  await assert.rejects(
    () => fillDocxTemplate(baseOpts(tpl, async () => 'not json at all')),
    (e: any) => e.code === 'BAD_JSON'
  );
  await assert.rejects(
    () => fillDocxTemplate(baseOpts(tpl, async () => JSON.stringify({ fields: [] }))),
    (e: any) => e.code === 'NO_FIELDS'
  );
});

test('a replacement for a paragraph the analysis did not approve is ignored', async () => {
  const tpl = await bailTemplate();
  const model = stubModel({
    analyze: (prompt) => ({ fields: [{ id: idOf(prompt, 'falsely implicated'), mode: 'rewrite', purpose: 'ground' }] }),
    fill: (prompt) => ({
      replacements: [
        { id: idOf(prompt, 'falsely implicated'), paragraphs: ['That the applicant is innocent.'], sources: ['x, p.1'] },
        { id: 'B7', paragraphs: ['SOMETHING ELSE'], sources: [] }, // B7 is PRAYER: never approved
      ],
    }),
  });
  const res = await fillDocxTemplate(baseOpts(tpl, model));
  const text = await allText(res.docx);
  assert.match(text, /PRAYER/);
  assert.doesNotMatch(text, /SOMETHING ELSE/);
  assert.ok(res.review.some((x) => /not an approved field/.test(x)));
});
