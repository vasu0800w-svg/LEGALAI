/**
 * Shared helpers for the scanned-template tests: loads the generated fixture pages, simulates what the
 * AI vision model would report for them (from the measured ground truth, with a little positional noise
 * like a real model has), and provides a fictional NEW case plus scripted fill answers.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readGrayPng } from './pngGray.ts';
import type { Gray } from '../scanPixels.ts';
import type { RawPage, TemplateProfile } from '../scanTemplate.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const fixturePath = (name: string) => join(here, name);

export interface GtLine {
  page: number;
  kind: string;
  text: string;
  start?: boolean;
  bold?: boolean;
  underline?: boolean;
  align?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const loadGt = (): { width: number; height: number; lines: GtLine[] } => JSON.parse(readFileSync(fixturePath('scan-template-gt.json'), 'utf8'));
export const loadPages = (): Gray[] => [1, 2, 3].map((n) => readGrayPng(fixturePath(`scan-template-p${n}.png`)));

export const TABLE_CELLS = [
  ['क्र.', 'सह-अभियुक्त का नाम', 'वर्तमान स्थिति'],
  ['1', 'दिनेश कुमार साहू', 'जमानत पर'],
  ['2', 'मोहन लाल निषाद', 'न्यायिक अभिरक्षा'],
];

/** What a vision model would say about the fixture pages (boxes within ~0.4% of the truth). */
export const simulatedVision = (jitter = 4, seed = 11): RawPage[] => {
  const gt = loadGt();
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const q = (v: number, max: number) => Math.round(Math.max(0, Math.min(1000, (v / max) * 1000 + rnd() * jitter)));
  return [1, 2, 3].map((p) => {
    const ls = gt.lines.filter((l) => l.page === p);
    const box = (l: GtLine): [number, number, number, number] => [q(l.y, gt.height), q(l.x, gt.width), q(l.y + l.h, gt.height), q(l.x + l.w, gt.width)];
    return {
      rotateCw: 0,
      marks: [],
      notes: [],
      lines: ls.filter((l) => l.kind !== 'table').map((l) => ({
        t: l.text,
        box: box(l),
        c: 0.92,
        bold: !!l.bold,
        u: !!l.underline,
        al: (l.align === 'center' ? 'center' : l.align === 'right' ? 'right' : 'left') as any,
        isNew: !!l.start,
        k: l.kind as any,
      })),
      tables: ls.filter((l) => l.kind === 'table').map((l) => ({ box: box(l), rows: TABLE_CELLS, borders: true })),
    };
  });
};

/** The NEW case: fictional, and none of its names/numbers/dates appear in the template. */
export const NEW_CASE_EVIDENCE = [
  '### Batch 1/1',
  'CLIENT: सुनील कुमार यादव',
  '[fir.pdf, p.1] थाना खरसिया, अपराध क्रमांक 312/2026, धारा 303(2) भारतीय न्याय संहिता।',
  '[fir.pdf, p.1] प्रथम सूचना रिपोर्ट दिनांक 05/09/2026 को दर्ज; अन्य स्वतंत्र साक्षी का उल्लेख नहीं।',
  '[fir.pdf, p.2] आवेदक सुनील कुमार यादव पिता श्री रामआधार यादव, उम्र 41 वर्ष, निवासी ग्राम खरसिया, जिला जशपुर (छ.ग.)।',
  '[remand.pdf, p.1] आवेदक को दिनांक 07/09/2026 को गिरफ्तार किया गया; वर्तमान में न्यायिक अभिरक्षा में।',
  '[remand.pdf, p.1] गिरफ्तारी के संबंध में एक अन्य दस्तावेज में दिनांक 08/09/2026 भी लिखी है (विरोधाभास)।',
  '[bail-note.pdf, p.1] आवेदक का कोई पूर्व आपराधिक इतिहास नहीं है; स्थायी निवासी है।',
  '[bail-note.pdf, p.1] आवेदक की पत्नी और तीन बच्चे उसी पर आश्रित हैं।',
  '[bail-note.pdf, p.2] सह-अभियुक्त अजय कुमार सिंह जमानत पर हैं; विनोद राठिया न्यायिक अभिरक्षा में हैं।',
  '[court-note.pdf, p.1] न्यायालय: सत्र न्यायाधीश, जिला जशपुर (छ.ग.)। जमानत आवेदन वर्ष 2026।',
].join('\n');

export const NEW_CASE_REQUEST = 'सुनील कुमार यादव की नियमित जमानत का आवेदन बनाओ';

const squash = (s: string) => s.replace(/\s+/g, ' ');
const block = (profile: TemplateProfile, needle: string) => {
  const b = profile.blocks.find((x) => squash(x.text).includes(squash(needle)));
  if (!b) throw new Error(`fixture block not found: ${needle}`);
  return b;
};

export interface ScriptOptions {
  /** make the "AI" misbehave in the ways the pipeline must catch */
  misbehave?: boolean;
}

/** What the text AI would answer when asked which blocks carry the sample case. */
export const scriptedFields = (profile: TemplateProfile) => ({
  fields: [
    { id: block(profile, 'न्यायालय श्रीमान्').id, mode: 'values', purpose: 'court district', samples: ['रायगढ़'] },
    { id: block(profile, 'जमानत आवेदन क्रमांक').id, mode: 'values', purpose: 'application year', samples: ['2025'] },
    { id: block(profile, 'रमेश कुमार पटेल पिता').id, mode: 'values', purpose: 'applicant details', samples: ['रमेश कुमार पटेल', 'स्व. श्री गोपाल पटेल', '34', 'सरिया', 'रायगढ़'] },
    { id: block(profile, 'छत्तीसगढ़ राज्य द्वारा').id, mode: 'values', purpose: 'police station', samples: ['सरिया'] },
    { id: block(profile, 'अपराध क्रमांक 145/2025').id, mode: 'values', purpose: 'crime details', samples: ['145/2025', 'सरिया', '305(a), 331(4)'] },
    { id: block(profile, '1.   यह कि, आवेदक को पुलिस').id, mode: 'values', purpose: 'arrest', samples: ['सरिया', '14/03/2025'] },
    { id: block(profile, '2.   यह कि, आवेदक के विरुद्ध').id, mode: 'rewrite', purpose: 'ground: false implication' },
    { id: block(profile, '(क)').id, mode: 'rewrite', purpose: 'ground: no antecedents' },
    { id: block(profile, '(ख)').id, mode: 'rewrite', purpose: 'ground: permanent resident' },
    { id: block(profile, '3.   यह कि, प्रकरण').id, mode: 'rewrite', purpose: 'ground: investigation complete' },
    { id: block(profile, '4.   यह कि, आवेदक पर').id, mode: 'rewrite', purpose: 'ground: dependants' },
    { id: `${block(profile, 'क्र. |').id}.2.2`, mode: 'values', purpose: 'co-accused name', samples: ['दिनेश कुमार साहू'] },
    { id: `${block(profile, 'क्र. |').id}.2.3`, mode: 'values', purpose: 'co-accused status', samples: ['जमानत पर'] },
    { id: `${block(profile, 'क्र. |').id}.3.2`, mode: 'values', purpose: 'co-accused name', samples: ['मोहन लाल निषाद'] },
    { id: `${block(profile, 'क्र. |').id}.3.3`, mode: 'values', purpose: 'co-accused status', samples: ['न्यायिक अभिरक्षा'] },
    { id: block(profile, 'स्थान :-').id, mode: 'values', purpose: 'place', samples: ['रायगढ़'] },
    { id: block(profile, 'दिनांक :-').id, mode: 'values', purpose: 'date', samples: ['20/03/2025'] },
    { id: block(profile, 'मैं रमेश कुमार पटेल').id, mode: 'values', purpose: 'verification', samples: ['रमेश कुमार पटेल', '20/03/2025', 'रायगढ़'] },
  ],
});

/** The text AI's replacement values for the NEW case. With `misbehave` it also makes the mistakes we must catch. */
export const scriptedFill = (profile: TemplateProfile, opts: ScriptOptions = {}) => {
  const id = (needle: string) => block(profile, needle).id;
  const tableId = block(profile, 'क्र. |').id;
  const long =
    'यह कि, आवेदक के विरुद्ध झूठा प्रकरण दर्ज किया गया है तथा प्रथम सूचना रिपोर्ट में अन्य कोई स्वतंत्र साक्षी नहीं है। ' +
    'आवेदक का घटना से कोई संबंध नहीं है और अभियोजन के पास आवेदक के विरुद्ध कोई प्रत्यक्ष साक्ष्य उपलब्ध नहीं है। ' +
    'प्रथम सूचना रिपोर्ट में लगाए गए आरोप सामान्य प्रकृति के हैं और उनकी पुष्टि किसी स्वतंत्र साक्षी या दस्तावेज से नहीं होती है। ' +
    'आवेदक पूरे अन्वेषण में सहयोग करने को तैयार है तथा न्यायालय द्वारा निर्धारित प्रत्येक शर्त का पालन करेगा।';
  const replacements: any[] = [
    { id: id('न्यायालय श्रीमान्'), values: [{ sample: 'रायगढ़', value: 'जशपुर' }], sources: ['court-note.pdf, p.1'] },
    { id: id('जमानत आवेदन क्रमांक'), values: [{ sample: '2025', value: '2026' }], sources: ['court-note.pdf, p.1'] },
    {
      id: id('रमेश कुमार पटेल पिता'),
      values: [
        { sample: 'रमेश कुमार पटेल', value: 'सुनील कुमार यादव' },
        { sample: 'स्व. श्री गोपाल पटेल', value: 'श्री रामआधार यादव' },
        { sample: '34', value: '41' },
        { sample: 'सरिया', value: 'खरसिया' },
        { sample: 'रायगढ़', value: 'जशपुर' },
      ],
      sources: ['fir.pdf, p.2'],
    },
    { id: id('छत्तीसगढ़ राज्य द्वारा'), values: [{ sample: 'सरिया', value: 'खरसिया' }], sources: ['fir.pdf, p.1'] },
    {
      id: id('अपराध क्रमांक 145/2025'),
      values: [
        { sample: '145/2025', value: '312/2026' },
        { sample: 'सरिया', value: 'खरसिया' },
        { sample: '305(a), 331(4)', value: '303(2)' },
      ],
      sources: ['fir.pdf, p.1'],
    },
    // the arrest date is contradictory in the papers (07/09 vs 08/09): the AI must not pick one
    {
      id: id('1.   यह कि, आवेदक को पुलिस'),
      values: [{ sample: 'सरिया', value: 'खरसिया' }, { sample: '14/03/2025', value: '________' }],
      sources: ['remand.pdf, p.1'],
      needsReview: true,
      uncertainty: 'गिरफ्तारी की तारीख 07/09/2026 और 08/09/2026 दोनों लिखी है; कृपया सही तारीख जाँचें।',
    },
    {
      id: id('2.   यह कि, आवेदक के विरुद्ध'),
      paragraphs: [`2.   ${long}`],
      sources: ['fir.pdf, p.1', 'bail-note.pdf, p.1'],
    },
    { id: id('(क)'), paragraphs: ['(क)  आवेदक का कोई पूर्व आपराधिक इतिहास नहीं है।'], sources: ['bail-note.pdf, p.1'] },
    { id: id('(ख)'), paragraphs: ['(ख)  आवेदक स्थायी निवासी है।', '(ग)  आवेदक की पत्नी और तीन बच्चे उसी पर आश्रित हैं।'], sources: ['bail-note.pdf, p.1'] },
    { id: id('3.   यह कि, प्रकरण'), paragraphs: ['3.   यह कि, प्रकरण का अन्वेषण पूर्ण हो चुका है एवं आवेदक से कोई जप्ती शेष नहीं है।'], sources: ['remand.pdf, p.1'] },
    {
      id: id('4.   यह कि, आवेदक पर'),
      paragraphs: [
        '4.   यह कि, आवेदक पर पत्नी और तीन अवयस्क बच्चों के पालन-पोषण का दायित्व है।',
        '5.   यह कि, आवेदक जमानत की सभी शर्तों का पालन करने को तैयार है।',
      ],
      sources: ['bail-note.pdf, p.1'],
    },
    { id: `${tableId}.2.2`, values: [{ sample: 'दिनेश कुमार साहू', value: 'अजय कुमार सिंह' }], sources: ['bail-note.pdf, p.2'] },
    { id: `${tableId}.2.3`, values: [{ sample: 'जमानत पर', value: 'जमानत पर' }], sources: ['bail-note.pdf, p.2'] },
    { id: `${tableId}.3.2`, values: [{ sample: 'मोहन लाल निषाद', value: 'विनोद राठिया' }], sources: ['bail-note.pdf, p.2'] },
    { id: `${tableId}.3.3`, values: [{ sample: 'न्यायिक अभिरक्षा', value: 'न्यायिक अभिरक्षा' }], sources: ['bail-note.pdf, p.2'] },
    { id: id('स्थान :-'), values: [{ sample: 'रायगढ़', value: 'जशपुर' }], sources: [] },
    { id: id('दिनांक :-'), values: [{ sample: '20/03/2025', value: '27/10/2026' }], sources: [] },
    {
      id: id('मैं रमेश कुमार पटेल'),
      values: [
        { sample: 'रमेश कुमार पटेल', value: 'सुनील कुमार यादव' },
        { sample: '20/03/2025', value: '27/10/2026' },
        { sample: 'रायगढ़', value: 'जशपुर' },
      ],
      sources: [],
    },
  ];
  if (opts.misbehave) {
    // 1) leaves the template's applicant name inside a ground, 2) invents a date the papers never mention
    const g = replacements.find((r) => r.id === id('(क)'))!;
    g.paragraphs = ['(क)  रमेश कुमार पटेल का कोई पूर्व आपराधिक इतिहास नहीं है।'];
    const a = replacements.find((r) => r.id === id('3.   यह कि, प्रकरण'))!;
    a.paragraphs = ['3.   यह कि, प्रकरण का अन्वेषण दिनांक 19/09/2026 को पूर्ण हो चुका है।'];
  }
  return { replacements };
};
