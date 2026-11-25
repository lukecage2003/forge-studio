import type { Project } from '../types';
import { clamp, easeOutBack, easeOutCubic, lerp } from '../lib/util';
import { notifyMedia } from './media';

/**
 * Channel identity: yellow + black, giant spaced condensed titles, the
 * channel logo bottom-left — used for the intro, chapter cards, end screen
 * and thumbnails, so every video looks like the same channel.
 */
export interface Brand { bg: string; ink: string; logo: string; intro: boolean; outro: boolean }
export const DEFAULT_BRAND: Brand = { bg: '#FFE500', ink: '#111111', logo: 'channel-logo.svg', intro: false, outro: false };
export const brandOf = (p: Project): Brand => ({ ...DEFAULT_BRAND, ...(p.brand ?? {}) });

const logos = new Map<string, HTMLImageElement>();
export function logoImage(src: string): HTMLImageElement | null {
  let im = logos.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => notifyMedia();
    im.src = src;
    logos.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

const TITLE_FONT = '"Anton", Impact, sans-serif';

/** big spaced title, fitted to a width, letters rising in one after another */
export function spacedTitle(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, maxH: number, ink: string, local = 99) {
  const t = text.toUpperCase();
  let size = maxH;
  const spacing = () => size * 0.16;
  const width = () => {
    ctx.font = `${size}px ${TITLE_FONT}`;
    let w = 0;
    for (const ch of t) w += ctx.measureText(ch).width + spacing();
    return w - spacing();
  };
  while (size > 10 && width() > maxW) size *= 0.95;
  ctx.font = `${size}px ${TITLE_FONT}`;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  let x = cx - width() / 2;
  [...t].forEach((ch, i) => {
    const a = easeOutCubic(clamp((local - i * 0.035) / 0.35, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillText(ch, x, cy + (1 - a) * size * 0.35);
    ctx.restore();
    x += ctx.measureText(ch).width + spacing();
  });
}

function drawLogo(ctx: CanvasRenderingContext2D, b: Brand, x: number, y: number, s: number) {
  const im = logoImage(b.logo);
  if (im) ctx.drawImage(im, x, y, s, s);
}

/** intro sting: the logo punches in on the brand colour */
export function drawIntro(ctx: CanvasRenderingContext2D, W: number, H: number, b: Brand, local: number) {
  ctx.fillStyle = b.bg;
  ctx.fillRect(0, 0, W, H);
  const s = Math.min(W, H) * 0.34 * lerp(0.4, 1, easeOutBack(clamp(local / 0.45, 0, 1)));
  ctx.save();
  ctx.globalAlpha = clamp(local / 0.15, 0, 1);
  drawLogo(ctx, b, W / 2 - s / 2, H / 2 - s / 2, s);
  ctx.restore();
}

/** chapter card: brand colour, giant spaced title, logo bottom-left */
export function drawChapter(ctx: CanvasRenderingContext2D, W: number, H: number, b: Brand, title: string, local: number) {
  ctx.fillStyle = b.bg;
  ctx.fillRect(0, 0, W, H);
  spacedTitle(ctx, title, W / 2, H * 0.46, W * 0.88, Math.min(W, H) * (W > H ? 0.26 : 0.16), b.ink, local);
  const ls = Math.min(W, H) * 0.12;
  drawLogo(ctx, b, Math.min(W, H) * 0.04, H - ls - Math.min(W, H) * 0.04, ls);
}

/** end screen (YouTube): call to action + two empty slots for YouTube's end-screen elements */
export function drawEndScreen(ctx: CanvasRenderingContext2D, W: number, H: number, b: Brand, local: number) {
  ctx.fillStyle = b.bg;
  ctx.fillRect(0, 0, W, H);
  spacedTitle(ctx, 'Abonne-toi', W / 2, H * 0.16, W * 0.7, Math.min(W, H) * 0.14, b.ink, local);
  const sw = W * 0.36, sh = sw * 9 / 16, y = H * 0.36;
  ctx.save();
  ctx.strokeStyle = b.ink;
  ctx.lineWidth = Math.max(3, W * 0.003);
  ctx.setLineDash([W * 0.012, W * 0.008]);
  ctx.strokeRect(W * 0.08, y, sw, sh);
  ctx.strokeRect(W - W * 0.08 - sw, y, sw, sh);
  ctx.restore();
  const ls = Math.min(W, H) * 0.2;
  drawLogo(ctx, b, W / 2 - ls / 2, y + sh / 2 - ls / 2, ls);
}

/* ------------------------------------------------------------ thumbnails */

/** how clean a cut-out is: one solid figure (1) vs. scattered fragments (0) */
export function cutoutQuality(c: HTMLCanvasElement): number {
  const S = Math.min(1, 160 / Math.max(c.width, c.height));
  const w = Math.max(4, Math.round(c.width * S)), h = Math.max(4, Math.round(c.height * S));
  const t = document.createElement('canvas');
  t.width = w; t.height = h;
  const x = t.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  let total = 0;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 128) { on[i] = 1; total++; }
  if (total < w * h * 0.04) return 0;
  const lab = new Uint8Array(w * h), st = new Int32Array(w * h);
  let biggest = 0;
  for (let i = 0; i < w * h; i++) {
    if (!on[i] || lab[i]) continue;
    let sp = 0, n = 0;
    st[sp++] = i; lab[i] = 1;
    while (sp) {
      const k = st[--sp], y = (k / w) | 0, xx = k - y * w;
      n++;
      for (const q of [xx > 0 ? k - 1 : -1, xx < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) if (q >= 0 && on[q] && !lab[q]) { lab[q] = 1; st[sp++] = q; }
    }
    biggest = Math.max(biggest, n);
  }
  // edge roughness: opaque pixels touching transparency, relative to the figure size
  let edge = 0;
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    const i = y * w + xx;
    if (on[i] && (!on[i - 1] || !on[i + 1] || !on[i - w] || !on[i + w])) edge++;
  }
  const solid = biggest / total;
  const smooth = Math.min(1, (4 * Math.sqrt(total)) / Math.max(1, edge));
  // a figure never fills its box; a near-rectangle is a piece of panel or a caption, not a character
  const fill = total / (w * h);
  const shape = fill > 0.8 ? 0.3 : fill > 0.72 ? 0.7 : 1;
  return (solid * 0.7 + smooth * 0.3) * shape;
}

/** crop a cut-out to its visible pixels (and drop tiny specks) */
export function trimAlpha(c: HTMLCanvasElement): HTMLCanvasElement {
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y += 2) for (let xx = 0; xx < c.width; xx += 2) {
    if (d[(y * c.width + xx) * 4 + 3] > 128) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return c;
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 2; o.height = y1 - y0 + 2;
  o.getContext('2d')!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

/** white sticker outline + soft shadow around a cut-out */
export function sticker(cut: HTMLCanvasElement, outline: number): HTMLCanvasElement {
  const pad = Math.ceil(outline * 2);
  const c = document.createElement('canvas');
  c.width = cut.width + pad * 2; c.height = cut.height + pad * 2;
  const x = c.getContext('2d')!;
  const sil = document.createElement('canvas');
  sil.width = c.width; sil.height = c.height;
  const sx = sil.getContext('2d')!;
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    sx.drawImage(cut, pad + Math.cos(ang) * outline, pad + Math.sin(ang) * outline);
  }
  sx.globalCompositeOperation = 'source-in';
  sx.fillStyle = '#fff';
  sx.fillRect(0, 0, sil.width, sil.height);
  x.shadowColor = 'rgba(0,0,0,0.35)';
  x.shadowBlur = outline * 2.5;
  x.shadowOffsetY = outline;
  x.drawImage(sil, 0, 0);
  x.shadowColor = 'transparent';
  x.drawImage(cut, pad, pad);
  return c;
}

export type ThumbLayout = 'duo' | 'solo' | 'face' | 'right';

/** 1280×720 thumbnail in the channel style */
export function drawThumbnail(b: Brand, title: string, layout: ThumbLayout, a: HTMLCanvasElement | null, c2: HTMLCanvasElement | null): HTMLCanvasElement {
  const W = 1280, H = 720;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = b.bg;
  x.fillRect(0, 0, W, H);
  spacedTitle(x, title, W / 2, 135, W * 0.86, 190, b.ink);
  const place = (s: HTMLCanvasElement, cx: number, bottom: number, h: number) => {
    const k = h / s.height;
    const w = s.width * k;
    x.drawImage(s, cx - w / 2, bottom - h, w, h);
  };
  // characters big and low, overlapping the bottom edge, like a poster
  if (layout === 'solo' && a) place(a, W / 2, H + 40, H * 0.8);
  else if (layout === 'right' && a) place(a, W * 0.68, H + 40, H * 0.86);
  else if (a && c2) { place(a, W * 0.25, H + 30, H * 0.72); place(c2, W * 0.7, H + 40, H * 0.86); }
  else if (a) place(a, W * 0.62, H + 30, H * 0.74);
  drawLogo(x, b, 28, H - 148, 120);
  return cv;
}
