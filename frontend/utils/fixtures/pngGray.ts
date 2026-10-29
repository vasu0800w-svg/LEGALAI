/** Minimal decoder for the 8-bit grayscale PNGs the scan fixture uses (test helper only). */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import type { Gray } from '../scanPixels.ts';

export const readGrayPng = (path: string): Gray => {
  const buf = readFileSync(path);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 0 || body[12] !== 0) throw new Error('fixture must be 8-bit grayscale, non-interlaced');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8Array(width * height);
  const stride = width;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x ? data[y * stride + x - 1] : 0;
      const b = y ? data[(y - 1) * stride + x] : 0;
      const c = x && y ? data[(y - 1) * stride + x - 1] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[y * stride + x] = v & 255;
    }
  }
  return { data, width, height };
};
