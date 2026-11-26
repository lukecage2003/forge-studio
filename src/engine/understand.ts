import type { Project, Rect, Shot } from '../types';
import { getImage } from './media';
import { cachedDetection } from './panelAI';
import { stem, translations } from './bridge-fr-en';
import type { Sentence } from './narration';
import { readLines, type TextLine } from './paddleOcr';

/* =========================================================================
   1. Reading the comics
   ========================================================================= */

const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
type TWorker = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>; terminate: () => Promise<void> };
let worker: TWorker | null = null;

async function ocrWorker(): Promise<TWorker> {
  if (worker) return worker;
  const M = await import(/* @vite-ignore */ TESS);
  const T = M.createWorker ? M : M.default; // the ESM build exports the API as default
  worker = (await T.createWorker(['eng', 'fra'], 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
  })) as TWorker;
  return worker;
}

const inside = (x: number, y: number, r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * Speech balloons and caption boxes: pale, solid blobs with dark marks inside.
 * Reading them one by one (cropped, enlarged) is far more accurate than
 * reading the whole page, and skips the art.
 */
export function findBalloons(img: CanvasImageSource, width: number, height: number): Rect[] {
  const S = Math.min(1, 900 / Math.max(width, height));
  const w = Math.round(width * S), h = Math.round(height * S);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const pale = new Uint8Array(w * h), dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // white balloons, and pale yellow/cream caption boxes
    pale[i] = L > 205 && (mx - mn < 40 || (r > 200 && g > 180 && b < 190)) ? 1 : 0;
    dark[i] = L < 90 ? 1 : 0;
  }
  const label = new Int32Array(w * h), stack = new Int32Array(w * h);
  const out: Rect[] = [];
  const page = w * h;
  for (let i = 0; i < w * h; i++) {
    if (!pale[i] || label[i]) continue;
    let sp = 0, n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = i; label[i] = 1;
    while (sp) {
      const k = stack[--sp], yy = (k / w) | 0, xx = k - yy * w;
      n++;
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
      for (const q of [k - 1, k + 1, k - w, k + w]) {
        if (q < 0 || q >= w * h || label[q] || !pale[q]) continue;
        if ((q === k - 1 && xx === 0) || (q === k + 1 && xx === w - 1)) continue;
        label[q] = 1; stack[sp++] = q;
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, area = bw * bh;
    if (area < page * 0.0012 || area > page * 0.15 || bw < 14 || bh < 8) continue;
    // touching two page edges = paper margin/gutter, not a balloon
    if ((x0 === 0 || x1 === w - 1) && (y0 === 0 || y1 === h - 1)) continue;
    if (n / area < 0.45) continue;
    // must contain lettering: some dark marks inside the box
    let ink = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) ink += dark[yy * w + xx];
    const inkR = ink / area;
    if (inkR < 0.02 || inkR > 0.4) continue;
    out.push({ x: x0 / S, y: y0 / S, w: bw / S, h: bh / S });
  }
  // reading order inside the page: top to bottom, then left to right
  return out.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
}

/** clean the usual OCR slips on comic lettering */
function cleanOcr(t: string) {
  return t.replace(/[|¦]/g, 'I').replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, '$1$2').trim();
}

/**
 * Local reading (free, offline after the first download): balloons and
 * captions are found, enlarged and read one by one; a page without balloons
 * is read whole. Each text goes to the panel that contains it.
 */
export async function ocrPages(p: Project, onProgress: (i: number, n: number) => void): Promise<Map<string, string>> {
  onProgress(-1, 0);
  const fast = await ocrPagesPaddle(p, onProgress);
  if (fast) return fast;
  const w = await ocrWorker();
  const out = new Map<string, string>();
  const pages = p.pages.filter((pg) => !pg.skip);
  const crop = document.createElement('canvas');
  const cx = crop.getContext('2d')!;
  for (let i = 0; i < pages.length; i++) {
    onProgress(i, pages.length);
    const pg = pages[i], a = getImage(pg.mediaId);
    if (!a) continue;
    const shots = p.shots.filter((s) => s.pageId === pg.id);
    const bucket = new Map<string, string[]>();
    const give = (cxp: number, cyp: number, text: string) => {
      const sh = shots.find((s) => inside(cxp, cyp, s.rect)) ?? shots[0];
      if (sh && text) bucket.set(sh.id, [...(bucket.get(sh.id) ?? []), text]);
    };
    // speech balloons from the AI detector + caption boxes from the heuristic (the network misses captions)
    const ai = cachedDetection(pg.mediaId)?.bubbles.filter((b) => b.s >= 0.35).map(({ x, y, w, h }) => ({ x, y, w, h })) ?? [];
    const heur = findBalloons(a.img, a.width, a.height);
    const ov = (r: Rect, q: Rect) => { const w = Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x), h = Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y); return w > 0 && h > 0 ? (w * h) / Math.min(r.w * r.h, q.w * q.h) : 0; };
    const balloons = [...ai, ...heur.filter((q) => !ai.some((r) => ov(r, q) > 0.5))];
    if (balloons.length) {
      for (const b of balloons) {
        const pad = 6;
        const sx = Math.max(0, b.x - pad), sy = Math.max(0, b.y - pad), sw = Math.min(a.width - sx, b.w + pad * 2), sh = Math.min(a.height - sy, b.h + pad * 2);
        const k = Math.min(3, Math.max(1, 90 / Math.max(10, sh / 4))); // enlarge small lettering
        crop.width = Math.round(sw * k); crop.height = Math.round(sh * k);
        cx.filter = 'grayscale(1) contrast(1.6)';
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(a.img, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
        cx.filter = 'none';
        const { data } = await w.recognize(crop);
        const words = data.words.filter((wd) => wd.confidence >= 50).map((wd) => wd.text.replace(/[^\p{L}\p{N}'’!?.,-]/gu, '')).filter((t) => /\p{L}/u.test(t));
        give(b.x + b.w / 2, b.y + b.h / 2, cleanOcr(words.join(' ')));
      }
    } else {
      const k = Math.min(1, 1500 / Math.max(a.width, a.height));
      crop.width = Math.round(a.width * k); crop.height = Math.round(a.height * k);
      cx.filter = 'grayscale(1) contrast(1.4)';
      cx.drawImage(a.img, 0, 0, crop.width, crop.height);
      cx.filter = 'none';
      const { data } = await w.recognize(crop);
      for (const wd of data.words) {
        const t = wd.text.replace(/[^\p{L}\p{N}'’-]/gu, '');
        if (wd.confidence < 55 || t.length < 2 || !/\p{L}/u.test(t)) continue;
        give((wd.bbox.x0 + wd.bbox.x1) / 2 / k, (wd.bbox.y0 + wd.bbox.y1) / 2 / k, t);
      }
    }
    for (const [id, ws] of bucket) out.set(id, cleanOcr(ws.join(' ')));
  }
  onProgress(pages.length, pages.length);
  return out;
}

/**
 * PaddleOCR path: every text line of the page is found and read, then lines
 * are grouped by speech balloon (AI detector) and given to the panel that
 * holds them, balloon by balloon in reading order (top to bottom, left to
 * right), lines top to bottom. Null when the models can't run (Tesseract then).
 */
async function ocrPagesPaddle(p: Project, onProgress: (i: number, n: number) => void): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  const pages = p.pages.filter((pg) => !pg.skip);
  for (let i = 0; i < pages.length; i++) {
    onProgress(i, pages.length);
    const pg = pages[i], a = getImage(pg.mediaId);
    if (!a) continue;
    const lines = await readLines(pg.mediaId, a.img, a.width, a.height);
    if (!lines) return i === 0 ? null : out;
    const shots = p.shots.filter((s) => s.pageId === pg.id);
    for (const [id, text] of groupLines(lines, shots, cachedDetection(pg.mediaId)?.bubbles.filter((b) => b.s >= 0.35) ?? [])) out.set(id, text);
  }
  onProgress(pages.length, pages.length);
  return out;
}

/** lines → text per panel (pure, tested) */
export function groupLines(lines: TextLine[], shots: { id: string; rect: Rect }[], bubbles: Rect[]): Map<string, string> {
  const ok = lines.filter((l) => l.conf >= 0.6 && /\p{L}{2}/u.test(l.text));
  // a line belongs to the balloon that holds its centre; lines outside balloons (captions, sounds) group by proximity
  const groups: { r: Rect; lines: TextLine[] }[] = [];
  for (const l of ok) {
    const c = { x: l.x + l.w / 2, y: l.y + l.h / 2 };
    const b = bubbles.find((r) => inside(c.x, c.y, r));
    let g = b ? groups.find((q) => q.r === b) : groups.find((q) => !bubbles.includes(q.r as never) && Math.abs(q.r.x + q.r.w / 2 - c.x) < Math.max(q.r.w, l.w) * 0.6 && l.y - (q.r.y + q.r.h) < l.h * 1.2 && l.y >= q.r.y - l.h * 0.5);
    if (!g) { g = { r: b ?? { x: l.x, y: l.y, w: l.w, h: l.h }, lines: [] }; groups.push(g); }
    g.lines.push(l);
    if (!b) { const r = g.r, x0 = Math.min(r.x, l.x), y0 = Math.min(r.y, l.y); g.r = { x: x0, y: y0, w: Math.max(r.x + r.w, l.x + l.w) - x0, h: Math.max(r.y + r.h, l.y + l.h) - y0 }; }
  }
  const bucket = new Map<string, { r: Rect; t: string }[]>();
  for (const g of groups) {
    const cx = g.r.x + g.r.w / 2, cy = g.r.y + g.r.h / 2;
    const sh = shots.find((s) => inside(cx, cy, s.rect)) ?? shots.find((s) => g.lines.some((l) => inside(l.x + l.w / 2, l.y + l.h / 2, s.rect))) ?? shots[0];
    if (!sh) continue;
    const ls = [...g.lines].sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
    bucket.set(sh.id, [...(bucket.get(sh.id) ?? []), { r: g.r, t: ls.map((l) => l.text).join(' ') }]);
  }
  const res = new Map<string, string>();
  for (const [id, gs] of bucket) {
    gs.sort((a, b) => (a.r.y + a.r.h <= b.r.y + b.r.h * 0.3 ? -1 : b.r.y + b.r.h <= a.r.y + a.r.h * 0.3 ? 1 : a.r.x - b.r.x));
    res.set(id, cleanOcr(gs.map((g) => g.t).join(' ')));
  }
  return res;
}

/* =========================================================================
   2. Matching narration ↔ panels
   ========================================================================= */

const STOP = new Set(('le la les un une des de du d l au aux et ou mais donc or ni car que qui quoi dont où ce cet cette ces son sa ses leur leurs mon ma mes ton ta tes il elle ils elles on nous vous je tu se en y ne pas plus très tout tous toute toutes est sont été être avoir a ont avait fait faire dans sur sous avec pour par sans entre vers chez comme aussi alors puis encore déjà ici là c\'est cest qu the a an and or but of to in on at for with by from is are was were be been it its this that these those he she they we you i his her their our your as not no so do does did have has had will would can could just then than there here what who whom which when where why how all any some more most').split(' '));

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export interface Doc { id: string; order: number; text: string; chars: string[] }

/** one searchable document per panel: what it says, what it shows, who is in it, the page context */
export function panelDocs(p: Project, panels: Shot[]): Doc[] {
  return panels.map((s, order) => {
    const pg = p.pages.find((x) => x.id === s.pageId);
    return { id: s.id, order, text: [s.text, s.desc, (s.chars ?? []).join(' '), pg?.summary].filter(Boolean).join(' '), chars: s.chars ?? [] };
  });
}

/**
 * Canonical form compared on both sides: comic lettering read by OCR mixes up
 * D and P (« PANVERS », « IPEA »), and a
 * plural must find its singular (« problems » ↔ PROBLEM): D → P, final S dropped.
 */
export const ocrCanon = (n: string) => {
  const c = n.replace(/d/g, 'p');
  return c.length >= 4 && /[^s]s$/.test(c) ? c.slice(0, -1) : c;
};

function tokens(text: string) {
  return text.split(/[\s,.;:!?()«»"“”…—–/-]+/).map((raw) => ({ raw, o: norm(raw) })).filter((t) => t.o.length >= 3 && !STOP.has(t.o))
    .map((t) => ({ ...t, n: ocrCanon(t.o) }));
}

export interface Assignment { sentence: number; shotId: string | null; conf: number; alts: string[] }

/**
 * Local matcher. Scores shared words (names and numbers count most, since
 * they survive translation: French narration over English comics), then a
 * monotonic alignment (Viterbi) follows the reading order: going back costs,
 * and with no evidence the story simply advances page by page.
 */
export function matchLocal(sentences: Sentence[], docs: Doc[], sim?: Float32Array[]): Assignment[] {
  const N = sentences.length, M = docs.length;
  if (!N || !M) return [];
  const dtoks = docs.map((d) => new Set(tokens(d.text).map((t) => t.n)));
  const df = new Map<string, number>();
  for (const s of dtoks) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + M / (df.get(t) ?? M));
  // French narration, English balloons: shared stems (cognates) and a fixed glossary bridge the languages
  const dstems = dtoks.map((s) => new Set([...s].map(stem).filter((x): x is string => !!x)));
  const sdf = new Map<string, number>();
  for (const s of dstems) for (const t of s) sdf.set(t, (sdf.get(t) ?? 0) + 1);
  const sidf = (t: string) => Math.log(1 + M / (sdf.get(t) ?? M));
  const names: Uint8Array[] = [];
  const emit: Float32Array[] = sentences.map((se) => {
    const row = new Float32Array(M);
    const nm = new Uint8Array(M);
    const st = tokens(se.text);
    for (let j = 0; j < M; j++) {
      let sc = 0;
      for (const t of st) {
        if (!dtoks[j].has(t.n)) {
          // translated word, else cognate stem: weaker evidence than the same word
          const tr = translations(t.o).map(ocrCanon).filter((x) => dtoks[j].has(x));
          if (tr.length) { sc += Math.max(...tr.map(idf)) * 0.8; continue; }
          const sm = stem(t.n);
          if (sm && dstems[j].has(sm)) sc += sidf(sm) * 0.7;
          continue;
        }
        const name = /^\p{Lu}/u.test(t.raw) && t.raw.length > 2;
        const num = /^\d+$/.test(t.n);
        if (name || num) nm[j]++;
        sc += idf(t.n) * (name ? 3 : num ? 2 : 1);
      }
      // meaning (local multilingual model): counts even when no word is shared (FR narration, EN comics)
      if (sim) sc += 9 * Math.max(0, sim[sentences.indexOf(se)][j] - 0.3);
      row[j] = sc;
    }
    names.push(nm);
    return row;
  });
  // Viterbi over panels (states), sentences (time)
  const prior = (i: number, j: number) => -1.2 * Math.abs(j / Math.max(1, M - 1) - i / Math.max(1, N - 1));
  // moving forward is free, staying on the same panel costs (the story must advance), going back costs more
  // a narration summarises: jumping ahead by about M/N panels per sentence is expected and free,
  // longer jumps cost a little (log), staying costs, going back costs more
  const step = Math.max(1, M / N);
  const trans = (a: number, b: number) => (b > a ? -0.35 * Math.log1p(Math.max(0, b - a - 1 - step) / step) : b === a ? -1.2 : -2.5 - 0.1 * (a - b));
  let score = Float32Array.from({ length: M }, (_, j) => emit[0][j] + prior(0, j));
  const back: Int32Array[] = [];
  for (let i = 1; i < N; i++) {
    const nx = new Float32Array(M), bk = new Int32Array(M);
    // running max for forward jumps keeps this fast enough for a few hundred panels
    for (let j = 0; j < M; j++) {
      let best = -Infinity, arg = 0;
      for (let a = 0; a < M; a++) {
        const v = score[a] + trans(a, j);
        if (v > best) { best = v; arg = a; }
      }
      nx[j] = best + emit[i][j] + prior(i, j);
      bk[j] = arg;
    }
    back.push(bk);
    score = nx;
  }
  let j = 0;
  for (let k = 1; k < M; k++) if (score[k] > score[j]) j = k;
  const path = new Array<number>(N);
  path[N - 1] = j;
  for (let i = N - 1; i > 0; i--) { j = back[i - 1][j]; path[i - 1] = j; }
  return sentences.map((_, i) => {
    const row = emit[i];
    const ranked = [...row.keys()].sort((a, b) => row[b] - row[a]);
    const chosen = path[i];
    const best = row[ranked[0]], second = row[ranked[1]] ?? 0;
    // confidence from solid evidence only: names/numbers found on the chosen panel, and a clear margin
    const ev = row[chosen], nh = names[i][chosen];
    const margin = best > 0 ? (row[chosen] - second) / best : 0;
    const sm = sim ? sim[i][chosen] : 0;
    const semBoost = sm > 0.55 ? 0.3 : sm > 0.45 ? 0.18 : sm > 0.38 ? 0.08 : 0;
    const conf = ev <= 0 ? 0.2 : Math.min(0.92, 0.22 + 0.18 * Math.min(3, nh) + 0.22 * Math.max(0, margin) + semBoost + (nh || semBoost ? 0 : Math.min(0.12, ev * 0.03)));
    return { sentence: i, shotId: docs[chosen].id, conf, alts: ranked.filter((k) => k !== chosen && row[k] > 0).slice(0, 3).map((k) => docs[k].id) };
  });
}

/** whole-page reading (credits, ads, prose pages): local Tesseract, about 2–4 s a page */
export async function pageText(img: CanvasImageSource, width: number, height: number): Promise<{ text: string; words: { t: string; x: number; y: number; w: number; h: number }[] }> {
  const w = await ocrWorker();
  const k = Math.min(2, 2000 / Math.max(width, height));
  const c = document.createElement('canvas');
  c.width = Math.round(width * k); c.height = Math.round(height * k);
  const x = c.getContext('2d')!;
  x.filter = 'grayscale(1) contrast(1.5)';
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  x.filter = 'none';
  const { data } = await w.recognize(c);
  const words = data.words.filter((wd) => wd.confidence >= 55)
    .map((wd) => ({ t: wd.text, x: wd.bbox.x0 / k, y: wd.bbox.y0 / k, w: (wd.bbox.x1 - wd.bbox.x0) / k, h: (wd.bbox.y1 - wd.bbox.y0) / k }));
  return { text: words.map((w) => w.t).join(' '), words };
}
