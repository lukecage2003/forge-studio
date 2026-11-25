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
    const out = await asr(pcm, {
      language, task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5,
    });
    self.postMessage({ type: 'done', chunks: out.chunks || [] });
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};`;

let worker: Worker | null = null;

export function whisperTranscribe(
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
      if (d.type === 'error') rej(new Error('Whisper : ' + d.message));
      if (d.type === 'done') {
        const words: Word[] = (d.chunks as { text: string; timestamp: [number, number | null] }[])
          .map((c) => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
          .filter((x) => x.w);
        res(words);
      }
    };
    w.onerror = (e) => rej(new Error('Whisper : ' + (e.message || 'le module n’a pas pu se charger (connexion ?)')));
    const copy = new Float32Array(pcm);
    w.postMessage({ pcm: copy, model: WHISPER_MODELS[model].id, language: language === 'en' ? 'english' : 'french' }, [copy.buffer]);
  });
}
