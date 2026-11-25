import type { Project, Rect, Shot } from '../types';
import { getImage } from './media';
import type { Sentence } from './narration';

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
 * Local reading (free, offline after the first download): one OCR pass per page,
 * each recognised word is given to the panel that contains it.
 */
export async function ocrPages(p: Project, onProgress: (i: number, n: number) => void): Promise<Map<string, string>> {
  onProgress(-1, 0);
  const w = await ocrWorker();
  const out = new Map<string, string>();
  const pages = p.pages.filter((pg) => !pg.skip);
  for (let i = 0; i < pages.length; i++) {
    onProgress(i, pages.length);
    const pg = pages[i], a = getImage(pg.mediaId);
    if (!a) continue;
    const k = Math.min(1, 1500 / Math.max(a.width, a.height));
    const c = document.createElement('canvas');
    c.width = Math.round(a.width * k); c.height = Math.round(a.height * k);
    const x = c.getContext('2d')!;
    x.filter = 'grayscale(1) contrast(1.4)';
    x.drawImage(a.img, 0, 0, c.width, c.height);
    const { data } = await w.recognize(c);
    const shots = p.shots.filter((s) => s.pageId === pg.id);
    const bucket = new Map<string, string[]>();
    for (const wd of data.words) {
      const t = wd.text.replace(/[^\p{L}\p{N}'’-]/gu, '');
      if (wd.confidence < 55 || t.length < 2 || !/\p{L}/u.test(t)) continue;
      const cx = (wd.bbox.x0 + wd.bbox.x1) / 2 / k, cy = (wd.bbox.y0 + wd.bbox.y1) / 2 / k;
      const sh = shots.find((s) => inside(cx, cy, s.rect));
      if (sh) bucket.set(sh.id, [...(bucket.get(sh.id) ?? []), t]);
    }
    for (const [id, ws] of bucket) out.set(id, ws.join(' '));
  }
  onProgress(pages.length, pages.length);
  return out;
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

function tokens(text: string) {
  return text.split(/[\s,.;:!?()«»"“”…—–/-]+/).map((raw) => ({ raw, n: norm(raw) })).filter((t) => t.n.length >= 3 && !STOP.has(t.n));
}

export interface Assignment { sentence: number; shotId: string | null; conf: number; alts: string[] }

/**
 * Local matcher. Scores shared words (names and numbers count most, since
 * they survive translation: French narration over English comics), then a
 * monotonic alignment (Viterbi) follows the reading order: going back costs,
 * and with no evidence the story simply advances page by page.
 */
export function matchLocal(sentences: Sentence[], docs: Doc[]): Assignment[] {
  const N = sentences.length, M = docs.length;
  if (!N || !M) return [];
  const dtoks = docs.map((d) => new Set(tokens(d.text).map((t) => t.n)));
  const df = new Map<string, number>();
  for (const s of dtoks) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + M / (df.get(t) ?? M));
  const names: Uint8Array[] = [];
  const emit: Float32Array[] = sentences.map((se) => {
    const row = new Float32Array(M);
    const nm = new Uint8Array(M);
    const st = tokens(se.text);
    for (let j = 0; j < M; j++) {
      let sc = 0;
      for (const t of st) {
        if (!dtoks[j].has(t.n)) continue;
        const name = /^\p{Lu}/u.test(t.raw) && t.raw.length > 2;
        const num = /^\d+$/.test(t.n);
        if (name || num) nm[j]++;
        sc += idf(t.n) * (name ? 3 : num ? 2 : 1);
      }
      row[j] = sc;
    }
    names.push(nm);
    return row;
  });
  // Viterbi over panels (states), sentences (time)
  const prior = (i: number, j: number) => -1.2 * Math.abs(j / Math.max(1, M - 1) - i / Math.max(1, N - 1));
  // moving forward is free, staying on the same panel costs (the story must advance), going back costs more
  const trans = (a: number, b: number) => (b > a ? -0.08 * (b - a - 1) : b === a ? -1.2 : -2.5 - 0.1 * (a - b));
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
    const conf = ev <= 0 ? 0.2 : Math.min(0.9, 0.22 + 0.2 * Math.min(3, nh) + 0.25 * Math.max(0, margin) + (nh ? 0 : Math.min(0.15, ev * 0.03)));
    return { sentence: i, shotId: docs[chosen].id, conf, alts: ranked.filter((k) => k !== chosen && row[k] > 0).slice(0, 3).map((k) => docs[k].id) };
  });
}
