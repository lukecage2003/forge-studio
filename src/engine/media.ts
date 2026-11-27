import { idb } from '../lib/db';
import { uid } from '../lib/util';

/** Runtime caches for decoded media. Blobs live in IndexedDB, decoded forms live here. */
export interface ImageAsset {
  img: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  /** tiny downscaled copy, upscaled at draw time = cheap, filter-free blur */
  blur: HTMLCanvasElement;
  url: string;
}

const images = new Map<string, ImageAsset>();
const audios = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

export const onMediaChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((f) => f());

let actx: AudioContext | null = null;
export const audioCtx = () => (actx ??= new AudioContext({ latencyHint: 'interactive' }));

export const getImage = (id: string) => images.get(id);
export const getAudio = (id: string) => audios.get(id);

/** soft, colourful blurred copy of the page, used behind panels and whenever nothing else fills the frame */
function makeBlur(img: CanvasImageSource, w: number, h: number) {
  const small = document.createElement('canvas');
  const s = 48 / Math.max(w, h);
  small.width = Math.max(4, Math.round(w * s));
  small.height = Math.max(4, Math.round(h * s));
  const sx = small.getContext('2d')!;
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(img, 0, 0, small.width, small.height);
  const c = document.createElement('canvas');
  c.width = small.width * 3;
  c.height = small.height * 3;
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.filter = 'blur(4px) saturate(1.25)';
  x.drawImage(small, -4, -4, c.width + 8, c.height + 8);
  x.filter = 'none';
  return c;
}

async function decodeImage(id: string, blob: Blob): Promise<ImageAsset> {
  const url = URL.createObjectURL(blob);
  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await createImageBitmap(blob);
  } catch {
    img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
  }
  const width = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const height = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const a: ImageAsset = { img, width, height, blur: makeBlur(img, width, height), url };
  images.set(id, a);
  emit();
  return a;
}

async function decodeAudio(id: string, blob: Blob): Promise<AudioBuffer> {
  const buf = await audioCtx().decodeAudioData(await blob.arrayBuffer());
  audios.set(id, buf);
  emit();
  return buf;
}

/* ------------------------------------------------------------ media store
 * Small media (comic pages) are kept in IndexedDB, a fast cache for decoding.
 * Large media (rushes, long audio) are written once, into the project
 * workspace (the user's folder, or the browser's file system when no folder
 * was chosen) and read from there: no second copy of a big rush on the disk.
 * Media of older projects already in IndexedDB keep working (read first).
 */
export const LARGE_MEDIA = 8 * 1024 * 1024;
type Sink = { put(id: string, b: Blob): Promise<void>; get(id: string): Promise<Blob | null> };
let sink: Sink | null = null;
/** the studio plugs the workspace in here */
export const setMediaSink = (s: Sink | null) => { sink = s; };
async function storeBlob(id: string, b: Blob) {
  if (b.size >= LARGE_MEDIA && sink) { try { await sink.put(id, b); return; } catch { /* fall back to the cache */ } }
  await idb.put('media', id, b);
}
async function readBlob(id: string): Promise<Blob | undefined> {
  const b = await idb.get<Blob>('media', id).catch(() => undefined);
  if (b) return b;
  return (await sink?.get(id).catch(() => null)) ?? undefined;
}

export async function importImage(file: Blob) {
  const id = uid('m_');
  await storeBlob(id, file);
  const a = await decodeImage(id, file);
  return { id, asset: a };
}

export async function importAudio(file: Blob) {
  const id = uid('m_');
  await storeBlob(id, file);
  const b = await decodeAudio(id, file);
  return { id, buffer: b };
}

/** Make sure a media id is decoded (after reload). */
export function ensureMedia(id: string, kind: 'image' | 'audio'): Promise<unknown> {
  if (kind === 'image' && images.has(id)) return Promise.resolve(images.get(id));
  if (kind === 'audio' && audios.has(id)) return Promise.resolve(audios.get(id));
  if (pending.has(id)) return pending.get(id)!;
  const p: Promise<unknown> = readBlob(id).then((blob): Promise<unknown> => {
    if (!blob) throw new Error('Média introuvable : ' + id);
    return kind === 'image' ? decodeImage(id, blob) : decodeAudio(id, blob);
  });
  pending.set(id, p);
  p.catch(() => {}).finally(() => pending.delete(id));
  return p;
}

export async function mediaBlob(id: string) {
  return readBlob(id);
}

export async function putMediaBlob(id: string, blob: Blob) {
  await storeBlob(id, blob);
}
/** the cache copy of a large media can go once the workspace holds it (frees the duplicate) */
export async function evictCached(id: string): Promise<number> {
  const b = await idb.get<Blob>('media', id).catch(() => undefined);
  if (!b || b.size < LARGE_MEDIA || !sink || !(await sink.get(id).catch(() => null))) return 0;
  await idb.del('media', id);
  return b.size;
}

/** size of the browser cache of media (IndexedDB) */
export async function cacheUsage(): Promise<{ count: number; bytes: number }> {
  let count = 0, bytes = 0;
  for (const k of await idb.keys('media').catch(() => [] as string[])) { const b = await idb.get<Blob>('media', k).catch(() => undefined); if (b) { count++; bytes += b.size; } }
  return { count, bytes };
}
/**
 * free the browser cache copies that are only duplicates: a copy goes only when
 * the workspace holds the same media AND the open project does not need it now.
 * Nothing is lost: the media is read back from the workspace when needed.
 */
export async function freeCacheCopies(keep: Set<string>): Promise<{ freed: number; bytes: number }> {
  if (!sink) return { freed: 0, bytes: 0 };
  let freed = 0, bytes = 0;
  for (const k of await idb.keys('media').catch(() => [] as string[])) {
    if (keep.has(k)) continue;
    const b = await idb.get<Blob>('media', k).catch(() => undefined);
    if (!b || !(await sink.get(k).catch(() => null))) continue;
    await idb.del('media', k);
    freed++; bytes += b.size;
  }
  return { freed, bytes };
}

/* ------------------------------------------------------------ video */

export interface VideoAsset { url: string; width: number; height: number; duration: number }
const videos = new Map<string, VideoAsset>();
export const getVideo = (id: string) => videos.get(id);

function probeVideo(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => res({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.onerror = () => rej(new Error('Vidéo illisible par le navigateur (essaie un MP4 H.264).'));
    v.src = url;
  });
}

async function decodeVideo(id: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const meta = await probeVideo(url);
  const asset = { url, ...meta };
  videos.set(id, asset);
  try {
    const buf = await audioCtx().decodeAudioData(await blob.arrayBuffer());
    audios.set(id, buf);
  } catch {
    /* video without a readable audio track */
  }
  emit();
  return asset;
}

export async function importVideo(file: Blob) {
  const id = uid('m_');
  await storeBlob(id, file);
  const asset = await decodeVideo(id, file);
  return { id, asset };
}

export function ensureVideo(id: string): Promise<unknown> {
  if (videos.has(id)) return Promise.resolve(videos.get(id));
  if (pending.has(id)) return pending.get(id)!;
  const p: Promise<unknown> = readBlob(id).then((blob): Promise<unknown> => {
    if (!blob) throw new Error('Rush introuvable : ' + id);
    return decodeVideo(id, blob);
  });
  pending.set(id, p);
  p.catch(() => {}).finally(() => pending.delete(id));
  return p;
}

export const notifyMedia = () => emit();

/** decode an image into the cache only, never saved (benchmark, previews) */
export const registerTempImage = (id: string, blob: Blob) => decodeImage(id, blob);

/* ----------------------------------------------- cleaned voice (denoise) */

import type { DenoiseMode, NoiseReport } from './denoise';
import type { VoicePreset, VoiceReport } from './voicepro';
import { heavy } from './jobs';
export interface VoiceProcessing { denoise: DenoiseMode; preset: VoicePreset }
const vkey = (id: string, v: VoiceProcessing) => `${id}:${v.denoise}:${v.preset}`;
const untouched = (v: VoiceProcessing) => v.denoise === 'off' && v.preset !== 'radio';
const cleaned = new Map<string, { buf: AudioBuffer; report: NoiseReport | null; voice: VoiceReport | null }>();
const cleaning = new Map<string, Promise<NoiseReport | null>>();

/** the voice as it will be heard: processed when ready, else the original */
export function voiceBuffer(id: string, v: VoiceProcessing): AudioBuffer | undefined {
  if (!untouched(v)) { const c = cleaned.get(vkey(id, v)); if (c) return c.buf; }
  return audios.get(id);
}
/** true once the processed voice is ready (the preview then sounds like the export) */
export const voiceReady = (id: string, v: VoiceProcessing) => untouched(v) || cleaned.has(vkey(id, v));
export const noiseReport = (id: string, v: VoiceProcessing) => cleaned.get(vkey(id, v))?.report ?? null;
export const voiceReport = (id: string, v: VoiceProcessing) => cleaned.get(vkey(id, v))?.voice ?? null;

/** clean (denoise) then polish (broadcast chain) a take, once per take and settings (cached) */
export function ensureClean(id: string, v: VoiceProcessing): Promise<NoiseReport | null> {
  if (untouched(v)) return Promise.resolve(null);
  const key = vkey(id, v);
  if (cleaned.has(key)) return Promise.resolve(cleaned.get(key)!.report);
  if (cleaning.has(key)) return cleaning.get(key)!;
  const job = heavy('audio', async () => {
    const src = audios.get(id) ?? (await ensureMedia(id, 'audio').catch(() => null), audios.get(id));
    if (!src) return null;
    await new Promise((r) => setTimeout(r, 0));
    const [{ cleanVoice }, { polishVoice }] = await Promise.all([import('./denoise'), import('./voicepro')]);
    let ch: Float32Array[] = Array.from({ length: src.numberOfChannels }, (_, i) => src.getChannelData(i) as Float32Array);
    let report: NoiseReport | null = null;
    if (v.denoise !== 'off') { const r = cleanVoice(ch, src.sampleRate, v.denoise); ch = r.channels; report = r.report; }
    let voice: VoiceReport | null = null;
    if (v.preset === 'radio') { const r = polishVoice(ch, src.sampleRate, 'radio'); ch = r.channels; voice = r.report; }
    const buf = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
    ch.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    cleaned.set(key, { buf, report, voice });
    emit();
    return report;
  });
  cleaning.set(key, job);
  return job.finally(() => cleaning.delete(key));
}
