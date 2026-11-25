import type { Rect } from '../types';

/**
 * Automatic panel detection by recursive XY-cut on gutters.
 * Works on classic western/manga layouts with uniform (white or black) gutters.
 */
export function detectPanels(img: CanvasImageSource, width: number, height: number, rtl = false, src: Rect = { x: 0, y: 0, w: width, h: height }): Rect[] {
  const ox = src.x, oy = src.y;
  width = src.w;
  height = src.h;
  const S = Math.min(1, 900 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * S)), h = Math.max(8, Math.round(height * S));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, ox, oy, width, height, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  // gutter colour = median of the border pixels
  const border: number[] = [];
  for (let i = 0; i < w; i++) border.push(lum[i], lum[(h - 1) * w + i]);
  for (let j = 0; j < h; j++) border.push(lum[j * w], lum[j * w + w - 1]);
  border.sort((a, b) => a - b);
  const bg = border[border.length >> 1];
  const tol = 38;
  const isBg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) isBg[i] = Math.abs(lum[i] - bg) < tol ? 1 : 0;

  const minGap = Math.max(2, Math.round(Math.min(w, h) * 0.006));
  const minSide = Math.min(w, h) * 0.08;

  let thr = 0.985;
  const rowBg = (y: number, x0: number, x1: number) => {
    let n = 0;
    for (let i = x0; i < x1; i++) n += isBg[y * w + i];
    return n / (x1 - x0) > thr;
  };
  const colBg = (xx: number, y0: number, y1: number) => {
    let n = 0;
    for (let j = y0; j < y1; j++) n += isBg[j * w + xx];
    return n / (y1 - y0) > thr;
  };

  /** split [a,b) by runs of gutter lines; returns content segments */
  function segments(a: number, b: number, test: (i: number) => boolean) {
    const segs: [number, number][] = [];
    let start = -1, gap = 0;
    for (let i = a; i < b; i++) {
      if (test(i)) {
        gap++;
        if (start >= 0 && gap >= minGap) {
          segs.push([start, i - gap + 1]);
          start = -1;
        }
      } else {
        if (start < 0) start = i;
        gap = 0;
      }
    }
    if (start >= 0) segs.push([start, b]);
    return segs.filter(([s, e]) => e - s >= minSide * 0.5);
  }

  const out: Rect[] = [];
  function cut(r: Rect, horizontalFirst: boolean, depth: number) {
    thr = 0.985;
    let rows = segments(r.y, r.y + r.h, (y) => rowBg(y, r.x, r.x + r.w));
    let cols = segments(r.x, r.x + r.w, (xx) => colBg(xx, r.y, r.y + r.h));
    // Art that bleeds over the gutters: for big unsplit regions, retry with a
    // looser gutter test, but only accept thick gutters and sizeable panels.
    if (rows.length < 2 && cols.length < 2 && r.w * r.h > w * h * 0.15) {
      for (const t of [0.85, 0.7, 0.55]) {
        thr = t;
        const big = (sg: [number, number][]) => sg.filter(([a, b]) => b - a >= minSide * 1.5);
        rows = big(segments(r.y, r.y + r.h, (y) => rowBg(y, r.x, r.x + r.w)));
        cols = big(segments(r.x, r.x + r.w, (xx) => colBg(xx, r.y, r.y + r.h)));
        if (rows.length > 1 || cols.length > 1) break;
      }
      thr = 0.985;
    }
    const tryRows = rows.length > 1, tryCols = cols.length > 1;
    if (depth > 6 || (!tryRows && !tryCols)) {
      // trim to content
      const tr = tighten(r);
      if (tr && tr.w >= minSide && tr.h >= minSide) out.push(tr);
      return;
    }
    if ((horizontalFirst && tryRows) || !tryCols) {
      for (const [s, e] of rows) cut({ x: r.x, y: s, w: r.w, h: e - s }, false, depth + 1);
    } else {
      const ordered = rtl ? [...cols].reverse() : cols;
      for (const [s, e] of ordered) cut({ x: s, y: r.y, w: e - s, h: r.h }, true, depth + 1);
    }
  }
  function tighten(r: Rect): Rect | null {
    const rs = segments(r.y, r.y + r.h, (y) => rowBg(y, r.x, r.x + r.w));
    const cs = segments(r.x, r.x + r.w, (xx) => colBg(xx, r.y, r.y + r.h));
    if (!rs.length || !cs.length) return null;
    const y0 = rs[0][0], y1 = rs[rs.length - 1][1];
    const x0 = cs[0][0], x1 = cs[cs.length - 1][1];
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  cut({ x: 0, y: 0, w, h }, true, 0);
  return out.map((r) => ({
    x: ox + Math.round(r.x / S), y: oy + Math.round(r.y / S), w: Math.round(r.w / S), h: Math.round(r.h / S),
  }));
}

/* ------------------------------------------------------------------ */

export type CutKind = 'panels' | 'splash' | 'zones';
export interface PageCut { rects: Rect[]; kind: CutKind; note?: string }

const area = (r: Rect) => r.w * r.h;
function inter(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Reading-order zones used when panels can't be trusted: the page is always animated. */
export function zonesFor(width: number, height: number, rtl = false, x0 = 0): Rect[] {
  const ar = width / height;
  if (ar > 1.2) {
    const half = width / 2;
    const left = zonesFor(half, height, rtl, x0), right = zonesFor(half, height, rtl, x0 + half);
    return rtl ? [...right, ...left] : [...left, ...right];
  }
  const n = ar < 0.8 ? 3 : 2;
  const step = height / n, ov = step * 0.08;
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(x0), y: Math.round(Math.max(0, i * step - ov)), w: Math.round(width),
    h: Math.round(Math.min(height, (i + 1) * step + ov) - Math.max(0, i * step - ov)),
  }));
}

/**
 * Robust page cutting: double-page spreads, sanity checks on the detected
 * panels, and a guaranteed fallback (reading-order zones) when detection is
 * unreliable — gutterless art, painted pages, covers, text pages.
 */
export function cutPage(img: CanvasImageSource, width: number, height: number, rtl = false): PageCut {
  const spread = width / height > 1.2;
  let raw: Rect[] = [];
  try {
    if (spread) {
      const half = Math.round(width / 2);
      const l = detectPanels(img, width, height, rtl, { x: 0, y: 0, w: half, h: height });
      const r = detectPanels(img, width, height, rtl, { x: half, y: 0, w: width - half, h: height });
      raw = rtl ? [...r, ...l] : [...l, ...r];
    } else raw = detectPanels(img, width, height, rtl);
  } catch {
    raw = [];
  }
  const page = width * height;
  // clean: clamp, drop specks, drop panels nested in others
  let rects = raw
    .map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(r.w, width - Math.max(0, r.x)), h: Math.min(r.h, height - Math.max(0, r.y)) }))
    .filter((r) => r.w > 8 && r.h > 8 && area(r) / page > 0.012);
  rects = rects.filter((r, i) => !rects.some((o, j) => j !== i && area(o) >= area(r) && inter(r, o) > area(r) * 0.85));
  const coverage = rects.reduce((a, r) => a + area(r), 0) / page;
  const biggest = rects.reduce((m, r) => Math.max(m, area(r) / page), 0);

  if (rects.length === 1 && biggest > 0.72) {
    return { rects: [{ x: 0, y: 0, w: width, h: height }], kind: biggest > 0.9 ? 'splash' : 'zones', note: 'pleine page' };
  }
  // real comic pages have clean gutters: the space between panels is one flat colour
  const purity = rects.length > 1 ? gutterPurity(img, width, height, rects) : 1;
  if (!rects.length || coverage < 0.4 || rects.length > 16 || (rects.length === 1 && biggest > 0.5) || purity < 0.8) {
    return { rects: zonesFor(width, height, rtl), kind: 'zones', note: 'cases non fiables : animation par zones' };
  }
  return { rects, kind: 'panels' };
}

/** share of the area outside the panels that looks like gutter (same colour as the page border) */
function gutterPurity(img: CanvasImageSource, width: number, height: number, rects: Rect[]) {
  const S = Math.min(1, 360 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * S)), h = Math.max(8, Math.round(height * S));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, width, height, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const L = (i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const border: number[] = [];
  for (let i = 0; i < w; i++) border.push(L(i), L((h - 1) * w + i));
  for (let j = 0; j < h; j++) border.push(L(j * w), L(j * w + w - 1));
  border.sort((a, b) => a - b);
  const bg = border[border.length >> 1];
  // the page margin must be one colour (paper or black); otherwise the art bleeds and gutters can't be trusted
  const uniform = border.filter((v) => Math.abs(v - bg) < 25).length / border.length;
  if (uniform < 0.6) return 0;
  const inside = new Uint8Array(w * h);
  for (const r of rects) {
    const x0 = Math.floor(r.x * S), y0 = Math.floor(r.y * S), x1 = Math.ceil((r.x + r.w) * S), y1 = Math.ceil((r.y + r.h) * S);
    for (let yy = Math.max(0, y0); yy < Math.min(h, y1); yy++) inside.fill(1, yy * w + Math.max(0, x0), yy * w + Math.min(w, x1));
  }
  let out = 0, flat = 0;
  for (let i = 0; i < w * h; i++) {
    if (inside[i]) continue;
    out++;
    if (Math.abs(L(i) - bg) < 30) flat++;
  }
  return out < w * h * 0.01 ? 1 : flat / out;
}
