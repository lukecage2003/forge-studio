import { FORMATS, type Caption, type Layout, type Project, type Rect, type Shot } from '../types';
import { clamp, easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic, lerp } from '../lib/util';
import { getImage } from './media';
import { layoutShots, overlayMode, segmentsOf, shotAt, type TimedShot } from './timeline';
import { toSource, type Seg } from './speech';

type Ctx = CanvasRenderingContext2D;
interface View { cx: number; cy: number; vw: number } // view rect in page px, aspect = box aspect
interface Box { x: number; y: number; w: number; h: number }

export const FONT_STACK = {
  anton: '"Anton", Impact, sans-serif',
  bangers: '"Bangers", "Comic Sans MS", cursive',
  inter: '"Inter Variable", Inter, system-ui, sans-serif',
  grotesk: '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif',
};

export async function loadFonts() {
  await Promise.all([
    document.fonts.load(`80px ${FONT_STACK.anton}`),
    document.fonts.load(`80px ${FONT_STACK.bangers}`),
    document.fonts.load(`700 80px ${FONT_STACK.inter}`),
    document.fonts.load(`700 80px ${FONT_STACK.grotesk}`),
  ]).catch(() => {});
}

/** Provides the face-cam frame for a given source time. */
export type FaceSource = (src: number) => CanvasImageSource | null;

/* ---------------------------------------------------------------- camera */

export function resolveMotion(shot: Shot, aspect: number, rtl: boolean) {
  if (shot.motion !== 'auto') return { motion: shot.motion, framing: shot.framing };
  const ratio = shot.rect.w / shot.rect.h / aspect;
  if (ratio > 1.35) return { motion: rtl ? 'pan-left' : 'pan-right', framing: 'fill' as const };
  if (ratio < 1 / 1.35) return { motion: 'pan-down' as const, framing: 'fill' as const };
  return { motion: 'zoom-in' as const, framing: shot.framing };
}

function baseView(r: Rect, aspect: number, framing: 'fit' | 'fill', pad = 1.08): View {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (framing === 'fill') return { cx, cy, vw: Math.min(r.w, r.h * aspect) };
  return { cx, cy, vw: Math.max(r.w * pad, r.h * pad * aspect) };
}

export function cameraAt(shot: Shot, p: number, aspect: number, rtl: boolean, r: Rect = shot.rect): View {
  const { motion, framing } = resolveMotion({ ...shot, rect: r }, aspect, rtl);
  const v = baseView(r, aspect, framing);
  const vh = v.vw / aspect;
  const k = shot.intensity;
  const e = easeInOutSine(clamp(p, 0, 1));
  switch (motion) {
    case 'zoom-in': return { ...v, vw: v.vw * lerp(1, 1 - 0.22 * k, e) };
    case 'zoom-out': return { ...v, vw: v.vw * lerp(1 - 0.22 * k, 1, e) };
    case 'pan-left':
    case 'pan-right': {
      const span = r.w - v.vw;
      const range = span > 1 ? span / 2 : v.vw * 0.06 * k;
      const d = motion === 'pan-right' ? lerp(-range, range, e) : lerp(range, -range, e);
      return { ...v, cx: v.cx + d };
    }
    case 'pan-up':
    case 'pan-down': {
      const span = r.h - vh;
      const range = span > 1 ? span / 2 : vh * 0.06 * k;
      const d = motion === 'pan-down' ? lerp(-range, range, e) : lerp(range, -range, e);
      return { ...v, cy: v.cy + d };
    }
    default: return v;
  }
}

/* ------------------------------------------------------------ textures */

const halftoneCache = new Map<string, HTMLCanvasElement>();
function halftone(W: number, H: number, accent: string) {
  const key = `${W}x${H}:${accent}`;
  let c = halftoneCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#101014');
  g.addColorStop(1, '#07070a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, Math.max(W, H) * 0.8);
  glow.addColorStop(0, hexA(accent, 0.22));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  // halftone dots, bigger towards the top-right glow
  const step = Math.max(10, Math.round(Math.min(W, H) / 70));
  x.fillStyle = 'rgba(255,255,255,0.05)';
  for (let yy = 0; yy < H + step; yy += step) {
    for (let xx = (yy / step) % 2 ? step / 2 : 0; xx < W + step; xx += step) {
      const d = Math.hypot(xx - W * 0.85, yy - H * 0.1) / Math.max(W, H);
      const r = step * 0.42 * clamp(1 - d * 1.1, 0.08, 1);
      x.beginPath();
      x.arc(xx, yy, r, 0, Math.PI * 2);
      x.fill();
    }
  }
  halftoneCache.set(key, c);
  return c;
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* --------------------------------------------------------- drawing kit */

function clipBox(ctx: Ctx, b: Box, r = 0) {
  ctx.beginPath();
  if (r > 0) ctx.roundRect(b.x, b.y, b.w, b.h, r);
  else ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
}

function drawBackground(ctx: Ctx, project: Project, box: Box, pageId: string | null, region: Rect | null) {
  const page = pageId ? project.pages.find((p) => p.id === pageId) : null;
  const asset = page && getImage(page.mediaId);
  if (project.background === 'color' || !asset || !region) {
    if (project.background === 'halftone' || !asset) {
      ctx.drawImage(halftone(Math.round(box.w), Math.round(box.h), project.accent), box.x, box.y, box.w, box.h);
    } else {
      ctx.fillStyle = project.bgColor;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    return;
  }
  if (project.background === 'halftone') {
    ctx.drawImage(halftone(Math.round(box.w), Math.round(box.h), project.accent), box.x, box.y, box.w, box.h);
    return;
  }
  if (project.background === 'blur' || project.background === 'page') {
    const b = asset.blur;
    const bx = (region.x / asset.width) * b.width, by = (region.y / asset.height) * b.height;
    const bw = (region.w / asset.width) * b.width, bh = (region.h / asset.height) * b.height;
    const sc = Math.max(box.w / bw, box.h / bh) * 1.15;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b, bx, by, bw, bh, box.x + box.w / 2 - (bw * sc) / 2, box.y + box.h / 2 - (bh * sc) / 2, bw * sc, bh * sc);
    ctx.fillStyle = 'rgba(8,8,10,0.5)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
}

/** Draw a panel of a page inside `box`, seen through `view`, clipped to `clip`. */
function drawPanelIn(ctx: Ctx, project: Project, pageId: string, box: Box, view: View, clip: Rect, opts: { bg?: boolean; dimPage?: number; border?: number } = {}) {
  const page = project.pages.find((p) => p.id === pageId);
  const asset = page && getImage(page.mediaId);
  ctx.save();
  clipBox(ctx, box);
  if (opts.bg !== false) drawBackground(ctx, project, box, pageId, clip);
  if (!asset) { ctx.restore(); return; }
  const s = box.w / view.vw;
  ctx.translate(box.x + box.w / 2 - view.cx * s, box.y + box.h / 2 - view.cy * s);
  ctx.scale(s, s);
  if (opts.dimPage) {
    ctx.drawImage(asset.img, 0, 0);
    ctx.fillStyle = `rgba(6,6,8,${opts.dimPage})`;
    ctx.fillRect(0, 0, asset.width, asset.height);
  }
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 44 / s;
  ctx.shadowOffsetY = 12 / s;
  ctx.fillStyle = '#000';
  ctx.fillRect(clip.x, clip.y, clip.w, clip.h);
  ctx.shadowColor = 'transparent';
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(asset.img, 0, 0);
  ctx.restore();
  if (opts.border) {
    ctx.lineWidth = opts.border / s;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(clip.x, clip.y, clip.w, clip.h);
  }
  ctx.restore();
}

/** Face cam: cover-fit around the focus point, with jump-cut punch-ins and slow drift. */
function drawFace(ctx: Ctx, project: Project, box: Box, face: FaceSource, segs: Seg[], t: number, radius = 0) {
  const ar = project.aroll;
  ctx.save();
  clipBox(ctx, box, radius);
  ctx.fillStyle = '#000';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (!ar || !segs.length) { ctx.restore(); return; }
  const { src, i, local } = toSource(segs, t);
  const img = face(src);
  if (img) {
    const vw = ar.width, vh = ar.height;
    let z = 1;
    if (ar.punchIn > 0) z *= [1, 1 + 0.16 * ar.punchIn, 1 + 0.07 * ar.punchIn][i % 3];
    const segLen = segs[i].e - segs[i].s;
    if (ar.drift > 0) z *= 1 + 0.05 * ar.drift * clamp(local / Math.max(segLen, 0.5), 0, 1);
    const sc = Math.max(box.w / vw, box.h / vh) * z;
    const dw = vw * sc, dh = vh * sc;
    // place focus point at ~ centre (slightly above for headroom), clamped to cover the box
    const fx = ar.focus.x * dw, fy = ar.focus.y * dh;
    let ox = box.x + box.w / 2 - fx;
    let oy = box.y + box.h * 0.42 - fy;
    ox = clamp(ox, box.x + box.w - dw, box.x);
    oy = clamp(oy, box.y + box.h - dh, box.y);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, ox, oy, dw, dh);
  }
  ctx.restore();
}

function drawTitleCard(ctx: Ctx, W: number, H: number, shot: Shot, local: number, accent: string) {
  ctx.fillStyle = shot.titleBg || '#0E0E11';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.5, H * (0.55 - local * 0.01), 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
  g.addColorStop(0, hexA(accent, 0.22));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* -------------------------------------------------------------- captions */

function wrap(ctx: Ctx, text: string, maxW: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out;
}

const PRESET = {
  tiktok: { font: FONT_STACK.anton, weight: '400', upper: true, fill: '#FFFFFF', stroke: '#000000' as string | null, strokeW: 0.16, hi: '#FFE14D', box: null as null | string, rot: 0, lh: 1.08, scale: 1, glow: false },
  comic: { font: FONT_STACK.bangers, weight: '400', upper: true, fill: '#111111', stroke: null, strokeW: 0, hi: '#D7261E', box: '#FFE14D', rot: -1.5, lh: 1.1, scale: 0.9, glow: false },
  clean: { font: FONT_STACK.inter, weight: '700', upper: false, fill: '#FFFFFF', stroke: null, strokeW: 0, hi: '#FFB020', box: 'rgba(10,10,12,0.66)', rot: 0, lh: 1.25, scale: 0.72, glow: false },
  impact: { font: FONT_STACK.bangers, weight: '400', upper: true, fill: '#FFD400', stroke: '#000000', strokeW: 0.14, hi: '#FF5A1F', box: null, rot: -4, lh: 1.0, scale: 1.45, glow: false },
  cinema: { font: FONT_STACK.grotesk, weight: '600', upper: false, fill: '#FFFFFF', stroke: null, strokeW: 0, hi: '#FFB020', box: null, rot: 0, lh: 1.25, scale: 0.6, glow: false },
  neon: { font: FONT_STACK.grotesk, weight: '700', upper: true, fill: '#FFFFFF', stroke: null, strokeW: 0, hi: '#FF5A1F', box: null, rot: 0, lh: 1.1, scale: 0.85, glow: true },
};

/**
 * Draw a caption. `wordTimes` (seconds, relative to `local` origin) drives the
 * karaoke highlight precisely when the words come from a transcript.
 */
export function drawCaption(ctx: Ctx, W: number, H: number, cap: Caption, local: number, dur: number, isTitle = false, wordTimes?: number[], accent = '#FF5A1F') {
  const raw = cap.text.trim();
  if (!raw) return;
  const P = PRESET[cap.preset] ?? PRESET.tiktok;
  const hiColor = cap.preset === 'neon' || cap.preset === 'impact' ? accent : P.hi;
  const text = P.upper ? raw.toUpperCase() : raw;
  const size = Math.min(W, H) * 0.075 * cap.size * P.scale * (isTitle ? 1.4 : 1);
  ctx.save();
  ctx.font = `${P.weight} ${size}px ${P.font}`;
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, W * (P.box ? 0.76 : 0.84));
  const lh = size * P.lh;
  const blockH = lines.length * lh;
  const y0 = isTitle ? H / 2 : clamp(cap.y, 0.06, 0.94) * H;

  let scale = 1, alpha = 1, chars = Infinity, wordsShown = Infinity, hiWord = -1;
  const allWords = lines.join(' ').split(' ').length;
  switch (cap.anim) {
    case 'pop': {
      scale = lerp(0.55, 1, easeOutBack(clamp(local / 0.3, 0, 1)));
      alpha = clamp(local / 0.1, 0, 1);
      break;
    }
    case 'type': {
      const span = Math.min(dur * 0.6, text.length * 0.035);
      chars = Math.floor(text.length * clamp(local / Math.max(span, 0.01), 0, 1));
      break;
    }
    case 'words': {
      if (wordTimes?.length) {
        let k = 0;
        while (k < wordTimes.length && wordTimes[k] <= local) k++;
        wordsShown = Math.max(1, k);
        hiWord = wordsShown - 1;
        scale = lerp(0.85, 1, easeOutBack(clamp(local / 0.18, 0, 1)));
      } else {
        const per = (dur * 0.85) / allWords;
        wordsShown = Math.min(allWords, Math.floor(local / per) + 1);
        hiWord = wordsShown - 1;
      }
      break;
    }
  }

  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, y0);
  ctx.rotate((P.rot * Math.PI) / 180);
  ctx.scale(scale, scale);

  if (P.box) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = size * 0.5, padY = size * 0.32;
    const bw = widest + padX * 2, bh = blockH + padY * 2;
    if (cap.preset === 'comic') {
      ctx.fillStyle = '#000';
      ctx.fillRect(-bw / 2 + size * 0.1, -bh / 2 + size * 0.1, bw, bh);
      ctx.fillStyle = P.box;
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.lineWidth = size * 0.07;
      ctx.strokeStyle = '#000';
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    } else {
      ctx.fillStyle = P.box;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, size * 0.35);
      ctx.fill();
    }
  } else if (cap.preset === 'cinema') {
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = size * 0.35;
  }

  let charCount = 0, wordIdx = 0;
  const space = ctx.measureText(' ').width;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const y = -blockH / 2 + lh * (li + 0.5);
    const words = line.split(' ');
    let x = -ctx.measureText(line).width / 2;
    for (let wi = 0; wi < words.length; wi++) {
      if (wordIdx >= wordsShown || charCount >= chars) break;
      let w = words[wi];
      const ww = ctx.measureText(w).width;
      if (charCount + w.length > chars) w = w.slice(0, chars - charCount);
      charCount += words[wi].length + 1;
      const isHi = wordIdx === hiWord && cap.anim === 'words';
      let ws = 1;
      if (isHi) {
        const t0 = wordTimes?.[hiWord] ?? hiWord * ((dur * 0.85) / allWords);
        ws = lerp(1.18, 1, easeOutCubic(clamp((local - t0) / 0.16, 0, 1)));
      }
      ctx.save();
      ctx.translate(x + ww / 2, y);
      ctx.scale(ws, ws);
      ctx.textAlign = 'center';
      if (P.glow) {
        ctx.shadowColor = isHi ? hiColor : 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = size * (isHi ? 0.5 : 0.3);
      }
      if (P.stroke) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * P.strokeW;
        ctx.strokeStyle = P.stroke;
        if (cap.preset === 'impact') { ctx.fillStyle = '#000'; ctx.fillText(w, size * 0.07, size * 0.07); }
        ctx.strokeText(w, 0, 0);
      }
      ctx.fillStyle = isHi ? hiColor : P.fill;
      ctx.fillText(w, 0, 0);
      ctx.restore();
      x += ww + space;
      wordIdx++;
    }
  }
  ctx.restore();
}

function drawNameTag(ctx: Ctx, W: number, H: number, text: string, local: number, dur: number, accent: string) {
  if (!text?.trim()) return;
  const inA = easeOutCubic(clamp(local / 0.35, 0, 1));
  const outA = 1 - easeInOutCubic(clamp((local - (dur - 0.3)) / 0.3, 0, 1));
  const a = Math.min(inA, outA);
  if (a <= 0) return;
  const size = Math.min(W, H) * 0.038;
  const vertical = H > W;
  const x = W * 0.06, y = vertical ? H * 0.14 : H * 0.8;
  ctx.save();
  ctx.font = `700 ${size}px ${FONT_STACK.grotesk}`;
  const tw = ctx.measureText(text.toUpperCase()).width;
  const pad = size * 0.55;
  ctx.globalAlpha = a;
  ctx.translate(lerp(-tw * 0.3, 0, inA), 0);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y - size * 0.95, size * 0.22, size * 1.9);
  ctx.fillStyle = 'rgba(8,8,10,0.86)';
  ctx.fillRect(x + size * 0.22, y - size * 0.95, (tw + pad * 2) * inA, size * 1.9);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), x + size * 0.22 + pad, y + size * 0.04);
  ctx.restore();
}

function drawWatermark(ctx: Ctx, W: number, H: number, text: string) {
  if (!text?.trim()) return;
  const size = Math.min(W, H) * 0.028;
  ctx.save();
  ctx.font = `600 ${size}px ${FONT_STACK.grotesk}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = size * 0.4;
  ctx.fillText(text, W - size * 1.2, size * 1.2 + (H > W ? H * 0.06 : 0));
  ctx.restore();
}

/* ------------------------------------------------------------ the frame */

export interface Renderer {
  W: number;
  H: number;
  draw(ctx: Ctx, project: Project, t: number, face?: FaceSource): void;
}

function makeBuf(W: number, H: number) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

function shakeOffset(shot: Shot, local: number, W: number) {
  if (!shot.shake || local > 0.45) return [0, 0];
  const d = Math.pow(1 - local / 0.45, 2) * shot.shake * W * 0.025;
  return [Math.sin(local * 71) * d, Math.cos(local * 53) * d];
}

type State = { kind: 'face' } | { kind: 'shot'; ts: TimedShot } | { kind: 'empty' };

export function effectiveLayout(shot: Shot, hasFace: boolean): Layout {
  if (!hasFace && (shot.layout === 'split' || shot.layout === 'pip')) return 'full';
  if (shot.layout === 'grid' && !shot.group?.length) return 'full';
  return shot.layout;
}

export function createRenderer(W: number, H: number): Renderer {
  const A = makeBuf(W, H), B = makeBuf(W, H);
  const actx = A.getContext('2d')!, bctx = B.getContext('2d')!;
  const vertical = H > W;
  const noFace: FaceSource = () => null;

  /** one comic shot, composed according to its layout */
  function renderShot(ctx: Ctx, project: Project, ts: TimedShot, t: number, face: FaceSource, segs: Seg[], motionStart = 0, override?: { view: View; clip: Rect }) {
    const shot = ts.shot;
    const local = t - ts.start;
    const rtl = project.readingOrder === 'rtl';
    const hasFace = !!project.aroll && segs.length > 0;
    const layoutKind = shot.pageId == null ? 'title' : effectiveLayout(shot, hasFace);
    const [sx, sy] = shakeOffset(shot, local, W);
    const p = (local - motionStart) / Math.max(0.01, shot.duration - motionStart);
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(sx, sy);
    const full: Box = { x: 0, y: 0, w: W, h: H };

    switch (layoutKind) {
      case 'title':
        if (shot.titleBg === 'face' && hasFace) {
          drawFace(ctx, project, full, face, segs, t);
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, 'rgba(0,0,0,0.15)');
          g.addColorStop(0.5, 'rgba(0,0,0,0.55)');
          g.addColorStop(1, 'rgba(0,0,0,0.15)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        } else drawTitleCard(ctx, W, H, shot, local, project.accent);
        break;
      case 'full': {
        const view = override?.view ?? cameraAt(shot, p, W / H, rtl);
        drawPanelIn(ctx, project, shot.pageId!, full, view, override?.clip ?? shot.rect, { dimPage: project.background === 'page' ? 0.72 : 0 });
        break;
      }
      case 'pip': {
        const view = cameraAt(shot, p, W / H, rtl);
        drawPanelIn(ctx, project, shot.pageId!, full, view, shot.rect);
        const r = Math.min(W, H) * (vertical ? 0.2 : 0.17);
        const cx = vertical ? W * 0.27 : W * 0.86, cy = vertical ? H * 0.62 : H * 0.76;
        const pop = easeOutBack(clamp(local / 0.35, 0, 1));
        const rr = r * pop;
        if (rr > 1) {
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = r * 0.3;
          ctx.fillStyle = project.accent;
          ctx.beginPath();
          ctx.arc(cx, cy, rr + r * 0.06, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          drawFace(ctx, project, { x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 }, face, segs, t, rr);
        }
        break;
      }
      case 'split': {
        const e = easeOutCubic(clamp(local / 0.4, 0, 1));
        const panelBox: Box = vertical ? { x: 0, y: 0, w: W, h: H * 0.56 } : { x: 0, y: 0, w: W * 0.6, h: H };
        const faceBox: Box = vertical ? { x: 0, y: H * 0.56, w: W, h: H * 0.44 } : { x: W * 0.6, y: 0, w: W * 0.4, h: H };
        // panel slides in
        ctx.save();
        if (vertical) ctx.translate(0, -panelBox.h * (1 - e) * 0.25); else ctx.translate(-panelBox.w * (1 - e) * 0.15, 0);
        ctx.globalAlpha = e;
        const view = cameraAt(shot, p, panelBox.w / panelBox.h, rtl);
        drawPanelIn(ctx, project, shot.pageId!, panelBox, view, shot.rect);
        ctx.restore();
        drawFace(ctx, project, faceBox, face, segs, t);
        ctx.fillStyle = project.accent;
        if (vertical) ctx.fillRect(0, panelBox.h - H * 0.003, W, H * 0.006);
        else ctx.fillRect(panelBox.w - W * 0.002, 0, W * 0.004, H);
        break;
      }
      case 'grid': {
        ctx.drawImage(halftone(W, H, project.accent), 0, 0);
        const items = [{ pageId: shot.pageId!, rect: shot.rect }, ...(shot.group ?? [])].slice(0, 4);
        const n = items.length;
        const m = Math.min(W, H) * 0.05, gap = Math.min(W, H) * 0.035;
        const cols = vertical ? (n === 4 ? 2 : 1) : (n === 4 ? 2 : n);
        const rows = Math.ceil(n / cols);
        const cw = (W - m * 2 - gap * (cols - 1)) / cols, ch = (H - m * 2 - gap * (rows - 1)) / rows;
        const z = 1 + 0.035 * easeInOutSine(clamp(p, 0, 1));
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(z, z);
        ctx.translate(-W / 2, -H / 2);
        items.forEach((it, k) => {
          const a = easeOutCubic(clamp((local - k * 0.18) / 0.4, 0, 1));
          if (a <= 0) return;
          const cx = m + (k % cols) * (cw + gap), cy = m + Math.floor(k / cols) * (ch + gap);
          // fit the panel inside its cell, keep its own aspect
          const ra = it.rect.w / it.rect.h, ca = cw / ch;
          const bw = ra > ca ? cw : ch * ra, bh = ra > ca ? cw / ra : ch;
          const box: Box = { x: cx + (cw - bw) / 2, y: cy + (ch - bh) / 2 + (1 - a) * ch * 0.12, w: bw, h: bh };
          ctx.save();
          ctx.globalAlpha = a;
          ctx.shadowColor = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = gap;
          ctx.shadowOffsetY = gap * 0.3;
          ctx.fillStyle = '#fff';
          const bd = Math.max(3, Math.min(W, H) * 0.006);
          ctx.fillRect(box.x - bd, box.y - bd, box.w + bd * 2, box.h + bd * 2);
          ctx.shadowColor = 'transparent';
          drawPanelIn(ctx, project, it.pageId, box, { cx: it.rect.x + it.rect.w / 2, cy: it.rect.y + it.rect.h / 2, vw: it.rect.w }, it.rect, { bg: false });
          ctx.restore();
        });
        ctx.restore();
        break;
      }
      case 'page': {
        const page = project.pages.find((x) => x.id === shot.pageId)!;
        ctx.drawImage(halftone(W, H, project.accent), 0, 0);
        const whole: View = baseView({ x: 0, y: 0, w: page.width, h: page.height }, W / H, 'fit', 1.12);
        const tight: View = baseView(shot.rect, W / H, 'fit', 1.5);
        const e = easeInOutCubic(clamp((p - 0.05) / 0.75, 0, 1));
        const target = { cx: lerp(whole.cx, tight.cx, 0.55), cy: lerp(whole.cy, tight.cy, 0.55), vw: lerp(whole.vw, Math.max(tight.vw, whole.vw * 0.55), 1) };
        const view = { cx: lerp(whole.cx, target.cx, e), cy: lerp(whole.cy, target.cy, e), vw: lerp(whole.vw, target.vw, e) };
        const dim = lerp(0.15, 0.68, clamp(local / 0.6, 0, 1));
        drawPanelIn(ctx, project, page.id, full, view, shot.rect, { bg: false, dimPage: dim, border: Math.min(W, H) * 0.006 });
        break;
      }
    }
    ctx.restore();
    if (shot.pageId == null) {
      drawCaption(ctx, W, H, shot.caption, local, shot.duration, true, undefined, project.accent);
    } else {
      drawCaption(ctx, W, H, shot.caption, local, shot.duration, false, undefined, project.accent);
      if (shot.nameTag) drawNameTag(ctx, W, H, shot.nameTag, local, shot.duration, project.accent);
    }
  }

  function renderState(ctx: Ctx, project: Project, st: State, t: number, face: FaceSource, segs: Seg[]) {
    if (st.kind === 'shot') renderShot(ctx, project, st.ts, t, face, segs);
    else if (st.kind === 'face') drawFace(ctx, project, { x: 0, y: 0, w: W, h: H }, face, segs, t);
    else { ctx.fillStyle = '#0B0B0D'; ctx.fillRect(0, 0, W, H); }
  }

  function overlays(ctx: Ctx, project: Project, t: number, total: number, st: State) {
    // subtitles from the transcript
    if (project.subtitleStyle.on && project.subtitles.length) {
      const sub = project.subtitles.find((s) => t >= s.s && t < s.e);
      if (sub) {
        const lay = st.kind === 'shot' && st.ts.shot.pageId ? effectiveLayout(st.ts.shot, !!project.aroll) : null;
        const hasShotCaption = st.kind === 'shot' && st.ts.shot.caption.text.trim();
        if (!hasShotCaption) {
          const y = lay === 'split' && vertical ? 0.56 : project.subtitleStyle.y;
          const cap: Caption = { ...project.subtitleStyle, text: sub.text, y };
          drawCaption(ctx, W, H, cap, t - sub.s, sub.e - sub.s, false, sub.words.map((w) => w.s - sub.s), project.accent);
        }
      }
    }
    if (project.progressBar && total > 0) {
      const h = Math.max(4, Math.min(W, H) * 0.007);
      const y = vertical ? 0 : H - h;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, y, W, h);
      ctx.fillStyle = project.accent;
      ctx.fillRect(0, y, W * clamp(t / total, 0, 1), h);
    }
    drawWatermark(ctx, W, H, project.watermark);
  }

  return {
    W, H,
    draw(ctx, project, t, face = noFace) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      const segs = segmentsOf(project.aroll);
      const overlay = overlayMode(project);
      const timed = layoutShots(project);
      const total = Math.max(timed.reduce((m, x) => Math.max(m, x.end), 0), segs.reduce((a, g) => a + g.e - g.s, 0));
      const stateAt = (tt: number): State => {
        const ts = shotAt(timed, tt, overlay);
        if (ts) return { kind: 'shot', ts };
        return overlay && segs.length ? { kind: 'face' } : { kind: 'empty' };
      };
      const cur = stateAt(t);
      if (cur.kind !== 'shot') {
        renderState(ctx, project, cur, t, face, segs);
        overlays(ctx, project, t, total, cur);
        return;
      }
      const shot = cur.ts.shot;
      const local = t - cur.ts.start;
      const td = Math.min(shot.transitionDur, shot.duration * 0.9);
      const prev = stateAt(cur.ts.start - 1e-4);
      const sameShot = prev.kind === 'shot' && prev.ts.shot.id === shot.id;
      const inTrans = shot.transition !== 'cut' && local < td && !sameShot && prev.kind !== 'empty';
      const rtl = project.readingOrder === 'rtl';
      const prevShot = prev.kind === 'shot' ? prev.ts.shot : null;
      const glideOk = shot.transition === 'glide' && prevShot?.pageId && prevShot.pageId === shot.pageId
        && effectiveLayout(shot, !!project.aroll) === 'full' && effectiveLayout(prevShot, !!project.aroll) === 'full';

      if (!inTrans) {
        renderShot(ctx, project, cur.ts, t, face, segs, glideOk ? td : 0);
        overlays(ctx, project, t, total, cur);
        return;
      }
      const a = clamp(local / td, 0, 1);
      if (glideOk && prev.kind === 'shot') {
        const e = easeInOutCubic(a);
        const v0 = cameraAt(prev.ts.shot, 1, W / H, rtl), v1 = cameraAt(shot, 0, W / H, rtl);
        const view = { cx: lerp(v0.cx, v1.cx, e), cy: lerp(v0.cy, v1.cy, e), vw: lerp(v0.vw, v1.vw, e) };
        const r0 = prev.ts.shot.rect, r1 = shot.rect;
        const clip = { x: lerp(r0.x, r1.x, e), y: lerp(r0.y, r1.y, e), w: lerp(r0.w, r1.w, e), h: lerp(r0.h, r1.h, e) };
        renderShot(ctx, project, { ...cur.ts, shot: { ...shot, caption: { ...shot.caption, text: a > 0.5 ? shot.caption.text : '' }, shake: 0, nameTag: undefined } }, t, face, segs, 0, { view, clip });
        overlays(ctx, project, t, total, cur);
        return;
      }
      renderState(actx, project, prev, t, face, segs);
      renderShot(bctx, project, cur.ts, t, face, segs);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const kind = shot.transition === 'glide' ? 'slide' : shot.transition;
      const e = easeInOutCubic(a);
      switch (kind) {
        case 'fade':
          ctx.drawImage(A, 0, 0);
          ctx.globalAlpha = easeInOutSine(a);
          ctx.drawImage(B, 0, 0);
          break;
        case 'slide':
          if (vertical) { ctx.drawImage(A, 0, -e * H); ctx.drawImage(B, 0, (1 - e) * H); }
          else { ctx.drawImage(A, -e * W, 0); ctx.drawImage(B, (1 - e) * W, 0); }
          break;
        case 'whip': {
          const n = 6;
          for (let i = 0; i < n; i++) {
            const ee = clamp(e + (i - n / 2) * 0.025, 0, 1);
            ctx.globalAlpha = 1 / (i + 1) + 0.15;
            const off = vertical ? [0, -ee * H, 0, (1 - ee) * H] : [-ee * W, 0, (1 - ee) * W, 0];
            ctx.drawImage(A, off[0], off[1]);
            ctx.drawImage(B, off[2], off[3]);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'zoom': {
          const s0 = lerp(1, 1.6, e);
          ctx.globalAlpha = 1 - e;
          ctx.drawImage(A, W / 2 - (W * s0) / 2, H / 2 - (H * s0) / 2, W * s0, H * s0);
          const s1 = lerp(0.8, 1, e);
          ctx.globalAlpha = e;
          ctx.drawImage(B, W / 2 - (W * s1) / 2, H / 2 - (H * s1) / 2, W * s1, H * s1);
          break;
        }
        case 'flash':
          ctx.drawImage(a < 0.5 ? A : B, 0, 0);
          ctx.globalAlpha = 1 - Math.abs(a - 0.5) * 2;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, W, H);
          break;
        default:
          ctx.drawImage(B, 0, 0);
      }
      ctx.globalAlpha = 1;
      overlays(ctx, project, t, total, cur);
    },
  };
}

export const frameSize = (p: Project) => FORMATS[p.format];
