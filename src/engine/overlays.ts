import type { NBox, Overlay, OverlayEnter, OverlayPlace, Project } from '../types';
import { getImage } from './media';

/**
 * OVERLAY TRACKS — drawn by the one renderer (render.ts) above the main track
 * and under the look and the subtitles, so preview and export stay the same
 * picture. Panels and images are cover-fitted in their box with an optional
 * slow push-in: a view, never a change of the artwork. Video frames come from
 * a source function (preview: a <video> element; export: decoded frames).
 */

/** frame of a video overlay at a source time, or null while it is not ready */
export type OverlayVideoSource = (mediaId: string, src: number) => CanvasImageSource | null;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface Box { x: number; y: number; w: number; h: number }

export const PLACE_FR: Record<OverlayPlace, string> = { full: 'Plein écran', pip: 'Incrustation', top: 'Moitié haute', bottom: 'Moitié basse', left: 'Moitié gauche', right: 'Moitié droite', free: 'Libre' };
export const ENTER_FR: Record<OverlayEnter, string> = { fade: 'Fondu', slide: 'Glissé', pop: 'Pop', wipe: 'Volet encré' };
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** pure: the place that cuts the least of a picture of this shape (the picture-in-picture first when it loses nothing) */
export function bestPlace(sw: number, sh: number, W: number, H: number): OverlayPlace {
  const order: OverlayPlace[] = ['pip', 'bottom', 'top', 'right', 'left', 'full'];
  let best: OverlayPlace = 'pip', loss = Infinity;
  // full screen hides the whole main track: advised only when it is clearly better
  for (const pl of order) { const b = placeBox(pl, W, H); const l = fitLoss(sw, sh, b.w, b.h) + (pl === 'full' ? 0.25 : 0); if (l < loss - 0.05) { loss = l; best = pl; } }
  return best;
}

/** pure: the box of an overlay at t (a free overlay moves from its box to its end box) */
export function overlayBox(o: Overlay, t: number, W: number, H: number) {
  if (o.place !== 'free' || !o.box) return placeBox(o.place === 'free' ? 'pip' : o.place, W, H);
  const a = o.box, b = o.boxEnd ?? o.box, k = ease(Math.min(1, Math.max(0, (t - o.start) / Math.max(0.01, o.duration))));
  const m = (u: number, v: number) => u + (v - u) * k;
  return { x: m(a.x, b.x) * W, y: m(a.y, b.y) * H, w: m(a.w, b.w) * W, h: m(a.h, b.h) * H };
}
/** pure: a pixel box as shares of the frame */
export const toNBox = (b: { x: number; y: number; w: number; h: number }, W: number, H: number): NBox => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });

/** pure: where an overlay sits in a W×H frame */
export function placeBox(place: OverlayPlace, W: number, H: number): Box {
  const m = Math.round(Math.min(W, H) * 0.04);
  switch (place) {
    case 'full': return { x: 0, y: 0, w: W, h: H };
    case 'top': return { x: 0, y: 0, w: W, h: H / 2 };
    case 'bottom': return { x: 0, y: H / 2, w: W, h: H / 2 };
    case 'left': return { x: 0, y: 0, w: W / 2, h: H };
    case 'right': return { x: W / 2, y: 0, w: W / 2, h: H };
    case 'free': return placeBox('pip', W, H);
    case 'pip': { const w = Math.round(W * 0.42), h = Math.round(w * (H > W ? 1.25 : 0.62)); return { x: W - w - m, y: Math.round(H * 0.16), w, h }; }
  }
}

/** pure: share of the picture lost when it fills (cover) a box of another shape: 0 = nothing cut */
export function fitLoss(sw: number, sh: number, bw: number, bh: number): number {
  const k = Math.max(bw / sw, bh / sh);
  return 1 - Math.min(1, (bw / k) / sw) * Math.min(1, (bh / k) / sh);
}

/** pure: the overlays visible at t, lower tracks first (drawn first, so higher tracks cover them) */
export function activeOverlays(p: Project, t: number): Overlay[] {
  return (p.overlays ?? []).filter((o) => t >= o.start && t < o.start + o.duration).sort((a, b) => a.track - b.track || a.start - b.start);
}

/** pure: how far in the overlay is (0 = out, 1 = fully in), over `fade` seconds at both ends */
export function overlayIn(o: Overlay, t: number): number {
  const local = t - o.start;
  if (local < 0 || local >= o.duration) return 0;
  const f = Math.min(o.fade, o.duration / 2);
  if (f <= 0) return 1;
  return Math.min(1, local / f, (o.duration - local) / f);
}
/** pure: opacity of an overlay at t: only the fade entrance changes it */
export const overlayAlpha = (o: Overlay, t: number) => ((o.enter ?? 'fade') === 'fade' ? overlayIn(o, t) : overlayIn(o, t) > 0 ? 1 : 0);

/** where the video overlay is in its source file at t */
export const overlaySourceTime = (o: Overlay, t: number) => (o.source.kind === 'video' ? o.source.offset + (t - o.start) : 0);

export function drawOverlays(ctx: Ctx, p: Project, t: number, W: number, H: number, video?: OverlayVideoSource) {
  for (const o of activeOverlays(p, t)) {
    const a = overlayAlpha(o, t);
    const pin = overlayIn(o, t);
    if (a <= 0 || pin <= 0) continue;
    let img: CanvasImageSource | null = null, sx = 0, sy = 0, sw = 0, sh = 0;
    if (o.source.kind === 'panel') {
      const src = o.source;
      const page = p.pages.find((pg) => pg.id === src.pageId);
      const asset = page && getImage(page.mediaId);
      if (!asset) continue;
      img = asset.img;
      // panel rects are in page pixels (as everywhere in the renderer)
      sx = src.rect.x; sy = src.rect.y; sw = Math.max(1, src.rect.w); sh = Math.max(1, src.rect.h);
    } else if (o.source.kind === 'image') {
      const asset = getImage(o.source.mediaId);
      if (!asset) continue;
      img = asset.img; sw = asset.width; sh = asset.height;
    } else {
      img = video?.(o.source.mediaId, overlaySourceTime(o, t)) ?? null;
      if (!img) continue;
      sw = o.source.width; sh = o.source.height;
      // the frame may come at another size (proxy, export scale): crop in its own pixels
      const iw = (img as HTMLVideoElement).videoWidth || (img as HTMLCanvasElement).width || sw;
      const k = iw / sw; sw *= k; sh *= k;
    }
    let box = overlayBox(o, t, W, H);
    // a picture-in-picture or a free frame takes the picture's own shape when filling would cut it:
    // the frame hugs the panel instead of leaving it small in a blurred box
    if ((o.place === 'pip' || o.place === 'free') && o.source.kind !== 'video' && fitLoss(sw, sh, box.w, box.h) > 0.25) {
      const kk = Math.min(box.w / sw, box.h / sh), nw = sw * kk, nh = sh * kk;
      box = { x: box.x + (box.w - nw) / 2, y: box.y + (box.h - nh) / 2, w: nw, h: nh };
    }
    const z = 1 + 0.08 * o.zoom * ((t - o.start) / Math.max(0.5, o.duration));
    // a comic picture is shown whole when filling the box would cut more than a quarter of it
    // (balloons and captions stay readable); a video always fills its box
    const whole = o.source.kind !== 'video' && fitLoss(sw, sh, box.w, box.h) > 0.25;
    const k = (whole ? Math.min(box.w / sw, box.h / sh) : Math.max(box.w / sw, box.h / sh)) * z;
    const cw = Math.min(sw, box.w / k), ch = Math.min(sh, box.h / k);
    const cx = sx + (sw - cw) / 2, cy = sy + (sh - ch) / 2;
    const dw = cw * k, dh = ch * k, dx = box.x + (box.w - dw) / 2, dy = box.y + (box.h - dh) / 2;
    ctx.save();
    ctx.globalAlpha = a;
    // comic entrances: slide in from the nearest side, pop with a small overshoot, or an ink wipe
    const en = o.enter ?? 'fade', e = ease(pin);
    if (en === 'slide' && pin < 1) { const fromLeft = box.x + box.w / 2 < W / 2; ctx.translate((fromLeft ? -1 : 1) * (1 - e) * (box.w + Math.min(box.x, W - box.x - box.w) + 10), 0); }
    if (en === 'pop' && pin < 1) { const s2 = 0.55 + 0.45 * e + 0.12 * Math.sin(Math.PI * e); const cx0 = box.x + box.w / 2, cy0 = box.y + box.h / 2; ctx.translate(cx0, cy0); ctx.scale(s2, s2); ctx.translate(-cx0, -cy0); }
    if (en === 'wipe' && pin < 1) { ctx.beginPath(); ctx.rect(box.x - 20, box.y - 20, (box.w + 40) * e, box.h + 40); ctx.clip(); }
    if (o.place === 'pip' || o.place === 'free') {
      // printed-comic frame: hard offset shadow and a white border, no glow
      const s = Math.round(Math.min(W, H) * 0.012);
      ctx.fillStyle = '#111'; ctx.fillRect(box.x + s, box.y + s, box.w, box.h);
      ctx.fillStyle = '#fff'; ctx.fillRect(box.x - s / 2, box.y - s / 2, box.w + s, box.h + s);
    }
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    if (whole) {
      // behind the whole picture: itself, filling the box, blurred and darkened (no invented pixels)
      const kb = Math.max(box.w / sw, box.h / sh), bw = box.w / kb, bh = box.h / kb;
      ctx.filter = 'blur(18px) brightness(0.45)';
      ctx.drawImage(img, sx + (sw - bw) / 2, sy + (sh - bh) / 2, bw, bh, box.x - 20, box.y - 20, box.w + 40, box.h + 40);
      ctx.filter = 'none';
    }
    ctx.drawImage(img, cx, cy, cw, ch, dx, dy, dw, dh);
    if (en === 'wipe' && pin < 1) { ctx.restore(); ctx.save(); const xe = box.x + box.w * e; ctx.fillStyle = '#111'; ctx.fillRect(xe - 6, box.y, 12, box.h); }
    ctx.restore();
  }
}
