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

/* --------------------------------------------- blob / contour detector */

/**
 * Panel detection by connected ink blobs (the approach used by Kumiko and
 * similar comic tools): every panel is a block of art separated from its
 * neighbours by gutter-coloured space. Balloons inside a panel are holes and
 * don't matter; blobs nested in another are merged; blobs bridged by a
 * balloon over the gutter are split again with the XY-cut.
 */
export function detectBlobs(img: CanvasImageSource, width: number, height: number, rtl = false, src: Rect = { x: 0, y: 0, w: width, h: height }): Rect[] {
  const S = Math.min(1, 700 / Math.max(src.w, src.h));
  const w = Math.max(8, Math.round(src.w * S)), h = Math.max(8, Math.round(src.h * S));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // gutter colour: paper white, or black, read from the page border; else the border median
  const border: number[] = [];
  for (let i = 0; i < w; i++) border.push(lum[i], lum[(h - 1) * w + i]);
  for (let j = 0; j < h; j++) border.push(lum[j * w], lum[j * w + w - 1]);
  border.sort((a, b) => a - b);
  const page = w * h;
  const candidates = [245, 12, border[border.length >> 1]];
  let best: { rects: Rect[]; score: number } = { rects: [], score: -1 };
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  for (const bg of candidates) {
    const tol = bg > 200 || bg < 40 ? 30 : 20;
    const gl = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) gl[i] = Math.abs(lum[i] - bg) <= tol ? 1 : 0;
    // gutter = gutter-coloured pixels connected to the page edge or to a long straight gutter line;
    // balloons and white areas enclosed in a panel are never reached
    const gut = new Uint8Array(w * h);
    let sp = 0;
    const seed = (i: number) => { if (gl[i] && !gut[i]) { gut[i] = 1; stack[sp++] = i; } };
    for (let i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { seed(j * w); seed(j * w + w - 1); }
    for (let y = 0; y < h; y++) {
      let run = 0, best = 0;
      for (let xx = 0; xx < w; xx++) { run = gl[y * w + xx] ? run + 1 : 0; best = Math.max(best, run); }
      if (best > w * 0.45) for (let xx = 0; xx < w; xx++) seed(y * w + xx);
    }
    for (let xx = 0; xx < w; xx++) {
      let run = 0, best = 0;
      for (let y = 0; y < h; y++) { run = gl[y * w + xx] ? run + 1 : 0; best = Math.max(best, run); }
      if (best > h * 0.45) for (let y = 0; y < h; y++) seed(y * w + xx);
    }
    while (sp) {
      const k = stack[--sp];
      const yy = (k / w) | 0, xx = k - yy * w;
      if (xx > 0) seed(k - 1);
      if (xx < w - 1) seed(k + 1);
      if (yy > 0) seed(k - w);
      if (yy < h - 1) seed(k + w);
    }
    let gutN = 0;
    for (let i = 0; i < w * h; i++) gutN += gut[i];
    const gutterShare = gutN / page;
    if (gutterShare < 0.01) continue;
    // panels = connected blocks of everything that isn't gutter
    label.fill(0);
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (let i = 0; i < w * h; i++) {
      if (gut[i] || label[i]) continue;
      const id = boxes.length + 1;
      const b = { x0: w, y0: h, x1: 0, y1: 0 };
      let q = 0;
      stack[q++] = i;
      label[i] = id;
      while (q) {
        const k = stack[--q];
        const yy = (k / w) | 0, xx = k - yy * w;
        if (xx < b.x0) b.x0 = xx; if (xx > b.x1) b.x1 = xx;
        if (yy < b.y0) b.y0 = yy; if (yy > b.y1) b.y1 = yy;
        if (xx > 0 && !gut[k - 1] && !label[k - 1]) { label[k - 1] = id; stack[q++] = k - 1; }
        if (xx < w - 1 && !gut[k + 1] && !label[k + 1]) { label[k + 1] = id; stack[q++] = k + 1; }
        if (yy > 0 && !gut[k - w] && !label[k - w]) { label[k - w] = id; stack[q++] = k - w; }
        if (yy < h - 1 && !gut[k + w] && !label[k + w]) { label[k + w] = id; stack[q++] = k + w; }
      }
      boxes.push(b);
    }
    let rects: Rect[] = boxes
      .map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }))
      .filter((r) => r.w * r.h > page * 0.003);
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (inter(a, b) > Math.min(area(a), area(b)) * 0.3) {
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
          rects[i] = { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
          rects.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
    rects = kumikoPolish(rects, w, h);
    const coverage = rects.reduce((a, r) => a + area(r), 0) / page;
    const n = rects.length;
    const score = coverage * (n >= 2 && n <= 14 ? 1 : n === 1 ? 0.35 : 0.2) * (gutterShare > 0.02 && gutterShare < 0.4 ? 1 : 0.5);
    if (score > best.score) best = { rects, score };
  }
  const rects = best.rects;
  // back to page coordinates
  let out = rects.map((r) => ({ x: src.x + Math.round(r.x / S), y: src.y + Math.round(r.y / S), w: Math.round(r.w / S), h: Math.round(r.h / S) }));
  // a blob spanning several panels (balloon bridging a gutter): try to split it with the XY-cut
  out = out.flatMap((r) => {
    if (area(r) < src.w * src.h * 0.3) return [r];
    const parts = detectPanels(img, width, height, rtl, r).filter((q) => area(q) > area(r) * 0.08);
    return parts.length > 1 && parts.length <= 6 ? parts : [r];
  });
  return readingOrder(out, rtl);
}

/** rows by vertical overlap, then left→right (or right→left for manga) */
export function readingOrder(rects: Rect[], rtl = false): Rect[] {
  const rest = [...rects].sort((a, b) => a.y - b.y);
  const rows: Rect[][] = [];
  for (const r of rest) {
    const row = rows.find((rw) => rw.some((q) => Math.min(q.y + q.h, r.y + r.h) - Math.max(q.y, r.y) > Math.min(q.h, r.h) * 0.5));
    if (row) row.push(r); else rows.push([r]);
  }
  rows.sort((a, b) => Math.min(...a.map((r) => r.y)) - Math.min(...b.map((r) => r.y)));
  return rows.flatMap((rw) => rw.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x)));
}

/* ------------------------------------------------------------------ */

export type CutKind = 'panels' | 'splash' | 'zones';
export let FLAT_MIN = 0.75;
export const setFlatMin = (v: number) => { FLAT_MIN = v; };
export interface PageCut { rects: Rect[]; kind: CutKind; note?: string; diag?: Record<string, number>; /** why the reading order may be wrong */ doubt?: string }

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
  height *= 0.97; // keep clear of footer watermarks
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
  let agree = 1;
  let rowsGuess: Rect[] = [];
  try {
    const half = Math.round(width / 2);
    const run = (src: Rect) => {
      const b = detectBlobs(img, width, height, rtl, src);
      const x = detectPanels(img, width, height, rtl, src);
      const a = agreement(b, x);
      // tiers (rows of panels) are the most reliable structure of a page
      const tiersB = tiersOf(b), tiersX = tiersOf(x);
      return { rects: b.length ? b : x, a, tiers: tiersB.length >= tiersX.length ? tiersB : tiersX };
    };
    if (spread) {
      const l = run({ x: 0, y: 0, w: half, h: height }), r = run({ x: half, y: 0, w: width - half, h: height });
      raw = rtl ? [...r.rects, ...l.rects] : [...l.rects, ...r.rects];
      agree = Math.min(l.a, r.a);
      rowsGuess = rtl ? [...r.tiers, ...l.tiers] : [...l.tiers, ...r.tiers];
    } else {
      const r = run({ x: 0, y: 0, w: width, h: height });
      raw = r.rects; agree = r.a; rowsGuess = r.tiers;
    }
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
  const g = rects.length > 1 ? gutterStats(img, width, height, rects) : { flat: 1, share: 0 };
  const diag = { n: rects.length, coverage: +coverage.toFixed(2), flat: +g.flat.toFixed(2), share: +g.share.toFixed(2), biggest: +biggest.toFixed(2) };
  Object.assign(diag, { agree: +agree.toFixed(2) });
  // two independent detectors must agree, otherwise the page is toured tier by tier
  const unreliable = !rects.length || coverage < 0.4 || rects.length > 16 || (rects.length === 1 && biggest > 0.5) || agree < 0.7;
  if (unreliable) {
    // thin strips at the very top/bottom are scan watermarks or credits, not story
    rowsGuess = rowsGuess.filter((r) => !(r.h < height * 0.07 && (r.y < height * 0.08 || r.y + r.h > height * 0.92)));
    const tierCover = rowsGuess.reduce((a, r) => a + area(r), 0) / page;
    const tiers = rowsGuess.length >= 2 && rowsGuess.length <= 5 && tierCover > 0.6 ? rowsGuess : zonesFor(width, height, rtl);
    return { rects: tiers, kind: 'zones', note: 'cases incertaines : animation bande par bande', diag };
  }
  return { rects, kind: 'panels', diag };
}

/**
 * How much the space between the detected panels looks like real gutters:
 * one flat colour (its own median, not the page border, so full-bleed art is fine),
 * and thin (gutters are a small part of the page).
 */
function gutterStats(img: CanvasImageSource, width: number, height: number, rects: Rect[]) {
  const S = Math.min(1, 360 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * S)), h = Math.max(8, Math.round(height * S));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, width, height, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const inside = new Uint8Array(w * h);
  for (const r of rects) {
    const x0 = Math.floor(r.x * S), y0 = Math.floor(r.y * S), x1 = Math.ceil((r.x + r.w) * S), y1 = Math.ceil((r.y + r.h) * S);
    for (let yy = Math.max(0, y0); yy < Math.min(h, y1); yy++) inside.fill(1, yy * w + Math.max(0, x0), yy * w + Math.min(w, x1));
  }
  const lum: number[] = [];
  for (let i = 0; i < w * h; i++) if (!inside[i]) lum.push(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  if (lum.length < w * h * 0.01) return { flat: 1, share: lum.length / (w * h) };
  const sorted = [...lum].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const flat = lum.filter((v) => Math.abs(v - med) < 24).length / lum.length;
  return { flat, share: lum.length / (w * h) };
}

function iou(a: Rect, b: Rect) { const i = inter(a, b); return i / (area(a) + area(b) - i); }

/** share of panels found the same way (IoU > 0.6) by both detectors */
export function agreement(a: Rect[], b: Rect[]) {
  if (!a.length || !b.length) return 0;
  const m = a.filter((r) => b.some((q) => iou(r, q) > 0.6)).length;
  return m / Math.max(a.length, b.length);
}

/** horizontal tiers: union box of each row of panels */
export function tiersOf(rects: Rect[]): Rect[] {
  if (rects.length < 2) return [];
  const rows: Rect[][] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y)) {
    const row = rows.find((rw) => rw.some((q) => Math.min(q.y + q.h, r.y + r.h) - Math.max(q.y, r.y) > Math.min(q.h, r.h) * 0.5));
    if (row) row.push(r); else rows.push([r]);
  }
  return rows
    .map((rw) => {
      const x0 = Math.min(...rw.map((r) => r.x)), y0 = Math.min(...rw.map((r) => r.y));
      return { x: x0, y: y0, w: Math.max(...rw.map((r) => r.x + r.w)) - x0, h: Math.max(...rw.map((r) => r.y + r.h)) - y0 };
    })
    .sort((a, b) => a.y - b.y)
    // overlapping tiers are merged
    .reduce<Rect[]>((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && r.y < last.y + last.h * 0.7) {
        const x0 = Math.min(last.x, r.x);
        acc[acc.length - 1] = { x: x0, y: last.y, w: Math.max(last.x + last.w, r.x + r.w) - x0, h: Math.max(last.y + last.h, r.y + r.h) - last.y };
      } else acc.push(r);
      return acc;
    }, []);
}

/**
 * Post-processing learnt from Kumiko (njean42/kumiko):
 * 1. small fragments that sit close together are one panel (borderless art cut by balloons) → grouped;
 * 2. what's still small is dropped (min panel ≈ 1/10 of the page side);
 * 3. overlaps are removed;
 * 4. each panel is expanded up to its neighbour minus the real gutter, or to the frame of all panels.
 */
function kumikoPolish(rects: Rect[], w: number, h: number): Rect[] {
  const minW = w / 10, minH = h / 10;
  const small = (r: Rect) => r.w < minW || r.h < minH;
  const near = Math.max(w, h) * 0.02;
  const close = (a: Rect, b: Rect) =>
    a.x - near < b.x + b.w && b.x - near < a.x + a.w && a.y - near < b.y + b.h && b.y - near < a.y + a.h;
  const union = (a: Rect, b: Rect): Rect => {
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
  };
  // 1. group close small fragments
  let list = [...rects];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i++) for (let j = i + 1; j < list.length && !changed; j++) {
      if ((small(list[i]) || small(list[j])) && close(list[i], list[j])) {
        const u = union(list[i], list[j]);
        // never swallow a real neighbour panel
        if (!list.some((o, k) => k !== i && k !== j && !small(o) && inter(u, o) > area(o) * 0.5)) {
          list[i] = u; list.splice(j, 1); changed = true;
        }
      }
    }
  }
  // 2. drop what is still too small, and boxes inside others
  list = list.filter((r) => !small(r));
  list = list.filter((r, i) => !list.some((o, j) => j !== i && area(o) >= area(r) && inter(r, o) > area(r) * 0.8));
  // 3. de-overlap: trim along the thinner side of the overlap
  for (const a of list) for (const b of list) {
    if (a === b) continue;
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) continue;
    if (ox < oy && a.x < b.x) { const m = Math.round((a.x + a.w + b.x) / 2); a.w = m - a.x; b.w = b.x + b.w - m; b.x = m; }
    else if (oy <= ox && a.y < b.y) { const m = Math.round((a.y + a.h + b.y) / 2); a.h = m - a.y; b.h = b.y + b.h - m; b.y = m; }
  }
  if (list.length < 2) return list;
  // 4. expand to the neighbour (minus the typical gutter) or to the frame of all panels
  const fx0 = Math.min(...list.map((r) => r.x)), fy0 = Math.min(...list.map((r) => r.y));
  const fx1 = Math.max(...list.map((r) => r.x + r.w)), fy1 = Math.max(...list.map((r) => r.y + r.h));
  const gaps: number[] = [];
  for (const a of list) for (const b of list) {
    if (a === b) continue;
    const vo = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y), ho = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (vo > 0 && b.x >= a.x + a.w) gaps.push(b.x - a.x - a.w);
    if (ho > 0 && b.y >= a.y + a.h) gaps.push(b.y - a.y - a.h);
  }
  const g = gaps.length ? Math.max(1, Math.min(...gaps.filter((x) => x > 0), Math.max(w, h) * 0.03)) : 2;
  for (const r of list) {
    const others = list.filter((o) => o !== r);
    const hov = (o: Rect) => Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y) > 0;
    const vov = (o: Rect) => Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x) > 0;
    const left = others.filter((o) => hov(o) && o.x + o.w <= r.x).reduce((m, o) => Math.max(m, o.x + o.w + g), fx0);
    const right = others.filter((o) => hov(o) && o.x >= r.x + r.w).reduce((m, o) => Math.min(m, o.x - g), fx1);
    const top = others.filter((o) => vov(o) && o.y + o.h <= r.y).reduce((m, o) => Math.max(m, o.y + o.h + g), fy0);
    const bottom = others.filter((o) => vov(o) && o.y >= r.y + r.h).reduce((m, o) => Math.min(m, o.y - g), fy1);
    // only grow, and only a little (never across a real panel)
    const nx = Math.min(r.x, Math.max(left, r.x - w * 0.05)), ny = Math.min(r.y, Math.max(top, r.y - h * 0.05));
    const nr = Math.max(r.x + r.w, Math.min(right, r.x + r.w + w * 0.05)), nb = Math.max(r.y + r.h, Math.min(bottom, r.y + r.h + h * 0.05));
    r.x = nx; r.y = ny; r.w = nr - nx; r.h = nb - ny;
  }
  return list;
}
