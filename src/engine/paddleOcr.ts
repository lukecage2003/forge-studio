import { heavy, onRelease } from './jobs';

/**
 * Local text reading with PaddleOCR (PP-OCRv3 line detection + PP-OCRv5
 * English recognition, Apache-2.0, 10 MB in public/models, see NOTICE.md),
 * run by onnxruntime-web in a Web Worker. Comic lettering (capitals, italics,
 * bold, stylised captions) is read far better than by Tesseract; Tesseract
 * stays as the fallback when the models can't run.
 * Only reads: never changes or generates anything on the page.
 */
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const DET_MAX = 1280; // longest side for line detection (small lettering survives)
const READ_MAX = 2400; // longest side of the image lines are cut from

export interface TextLine { text: string; conf: number; x: number; y: number; w: number; h: number }

const code = `
import * as ort from '${ORT}ort.webgpu.min.mjs';
ort.env.wasm.wasmPaths = '${ORT}';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
let det = null, rec = null, chars = null;
async function session(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  // wasm only: the recogniser's input width changes on every line, which WebGPU recompiles each time
  return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
}
async function load(base) {
  if (!det) det = await session(base + 'ocr-det-v3.onnx');
  if (!rec) rec = await session(base + 'ocr-rec-en-v5.onnx');
  if (!chars) chars = ['', ...(await (await fetch(base + 'ocr-rec-en-v5.txt')).text()).split('\\n').filter((c, i, a) => i < a.length - 1 || c), ' '];
}
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
// bilinear sample of an RGBA buffer into a CHW float tensor
function sample(src, sw, sh, x0, y0, cw, ch, dw, dh, norm) {
  const t = new Float32Array(3 * dw * dh), P = dw * dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, y0 + (y + 0.5) * ch / dh - 0.5)), iy = Math.floor(fy), ay = fy - iy, iy2 = Math.min(sh - 1, iy + 1);
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, x0 + (x + 0.5) * cw / dw - 0.5)), ix = Math.floor(fx), ax = fx - ix, ix2 = Math.min(sw - 1, ix + 1);
      for (let c = 0; c < 3; c++) {
        const a = src[(iy * sw + ix) * 4 + c], b = src[(iy * sw + ix2) * 4 + c], d = src[(iy2 * sw + ix) * 4 + c], e = src[(iy2 * sw + ix2) * 4 + c];
        const v = ((a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay) / 255;
        t[c * P + y * dw + x] = norm(v, c);
      }
    }
  }
  return t;
}
self.onmessage = async (ev) => {
  const { id, base, rgba, W, H } = ev.data;
  try {
    await load(base);
    // 1. text lines: probability map, connected regions, grown back to the full line (DB "unclip")
    const k = Math.min(1, ${DET_MAX} / Math.max(W, H));
    const w = Math.max(32, Math.round(W * k / 32) * 32), h = Math.max(32, Math.round(H * k / 32) * 32);
    const inp = sample(rgba, W, H, 0, 0, W, H, w, h, (v, c) => (v - MEAN[c]) / STD[c]);
    const o = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, h, w]) });
    const p = o[det.outputNames[0]].data;
    const seen = new Uint8Array(w * h), boxes = [], q = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || p[s] <= 0.3) continue;
      let n = 0, head = 0, sum = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
      q[n++] = s; seen[s] = 1;
      while (head < n) {
        const i = q[head++], x = i % w, y = (i - x) / w;
        sum += p[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !seen[i - 1] && p[i - 1] > 0.3) { seen[i - 1] = 1; q[n++] = i - 1; }
        if (x < w - 1 && !seen[i + 1] && p[i + 1] > 0.3) { seen[i + 1] = 1; q[n++] = i + 1; }
        if (y > 0 && !seen[i - w] && p[i - w] > 0.3) { seen[i - w] = 1; q[n++] = i - w; }
        if (y < h - 1 && !seen[i + w] && p[i + w] > 0.3) { seen[i + w] = 1; q[n++] = i + w; }
      }
      if (n < 10 || sum / n < 0.6) continue;
      const bw = x1 + 1 - x0, bh = y1 + 1 - y0, d = (bw * bh * 1.5) / (2 * (bw + bh));
      const sx = W / w, sy = H / h;
      const bx = Math.max(0, (x0 - d) * sx), by = Math.max(0, (y0 - d) * sy);
      boxes.push({ x: bx, y: by, w: Math.min(W, (x1 + 1 + d) * sx) - bx, h: Math.min(H, (y1 + 1 + d) * sy) - by });
    }
    // 2. read each line: height 48, width keeps the proportions, CTC greedy decoding
    const lines = [];
    for (const b of boxes) {
      if (b.w < 4 || b.h < 4) continue;
      const dw = Math.min(1600, Math.max(16, Math.round(48 * b.w / b.h)));
      const t = sample(rgba, W, H, b.x, b.y, b.w, b.h, dw, 48, (v) => (v - 0.5) / 0.5);
      const r = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, 48, dw]) });
      const out = r[rec.outputNames[0]], [, T, C] = out.dims, D = out.data;
      let text = '', last = 0, ps = 0, np = 0;
      for (let i = 0; i < T; i++) {
        let best = 0, bv = -Infinity;
        for (let c = 0; c < C; c++) { const v = D[i * C + c]; if (v > bv) { bv = v; best = c; } }
        if (best !== last && best !== 0) { text += chars[best] ?? ''; ps += bv; np++; }
        last = best;
      }
      if (np) lines.push({ text: text.trim(), conf: ps / np, ...b });
    }
    self.postMessage({ id, ok: true, lines });
  } catch (e) { self.postMessage({ id, ok: false, message: String(e && e.message || e) }); }
};`;

let worker: Worker | null = null;
let seq = 0;
let broken = false;
const cache = new Map<string, TextLine[]>();
const waiting = new Map<number, (v: TextLine[] | null) => void>();

onRelease('ocr', () => { worker?.terminate(); worker = null; });
export const paddleState = () => ({ broken });

function base() {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return new URL(`${b}models/`, location.href).href;
}

/** the text lines already read for this page (no model run): what a quick decision may use */
export const cachedLines = (key: string) => cache.get(key) ?? null;

/** every text line of a page, in page pixels; null when the models can't run here (use Tesseract) */
export async function readLines(key: string, img: CanvasImageSource, width: number, height: number): Promise<TextLine[] | null> {
  if (broken || typeof Worker === 'undefined') return null;
  const hit = cache.get(key);
  if (hit) return hit;
  const k = Math.min(1, READ_MAX / Math.max(width, height));
  const W = Math.round(width * k), H = Math.round(height * k);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, width, height, 0, 0, W, H);
  const rgba = x.getImageData(0, 0, W, H).data;
  const res = await heavy('ocr', () => new Promise<TextLine[] | null>((resolve) => {
    if (!worker) {
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' });
      worker.onmessage = (ev) => {
        const d = ev.data;
        const done = waiting.get(d.id);
        waiting.delete(d.id);
        if (!d.ok) { broken = true; console.warn('Lecture PaddleOCR indisponible :', d.message); done?.(null); return; }
        done?.(d.lines);
      };
      worker.onerror = () => { broken = true; for (const f of waiting.values()) f(null); waiting.clear(); };
    }
    const id = ++seq;
    waiting.set(id, resolve);
    worker.postMessage({ id, base: base(), rgba, W, H }, [rgba.buffer]);
  }));
  if (!res) return null;
  const lines = res.map((l) => ({ ...l, x: l.x / k, y: l.y / k, w: l.w / k, h: l.h / k }));
  cache.set(key, lines);
  return lines;
}
