import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, getFirstEncodableVideoCodec } from 'mediabunny';

/**
 * PROXIES — a light copy of a large rush for the preview only. The preview
 * draws the frame scaled to its box (render.placeFace uses the project's
 * width and height, never the file's pixels), so a copy with the same aspect
 * ratio gives exactly the same picture, only softer. The export always reads
 * the original. Sound is not copied: the preview plays it from Web Audio.
 * A proxy can always be made again, so removing proxies loses nothing.
 */

export const PROXY_SIDE = 540;
/** worth it only above 720 p: below, decoding the original costs about the same */
export const needsProxy = (w: number, h: number) => Math.min(w, h) > 720;

/** pure: proxy size keeping the aspect ratio, short side PROXY_SIDE, even numbers (video encoders need them) */
export function proxySize(w: number, h: number, side = PROXY_SIDE): { width: number; height: number } {
  const k = side / Math.min(w, h);
  const even = (x: number) => Math.max(2, Math.round((x * k) / 2) * 2);
  return { width: even(w), height: even(h) };
}

export async function makeProxy(blob: Blob, w: number, h: number, onProgress?: (x: number) => void, signal?: AbortSignal): Promise<Blob> {
  const size = proxySize(w, h);
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: size.width, height: size.height });
  if (!codec) throw Object.assign(new Error('Ce navigateur ne sait encoder aucune vidéo : aperçu sur l’original.'), { kind: 'input' });
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conv = await Conversion.init({ input, output, video: { ...size, fit: 'fill', codec, bitrate: 1_200_000 }, audio: { discard: true } });
  if (!conv.isValid) throw Object.assign(new Error('Rush non convertible en aperçu léger : aperçu sur l’original.'), { kind: 'input' });
  if (onProgress) conv.onProgress = (x) => onProgress(x);
  const stop = () => { void conv.cancel(); };
  signal?.addEventListener('abort', stop, { once: true });
  try { await conv.execute(); } finally { signal?.removeEventListener('abort', stop); }
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
}
