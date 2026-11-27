import { heavy, onRelease } from './jobs';

/**
 * Picture ↔ words model (OpenAI CLIP ViT-B/32, MIT licence, Xenova ONNX
 * conversion, ~89 MB for pictures + ~64 MB for text, downloaded once on the
 * first visual search and cached by the browser), run by Transformers.js in a
 * Web Worker. A description ("a man in red armour flying") and a comic page
 * that shows it end up close. Only ranks the user's own pictures; never makes one.
 * CLIP reads English: French queries are bridged word by word (bridge-fr-en).
 */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
const MODEL = 'Xenova/clip-vit-base-patch32';

const code = `
import { AutoProcessor, CLIPVisionModelWithProjection, AutoTokenizer, CLIPTextModelWithProjection, RawImage, env } from '${LIB}';
env.allowLocalModels = false;
let proc = null, vision = null, tok = null, text = null;
const norm = (d, dim) => { const out = []; for (let k = 0; k < d.length / dim; k++) { const v = d.slice(k * dim, (k + 1) * dim); let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; out.push(Array.from(v, (x) => x / n)); } return out; };
const prog = (id, what) => (p) => { if (p.status === 'progress') self.postMessage({ id, type: 'load', what, p: (p.progress || 0) / 100 }); };
self.onmessage = async (ev) => {
  const { id, kind, items } = ev.data;
  try {
    if (kind === 'image') {
      proc ??= await AutoProcessor.from_pretrained('${MODEL}');
      vision ??= await CLIPVisionModelWithProjection.from_pretrained('${MODEL}', { dtype: 'q8', progress_callback: prog(id, 'image') });
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const img = await RawImage.fromBlob(items[i]);
        const { image_embeds } = await vision(await proc(img));
        out.push(...norm(image_embeds.data, image_embeds.dims.at(-1)));
        self.postMessage({ id, type: 'step', p: (i + 1) / items.length });
      }
      self.postMessage({ id, type: 'done', out });
    } else {
      tok ??= await AutoTokenizer.from_pretrained('${MODEL}');
      text ??= await CLIPTextModelWithProjection.from_pretrained('${MODEL}', { dtype: 'q8', progress_callback: prog(id, 'texte') });
      const { text_embeds } = await text(tok(items, { padding: true, truncation: true }));
      self.postMessage({ id, type: 'done', out: norm(text_embeds.data, text_embeds.dims.at(-1)) });
    }
  } catch (e) { self.postMessage({ id, type: 'error', message: String(e && e.message || e) }); }
};`;

let worker: Worker | null = null;
let seq = 0;
onRelease('clip', () => { worker?.terminate(); worker = null; });

function call(kind: 'image' | 'text', items: (Blob | string)[], onProgress?: (label: string, p: number) => void): Promise<number[][]> {
  return heavy('clip', () => new Promise<number[][]>((res, rej) => {
    worker ??= new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' });
    const id = ++seq, w = worker;
    const h = (ev: MessageEvent) => {
      const d = ev.data;
      if (d.id !== id) return;
      if (d.type === 'load') onProgress?.(`Chargement du modèle image ↔ texte (${d.what})…`, d.p);
      if (d.type === 'step') onProgress?.('Analyse des images…', d.p);
      if (d.type === 'error') { w.removeEventListener('message', h); rej(new Error('Modèle image ↔ texte : ' + d.message)); }
      if (d.type === 'done') { w.removeEventListener('message', h); res(d.out); }
    };
    w.addEventListener('message', h);
    w.postMessage({ id, kind, items });
  }));
}

/** one normalised vector per picture (resized before sending: CLIP looks at 224 px) */
export async function embedImages(blobs: Blob[], onProgress?: (label: string, p: number) => void) {
  const small = await Promise.all(blobs.map(async (b) => {
    try {
      const bmp = await createImageBitmap(b, { resizeWidth: 336, resizeQuality: 'medium' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      return await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    } catch { return b; }
  }));
  return call('image', small, onProgress);
}
export const embedTexts = (texts: string[], onProgress?: (label: string, p: number) => void) => call('text', texts, onProgress);

/** vectors stored as text (base64 of float32) */
export const packVec = (v: number[]) => { const f = Float32Array.from(v); let s = ''; const u = new Uint8Array(f.buffer); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
export const unpackVec = (s: string) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]; return s; };
