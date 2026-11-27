import type { Project } from '../types';
import { measureLoudness } from './loudness';

/**
 * DELIVERY — what a finished MP4 really contains, and whether it fits each
 * platform. The file itself is read back (not the project): resolution, frame
 * rate, duration, codecs, black frames, loudness, true peak, clipped samples.
 * Platform limits are guidelines published by the platforms at the time of
 * writing; they change, so every message names the rule it applies.
 */

export type PlatformId = 'tiktok' | 'shorts' | 'reels';
export interface Platform {
  id: PlatformId; label: string;
  w: number; h: number;
  /** longest video the platform accepts in this format, seconds */
  maxSec: number;
  /** interface bands drawn over the video (share of the height / width) */
  safe: { top: number; bottom: number; right: number };
  loudness: number;
  hashtagsMax: number;
}
export const PLATFORMS: Record<PlatformId, Platform> = {
  tiktok: { id: 'tiktok', label: 'TikTok', w: 1080, h: 1920, maxSec: 600, safe: { top: 0.08, bottom: 0.2, right: 0.13 }, loudness: -14, hashtagsMax: 5 },
  shorts: { id: 'shorts', label: 'YouTube Shorts', w: 1080, h: 1920, maxSec: 180, safe: { top: 0.08, bottom: 0.16, right: 0.12 }, loudness: -14, hashtagsMax: 3 },
  reels: { id: 'reels', label: 'Instagram Reels', w: 1080, h: 1920, maxSec: 180, safe: { top: 0.1, bottom: 0.2, right: 0.12 }, loudness: -14, hashtagsMax: 5 },
};

export interface FileReport {
  width: number; height: number; fps: number; duration: number; sizeMB: number; mbps: number;
  videoCodec: string; audioCodec: string | null; sampleRate: number | null;
  /** runs of black picture longer than 0.4 s (seconds) */
  black: { s: number; e: number }[];
  /** audio */
  lufs: number | null; truePeakDb: number | null; clipped: number; silentStart: number;
}
export interface DeliveryIssue { level: 'error' | 'warn' | 'ok'; text: string }

/* ---------------------------------------------------------------- pure checks (tested) */

/** mean luma of RGBA pixels, 0..1 */
export function meanLuma(px: Uint8ClampedArray): number {
  let s = 0;
  for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  return s / (px.length / 4) / 255;
}
/** runs of black samples (luma under 0.035) at least `min` seconds long */
export function blackRuns(samples: { t: number; luma: number }[], step: number, min = 0.4) {
  const out: { s: number; e: number }[] = [];
  let start: number | null = null;
  for (const x of samples) {
    if (x.luma < 0.035) start ??= x.t;
    else if (start != null) { if (x.t - start >= min) out.push({ s: start, e: x.t }); start = null; }
  }
  if (start != null && samples.length && samples[samples.length - 1].t + step - start >= min) out.push({ s: start, e: samples[samples.length - 1].t + step });
  return out;
}
/**
 * True peak, dBTP: 4× oversampling with a windowed-sinc interpolator (the
 * method of ITU-R BS.1770). Only computed around samples louder than −8 dBFS:
 * quieter parts can't reach the ceiling, and the check stays fast.
 */
const TAPS = 16;
const KERNEL = [0.25, 0.5, 0.75].map((f) => Array.from({ length: 2 * TAPS }, (_, k) => {
  const x = k - TAPS + 1 - f; // distance from the interpolated point
  const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
  const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TAPS + 1));
  return sinc * w;
}));
export function truePeakDb(ch: Float32Array[]): number {
  let peak = 0;
  const gate = 10 ** (-8 / 20);
  for (const c of ch) {
    for (let i = 0; i < c.length; i++) {
      const v = Math.abs(c[i]);
      if (v > peak) peak = v;
      if (v < gate || i < TAPS || i + TAPS >= c.length) continue;
      for (const kern of KERNEL) {
        let acc = 0;
        for (let k = 0; k < kern.length; k++) acc += kern[k] * c[i - TAPS + 1 + k];
        if (Math.abs(acc) > peak) peak = Math.abs(acc);
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
export const clippedSamples = (ch: Float32Array[]) => ch.reduce((n, c) => { let k = 0; for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= 0.9995) k++; return n + k; }, 0);

/** what the file needs before it is posted on a platform */
export function checkDelivery(r: FileReport, pf: Platform, p?: Project): DeliveryIssue[] {
  const out: DeliveryIssue[] = [];
  const err = (text: string) => out.push({ level: 'error', text }), warn = (text: string) => out.push({ level: 'warn', text });
  if (r.width !== pf.w || r.height !== pf.h) err(`${pf.label} attend ${pf.w}×${pf.h} (vertical) : le fichier fait ${r.width}×${r.height}.`);
  if (Math.abs(r.fps - Math.round(r.fps)) > 0.05 || ![24, 25, 30, 50, 60].includes(Math.round(r.fps))) warn(`Cadence inhabituelle (${r.fps.toFixed(2)} images/s) : 30 ou 60 images/s conseillées.`);
  if (r.duration > pf.maxSec) err(`${pf.label} : ${Math.round(r.duration)} s dépasse la durée maximale de ${pf.maxSec / 60} min de ce format.`);
  if (r.duration < 3) warn('Vidéo de moins de 3 secondes.');
  if (!r.audioCodec) err('Le fichier n’a pas de piste son.');
  else if (!/mp4a|aac/i.test(r.audioCodec)) warn(`Son encodé en ${r.audioCodec} : l’AAC est le format le plus sûr pour ${pf.label} (ce navigateur ne propose pas d’encodeur AAC).`);
  if (r.black.length) err(`${r.black.length} passage${r.black.length > 1 ? 's' : ''} noir${r.black.length > 1 ? 's' : ''} : ${r.black.slice(0, 3).map((b) => `${b.s.toFixed(1)}–${b.e.toFixed(1)} s`).join(', ')}.`);
  if (r.lufs != null && Math.abs(r.lufs - pf.loudness) > 2) warn(`Volume moyen ${r.lufs.toFixed(1)} LUFS : ${pf.label} normalise autour de ${pf.loudness} LUFS.`);
  if (r.truePeakDb != null && r.truePeakDb > -1) warn(`Crête à ${r.truePeakDb.toFixed(1)} dBTP : au-dessus de −1 dBTP, la conversion de la plateforme peut saturer.`);
  if (r.clipped > 0) err(`${r.clipped} échantillon${r.clipped > 1 ? 's' : ''} saturé${r.clipped > 1 ? 's' : ''} dans le son.`);
  if (r.silentStart > 1.5) warn(`${r.silentStart.toFixed(1)} s de silence au début : l’accroche arrive tard.`);
  if (p) {
    const inBand = (y: number) => y > 1 - pf.safe.bottom || y < pf.safe.top;
    if (p.subtitles.length && p.subtitleStyle.on !== false && inBand(p.subtitleStyle.y)) err(`Sous-titres sous l’interface de ${pf.label} (position ${Math.round(p.subtitleStyle.y * 100)} % de la hauteur, zone sûre ${Math.round(pf.safe.top * 100)}–${Math.round((1 - pf.safe.bottom) * 100)} %).`);
    const caps = p.shots.filter((s) => s.caption.text.trim() && inBand(s.caption.y)).length;
    if (caps) warn(`${caps} texte${caps > 1 ? 's' : ''} à l’écran dans une zone couverte par l’interface de ${pf.label}.`);
  }
  if (!out.length) out.push({ level: 'ok', text: `Conforme pour ${pf.label}.` });
  return out;
}

/* ---------------------------------------------------------------- reading a file (browser) */

export async function analyzeFile(blob: Blob, onProgress?: (p: number) => void): Promise<FileReport> {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioBufferSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  const at = await input.getPrimaryAudioTrack();
  const duration = await input.computeDuration();
  const stats = vt ? await vt.computePacketStats(300) : null;
  const report: FileReport = {
    width: vt?.displayWidth ?? 0, height: vt?.displayHeight ?? 0, fps: stats?.averagePacketRate ?? 0, duration,
    sizeMB: blob.size / 1e6, mbps: (blob.size * 8) / Math.max(0.001, duration) / 1e6,
    videoCodec: (vt && (await vt.getCodecParameterString())) ?? '?', audioCodec: at ? ((await at.getCodecParameterString()) ?? at.codec ?? '?') : null, sampleRate: at?.sampleRate ?? null,
    black: [], lufs: null, truePeakDb: null, clipped: 0, silentStart: 0,
  };
  // picture: a small frame every 0.2 s
  if (vt) {
    const step = 0.2, sink = new CanvasSink(vt, { width: 48, height: 85, fit: 'fill', poolSize: 2 });
    const times = Array.from({ length: Math.max(1, Math.floor(duration / step)) }, (_, i) => i * step);
    const samples: { t: number; luma: number }[] = [];
    let i = 0;
    for await (const w of sink.canvasesAtTimestamps(times)) {
      const c = w?.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
      if (c) { const x = (c as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D; samples.push({ t: times[i], luma: meanLuma(x.getImageData(0, 0, c.width, c.height).data) }); }
      i++;
      if (i % 25 === 0) onProgress?.(0.5 * i / times.length);
    }
    report.black = blackRuns(samples, step);
  }
  // sound: the whole track
  if (at) {
    const sink = new AudioBufferSink(at);
    const parts: Float32Array[][] = [];
    let sr = at.sampleRate, n = 0;
    for await (const { buffer } of sink.buffers()) {
      sr = buffer.sampleRate;
      parts.push(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice()));
      n += buffer.length;
    }
    const nc = parts[0]?.length ?? 0;
    const ch = Array.from({ length: nc }, (_, c) => { const out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p[c], o); o += p[c].length; } return out; });
    if (nc) {
      report.lufs = measureLoudness(ch, sr).integrated;
      // in 5 s pieces (overlapping by the filter length), the interface gets a turn between them
      const { yieldToUI } = await import('./resources');
      let tp = -Infinity;
      for (let o = 0; o < n; o += sr * 5) {
        tp = Math.max(tp, truePeakDb(ch.map((c) => c.subarray(Math.max(0, o - 2 * TAPS), Math.min(n, o + sr * 5 + 2 * TAPS)))));
        await yieldToUI();
      }
      report.truePeakDb = tp;
      report.clipped = clippedSamples(ch);
      const thr = 10 ** (-50 / 20);
      let k = 0; while (k < n && Math.abs(ch[0][k]) < thr) k++;
      report.silentStart = k / sr;
    }
  }
  (input as unknown as { dispose?: () => void }).dispose?.();
  onProgress?.(1);
  return report;
}

/** one picture of the finished video (cover image of the post), PNG */
export async function frameAt(blob: Blob, t: number): Promise<Blob | null> {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) return null;
  const sink = new CanvasSink(vt, { poolSize: 1 });
  const w = await sink.getCanvas(t);
  const c = w?.canvas as HTMLCanvasElement | undefined;
  const out = c ? await new Promise<Blob | null>((r) => (c.toBlob ? c.toBlob(r, 'image/png') : r(null))) : null;
  (input as unknown as { dispose?: () => void }).dispose?.();
  return out;
}
