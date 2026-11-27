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

/** 2.5D is for one panel, never a whole page (several panels would drift apart) */
function oneImage(p: Project, s: Shot) {
  const pg = p.pages.find((x) => x.id === s.pageId);
  if (!pg) return null;
  const share = (s.rect.w * s.rect.h) / Math.max(1, pg.width * pg.height);
  // a whole page is often several panels the detector could not split: parallax only on a real panel
  return share > 0.6 ? null : pg;
}

export function layersFor(p: Project, s: Shot): Layers | null {
  const pg = oneImage(p, s);
  if (!pg) return null;
  const v = cache.get(key(pg.mediaId, s.rect));
  return v && v !== 'pending' && v !== 'none' ? v : null;
}

export async function ensureLayers(p: Project, s: Shot, onLoad?: (pr: number) => void): Promise<void> {
  const pg = oneImage(p, s);
  const a = pg && getImage(pg.mediaId);
  if (!pg || !a) return;
  const k = key(pg.mediaId, s.rect);
  if (cache.has(k)) return;
  cache.set(k, 'pending');
  try {
    const depth = (await storedDepth(k)) ?? (await depthOf(a.img, s.rect, onLoad).then((d) => { if (d) void storeDepth(k, d); return d; }));
    if (!depth) { cache.set(k, 'none'); return; }
    const L = build(a.img, s.rect, depth, s.balloons ?? []);
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

/** the biggest solid part holds most of the foreground (coarse grid): a real figure, not speckle */
function compact(d: Uint8ClampedArray, W: number, H: number): boolean {
  const S = 6, gw = Math.ceil(W / S), gh = Math.ceil(H / S), on = new Uint8Array(gw * gh);
  let total = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (d[(Math.min(H - 1, y * S) * W + Math.min(W - 1, x * S)) * 4 + 3] > 127) { on[y * gw + x] = 1; total++; }
  if (!total) return false;
  const seen = new Uint8Array(gw * gh); let best = 0; const q: number[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || seen[i]) continue;
    let n = 0; seen[i] = 1; q.push(i);
    while (q.length) { const j = q.pop()!; n++; const x = j % gw; for (const k of [x > 0 ? j - 1 : -1, x < gw - 1 ? j + 1 : -1, j - gw, j + gw]) if (k >= 0 && k < on.length && on[k] && !seen[k]) { seen[k] = 1; q.push(k); } }
    best = Math.max(best, n);
  }
  return best / total >= 0.6;
}

/**
 * push-pull fill: at a small size, the pixels outside the (widened) subject are averaged down a
 * pyramid, then every hidden pixel takes the colour of its level below — the scenery around,
 * smoothly; returned at full size
 */
function inpaint(img: CanvasImageSource, r: Rect, hole: HTMLCanvasElement, W: number, H: number): HTMLCanvasElement {
  const k = Math.min(1, 384 / Math.max(W, H));
  const w = Math.max(4, Math.round(W * k)), h = Math.max(4, Math.round(H * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h);
  const m = document.createElement('canvas'); m.width = w; m.height = h;
  const mx = m.getContext('2d', { willReadFrequently: true })!; mx.drawImage(hole, 0, 0, w, h);
  const md = mx.getImageData(0, 0, w, h).data;
  // level 0: colour × weight (weight = visible scenery)
  type Lv = { w: number; h: number; c: Float32Array; a: Float32Array };
  const l0: Lv = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) { const a = 1 - md[i * 4 + 3] / 255; l0.a[i] = a; for (let j = 0; j < 3; j++) l0.c[i * 3 + j] = px.data[i * 4 + j] * a; }
  const lv: Lv[] = [l0];
  while (lv[lv.length - 1].w > 1 || lv[lv.length - 1].h > 1) {
    const p = lv[lv.length - 1], nw = Math.max(1, Math.ceil(p.w / 2)), nh = Math.max(1, Math.ceil(p.h / 2));
    const n: Lv = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), a: new Float32Array(nw * nh) };
    for (let y = 0; y < p.h; y++) for (let X = 0; X < p.w; X++) { const s = y * p.w + X, d = (y >> 1) * nw + (X >> 1); n.a[d] += p.a[s]; for (let j = 0; j < 3; j++) n.c[d * 3 + j] += p.c[s * 3 + j]; }
    // normalise to a weighted mean, capped weight (a fully visible cell counts 1)
    for (let i = 0; i < nw * nh; i++) { const a = n.a[i]; if (a > 0) { for (let j = 0; j < 3; j++) n.c[i * 3 + j] /= a; n.a[i] = Math.min(1, a); for (let j = 0; j < 3; j++) n.c[i * 3 + j] *= n.a[i]; } }
    lv.push(n);
  }
  // pull: coarse to fine, the missing weight takes the coarser level's colour
  for (let L = lv.length - 2; L >= 0; L--) {
    const f = lv[L], g = lv[L + 1];
    for (let y = 0; y < f.h; y++) for (let X = 0; X < f.w; X++) {
      const i = y * f.w + X, gi = (y >> 1) * g.w + (X >> 1), ga = g.a[gi] || 1e-6, miss = 1 - f.a[i];
      if (miss <= 0) continue;
      for (let j = 0; j < 3; j++) f.c[i * 3 + j] += miss * (g.c[gi * 3 + j] / ga);
      f.a[i] = 1;
    }
  }
  for (let i = 0; i < w * h; i++) { for (let j = 0; j < 3; j++) px.data[i * 4 + j] = l0.c[i * 3 + j]; px.data[i * 4 + 3] = 255; }
  x.putImageData(px, 0, 0);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ox = out.getContext('2d')!; ox.imageSmoothingQuality = 'high'; ox.filter = `blur(${Math.max(1, W / 400)}px)`;
  ox.drawImage(c, 0, 0, W, H);
  return out;
}

function build(img: CanvasImageSource, r: Rect, depth: HTMLCanvasElement, balloons: Rect[] = []): Layers | null {
  // full resolution of the panel (up to 2400 px): a zoomed 2.5D shot is as sharp as the plain one
  const k = Math.min(1, 2400 / Math.max(r.w, r.h));
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
  // balloons and captions stay on the drawing (background layer): lettering never floats
  for (const b of balloons) {
    const x0 = Math.max(0, Math.floor((b.x - r.x) * k) - 3), y0 = Math.max(0, Math.floor((b.y - r.y) * k) - 3);
    const x1 = Math.min(W, Math.ceil((b.x + b.w - r.x) * k) + 3), y1 = Math.min(H, Math.ceil((b.y + b.h - r.y) * k) + 3);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4 + 3; if (id.data[i] > 127) fgN--; id.data[i] = 0; }
  }
  const share = fgN / (W * H);
  // a clear subject only (not a flat panel, not half the picture): otherwise no parallax at all
  if (share < 0.1 || share > 0.55) return null;
  // the subject must be one solid figure, not depth noise scattered over the panel
  if (!compact(id.data, W, H)) return null;
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
  // the hole is rebuilt from the scenery AROUND the subject only (push-pull inpainting), so the
  // subject's own colours never bleed into a dark halo when it drifts
  const fill = inpaint(img, r, wide, W, H);
  const fl = fill.getContext('2d')!;
  fl.globalCompositeOperation = 'destination-in';
  fl.drawImage(wide, 0, 0);
  bx.drawImage(fill, 0, 0);
  return { fg, bg };
}
