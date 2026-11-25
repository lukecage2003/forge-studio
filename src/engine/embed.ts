/**
 * Local meaning model: multilingual sentence embeddings (paraphrase MiniLM,
 * 50+ languages) running in a Web Worker. A French sentence and an English
 * balloon that say the same thing end up close, without any cloud service.
 * Downloaded once (~118 MB) and cached by the browser.
 */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

const code = `
import { pipeline, env } from '${LIB}';
env.allowLocalModels = false;
let fe = null;
self.onmessage = async (ev) => {
  const { id, texts } = ev.data;
  try {
    if (!fe) fe = await pipeline('feature-extraction', '${MODEL}', { dtype: 'q8',
      progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ id, type: 'load', p: (p.progress || 0) / 100 }); } });
    const out = [];
    for (let i = 0; i < texts.length; i += 16) {
      const t = await fe(texts.slice(i, i + 16), { pooling: 'mean', normalize: true });
      const dim = t.dims[t.dims.length - 1];
      for (let k = 0; k < t.dims[0]; k++) out.push(Array.from(t.data.slice(k * dim, (k + 1) * dim)));
      self.postMessage({ id, type: 'step', p: Math.min(1, (i + 16) / texts.length) });
    }
    self.postMessage({ id, type: 'done', out });
  } catch (e) { self.postMessage({ id, type: 'error', message: String(e && e.message || e) }); }
};`;

let worker: Worker | null = null;
let seq = 0;
const cache = new Map<string, Float32Array>();

export async function embed(texts: string[], onProgress?: (label: string, p: number) => void): Promise<Float32Array[]> {
  const todo = [...new Set(texts.filter((t) => t && !cache.has(t)))];
  if (todo.length) {
    worker ??= new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' });
    const id = ++seq;
    const vecs: number[][] = await new Promise((res, rej) => {
      const w = worker!;
      const h = (ev: MessageEvent) => {
        const d = ev.data;
        if (d.id !== id) return;
        if (d.type === 'load') onProgress?.('Chargement du modèle de compréhension…', d.p);
        if (d.type === 'step') onProgress?.('Compréhension du texte…', d.p);
        if (d.type === 'error') { w.removeEventListener('message', h); rej(new Error('Modèle de compréhension : ' + d.message)); }
        if (d.type === 'done') { w.removeEventListener('message', h); res(d.out); }
      };
      w.addEventListener('message', h);
      w.postMessage({ id, texts: todo });
    });
    todo.forEach((t, i) => cache.set(t, Float32Array.from(vecs[i])));
  }
  return texts.map((t) => cache.get(t) ?? new Float32Array(0));
}

export function cosine(a: Float32Array, b: Float32Array) {
  if (!a.length || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // vectors are normalised
}
