import type { Overlay, OverlayPlace, Project } from '../types';
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

export const PLACE_FR: Record<OverlayPlace, string> = { full: 'Plein écran', pip: 'Incrustation', top: 'Moitié haute', bottom: 'Moitié basse', left: 'Moitié gauche', right: 'Moitié droite' };

/** pure: where an overlay sits in a W×H frame */
export function placeBox(place: OverlayPlace, W: number, H: number): Box {
  const m = Math.round(Math.min(W, H) * 0.04);
  switch (place) {
    case 'full': return { x: 0, y: 0, w: W, h: H };
    case 'top': return { x: 0, y: 0, w: W, h: H / 2 };
    case 'bottom': return { x: 0, y: H / 2, w: W, h: H / 2 };
    case 'left': return { x: 0, y: 0, w: W / 2, h: H };
    case 'right': return { x: W / 2, y: 0, w: W / 2, h: H };
    case 'pip': { const w = Math.round(W * 0.42), h = Math.round(w * (H > W ? 1.25 : 0.62)); return { x: W - w - m, y: Math.round(H * 0.16), w, h }; }
  }
}

/** pure: the overlays visible at t, lower tracks first (drawn first, so higher tracks cover them) */
export function activeOverlays(p: Project, t: number): Overlay[] {
  return (p.overlays ?? []).filter((o) => t >= o.start && t < o.start + o.duration).sort((a, b) => a.track - b.track || a.start - b.start);
}

/** pure: opacity of an overlay at t (fades in and out over `fade` seconds) */
export function overlayAlpha(o: Overlay, t: number): number {
  const local = t - o.start;
  if (local < 0 || local >= o.duration) return 0;
  const f = Math.min(o.fade, o.duration / 2);
  if (f <= 0) return 1;
  return Math.min(1, local / f, (o.duration - local) / f);
}

/** where the video overlay is in its source file at t */
export const overlaySourceTime = (o: Overlay, t: number) => (o.source.kind === 'video' ? o.source.offset + (t - o.start) : 0);

export function drawOverlays(ctx: Ctx, p: Project, t: number, W: number, H: number, video?: OverlayVideoSource) {
  for (const o of activeOverlays(p, t)) {
    const a = overlayAlpha(o, t);
    if (a <= 0) continue;
    let img: CanvasImageSource | null = null, sx = 0, sy = 0, sw = 0, sh = 0;
    if (o.source.kind === 'panel') {
      const src = o.source;
      const page = p.pages.find((pg) => pg.id === src.pageId);
      const asset = page && getImage(page.mediaId);
      if (!asset) continue;
      img = asset.img;
      sx = (src.rect.x / 100) * asset.width; sy = (src.rect.y / 100) * asset.height;
      sw = Math.max(1, (src.rect.w / 100) * asset.width); sh = Math.max(1, (src.rect.h / 100) * asset.height);
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
    const box = placeBox(o.place, W, H);
    // cover-fit the source in its box, centred; a slow push-in over the overlay's life
    const z = 1 + 0.08 * o.zoom * ((t - o.start) / Math.max(0.5, o.duration));
    const k = Math.max(box.w / sw, box.h / sh) * z;
    const cw = box.w / k, ch = box.h / k;
    const cx = sx + (sw - cw) / 2, cy = sy + (sh - ch) / 2;
    ctx.save();
    ctx.globalAlpha = a;
    if (o.place === 'pip') {
      // printed-comic frame: hard offset shadow and a white border, no glow
      const s = Math.round(Math.min(W, H) * 0.012);
      ctx.fillStyle = '#111'; ctx.fillRect(box.x + s, box.y + s, box.w, box.h);
      ctx.fillStyle = '#fff'; ctx.fillRect(box.x - s / 2, box.y - s / 2, box.w + s, box.h + s);
    }
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx, cy, cw, ch, box.x, box.y, box.w, box.h);
    ctx.restore();
  }
}
