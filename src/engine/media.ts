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

function makeBlur(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  const s = 40 / Math.max(w, h);
  c.width = Math.max(4, Math.round(w * s));
  c.height = Math.max(4, Math.round(h * s));
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
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

export async function importImage(file: Blob) {
  const id = uid('m_');
  await idb.put('media', id, file);
  const a = await decodeImage(id, file);
  return { id, asset: a };
}

export async function importAudio(file: Blob) {
  const id = uid('m_');
  await idb.put('media', id, file);
  const b = await decodeAudio(id, file);
  return { id, buffer: b };
}

/** Make sure a media id is decoded (after reload). */
export function ensureMedia(id: string, kind: 'image' | 'audio'): Promise<unknown> {
  if (kind === 'image' && images.has(id)) return Promise.resolve(images.get(id));
  if (kind === 'audio' && audios.has(id)) return Promise.resolve(audios.get(id));
  if (pending.has(id)) return pending.get(id)!;
  const p: Promise<unknown> = idb.get<Blob>('media', id).then((blob): Promise<unknown> => {
    if (!blob) throw new Error('Média introuvable : ' + id);
    return kind === 'image' ? decodeImage(id, blob) : decodeAudio(id, blob);
  });
  pending.set(id, p);
  p.catch(() => {}).finally(() => pending.delete(id));
  return p;
}

export async function mediaBlob(id: string) {
  return idb.get<Blob>('media', id);
}

export async function putMediaBlob(id: string, blob: Blob) {
  await idb.put('media', id, blob);
}
