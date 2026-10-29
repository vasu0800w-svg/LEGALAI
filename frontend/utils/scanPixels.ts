/**
 * Pixel measurements on a grayscale page image. Pure functions on plain arrays, so they run the same in the
 * browser (ImageData -> gray) and in Node tests. They give the template analysis evidence that does not
 * depend on the AI: how crooked the page is, where the paper ends, where ink really sits, whether a line is
 * underlined, how heavy its strokes are and whether a box is ruled like a table.
 */

export interface Gray {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** Pixel rectangle: x, y = top-left. */
export interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const toGray = (rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray => {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return { data, width, height };
};

/** Otsu's method: the gray level that best separates ink from paper. */
export const otsuThreshold = (g: Gray): number => {
  const hist = new Array<number>(256).fill(0);
  const step = Math.max(1, Math.floor(Math.sqrt((g.width * g.height) / 400000)));
  let total = 0;
  for (let y = 0; y < g.height; y += step) {
    for (let x = 0; x < g.width; x += step) {
      hist[g.data[y * g.width + x]]++;
      total++;
    }
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
};

/** Ink is clearly darker than the paper; a fixed margin below Otsu keeps shadows and JPEG haze out. */
export const inkThreshold = (g: Gray): number => {
  const o = otsuThreshold(g);
  return Math.max(40, Math.min(200, o - 6));
};

const clampBox = (b: PxBox, g: Gray): PxBox => {
  const x1 = Math.max(0, Math.floor(b.x));
  const y1 = Math.max(0, Math.floor(b.y));
  const x2 = Math.min(g.width, Math.ceil(b.x + b.w));
  const y2 = Math.min(g.height, Math.ceil(b.y + b.h));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
};

/* ---------------------------- skew ---------------------------- */

/**
 * Angle, in degrees, by which the text lines are rotated clockwise (lines drop towards the right).
 * Projection-profile search: when the page is straight, ink piles up in a few sharp rows.
 * Returns 0 when there is not enough text to tell.
 */
export const estimateSkewDeg = (g: Gray): number => {
  const thr = inkThreshold(g);
  const scale = Math.max(1, Math.round(g.width / 800));
  const pts: number[] = [];
  for (let y = 0; y < g.height; y += scale) {
    for (let x = 0; x < g.width; x += scale) {
      if (g.data[y * g.width + x] < thr) pts.push(x / scale, y / scale);
    }
  }
  const n = pts.length / 2;
  if (n < 400) return 0;
  const stride = Math.max(1, Math.floor(n / 50000));
  const h = Math.ceil(g.height / scale) + Math.ceil(g.width / scale) + 4;
  const score = (deg: number): number => {
    const r = (deg * Math.PI) / 180;
    const s = Math.sin(r);
    const c = Math.cos(r);
    const bins = new Float64Array(h);
    const off = Math.ceil(g.width / scale) + 2;
    for (let i = 0; i < n; i += stride) {
      const yy = pts[2 * i + 1] * c - pts[2 * i] * s + off;
      bins[Math.max(0, Math.min(h - 1, Math.round(yy)))]++;
    }
    let sq = 0;
    for (let i = 0; i < h; i++) sq += bins[i] * bins[i];
    return sq;
  };
  let bestDeg = 0;
  let best = score(0);
  const base = best;
  for (let d = -8; d <= 8; d += 0.5) {
    const sc = score(d);
    if (sc > best) { best = sc; bestDeg = d; }
  }
  const centre = bestDeg;
  for (let d = centre - 0.5; d <= centre + 0.5; d += 0.1) {
    const sc = score(d);
    if (sc > best) { best = sc; bestDeg = d; }
  }
  // Only trust a clear improvement over "not rotated".
  if (best < base * 1.03) return 0;
  return Math.round(bestDeg * 10) / 10;
};

/* ---------------------------- page bounds ---------------------------- */

/**
 * The paper's rectangle when the photo shows a darker background around it (table, desk, scanner lid).
 * A flat scan whose edges are already white returns the whole image.
 */
export const detectPageBounds = (g: Gray): PxBox => {
  const full: PxBox = { x: 0, y: 0, w: g.width, h: g.height };
  const step = Math.max(1, Math.round(Math.max(g.width, g.height) / 500));
  const thr = Math.max(90, otsuThreshold(g));
  const rows = new Array<number>(Math.ceil(g.height / step)).fill(0);
  const cols = new Array<number>(Math.ceil(g.width / step)).fill(0);
  for (let y = 0, ry = 0; y < g.height; y += step, ry++) {
    for (let x = 0, cx = 0; x < g.width; x += step, cx++) {
      if (g.data[y * g.width + x] > thr) {
        rows[ry]++;
        cols[cx]++;
      }
    }
  }
  const rowNeed = cols.length * 0.5;
  const colNeed = rows.length * 0.5;
  const first = (arr: number[], need: number) => arr.findIndex((v) => v >= need);
  const last = (arr: number[], need: number) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= need) return i; return -1; };
  const y1 = first(rows, rowNeed) * step;
  const y2 = (last(rows, rowNeed) + 1) * step;
  const x1 = first(cols, colNeed) * step;
  const x2 = (last(cols, colNeed) + 1) * step;
  if (y1 < 0 || x1 < 0 || y2 <= y1 || x2 <= x1) return full;
  const area = ((x2 - x1) * (y2 - y1)) / (g.width * g.height);
  if (area > 0.93 || area < 0.35) return full;
  return clampBox({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, g);
};

/* ---------------------------- ink boxes ---------------------------- */

export interface Snapped {
  box: PxBox;
  /** dark pixels counted inside the snapped box */
  ink: number;
  found: boolean;
}

/**
 * The AI's box for a line is only approximate. Shrink/grow it to the ink that is really on the page.
 * `found` is false when almost nothing is printed there, which means the line may not exist.
 */
export const snapToInk = (g: Gray, approx: PxBox, thr = inkThreshold(g)): Snapped => {
  const padY = Math.max(3, approx.h * 0.45);
  const padX = Math.max(4, approx.h * 0.6);
  const area = clampBox({ x: approx.x - padX, y: approx.y - padY, w: approx.w + padX * 2, h: approx.h + padY * 2 }, g);
  if (area.w < 4 || area.h < 4) return { box: clampBox(approx, g), ink: 0, found: false };
  const rowCount = new Array<number>(area.h).fill(0);
  for (let y = 0; y < area.h; y++) {
    let c = 0;
    const o = (area.y + y) * g.width + area.x;
    for (let x = 0; x < area.w; x++) if (g.data[o + x] < thr) c++;
    rowCount[y] = c;
  }
  const rowMin = Math.max(2, Math.round(approx.w * 0.006));
  const inked = rowCount.map((c) => c >= rowMin);
  // Take the run of inked rows (bridging 1-row gaps) that overlaps the AI's line the most.
  const runs: [number, number][] = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y <= area.h; y++) {
    const on = y < area.h && inked[y];
    if (on) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > 2 || y === area.h) {
        runs.push([start, y - gap]);
        start = -1;
        gap = 0;
      }
    }
  }
  const a0 = approx.y - area.y;
  const a1 = a0 + approx.h;
  let bestRun: [number, number] | null = null;
  let bestOverlap = 0;
  for (const r of runs) {
    const ov = Math.min(r[1] + 1, a1) - Math.max(r[0], a0);
    if (ov > bestOverlap) { bestOverlap = ov; bestRun = r; }
  }
  if (!bestRun || bestOverlap < approx.h * 0.3) return { box: clampBox(approx, g), ink: 0, found: false };
  const top = bestRun[0];
  const bottom = bestRun[1];
  const colCount = new Array<number>(area.w).fill(0);
  for (let y = top; y <= bottom; y++) {
    const o = (area.y + y) * g.width + area.x;
    for (let x = 0; x < area.w; x++) if (g.data[o + x] < thr) colCount[x]++;
  }
  let left = -1;
  let right = -1;
  for (let x = 0; x < area.w; x++) if (colCount[x] >= 1 && hasNeighbour(colCount, x)) { if (left < 0) left = x; right = x; }
  if (left < 0) return { box: clampBox(approx, g), ink: 0, found: false };
  const box = clampBox({ x: area.x + left, y: area.y + top, w: right - left + 1, h: bottom - top + 1 }, g);
  let ink = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    const o = y * g.width;
    for (let x = box.x; x < box.x + box.w; x++) if (g.data[o + x] < thr) ink++;
  }
  return { box, ink, found: ink > 12 };
};

/** A lone speck is noise; real glyphs have inked neighbours within a few columns. */
const hasNeighbour = (cols: number[], x: number): boolean => {
  for (let d = 1; d <= 6; d++) if ((cols[x - d] || 0) >= 1 || (cols[x + d] || 0) >= 1) return true;
  return false;
};

/** Longest horizontal dark run in one row of a box (1-pixel gaps are bridged). */
const longestRun = (g: Gray, y: number, x1: number, x2: number, thr: number): number => {
  let best = 0;
  let run = 0;
  let miss = 0;
  const o = y * g.width;
  for (let x = x1; x < x2; x++) {
    if (g.data[o + x] < thr) { run += 1 + miss; miss = 0; } else if (run > 0 && miss < 1) { miss++; } else { best = Math.max(best, run); run = 0; miss = 0; }
  }
  return Math.max(best, run);
};

export interface UnderlineResult {
  underlined: boolean;
  /** y of the underline stroke, when one was found */
  y?: number;
  /** 0..1 how much of the line the stroke covers */
  coverage: number;
}

/**
 * An underline is one long unbroken stroke below the letters. Devanagari's headline (shirorekha) is also a
 * long stroke, but it sits at the top of the line, so only the bottom part of the box and the strip just
 * under it are examined.
 */
export const findUnderline = (g: Gray, box: PxBox, thr = inkThreshold(g)): UnderlineResult => {
  const y0 = Math.floor(box.y + box.h * 0.62);
  const y1 = Math.min(g.height - 1, Math.ceil(box.y + box.h + box.h * 0.3));
  const x1 = Math.max(0, box.x);
  const x2 = Math.min(g.width, box.x + box.w);
  let best = 0;
  let bestY = -1;
  for (let y = y0; y <= y1; y++) {
    const r = longestRun(g, y, x1, x2, thr) / Math.max(1, x2 - x1);
    if (r > best) { best = r; bestY = y; }
  }
  return best >= 0.72 ? { underlined: true, y: bestY, coverage: best } : { underlined: false, coverage: best };
};

/**
 * Ink per unit of area, ignoring any underline stroke. Strokes of bold type are thicker, so the ratio of a
 * line's density to the page's typical density separates bold from regular text. It is an estimate: digits,
 * punctuation and headings in a different size shift it, so callers treat it as evidence, not proof.
 */
export const inkDensity = (g: Gray, box: PxBox, underlineY?: number, thr = inkThreshold(g)): number => {
  const bottom = underlineY !== undefined ? Math.max(box.y + 2, underlineY - 1) : box.y + box.h;
  let ink = 0;
  let area = 0;
  for (let y = box.y; y < bottom; y++) {
    const o = y * g.width;
    for (let x = box.x; x < box.x + box.w; x++) {
      area++;
      if (g.data[o + x] < thr) ink++;
    }
  }
  return area ? ink / area : 0;
};

export interface RuleLines {
  horizontal: number;
  vertical: number;
}

/** Counts long straight ruling inside a box (table borders). Adjacent rows/columns count once. */
export const countRuleLines = (g: Gray, box: PxBox, thr = inkThreshold(g)): RuleLines => {
  const b = clampBox(box, g);
  let horizontal = 0;
  let vertical = 0;
  let prev = -10;
  for (let y = b.y; y < b.y + b.h; y++) {
    const r = longestRun(g, y, b.x, b.x + b.w, thr) / Math.max(1, b.w);
    if (r >= 0.8) { if (y - prev > 3) horizontal++; prev = y; }
  }
  prev = -10;
  for (let x = b.x; x < b.x + b.w; x++) {
    let run = 0;
    let best = 0;
    for (let y = b.y; y < b.y + b.h; y++) {
      if (g.data[y * g.width + x] < thr) { run++; best = Math.max(best, run); } else run = 0;
    }
    if (best / Math.max(1, b.h) >= 0.8) { if (x - prev > 3) vertical++; prev = x; }
  }
  return { horizontal, vertical };
};

/** Median of a list; 0 when empty. */
export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
