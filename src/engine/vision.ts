import { heavy, onRelease } from './jobs';
/**
 * Local vision models in a Web Worker (transformers.js):
 *  - depth (Depth Anything V2 small, Apache-2.0, ~27 MB): 2.5D parallax of the panels
 *  - cut-out (BiRefNet lite, MIT, ~115 MB): characters cut out of the comic art for thumbnails
 * Downloaded once, cached by the browser.
 */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';

import { GPU_PICK, noteDevice } from './hardware';

const code = `
import { pipeline, RawImage, env } from '${LIB}';
env.allowLocalModels = false;
${GPU_PICK}
const pipes = {}, devices = {};
async function get(task) {
  if (pipes[task]) return pipes[task];
  let device = 'wasm';
  if (await gpuPick()) device = 'webgpu';
  const prog = (p) => { if (p.status === 'progress') self.postMessage({ type: 'load', task, p: (p.progress || 0) / 100 }); };
  // on the graphics card: fp16 when it has it (q8 is a processor format, slow on a card); refused → processor
  let f16 = false;
  try { const a = device === 'webgpu' && await navigator.gpu.requestAdapter(); f16 = !!a && a.features.has('shader-f16'); } catch {}
  const make = (dev) => task === 'depth'
    ? pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device: dev, dtype: dev === 'webgpu' ? (f16 ? 'fp16' : 'fp32') : 'q8', progress_callback: prog })
    : pipeline('background-removal', 'onnx-community/BiRefNet_lite-ONNX', { device: dev, dtype: dev === 'webgpu' ? (f16 ? 'fp16' : 'fp32') : 'fp32', progress_callback: prog });
  try { pipes[task] = await make(device); } catch (e) { if (device !== 'webgpu') throw e; device = 'wasm'; pipes[task] = await make('wasm'); }
  devices[task] = device;
  return pipes[task];
}
self.onmessage = async (ev) => {
  const { id, task, blob } = ev.data;
  try {
    const p = await get(task);
    const img = await RawImage.fromBlob(blob);
    if (task === 'depth') {
      const out = await p(img);
      const d = out.depth;
      self.postMessage({ id, type: 'done', width: d.width, height: d.height, data: d.data, device: devices[task] }, [d.data.buffer]);
    } else {
      const out = await p(img);
      const r = Array.isArray(out) ? out[0] : out;
      const rgba = r.channels === 4 ? r : r.rgba();
      self.postMessage({ id, type: 'done', width: rgba.width, height: rgba.height, data: rgba.data, device: devices[task] }, [rgba.data.buffer]);
    }
  } catch (e) { self.postMessage({ id, type: 'error', message: String(e && e.message || e) }); }
};`;

let worker: Worker | null = null;
let seq = 0;
type Out = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

onRelease('vision', () => { worker?.terminate(); worker = null; });

function run(task: 'depth' | 'cutout', blob: Blob, onLoad?: (p: number) => void): Promise<Out> {
  return heavy('vision', () => runNow(task, blob, onLoad));
}

function runNow(task: 'depth' | 'cutout', blob: Blob, onLoad?: (p: number) => void): Promise<Out> {
  worker ??= new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' });
  const id = ++seq;
  return new Promise((res, rej) => {
    const w = worker!;
    const h = (ev: MessageEvent) => {
      const d = ev.data;
      if (d.type === 'load' && d.task === task) onLoad?.(d.p);
      if (d.id !== id) return;
      w.removeEventListener('message', h);
      if (d.type === 'error') rej(new Error(d.message)); else { if (d.device) noteDevice(task === 'depth' ? 'Relief 2.5D (profondeur)' : 'Détourage', d.device); res(d); }
    };
    w.addEventListener('message', h);
    w.postMessage({ id, task, blob });
  });
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));

/** depth of a region of an image (bigger = closer), as a grayscale canvas the size of the crop */
export async function depthOf(img: CanvasImageSource, r: { x: number; y: number; w: number; h: number }, onLoad?: (p: number) => void) {
  const c = document.createElement('canvas');
  const k = Math.min(1, 518 / Math.max(r.w, r.h));
  c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
  c.getContext('2d')!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const o = await run('depth', await toBlob(c), onLoad);
  const g = document.createElement('canvas');
  g.width = o.width; g.height = o.height;
  const x = g.getContext('2d')!;
  const im = x.createImageData(o.width, o.height);
  for (let i = 0; i < o.width * o.height; i++) { const v = o.data[i]; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
  return g;
}

/** subject cut out of a region (transparent background), full resolution of the crop up to 1024 px */
export async function cutoutOf(img: CanvasImageSource, r: { x: number; y: number; w: number; h: number }, onLoad?: (p: number) => void) {
  const c = document.createElement('canvas');
  const k = Math.min(1, 1024 / Math.max(r.w, r.h));
  c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
  c.getContext('2d')!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const o = await run('cutout', await toBlob(c), onLoad);
  const out = document.createElement('canvas');
  out.width = o.width; out.height = o.height;
  const x = out.getContext('2d')!;
  x.putImageData(new ImageData(new Uint8ClampedArray(o.data), o.width, o.height), 0, 0);
  return out;
}

export async function hasWebGPU() {
  try { return !!(navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu && !!(await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter()); }
  catch { return false; }
}

/**
 * Character cut-out with the depth model (fallback without WebGPU): the
 * closest region is the character; kept as the largest solid blob, feathered.
 */
export async function depthCutout(img: CanvasImageSource, r: { x: number; y: number; w: number; h: number }, onLoad?: (p: number) => void) {
  const depth = await depthOf(img, r, onLoad);
  const k = Math.min(1, 1024 / Math.max(r.w, r.h));
  const W = Math.round(r.w * k), H = Math.round(r.h * k);
  const m = document.createElement('canvas');
  m.width = W; m.height = H;
  const mx = m.getContext('2d', { willReadFrequently: true })!;
  mx.drawImage(depth, 0, 0, W, H);
  const id = mx.getImageData(0, 0, W, H);
  const vals: number[] = [];
  for (let i = 0; i < W * H; i += 9) vals.push(id.data[i * 4]);
  vals.sort((a, b) => a - b);
  const thr = vals[Math.floor(vals.length * 0.6)];
  // keep only the main subject: the biggest close blob (weighted by closeness), not scattered bits of scenery
  const on = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) on[i] = id.data[i * 4] > thr ? 1 : 0;
  const lab = new Int32Array(W * H), stack = new Int32Array(W * H);
  let best = 0, bestScore = 0, n = 0;
  for (let i = 0; i < W * H; i++) {
    if (!on[i] || lab[i]) continue;
    n++;
    let sp = 0, score = 0;
    stack[sp++] = i; lab[i] = n;
    while (sp) {
      const k2 = stack[--sp], y = (k2 / W) | 0, x = k2 - y * W;
      score += id.data[k2 * 4];
      if (x > 0 && on[k2 - 1] && !lab[k2 - 1]) { lab[k2 - 1] = n; stack[sp++] = k2 - 1; }
      if (x < W - 1 && on[k2 + 1] && !lab[k2 + 1]) { lab[k2 + 1] = n; stack[sp++] = k2 + 1; }
      if (y > 0 && on[k2 - W] && !lab[k2 - W]) { lab[k2 - W] = n; stack[sp++] = k2 - W; }
      if (y < H - 1 && on[k2 + W] && !lab[k2 + W]) { lab[k2 + W] = n; stack[sp++] = k2 + W; }
    }
    if (score > bestScore) { bestScore = score; best = n; }
  }
  // the blob, with its inner holes filled (balloons, highlights inside the character)
  for (let y = 0; y < H; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < W; x++) if (lab[y * W + x] === best) { if (first < 0) first = x; last = x; }
    for (let x = 0; x < W; x++) id.data[(y * W + x) * 4 + 3] = first >= 0 && x >= first && x <= last && (lab[y * W + x] === best || (x > first && x < last && rowInside(lab, W, H, x, y, best))) ? 255 : 0;
  }
  mx.putImageData(id, 0, 0);
  const soft = document.createElement('canvas');
  soft.width = W; soft.height = H;
  const sx = soft.getContext('2d')!;
  sx.filter = `blur(${Math.max(1, W / 400)}px)`;
  sx.drawImage(m, 0, 0);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ox = out.getContext('2d')!;
  ox.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, W, H);
  ox.globalCompositeOperation = 'destination-in';
  ox.drawImage(soft, 0, 0);
  return out;
}

/** a pixel is inside the blob vertically too (avoids filling the gap between two arms) */
function rowInside(lab: Int32Array, W: number, H: number, x: number, y: number, id: number) {
  let up = false, down = false;
  for (let yy = y - 1; yy >= 0 && !up; yy--) if (lab[yy * W + x] === id) up = true;
  for (let yy = y + 1; yy < H && !down; yy++) if (lab[yy * W + x] === id) down = true;
  return up && down;
}
