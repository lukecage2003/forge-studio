import type { Project, Rect, Shot } from '../types';
import { getImage, notifyMedia } from './media';
import { depthOf } from './vision';
import { idb } from '../lib/db';

/**
 * 2.5D motion-comic layers for a panel: the closest elements (characters,
 * foreground) are lifted onto their own layer using the depth map, and the
 * hole they leave in the background is filled with a soft blur of the
 * surroundings, so the two layers can drift apart without ghosting.
 */
export interface Layers { fg: HTMLCanvasElement; bg: HTMLCanvasElement }
const cache = new Map<string, Layers | 'pending' | 'none'>();
const key = (mediaId: string, r: Rect) => `${mediaId}:${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.w)}:${Math.round(r.h)}`;

export function layersFor(p: Project, s: Shot): Layers | null {
  const pg = p.pages.find((x) => x.id === s.pageId);
  if (!pg) return null;
  const v = cache.get(key(pg.mediaId, s.rect));
  return v && v !== 'pending' && v !== 'none' ? v : null;
}

export async function ensureLayers(p: Project, s: Shot, onLoad?: (pr: number) => void): Promise<void> {
  const pg = p.pages.find((x) => x.id === s.pageId);
  const a = pg && getImage(pg.mediaId);
  if (!pg || !a) return;
  const k = key(pg.mediaId, s.rect);
  if (cache.has(k)) return;
  cache.set(k, 'pending');
  try {
    const depth = (await storedDepth(k)) ?? (await depthOf(a.img, s.rect, onLoad).then((d) => { if (d) void storeDepth(k, d); return d; }));
    if (!depth) { cache.set(k, 'none'); return; }
    const L = build(a.img, s.rect, depth);
    cache.set(k, L ?? 'none');
    if (L) notifyMedia();
  } catch {
    cache.set(k, 'none');
  }
}

/*
 * The depth map is the only costly part (the local depth model, about a second per
 * panel without a graphics card): it is kept in the browser, a small grey picture per
 * panel, so the first export after a reload does not run the model again.
 */
async function storedDepth(k: string): Promise<HTMLCanvasElement | null> {
  try {
    const b = await idb.get<Blob>('media', 'depth:' + k);
    if (!b) return null;
    const bmp = await createImageBitmap(b);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close();
    return c;
  } catch { return null; }
}
async function storeDepth(k: string, c: HTMLCanvasElement) {
  try { const b = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png')); if (b) await idb.put('media', 'depth:' + k, b); } catch { /* storage full: computed again next time */ }
}

function build(img: CanvasImageSource, r: Rect, depth: HTMLCanvasElement): Layers | null {
  const k = Math.min(1, 1200 / Math.max(r.w, r.h));
  const W = Math.max(8, Math.round(r.w * k)), H = Math.max(8, Math.round(r.h * k));
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  // depth → foreground mask (closest ~35 % of the panel), feathered
  const dm = mk(), dx = dm.getContext('2d', { willReadFrequently: true })!;
  dx.drawImage(depth, 0, 0, W, H);
  const id = dx.getImageData(0, 0, W, H);
  const vals: number[] = [];
  for (let i = 0; i < W * H; i += 7) vals.push(id.data[i * 4]);
  vals.sort((a, b) => a - b);
  const thr = vals[Math.floor(vals.length * 0.65)];
  const lo = thr - 12, hi = thr + 12;
  let fgN = 0;
  for (let i = 0; i < W * H; i++) {
    const v = id.data[i * 4];
    const a = v <= lo ? 0 : v >= hi ? 255 : Math.round(((v - lo) / (hi - lo)) * 255);
    id.data[i * 4 + 3] = a;
    if (a > 127) fgN++;
  }
  const share = fgN / (W * H);
  if (share < 0.08 || share > 0.7) return null; // flat panel or no clear subject: no parallax
  dx.putImageData(id, 0, 0);
  const mask = mk(), mx = mask.getContext('2d')!;
  mx.filter = `blur(${Math.max(1, W / 300)}px)`;
  mx.drawImage(dm, 0, 0);
  // layers
  const fg = mk(), fx = fg.getContext('2d')!;
  fx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, W, H);
  fx.globalCompositeOperation = 'destination-in';
  fx.drawImage(mask, 0, 0);
  const bg = mk(), bx = bg.getContext('2d')!;
  bx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, W, H);
  // fill behind the subject: blurred surroundings through a widened mask
  const wide = mk(), wx = wide.getContext('2d')!;
  wx.filter = `blur(${Math.max(4, W / 40)}px)`;
  wx.drawImage(mask, 0, 0);
  wx.drawImage(mask, 0, 0);
  const fill = mk(), fl = fill.getContext('2d')!;
  fl.filter = `blur(${Math.max(8, W / 25)}px)`;
  fl.drawImage(img, r.x, r.y, r.w, r.h, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
  fl.filter = 'none';
  fl.globalCompositeOperation = 'destination-in';
  fl.drawImage(wide, 0, 0);
  bx.drawImage(fill, 0, 0);
  return { fg, bg };
}
