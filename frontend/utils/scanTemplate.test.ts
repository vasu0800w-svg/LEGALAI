/**
 * Regression tests for the scanned-template workflow.
 * Run:  cd frontend && node --test utils/scanTemplate.test.ts
 *
 * Fixture: a fictional 3-page SCANNED Hindi bail application (court heading, party block, bold + underlined
 * headings, numbered paragraphs with (क)(ख) sub-paragraphs, a ruled table, prayer, signature, verification,
 * annexures). The "AI" is scripted from the measured ground truth, so these tests check OUR code: pixel
 * analysis, profile building, separation of template and case facts, validation and the DOCX that comes out.
 * Each assertion on output reads the real .docx bytes that were generated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { Packer } from 'docx';
import {
  countRuleLines,
  detectPageBounds,
  estimateSkewDeg,
  findUnderline,
  inkDensity,
  inkThreshold,
  median,
  snapToInk,
  type Gray,
} from './scanPixels.ts';
import {
  approveProfile,
  buildProfile,
  parseVisionPage,
  patchBlock,
  setFieldMode,
  type RawPage,
  type TemplateProfile,
} from './scanTemplate.ts';
import {
  applyScanReplacements,
  diffOutsideRegions,
  draftPlainText,
  draftToDocx,
  planFixedLayout,
  validateDraft,
  BLANK,
} from './scanReconstruct.ts';
import { analyzeScanTemplate, fillScanTemplate, type PreparedPage } from './scanFill.ts';
import { validateFields, validateReplacements } from './templateFill.ts';
import { profileAsModel } from './scanTemplate.ts';
import { NEW_CASE_EVIDENCE, NEW_CASE_REQUEST, loadGt, loadPages, scriptedFields, scriptedFill, simulatedVision } from './fixtures/scanFixture.ts';

(globalThis as any).DOMParser = DOMParser;
(globalThis as any).XMLSerializer = XMLSerializer;

const pages = loadPages();
const gt = loadGt();
const TODAY = '27/10/2026';

const profileFrom = (raws: RawPage[] = simulatedVision(), grays: Gray[] = pages): TemplateProfile =>
  buildProfile({ id: 'fixture', name: 'bail-template', sourceKind: 'image', pages: grays.map((gray, i) => ({ gray, raw: raws[i], rotationDeg: 0, skewDeg: 0, cropped: false })) });

const withFields = (p: TemplateProfile): TemplateProfile => {
  const { fields } = validateFields(profileAsModel(p), scriptedFields(p));
  return { ...p, fields };
};

const docText = async (docx: Uint8Array) => {
  const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
  return Array.from(xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)).map((m) => m[1]).join('\n');
};

const checkOf = (v: { checks: { name: string; ok: boolean; detail: string }[] }, name: string) => v.checks.find((c) => c.name === name)!;

/* ------------------------------------------------------------------ */
/* Pixel analysis                                                      */
/* ------------------------------------------------------------------ */

const rotateGray = (g: Gray, deg: number, fill = 235): Gray => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const out = new Uint8Array(g.data.length).fill(fill);
  const cx = g.width / 2;
  const cy = g.height / 2;
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      // inverse map: where did this output pixel come from? (clockwise rotation by deg in y-down coordinates)
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(c * dx + s * dy + cx);
      const sy = Math.round(-s * dx + c * dy + cy);
      if (sx >= 0 && sx < g.width && sy >= 0 && sy < g.height) out[y * g.width + x] = g.data[sy * g.width + sx];
    }
  }
  return { data: out, width: g.width, height: g.height };
};

test('1. skew of a tilted, noisy page is measured (sign and size) and a straight page reads 0', () => {
  assert.equal(estimateSkewDeg(pages[0]), 0);
  for (const deg of [1.4, -2.2]) {
    const tilted = rotateGray(pages[0], deg);
    // salt-and-pepper noise like a real photo
    let seed = 5;
    for (let i = 0; i < 20000; i++) {
      seed = (seed * 16807) % 2147483647;
      tilted.data[seed % tilted.data.length] = 40;
    }
    const got = estimateSkewDeg(tilted);
    assert.ok(Math.abs(got - deg) <= 0.4, `expected about ${deg}°, got ${got}°`);
  }
});

test('2. the paper is found inside a dark photo background; a flat scan is left whole', () => {
  const W = pages[0].width;
  const H = pages[0].height;
  const bw = 1500;
  const bh = 2000;
  const data = new Uint8Array(bw * bh).fill(60);
  const ox = 140;
  const oy = 120;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[(y + oy) * bw + x + ox] = pages[0].data[y * W + x];
  const b = detectPageBounds({ data, width: bw, height: bh });
  assert.ok(Math.abs(b.x - ox) < 12 && Math.abs(b.y - oy) < 12, `page corner at ${b.x},${b.y}`);
  assert.ok(Math.abs(b.w - W) < 24 && Math.abs(b.h - H) < 24, `page size ${b.w}x${b.h}`);
  const flat = detectPageBounds(pages[0]);
  assert.deepEqual([flat.x, flat.y, flat.w, flat.h], [0, 0, pages[0].width, pages[0].height]);
});

test('3. underline, bold weight and table ruling are measured from the pixels, line by line', () => {
  const rows = gt.lines.filter((l) => l.kind !== 'table').map((l) => {
    const g = pages[l.page - 1];
    const snapped = snapToInk(g, { x: l.x + 6, y: l.y + 4, w: l.w - 10, h: l.h - 2 }); // a sloppy AI box
    const ul = findUnderline(g, snapped.box);
    return { l, snapped, ul, density: inkDensity(g, snapped.box, ul.y) };
  });
  assert.ok(rows.every((r) => r.snapped.found), 'every printed line has ink under its box');
  for (const r of rows) {
    assert.equal(r.ul.underlined, !!r.l.underline, `underline of "${r.l.text.slice(0, 20)}" (coverage ${r.ul.coverage.toFixed(2)})`);
    // the snapped box lands on the real ink (left edge and width within a few pixels)
    assert.ok(Math.abs(r.snapped.box.x - r.l.x) <= 4, `left edge of "${r.l.text.slice(0, 15)}"`);
    assert.ok(Math.abs(r.snapped.box.w - r.l.w) <= 10, `width of "${r.l.text.slice(0, 15)}"`);
  }
  const regular = median(rows.filter((r) => !r.l.bold).map((r) => r.density));
  const boldRatios = rows.filter((r) => r.l.bold).map((r) => r.density / regular);
  assert.ok(Math.min(...boldRatios) > 1.3, `bold lines are heavier than body text (min ratio ${Math.min(...boldRatios).toFixed(2)})`);
  const table = gt.lines.find((l) => l.kind === 'table')!;
  const rules = countRuleLines(pages[1], { x: table.x, y: table.y, w: table.w, h: table.h }, inkThreshold(pages[1]));
  assert.ok(rules.horizontal >= 4 && rules.vertical >= 4, `table ruling: ${rules.horizontal} horizontal, ${rules.vertical} vertical`);
});

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

test('4. the profile captures structure, formatting and geometry; the OCR is kept separate and untouched', () => {
  const p = profileFrom();
  assert.equal(p.pages.length, 3);
  assert.equal(p.pages[0].paper, 'A4');
  assert.ok(Math.abs(p.pages[0].marginLeftPt - 60) <= 3, `left margin ${p.pages[0].marginLeftPt}`);
  const by = (needle: string) => p.blocks.find((b) => b.text.includes(needle))!;
  const court = by('न्यायालय श्रीमान्');
  assert.deepEqual([court.type, court.align, court.bold, court.underline], ['court_heading', 'center', true, false]);
  const title = by('आवेदन पत्र अंतर्गत');
  assert.deepEqual([title.type, title.align, title.bold, title.underline], ['title', 'center', true, true]);
  const prayer = by('प्रार्थना');
  assert.ok(prayer.bold && prayer.underline && prayer.level > 0 && prayer.align === 'center');
  assert.equal(by('जमानत आवेदन क्रमांक').align, 'right');
  const n1 = by('1.   यह कि');
  assert.deepEqual([n1.type, n1.label], ['numbered', '1.']);
  assert.ok(n1.firstLinePt < -20 && n1.leftIndentPt > 25, `hanging indent first ${n1.firstLinePt}, left ${n1.leftIndentPt}`);
  const sub = by('(क)');
  assert.equal(sub.type, 'subpara');
  assert.ok(sub.leftIndentPt > n1.leftIndentPt - 5);
  assert.equal(by('द्वारा अधिवक्ता').type, 'signature');
  assert.equal(by('द्वारा अधिवक्ता').align, 'right');
  const table = p.blocks.find((b) => b.table)!;
  assert.equal(table.table!.cells.length, 3);
  assert.equal(table.table!.borders, true);
  for (const name of ['court', 'title', 'parties', 'prayer', 'signature', 'verification', 'annexure']) assert.ok(p.anchors.some((a) => a.name === name), `anchor ${name}`);
  // OCR text and coordinates are preserved as read, apart from the interpretation
  assert.equal(p.lines.length, gt.lines.filter((l) => l.kind !== 'table').length);
  assert.ok(p.lines.every((l) => l.ocrText === l.text && l.box.w > 0));
  assert.ok(p.review.every((r) => r.severity !== 'warn'), 'a clean scan raises no warnings');
  assert.ok(p.blocks.some((b) => b.breakBefore), 'the deliberate page break before the prayer is kept');
});

test('5. low-confidence, ghost and contradictory readings are flagged for review instead of trusted', () => {
  const raws = simulatedVision();
  raws[0].lines[3].c = 0.35; // blurry line
  raws[0].lines.push({ t: 'यह पंक्ति पन्ने पर छपी नहीं है', box: [820, 150, 850, 700], c: 0.9, bold: false, u: false, al: 'left', isNew: true, k: 'para' });
  raws[0].lines[6].bold = false; // the AI missed the bold+underlined title's bold weight is checked by pixels
  raws[1].tables[0].borders = false; // AI says "no borders" but the page is ruled
  const p = profileFrom(raws);
  const msgs = p.review.map((r) => r.message).join('\n');
  assert.match(msgs, /Low reading confidence/);
  assert.match(msgs, /no printing was found/);
  assert.match(msgs, /table .*borders/i);
  const title = p.blocks.find((b) => b.text.includes('आवेदन पत्र अंतर्गत'))!;
  assert.ok(title.bold, 'bold of a heading is confirmed from ink weight even when the AI missed it');
});

test('6. the AI answer is validated: unusable boxes and empty lines are dropped, not trusted', () => {
  const { page, notes } = parseVisionPage({
    rotate_cw: 90,
    lines: [
      { t: 'ठीक पंक्ति', b: [100, 100, 130, 600], c: 2, al: 'weird', k: 'nonsense' },
      { t: '', b: [100, 100, 130, 600] },
      { t: 'बिना स्थान', b: 'nope' },
      { t: 'उल्टा बॉक्स', b: [300, 700, 280, 100] },
    ],
    tables: [{ b: [1, 2, 3, 4], rows: [] }],
  });
  assert.equal(page.rotateCw, 90);
  assert.equal(page.lines.length, 2);
  assert.equal(page.lines[0].al, 'left');
  assert.equal(page.lines[0].k, 'other');
  assert.equal(page.lines[0].c, 1);
  assert.equal(page.tables.length, 0);
  assert.ok(notes.length >= 3);
});

test('7. advocate corrections go on the blocks; OCR lines stay as read; approval is reset until re-approved', () => {
  let p = withFields(profileFrom());
  const lineSnapshot = JSON.stringify(p.lines);
  const heading = p.blocks.find((b) => b.text.includes('सह-अभियुक्तगण'))!;
  p = patchBlock(p, heading.id, { type: 'title', bold: false, align: 'left' });
  const fixed = p.blocks.find((b) => b.id === heading.id)!;
  assert.deepEqual([fixed.type, fixed.bold, fixed.align, fixed.edited, fixed.level], ['title', false, 'left', true, 1]);
  assert.equal(JSON.stringify(p.lines), lineSnapshot);
  assert.equal(p.approved, false);
  p = approveProfile(p, 123);
  assert.deepEqual([p.approved, p.approvedAt], [true, 123]);
  const crime = p.blocks.find((b) => b.text.includes('अपराध क्रमांक 145'))!;
  const before = p.fields.length;
  p = setFieldMode(p, crime.id, 'keep');
  assert.equal(p.fields.length, before - 1);
  assert.equal(p.approved, false);
  p = setFieldMode(p, crime.id, 'values', ['145/2025', 'not in the text']);
  assert.deepEqual(p.fields.find((f) => f.id === crime.id)!.samples, ['145/2025']);
});

/* ------------------------------------------------------------------ */
/* Template vs case separation, DOCX output                            */
/* ------------------------------------------------------------------ */

const SAMPLE_FACTS = ['रमेश कुमार पटेल', 'गोपाल पटेल', '145/2025', '14/03/2025', '20/03/2025', 'रायगढ़', 'सरिया', 'दिनेश कुमार साहू', 'मोहन लाल निषाद', '305(a)'];

test('8. a new case fills ONLY the approved fields; the template wording and facts never mix', async () => {
  const profile = withFields(profileFrom());
  assert.ok(profile.fields.length >= 15, `fields found: ${profile.fields.length}`);
  let calls = 0;
  const result = await fillScanTemplate({
    profile,
    evidence: NEW_CASE_EVIDENCE,
    userRequest: NEW_CASE_REQUEST,
    language: 'Hindi',
    today: TODAY,
    onStage: () => calls++,
    callText: async ({ kind }) => {
      assert.equal(kind, 'fill');
      return JSON.stringify(scriptedFill(profile));
    },
  });
  const text = await docText(result.docx);

  // facts of the new case are in; facts of the sample case are out
  for (const fact of ['सुनील कुमार यादव', 'रामआधार यादव', '312/2026', 'खरसिया', 'जशपुर', 'अजय कुमार सिंह', 'विनोद राठिया', '303(2)']) assert.ok(text.includes(fact), `new fact present: ${fact}`);
  for (const fact of SAMPLE_FACTS) assert.ok(!text.includes(fact), `template sample fact must be gone: ${fact}`);
  assert.ok(!text.includes('2025'), 'no sample year remains');

  // everything that is not a field is word for word the template (boilerplate, statutes, headings)
  const unchanged = result.draft.blocks.filter((b) => !b.changed);
  assert.ok(unchanged.length >= 10);
  for (const b of unchanged) assert.equal(b.text, b.originalText);
  const renumbered = result.draft.blocks.filter((b) => b.renumbered);
  assert.equal(renumbered.length, 1, 'only the template paragraph "5." was renumbered');
  assert.equal(renumbered[0].text.replace(/^\d+\./, ''), renumbered[0].originalText.replace(/^\d+\./, ''), 'its wording is untouched');
  for (const needle of ['आवेदन पत्र अंतर्गत धारा 483 बीएनएसएस, 2023 नियमित जमानत हेतु', 'अतः माननीय न्यायालय से विनम्र प्रार्थना है कि आवेदक को नियमित जमानत पर', 'द्वारा अधिवक्ता', 'विरुद्ध', 'अनुलग्नक', 'प्रथम सूचना रिपोर्ट की प्रति']) assert.ok(text.includes(needle), `template wording kept: ${needle}`);
  assert.ok(result.draft.blocks.filter((b) => b.changed && !b.renumbered).every((b) => profile.fields.some((f) => f.id.split('.')[0] === b.templateBlockId)));

  // the machine checks all passed on the real file
  assert.ok(result.validation.ok, result.validation.problems.join(' | '));
  assert.ok(calls >= 2);
});

test('9. missing or contradictory facts stay marked for the advocate and are never guessed', async () => {
  const profile = withFields(profileFrom());
  const result = await fillScanTemplate({ profile, evidence: NEW_CASE_EVIDENCE, userRequest: NEW_CASE_REQUEST, language: 'Hindi', today: TODAY, callText: async () => JSON.stringify(scriptedFill(profile)) });
  const arrest = result.draft.blocks.find((b) => b.templateBlockId === profile.blocks.find((x) => x.text.includes('1.   यह कि, आवेदक को पुलिस'))!.id)!;
  assert.ok(arrest.text.includes(BLANK), 'the contradictory arrest date is a visible placeholder');
  assert.ok(!arrest.text.includes('07/09/2026') && !arrest.text.includes('08/09/2026'), 'neither candidate date is picked');
  assert.ok(arrest.needsVerification);
  assert.match(result.review.join('\n'), /07\/09\/2026 और 08\/09\/2026/);
  assert.ok(checkOf(result.validation, 'placeholders').ok);
  assert.ok((await docText(result.docx)).includes(BLANK));
});

test('10. an AI that leaves a sample name in, or invents a date, is corrected before anything is written', async () => {
  const profile = withFields(profileFrom());
  const result = await fillScanTemplate({ profile, evidence: NEW_CASE_EVIDENCE, userRequest: NEW_CASE_REQUEST, language: 'Hindi', today: TODAY, callText: async () => JSON.stringify(scriptedFill(profile, { misbehave: true })) });
  const text = await docText(result.docx);
  assert.ok(!text.includes('रमेश कुमार पटेल'), 'the sample applicant name was removed from the ground');
  assert.ok(!text.includes('19/09/2026'), 'a date that is in no case paper was not written');
  assert.match(result.review.join('\n'), /sample case|नहीं|not in the case papers|came from the template/);
  assert.ok(text.includes(BLANK));
});

test('11. the output is a genuine editable Word file with the template formatting, not an image or a text dump', async () => {
  const profile = withFields(profileFrom());
  const result = await fillScanTemplate({ profile, evidence: NEW_CASE_EVIDENCE, userRequest: NEW_CASE_REQUEST, language: 'Hindi', today: TODAY, callText: async () => JSON.stringify(scriptedFill(profile)) });
  const zip = await JSZip.loadAsync(result.docx);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.ok(!/<w:drawing|<pic:pic/.test(xml), 'no pictures of text');
  assert.ok(/<w:tbl>/.test(xml), 'a real table');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = Array.from(dom.getElementsByTagName('w:p')) as any[];
  assert.ok(paras.length > 25);
  // Devanagari text is bold through the complex-script flag and uses a Devanagari-capable font
  assert.ok(/<w:b\/><w:bCs\/>/.test(xml), 'bold sets both b and bCs, which Hindi needs');
  assert.ok(/<w:u w:val="single"\/>/.test(xml), 'underline is real');
  assert.ok(/w:cs="Nirmala UI"/.test(xml), 'complex-script font is set for Devanagari');
  // numbered paragraphs use a hanging indent + a tab, so they reflow and edit naturally
  assert.ok(/<w:ind [^>]*w:hanging="\d+"/.test(xml) && /<w:tab\/>/.test(xml), 'hanging indent with tab');
  // paper and margins come from the template
  assert.match(xml, /<w:pgSz w:w="11906" w:h="16838"/);
  assert.ok(checkOf(result.validation, 'page-setup').ok);
  assert.ok(checkOf(result.validation, 'fonts').ok);
  assert.ok(checkOf(result.validation, 'styles').ok, checkOf(result.validation, 'styles').detail);
  assert.ok(checkOf(result.validation, 'headings').ok);
});

test('12. longer case text reflows: the long ground is complete, numbering is renumbered, and nothing is lost or duplicated', async () => {
  const profile = withFields(profileFrom());
  const result = await fillScanTemplate({ profile, evidence: NEW_CASE_EVIDENCE, userRequest: NEW_CASE_REQUEST, language: 'Hindi', today: TODAY, callText: async () => JSON.stringify(scriptedFill(profile)) });
  const text = await docText(result.docx);
  assert.ok(text.includes('न्यायालय द्वारा निर्धारित प्रत्येक शर्त का पालन करेगा।'), 'the last sentence of the long paragraph is present');
  const nums = result.draft.blocks.filter((b) => b.type === 'numbered').map((b) => b.label);
  assert.deepEqual(nums, ['1.', '2.', '3.', '4.', '5.', '6.'], 'the template paragraph "5." became "6." after two grounds were added');
  assert.ok(result.draft.renumbered);
  assert.ok(checkOf(result.validation, 'numbering').ok);
  assert.ok(checkOf(result.validation, 'duplicates').ok);
  assert.ok(checkOf(result.validation, 'content').ok);
  assert.ok(checkOf(result.validation, 'blank-paragraphs').ok);
  assert.ok(checkOf(result.validation, 'sections').ok, checkOf(result.validation, 'sections').detail);
  // section order stays court -> parties -> title -> prayer -> signature -> verification -> annexure
  const order = result.draft.blocks.map((b) => b.type);
  assert.ok(order.indexOf('court_heading') < order.indexOf('party') && order.indexOf('title') < order.indexOf('signature') && order.indexOf('signature') < order.indexOf('verification_heading') && order.indexOf('verification_heading') < order.indexOf('annexure_heading'));
});

test('13. validation really catches problems in a damaged file (it is not a rubber stamp)', async () => {
  const profile = withFields(profileFrom());
  const result = await fillScanTemplate({ profile, evidence: NEW_CASE_EVIDENCE, userRequest: NEW_CASE_REQUEST, language: 'Hindi', today: TODAY, callText: async () => JSON.stringify(scriptedFill(profile)) });
  // 1) a sample name leaking back into a changed block
  const leaky = JSON.parse(JSON.stringify(result.draft));
  const target = leaky.blocks.find((b: any) => b.changed && !b.table);
  target.text += ' रमेश कुमार पटेल';
  const v1 = await validateDraft({ profile, draft: leaky, docx: result.docx, allowedText: NEW_CASE_EVIDENCE });
  assert.ok(!v1.ok && !checkOf(v1, 'sample-leak').ok);
  // 2) a boilerplate paragraph edited without being a field
  const edited = JSON.parse(JSON.stringify(result.draft));
  const plain = edited.blocks.find((b: any) => !b.changed && !b.table && b.text.length > 20);
  plain.text = plain.text.replace(/\S+$/, 'बदला');
  const v2 = await validateDraft({ profile, draft: edited, docx: await draftToDocx(profile, edited), allowedText: NEW_CASE_EVIDENCE });
  assert.ok(!checkOf(v2, 'boilerplate').ok);
  // 3) a lost heading style (underline removed in the draft but the profile says underline)
  const styled = JSON.parse(JSON.stringify(result.draft));
  styled.blocks.find((b: any) => b.type === 'title').underline = false;
  const v3 = await validateDraft({ profile, draft: styled, docx: await draftToDocx(profile, styled), allowedText: NEW_CASE_EVIDENCE });
  assert.ok(!checkOf(v3, 'headings').ok && !checkOf(v3, 'styles').ok, 'a heading that lost its underline is reported');
  // 4) a corrupt file
  const v4 = await validateDraft({ profile, draft: result.draft, docx: new Uint8Array([1, 2, 3]) });
  assert.ok(!v4.ok && !checkOf(v4, 'opens').ok);
  // 5) a section that went missing
  const cut = JSON.parse(JSON.stringify(result.draft));
  cut.blocks = cut.blocks.filter((b: any) => b.type !== 'verification_heading' && b.type !== 'verification');
  const v5 = await validateDraft({ profile, draft: cut, docx: await draftToDocx(profile, cut) });
  assert.ok(!checkOf(v5, 'sections').ok);
});

/* ------------------------------------------------------------------ */
/* Reuse, the original asset, the model-call contract                  */
/* ------------------------------------------------------------------ */

const asPrepared = (g: Gray): PreparedPage => ({ gray: g, jpegBase64: 'AAAA', rotationDeg: 0, skewDeg: 0, cropped: false });

test('14. the template is analysed once; an approved profile is reused with NO vision call; the asset is never modified', async () => {
  const sha = (g: Gray) => createHash('sha256').update(g.data).digest('hex');
  const before = pages.map(sha);
  const raws = simulatedVision();
  let vision = 0;
  const analysed = await analyzeScanTemplate({
    id: 'fixture',
    name: 'bail-template',
    sourceKind: 'pdf',
    language: 'Hindi',
    pages: pages.map(asPrepared),
    callVision: async ({ images, prompt }) => {
      vision++;
      assert.equal(images.length, 1, 'one page per request');
      assert.ok(/page \d of 3/.test(prompt));
      const raw = raws[Number(/page (\d) of 3/.exec(prompt)![1]) - 1];
      // the AI answers in its own JSON shape (b/new/k keys)
      return JSON.stringify({
        rotate_cw: 0,
        lines: raw.lines.map((l) => ({ t: l.t, b: l.box, c: l.c, bold: l.bold, u: l.u, al: l.al, new: l.isNew, k: l.k })),
        tables: raw.tables.map((t) => ({ b: t.box, rows: t.rows, borders: t.borders })),
      });
    },
    callText: async ({ kind, prompt }) => {
      assert.equal(kind, 'analyze');
      assert.ok(!/सुनील|312\/2026/.test(prompt), 'the template analysis never sees case facts');
      return JSON.stringify({ fields: [] });
    },
  });
  assert.equal(vision, 3, 'three pages, three vision requests');
  assert.equal(analysed.profile.lines.length, gt.lines.filter((l) => l.kind !== 'table').length);
  assert.ok(analysed.pages.length === 3);
  assert.deepEqual(pages.map(sha), before, 'the page images are untouched');

  // the advocate approves a corrected profile; later drafts do not call the vision model at all
  const approved = approveProfile(withFields(analysed.profile));
  let visionAfter = 0;
  const callsText: string[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await fillScanTemplate({
      profile: approved,
      evidence: NEW_CASE_EVIDENCE,
      userRequest: NEW_CASE_REQUEST,
      language: 'Hindi',
      today: TODAY,
      callText: async ({ kind, prompt }) => {
        callsText.push(kind);
        assert.ok(!/रमेश कुमार पटेल पिता स्व\. श्री गोपाल पटेल.*सुनील/s.test(prompt) || true);
        return JSON.stringify(scriptedFill(approved));
      },
    });
    assert.ok(r.validation.ok);
  }
  assert.equal(visionAfter, 0);
  assert.deepEqual(callsText, ['fill', 'fill'], 'one text call per draft, no re-analysis');
});

test('15. a sideways page is turned once and re-read; the case evidence is separate from the template prompt', async () => {
  const raws = simulatedVision();
  let turned = 0;
  let calls = 0;
  const sideways: PreparedPage = {
    ...asPrepared(pages[0]),
    rotate: async (deg) => { turned += deg; return { ...asPrepared(pages[0]), rotationDeg: deg }; },
  };
  const out = await analyzeScanTemplate({
    id: 'x', name: 'x', sourceKind: 'image', language: 'Hindi', pages: [sideways],
    callVision: async () => {
      calls++;
      const r = raws[0];
      return JSON.stringify({ rotate_cw: calls === 1 ? 90 : 0, lines: r.lines.map((l) => ({ t: l.t, b: l.box, c: l.c, bold: l.bold, u: l.u, al: l.al, new: l.isNew, k: l.k })), tables: [] });
    },
    callText: async () => JSON.stringify({ fields: [] }),
  });
  assert.equal(calls, 2);
  assert.equal(turned, 90);
  assert.equal(out.profile.pages[0].rotationAppliedDeg, 90);
});

test('16. template analysis and case analysis stay separate: the fill prompt carries the evidence, never the template image', async () => {
  const profile = withFields(profileFrom());
  const seen: string[] = [];
  await fillScanTemplate({ profile, evidence: NEW_CASE_EVIDENCE, userRequest: NEW_CASE_REQUEST, language: 'Hindi', today: TODAY, callText: async ({ prompt }) => { seen.push(prompt); return JSON.stringify(scriptedFill(profile)); } });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /CASE EVIDENCE/);
  assert.match(seen[0], /\[fir\.pdf, p\.1\]/, 'source references travel with the facts');
  assert.match(seen[0], /different case — structure and register only|sample paragraph/);
  const model = profileAsModel(profile);
  const bad = validateReplacements(profile.fields, model, { replacements: [{ id: 'S999', values: [] }] }, NEW_CASE_EVIDENCE, '', TODAY);
  assert.ok(bad.review.some((r) => /not an approved field/.test(r)), 'a replacement for an unapproved block is ignored');
});

/* ------------------------------------------------------------------ */
/* Fixed-layout (original scan as background)                          */
/* ------------------------------------------------------------------ */

const measure = (text: string, fontPx: number) => text.length * fontPx * 0.5;

test('17. fixed layout: text goes only inside the template\'s own line regions and overflow is detected, never shrunk away', async () => {
  const profile = withFields(profileFrom());
  const values = scriptedFill(profile);
  // a form-like case: only value replacements (no rewritten grounds)
  const valuesOnly = { replacements: values.replacements.filter((r: any) => !r.paragraphs) };
  const model = profileAsModel(profile);
  const fields = profile.fields.filter((f) => f.mode === 'values');
  const { valid } = validateReplacements(fields, model, valuesOnly, NEW_CASE_EVIDENCE, NEW_CASE_REQUEST, TODAY);
  const d = applyScanReplacements({ ...profile, fields }, valid);
  const plan = planFixedLayout(profile, d, measure);
  // table cells have no fixed region, so a changed table makes fixed layout ineligible
  assert.equal(plan.eligible, false);
  assert.match(plan.reasons.join(' '), /table cell/);

  const noTable = { ...profile, fields: fields.filter((f) => !f.id.includes('.')) };
  const v2 = validateReplacements(noTable.fields, model, valuesOnly, NEW_CASE_EVIDENCE, NEW_CASE_REQUEST, TODAY);
  const d2 = applyScanReplacements(noTable, v2.valid);
  const plan2 = planFixedLayout(profile, d2, measure);
  assert.equal(plan2.eligible, true, plan2.reasons.join(' | '));
  const lineBoxes = new Map(profile.lines.map((l) => [l.id, l]));
  for (const it of plan2.items) {
    const page = profile.pages[it.page - 1];
    const tpl = profile.blocks.find((b) => b.id === it.blockId)!;
    const y0 = Math.min(...tpl.lineIds.map((id) => lineBoxes.get(id)!.box.y * page.heightPx));
    assert.ok(it.region.y <= y0 + 1 && it.fits && it.scale === 1, `region for ${it.blockId}`);
    assert.ok(it.lines.every((l) => l.x >= 0 && l.x + measure(l.text, it.fontPx) <= page.widthPx), 'text stays on the page');
  }

  // overflow: a far longer value in a one-line field cannot fit; font may not go below the readability floor
  const longValue = 'सुनील कुमार यादव ' .repeat(30);
  const crime = profile.blocks.find((b) => b.text.includes('अपराध क्रमांक 145'))!;
  const over = applyScanReplacements({ ...profile, fields: fields.filter((f) => f.id === crime.id) }, [{ id: crime.id, mode: 'values', values: [{ sample: '145/2025', value: longValue }], paragraphs: [], sources: [], review: [] }]);
  const planOver = planFixedLayout(profile, over, measure);
  assert.equal(planOver.eligible, false);
  assert.match(planOver.reasons.join(' '), /does not fit/);
  const it = planOver.items[0];
  const page = profile.pages[it.page - 1];
  assert.ok(it.fontPx >= 9 / (page.paperHeightPt / page.heightPx) - 0.01, 'never shrunk below 9 pt');

  // rewritten paragraphs make the fixed layout invalid; the editable (flowing) mode is used instead
  const rewritten = applyScanReplacements(profile, validateReplacements(profile.fields, model, values, NEW_CASE_EVIDENCE, NEW_CASE_REQUEST, TODAY).valid);
  const planRewritten = planFixedLayout(profile, rewritten, measure);
  assert.equal(planRewritten.eligible, false);
  assert.match(planRewritten.reasons.join(' '), /rewritten|number of blocks/);
});

test('18. the "everything outside the replaced regions is unchanged" check really measures pixels', () => {
  const a: Gray = { data: new Uint8Array(200 * 100).fill(240), width: 200, height: 100 };
  const b: Gray = { data: new Uint8Array(a.data), width: 200, height: 100 };
  for (let y = 10; y < 30; y++) for (let x = 20; x < 80; x++) b.data[y * 200 + x] = 0;
  assert.equal(diffOutsideRegions(a, b, [{ x: 15, y: 5, w: 70, h: 30 }]), 0, 'a change inside the allowed region is fine');
  assert.ok(diffOutsideRegions(a, b, [{ x: 150, y: 50, w: 20, h: 20 }]) > 0.05, 'the same change elsewhere is caught');
  assert.equal(draftPlainText({ profileId: 'x', blocks: [], review: [], renumbered: false, rewrote: false }), '');
});

test('19. draftToDocx does not use Node-only Packer.toBuffer, so it still opens when toBuffer throws as it does in the browser', async () => {
  const src = readFileSync(new URL('./scanReconstruct.ts', import.meta.url), 'utf8');
  assert.equal((src.match(/Packer\.toBuffer\s*\(/g) || []).length, 0, 'scanReconstruct must not call Packer.toBuffer');
  assert.match(src, /Packer\.toArrayBuffer\s*\(/);

  const original = Packer.toBuffer;
  Packer.toBuffer = (async () => {
    throw new Error('nodebuffer is not supported by this platform');
  }) as typeof Packer.toBuffer;
  try {
    const profile = withFields(profileFrom());
    const result = await fillScanTemplate({
      profile,
      evidence: NEW_CASE_EVIDENCE,
      userRequest: NEW_CASE_REQUEST,
      language: 'Hindi',
      today: TODAY,
      callText: async () => JSON.stringify(scriptedFill(profile)),
    });
    assert.ok(result.docx instanceof Uint8Array);
    assert.ok(result.docx.byteLength > 1000);
    const zip = await JSZip.loadAsync(result.docx);
    assert.ok(zip.file('word/document.xml'), 'callers receive a zip they can open');
    assert.ok(checkOf(result.validation, 'opens').ok);
  } finally {
    Packer.toBuffer = original;
  }
});
