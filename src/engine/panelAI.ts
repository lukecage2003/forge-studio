import type { Rect } from '../types';
import { cutPage, type PageCut } from './detect';
import { heavy, onRelease } from './jobs';

/**
 * Panel + speech-bubble detection with a small neural network (YOLOv13n,
 * Apache-2.0, 10 MB, shipped in public/models, see NOTICE.md), run locally by
 * onnxruntime-web in a Web Worker: WebGPU when the PC has it, WebAssembly otherwise.
 * The classic gutter detectors (detect.ts) stay as the fallback.
 */
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const N = 1024;

export interface Box extends Rect { s: number }
export interface PanelDetection { panels: Box[]; bubbles: Box[]; ms: number; device: string }

const code = `
import * as ort from '${ORT}ort.webgpu.min.mjs';
ort.env.wasm.wasmPaths = '${ORT}';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
let sess = null, device = 'wasm';
async function load(url) {
  if (sess) return sess;
  const buf = await (await fetch(url)).arrayBuffer();
  let gpu = false;
  try { gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch {}
  if (gpu) {
    try { sess = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] }); device = 'webgpu'; return sess; } catch {}
  }
  sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  device = 'wasm';
  return sess;
}
function iou(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h; return i / (a.w * a.h + b.w * b.h - i);
}
function nms(list) { list.sort((a, b) => b.s - a.s); const k = []; for (const x of list) if (!k.some((y) => iou(x, y) > 0.5)) k.push(x); return k; }
self.onmessage = async (ev) => {
  const { id, url, rgba, k, px, py } = ev.data;
  try {
    const s = await load(url);
    const t = new Float32Array(3 * ${N} * ${N}), P = ${N} * ${N};
    for (let i = 0; i < P; i++) { t[i] = rgba[i * 4] / 255; t[P + i] = rgba[i * 4 + 1] / 255; t[2 * P + i] = rgba[i * 4 + 2] / 255; }
    const t0 = performance.now();
    const o = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, ${N}, ${N}]) });
    const ms = performance.now() - t0;
    const d = o[s.outputNames[0]], n = d.dims[2], D = d.data, out = [[], []];
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
      const sc = D[(4 + c) * n + i];
      if (sc < 0.3) continue;
      const cx = D[i], cy = D[n + i], bw = D[2 * n + i], bh = D[3 * n + i];
      out[c].push({ s: sc, x: (cx - bw / 2 - px) / k, y: (cy - bh / 2 - py) / k, w: bw / k, h: bh / k });
    }
    self.postMessage({ id, ok: true, panels: nms(out[0]), bubbles: nms(out[1]), ms, device });
  } catch (e) { self.postMessage({ id, ok: false, message: String(e && e.message || e) }); }
};`;

let worker: Worker | null = null;
let seq = 0;
let broken = false;
let enabled = true;
const cache = new Map<string, PanelDetection>();
const waiting = new Map<number, (v: PanelDetection | null) => void>();

/** the user can turn the AI cut off (Réglages); the classic cut is used then */
export const setPanelAI = (on: boolean) => { enabled = on; };
export const panelAIState = () => ({ enabled, broken });

onRelease('panels', () => { worker?.terminate(); worker = null; });

function modelUrl() {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return new URL(`${base}models/forge-panels-1024.onnx`, location.href).href;
}

/** detect panels and bubbles on a page; null when the model can't run here */
export async function detectWithAI(key: string, img: CanvasImageSource, width: number, height: number): Promise<PanelDetection | null> {
  if (!enabled || broken || typeof Worker === 'undefined') return null;
  const hit = cache.get(key);
  if (hit) return hit;
  const k = N / Math.max(width, height);
  const w = Math.round(width * k), h = Math.round(height * k), px = Math.floor((N - w) / 2), py = Math.floor((N - h) / 2);
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = 'rgb(114,114,114)';
  x.fillRect(0, 0, N, N);
  x.drawImage(img, 0, 0, width, height, px, py, w, h);
  const rgba = x.getImageData(0, 0, N, N).data;
  const res = await heavy('panels', () => new Promise<PanelDetection | null>((resolve) => {
    if (!worker) {
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' });
      worker.onmessage = (ev) => {
        const d = ev.data;
        const done = waiting.get(d.id);
        waiting.delete(d.id);
        if (!d.ok) { broken = true; console.warn('Découpe IA indisponible :', d.message); done?.(null); return; }
        done?.({ panels: d.panels, bubbles: d.bubbles, ms: d.ms, device: d.device });
      };
      worker.onerror = () => { broken = true; for (const f of waiting.values()) f(null); waiting.clear(); };
    }
    const id = ++seq;
    waiting.set(id, resolve);
    worker.postMessage({ id, url: modelUrl(), rgba, k, px, py }, [rgba.buffer]);
  }));
  if (res) cache.set(key, res);
  return res;
}

/* ------------------------------------------------------------ geometry */

const area = (r: Rect) => r.w * r.h;
function inter(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Comic reading order by recursive XY-cut on the boxes themselves: split the
 * set by a horizontal line no box crosses (tiers, top to bottom), else by a
 * vertical line (columns, left to right or right to left for manga). A tall
 * panel next to two stacked ones is read first, then the stack, as a reader does.
 */
export function comicOrder(rects: Rect[], rtl = false, info?: { doubt?: string }): Rect[] {
  if (rects.length < 2) return [...rects];
  const split = (list: Rect[], axis: 'y' | 'x', f: number): Rect[][] | null => {
    const tol = (a: Rect) => Math.min(a.w, a.h) * f;
    const lo = axis === 'y' ? (r: Rect) => r.y + tol(r) : (r: Rect) => r.x + tol(r);
    const hi = axis === 'y' ? (r: Rect) => r.y + r.h - tol(r) : (r: Rect) => r.x + r.w - tol(r);
    const sorted = [...list].sort((a, b) => lo(a) - lo(b));
    const groups: Rect[][] = [];
    let cur: Rect[] = [], end = -Infinity;
    for (const r of sorted) {
      if (cur.length && lo(r) >= end) { groups.push(cur); cur = []; end = -Infinity; }
      cur.push(r);
      end = Math.max(end, hi(r));
    }
    groups.push(cur);
    return groups.length > 1 ? groups : null;
  };
  const walk = (list: Rect[]): Rect[] => {
    if (list.length < 2) return list;
    // detected boxes overlap a little: retry with a looser tolerance before giving up
    for (const f of [0.12, 0.25, 0.4]) {
      if (f > 0.12 && info && !info.doubt) info.doubt = 'des cases débordent les unes sur les autres : l’ordre a été déduit avec une tolérance';
      const rows = split(list, 'y', f);
      if (rows) return rows.flatMap(walk);
      const cols = split(list, 'x', f);
      if (cols) return (rtl ? cols.reverse() : cols).flatMap(walk);
    }
    // overlapping art: fall back to top-left first — and say it is a guess
    if (info) info.doubt = 'cases imbriquées sans rangées ni colonnes nettes : ordre deviné (haut-gauche d’abord)';
    return [...list].sort((a, b) => (a.y - b.y) || (rtl ? b.x - a.x : a.x - b.x));
  };
  return walk(rects);
}

/** turn raw detections into a clean page cut, or null when they can't be trusted */
export function cutFromDetection(det: PanelDetection, width: number, height: number, rtl = false): PageCut | null {
  const page = width * height;
  let list: Rect[] = det.panels
    .filter((b) => b.s >= 0.35)
    .map((b) => {
      const x = Math.max(0, b.x), y = Math.max(0, b.y);
      return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(width, b.x + b.w) - x), h: Math.round(Math.min(height, b.y + b.h) - y) };
    })
    // slivers along the page edge (bleed, gutters) are not panels
    .filter((r) => r.w > 16 && r.h > 16 && area(r) / page > 0.012 && r.w >= width * 0.08 && r.h >= height * 0.05);
  // nested boxes: keep the outer panel
  list = list.filter((r, i) => !list.some((o, j) => j !== i && area(o) >= area(r) && inter(r, o) > area(r) * 0.8));
  if (!list.length) return null;
  const coverage = Math.min(1, list.reduce((a, r) => a + area(r), 0) / page);
  const biggest = list.reduce((m, r) => Math.max(m, area(r) / page), 0);
  const diag = { n: list.length, coverage: +coverage.toFixed(2), biggest: +biggest.toFixed(2), bubbles: det.bubbles.filter((b) => b.s >= 0.35).length, ia: 1 };
  if (list.length === 1 && biggest > 0.6) return { rects: [{ x: 0, y: 0, w: width, h: height }], kind: 'splash', note: 'pleine page (IA)', diag };
  if (coverage < 0.35) return null;
  const info: { doubt?: string } = {};
  const rects = comicOrder(list, rtl, info);
  return { rects, kind: 'panels', note: 'cases détectées par IA', diag, doubt: info.doubt };
}

/**
 * Best available page cut: the AI detector when it runs and its result is
 * sound, the classic gutter detectors otherwise. Never throws.
 */
export async function cutPageSmart(key: string, img: CanvasImageSource, width: number, height: number, rtl = false): Promise<PageCut & { by: 'ia' | 'algo'; bubbles: number }> {
  // a double page squeezed into the network's square input makes its panels tiny:
  // read each half on its own, then left half before right half (manga: the reverse)
  if (width / height > 1.2) {
    try {
      const half = Math.round(width / 2);
      const parts = await Promise.all([0, 1].map(async (k) => {
        const x0 = k ? half : 0, w = k ? width - half : half;
        const c = document.createElement('canvas');
        c.width = w; c.height = height;
        c.getContext('2d')!.drawImage(img, x0, 0, w, height, 0, 0, w, height);
        const det = await detectWithAI(`${key}#${k}`, c, w, height);
        return { det, x0, w };
      }));
      if (parts.every((q) => q.det)) {
        const cuts = parts.map((q) => ({ ...q, cut: cutFromDetection(q.det!, q.w, height, rtl) }));
        if (cuts.every((q) => q.cut)) {
          const shift = (r: Rect, x0: number) => ({ ...r, x: r.x + x0 });
          const ordered = rtl ? [...cuts].reverse() : cuts;
          let rects = ordered.flatMap((q) => q.cut!.rects.map((r) => shift(r, q.x0)));
          // panels drawn ACROSS the two pages come from the whole-page reading; the halves
          // only add what lies outside them (never slice a spread-wide image in two)
          const whole = await detectWithAI(key + '#whole', img, width, height);
          const wc = whole && cutFromDetection(whole, width, height, rtl);
          const across = wc ? wc.rects.filter((r) => r.x < half - width * 0.05 && r.x + r.w > half + width * 0.05) : [];
          if (across.length) {
            const inside = (r: Rect, o: Rect) => { const w = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x), h = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y); return w > 0 && h > 0 ? (w * h) / (r.w * r.h) : 0; };
            rects = comicOrder([...across, ...rects.filter((r) => !across.some((o) => inside(r, o) > 0.5))], rtl);
          }
          const bubbles = parts.reduce((a, q) => a + q.det!.bubbles.filter((b) => b.s >= 0.35).length, 0);
          // keep the page-level detection for the balloon camera
          cache.set(key, { panels: [], bubbles: parts.flatMap((q) => q.det!.bubbles.map((b) => ({ ...b, x: b.x + q.x0 }))), ms: 0, device: parts[0].det!.device });
          return { rects, kind: 'panels', note: 'double page lue moitié par moitié (IA)', diag: { n: rects.length, ia: 1, bubbles }, by: 'ia', bubbles };
        }
      }
    } catch { /* fall back to the whole-page reading below */ }
  }
  try {
    const det = await detectWithAI(key, img, width, height);
    if (det) {
      const c = cutFromDetection(det, width, height, rtl);
      const bubbles = det.bubbles.filter((b) => b.s >= 0.35).length;
      if (c) return { ...c, by: 'ia', bubbles };
      // the network saw no trustworthy panel: the classic cut decides, bubbles still count
      return { ...cutPage(img, width, height, rtl), by: 'algo', bubbles };
    }
  } catch { /* fall through */ }
  return { ...cutPage(img, width, height, rtl), by: 'algo', bubbles: -1 };
}

/** detections already computed for a page (no new work) */
export const cachedDetection = (key: string) => cache.get(key) ?? null;
