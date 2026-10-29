/**
 * Read a .docx on the device and keep its formatting as the editor's own tags.
 *
 * Sent as a raw file, Gemini sees a Word document's text and alignment but not
 * its bold or underline — every line comes back "plain". Reading the file's XML
 * ourselves keeps **bold**, [U]underline[/U], [CENTER] and [RIGHT] so the AI
 * (and the skeleton it builds from a template) sees the real formatting.
 *
 * No dependency: a .docx is a zip, and the browser can inflate it natively.
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const readU16 = (v: DataView, o: number) => v.getUint16(o, true);
const readU32 = (v: DataView, o: number) => v.getUint32(o, true);

/** Pull one file out of a zip using the central directory (handles data descriptors). */
const unzipEntry = async (buf: ArrayBuffer, wanted: string): Promise<Uint8Array | null> => {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End of central directory record: scan back for its signature.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = readU16(view, eocd + 10);
  let p = readU32(view, eocd + 16);
  for (let n = 0; n < count; n++) {
    if (readU32(view, p) !== 0x02014b50) return null;
    const method = readU16(view, p + 10);
    const compSize = readU32(view, p + 20);
    const nameLen = readU16(view, p + 28);
    const extraLen = readU16(view, p + 30);
    const commentLen = readU16(view, p + 32);
    const localOffset = readU32(view, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const lhNameLen = readU16(view, localOffset + 26);
      const lhExtraLen = readU16(view, localOffset + 28);
      const start = localOffset + 30 + lhNameLen + lhExtraLen;
      const raw = bytes.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method !== 8 || typeof DecompressionStream === 'undefined') return null;
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
};

const flagOn = (el: Element | null): boolean => {
  if (!el) return false;
  const v = (el.getAttributeNS(W_NS, 'val') ?? el.getAttribute('w:val') ?? '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'none';
};

const child = (parent: Element | null, local: string): Element | null => {
  if (!parent) return null;
  for (const c of Array.from(parent.children)) if (c.localName === local) return c;
  return null;
};

const runText = (run: Element): string => {
  let out = '';
  for (const c of Array.from(run.children)) {
    if (c.localName === 't') out += c.textContent || '';
    else if (c.localName === 'tab') out += '\t';
    else if (c.localName === 'br' || c.localName === 'cr') out += '\n';
  }
  return out;
};

const paragraphToTagged = (p: Element): string => {
  const pPr = child(p, 'pPr');
  const jc = (child(pPr, 'jc')?.getAttributeNS(W_NS, 'val') ?? child(pPr, 'jc')?.getAttribute('w:val') ?? '').toLowerCase();
  const style = (child(pPr, 'pStyle')?.getAttributeNS(W_NS, 'val') ?? child(pPr, 'pStyle')?.getAttribute('w:val') ?? '');
  const headingStyle = /^(heading|title)/i.test(style);

  const pieces: { text: string; b: boolean; u: boolean }[] = [];
  const collect = (node: Element) => {
    for (const c of Array.from(node.children)) {
      if (c.localName === 'r') {
        const text = runText(c);
        if (!text) continue;
        const rPr = child(c, 'rPr');
        const b = rPr ? flagOn(child(rPr, 'b')) : false;
        const u = rPr ? flagOn(child(rPr, 'u')) : false;
        pieces.push({ text, b: b || headingStyle, u });
      } else if (c.localName === 'hyperlink' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'ins') {
        collect(c);
      }
    }
  };
  collect(p);
  if (pieces.length === 0) return '';

  // Merge neighbouring runs that share a style so tags are not repeated per word.
  const merged: typeof pieces = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.b === piece.b && last.u === piece.u) last.text += piece.text;
    else merged.push({ ...piece });
  }
  let line = merged
    .map((m) => {
      if (!m.text.trim()) return m.text;
      let t = m.text;
      if (m.u) t = `[U]${t}[/U]`;
      if (m.b) t = `**${t}**`;
      return t;
    })
    .join('');
  if (!line.trim()) return '';
  if (jc === 'center') line = `[CENTER]${line}[/CENTER]`;
  else if (jc === 'right' || jc === 'end') line = `[RIGHT]${line}[/RIGHT]`;
  return line;
};

const bodyToLines = (node: Element, out: string[]) => {
  for (const c of Array.from(node.children)) {
    if (c.localName === 'p') {
      const line = paragraphToTagged(c);
      out.push(line);
    } else if (c.localName === 'tbl') {
      for (const row of Array.from(c.children).filter((r) => r.localName === 'tr')) {
        const cells = Array.from(row.children)
          .filter((x) => x.localName === 'tc')
          .map((tc) => {
            const lines: string[] = [];
            bodyToLines(tc, lines);
            return lines.filter((l) => l.trim()).join(' ');
          })
          .filter(Boolean);
        if (cells.length === 2) out.push(`[ROW]\n${cells[0]}\n|\n${cells[1]}\n[/ROW]`);
        else if (cells.length > 0) out.push(cells.join(' | '));
      }
    } else if (c.localName === 'sdt' || c.localName === 'sdtContent') {
      bodyToLines(c, out);
    }
  }
};

export const isDocxFile = (file: File): boolean =>
  /\.docx$/i.test(file.name || '') ||
  file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Tagged text for a .docx, or null if it cannot be read here (caller then sends the raw file). */
export const docxToTaggedText = async (file: File): Promise<string | null> => {
  try {
    const buf = await file.arrayBuffer();
    const xmlBytes = await unzipEntry(buf, 'word/document.xml');
    if (!xmlBytes) return null;
    const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(xmlBytes), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0] || doc.getElementsByTagName('w:body')[0];
    if (!body) return null;
    const lines: string[] = [];
    bodyToLines(body, lines);
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    console.warn('docx text read failed; sending the file as is', e);
    return null;
  }
};
