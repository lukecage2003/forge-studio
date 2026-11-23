import type { Rect } from '../types';

/**
 * Automatic panel detection by recursive XY-cut on gutters.
 * Works on classic western/manga layouts with uniform (white or black) gutters.
 */
export function detectPanels(img: CanvasImageSource, width: number, height: number, rtl = false): Rect[] {
  const S = Math.min(1, 900 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * S)), h = Math.max(8, Math.round(height * S));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
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
  const res = out.map((r) => ({
    x: Math.round(r.x / S), y: Math.round(r.y / S), w: Math.round(r.w / S), h: Math.round(r.h / S),
  }));
  // nothing sensible → whole page
  if (!res.length) return [{ x: 0, y: 0, w: width, h: height }];
  return res;
}
