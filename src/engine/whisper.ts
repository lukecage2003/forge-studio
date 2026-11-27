import { heavy, onRelease } from './jobs';
import type { Word } from '../types';

/**
 * Local transcription with Whisper (transformers.js) in a Web Worker.
 * Runs entirely on this computer; the model (~80 MB for "base") is downloaded
 * once from Hugging Face and cached by the browser.
 */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';

export const WHISPER_MODELS = {
  tiny: { id: 'onnx-community/whisper-tiny_timestamped', label: 'Rapide (tiny · ~40 Mo)' },
  base: { id: 'onnx-community/whisper-base_timestamped', label: 'Équilibré (base · ~80 Mo)' },
  small: { id: 'onnx-community/whisper-small_timestamped', label: 'Précis (small · ~250 Mo)' },
};
export type WhisperModel = keyof typeof WHISPER_MODELS;

const workerCode = `
import { pipeline, env } from '${LIB}';
env.allowLocalModels = false;
let asr = null, loaded = '';
self.onmessage = async (ev) => {
  const { pcm, model, language } = ev.data;
  try {
    if (!asr || loaded !== model) {
      let device = 'wasm';
      try { if (navigator.gpu && await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch {}
      asr = await pipeline('automatic-speech-recognition', model, {
        device, dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'load', p: (p.progress || 0) / 100, file: p.file }); },
      });
      loaded = model;
    }
    self.postMessage({ type: 'stage', stage: 'transcribe' });
    // the library's own 30 s chunking loses the first chunk when timestamps are per word:
    // windows are cut here (25 s, 4 s overlap) and merged on the main thread (mergeWindows)
    // 25 s, not 30: a window of exactly 30 s (the model's maximum) stops after a few words
    const SR = 16000, WIN = 25 * SR, HOP = 21 * SR;
    const windows = [];
    for (let o = 0; o < pcm.length; o += HOP) {
      const part = pcm.subarray(o, Math.min(pcm.length, o + WIN));
      if (part.length < SR * 0.3) break;
      const out = await asr(part, { language, task: 'transcribe', return_timestamps: 'word' });
      windows.push({ offset: o / SR, length: part.length / SR, chunks: out.chunks || [] });
      self.postMessage({ type: 'step', p: Math.min(1, (o + WIN) / pcm.length) });
      if (o + WIN >= pcm.length) break;
    }
    self.postMessage({ type: 'done', windows });
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};`;

let worker: Worker | null = null;

onRelease('whisper', () => { worker?.terminate(); worker = null; });

export function whisperTranscribe(
  pcm: Float32Array,
  model: WhisperModel,
  language: 'fr' | 'en',
  onProgress: (label: string, p: number) => void,
): Promise<Word[]> {
  return heavy('whisper', () => whisperNow(pcm, model, language, onProgress));
}

function whisperNow(
  pcm: Float32Array,
  model: WhisperModel,
  language: 'fr' | 'en',
  onProgress: (label: string, p: number) => void,
): Promise<Word[]> {
  worker ??= new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' })), { type: 'module' });
  const w = worker;
  return new Promise((res, rej) => {
    w.onmessage = (ev) => {
      const d = ev.data;
      if (d.type === 'load') onProgress('Téléchargement du modèle…', d.p);
      if (d.type === 'stage') onProgress('Transcription en cours…', -1);
      if (d.type === 'step') onProgress('Transcription en cours…', d.p);
      if (d.type === 'error') rej(new Error('Whisper : ' + d.message));
      if (d.type === 'done') res(mergeWindows(d.windows));
    };
    w.onerror = (e) => rej(new Error('Whisper : ' + (e.message || 'le module n’a pas pu se charger (connexion ?)')));
    const copy = new Float32Array(pcm);
    w.postMessage({ pcm: copy, model: WHISPER_MODELS[model].id, language: language === 'en' ? 'english' : 'french' }, [copy.buffer]);
  });
}

export interface WhisperWindow { offset: number; length: number; chunks: { text: string; timestamp: [number, number | null] }[] }
/**
 * Words of overlapping 30 s windows, back on one timeline: each window keeps
 * the words that start in its own part (the middle of each overlap is the
 * border), so nothing is lost and nothing appears twice.
 */
export function mergeWindows(windows: WhisperWindow[]): Word[] {
  const out: Word[] = [];
  windows.forEach((win, i) => {
    const prev = windows[i - 1], next = windows[i + 1];
    const from = prev ? (prev.offset + prev.length + win.offset) / 2 : -Infinity;
    const to = next ? (win.offset + win.length + next.offset) / 2 : Infinity;
    for (const c of win.chunks) {
      const w = c.text.trim();
      if (!w) continue;
      const s = win.offset + c.timestamp[0], e = win.offset + (c.timestamp[1] ?? c.timestamp[0] + 0.3);
      if (s >= from && s < to) out.push({ w, s: +s.toFixed(3), e: +Math.max(s + 0.05, e).toFixed(3) });
    }
  });
  return out;
}
