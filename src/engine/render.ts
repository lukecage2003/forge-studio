import { FORMATS, type Caption, type Project, type Rect, type Shot } from '../types';
import { clamp, easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic, lerp } from '../lib/util';
import { getImage } from './media';
import { layout, shotAt } from './timeline';

type Ctx = CanvasRenderingContext2D;
interface View { cx: number; cy: number; vw: number } // view rect in page px, aspect = frame aspect

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
    document.fonts.load(`600 80px ${FONT_STACK.grotesk}`),
  ]).catch(() => {});
}

/* ---------------------------------------------------------------- camera */

/** Resolve "auto" into concrete motion + framing based on panel vs frame aspect. */
export function resolveMotion(shot: Shot, aspect: number, rtl: boolean) {
  if (shot.motion !== 'auto') return { motion: shot.motion, framing: shot.framing };
  const ratio = shot.rect.w / shot.rect.h / aspect;
  if (ratio > 1.35) return { motion: rtl ? 'pan-left' : 'pan-right', framing: 'fill' as const };
  if (ratio < 1 / 1.35) return { motion: 'pan-down' as const, framing: 'fill' as const };
  return { motion: 'zoom-in' as const, framing: shot.framing };
}

function baseView(r: Rect, aspect: number, framing: 'fit' | 'fill'): View {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (framing === 'fill') return { cx, cy, vw: Math.min(r.w, r.h * aspect) };
  const pad = 1.08;
  return { cx, cy, vw: Math.max(r.w * pad, r.h * pad * aspect) };
}

export function cameraAt(shot: Shot, p: number, aspect: number, rtl: boolean): View {
  const { motion, framing } = resolveMotion(shot, aspect, rtl);
  const r = shot.rect;
  const v = baseView(r, aspect, framing);
  const vh = v.vw / aspect;
  const k = shot.intensity;
  const e = easeInOutSine(clamp(p, 0, 1));
  switch (motion) {
    case 'zoom-in': {
      const z = lerp(1, 1 - 0.22 * k, e);
      return { ...v, vw: v.vw * z };
    }
    case 'zoom-out': {
      const z = lerp(1 - 0.22 * k, 1, e);
      return { ...v, vw: v.vw * z };
    }
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
    default:
      return v;
  }
}

/* --------------------------------------------------------------- drawing */

function drawPanel(ctx: Ctx, W: number, H: number, project: Project, shot: Shot, view: View, clip: Rect) {
  const page = project.pages.find((p) => p.id === shot.pageId);
  const asset = page && getImage(page.mediaId);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!asset) return;
  const s = W / view.vw;
  const toFrame = () => {
    ctx.setTransform(s, 0, 0, s, W / 2 - view.cx * s, H / 2 - view.cy * s);
  };

  // background
  if (project.background === 'color') {
    ctx.fillStyle = project.bgColor;
    ctx.fillRect(0, 0, W, H);
  } else if (project.background === 'blur') {
    const b = asset.blur;
    const bx = (clip.x / asset.width) * b.width, by = (clip.y / asset.height) * b.height;
    const bw = (clip.w / asset.width) * b.width, bh = (clip.h / asset.height) * b.height;
    // cover the frame with the blurred panel region
    const sc = Math.max(W / bw, H / bh) * 1.15;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b, bx, by, bw, bh, W / 2 - (bw * sc) / 2, H / 2 - (bh * sc) / 2, bw * sc, bh * sc);
    ctx.fillStyle = 'rgba(8,8,10,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else {
    ctx.save();
    toFrame();
    ctx.drawImage(asset.img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(8,8,10,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // panel with drop shadow
  ctx.save();
  toFrame();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 40 / s;
  ctx.shadowOffsetY = 10 / s;
  ctx.fillStyle = '#000';
  ctx.fillRect(clip.x, clip.y, clip.w, clip.h);
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(asset.img, 0, 0);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawTitleCard(ctx: Ctx, W: number, H: number, shot: Shot, local: number) {
  const c = shot.titleBg || '#0E0E11';
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, W, H);
  // slow ember glow
  const g = ctx.createRadialGradient(W * 0.5, H * (0.55 - local * 0.01), 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(255,90,31,0.20)');
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
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

const PRESET = {
  tiktok: { font: FONT_STACK.anton, weight: '400', upper: true, fill: '#FFFFFF', stroke: '#000000', strokeW: 0.16, hi: '#FFE14D', box: null as null | string, rot: 0, lh: 1.08, scale: 1 },
  comic: { font: FONT_STACK.bangers, weight: '400', upper: true, fill: '#111111', stroke: null as null | string, strokeW: 0, hi: '#D7261E', box: '#FFE14D', rot: -1.5, lh: 1.1, scale: 0.9 },
  clean: { font: FONT_STACK.inter, weight: '700', upper: false, fill: '#FFFFFF', stroke: null, strokeW: 0, hi: '#FFB020', box: 'rgba(10,10,12,0.62)', rot: 0, lh: 1.25, scale: 0.72 },
  impact: { font: FONT_STACK.bangers, weight: '400', upper: true, fill: '#FFD400', stroke: '#000000', strokeW: 0.14, hi: '#FF5A1F', box: null, rot: -4, lh: 1.0, scale: 1.45 },
  cinema: { font: FONT_STACK.grotesk, weight: '600', upper: false, fill: '#FFFFFF', stroke: null, strokeW: 0, hi: '#FFB020', box: null, rot: 0, lh: 1.25, scale: 0.6 },
};

export function drawCaption(ctx: Ctx, W: number, H: number, cap: Caption, local: number, dur: number, isTitle = false) {
  const raw = cap.text.trim();
  if (!raw) return;
  const P = PRESET[cap.preset] ?? PRESET.tiktok;
  const text = P.upper ? raw.toUpperCase() : raw;
  const size = Math.min(W, H) * 0.075 * cap.size * P.scale * (isTitle ? 1.4 : 1);
  ctx.save();
  ctx.font = `${P.weight} ${size}px ${P.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, W * (P.box ? 0.76 : 0.84));
  const lh = size * P.lh;
  const blockH = lines.length * lh;
  const y0 = isTitle ? H / 2 : clamp(cap.y, 0.06, 0.94) * H;

  // animation
  let scale = 1, alpha = 1, chars = Infinity, wordsShown = Infinity, hiWord = -1;
  const allWords = lines.join(' ').split(' ').length;
  switch (cap.anim) {
    case 'pop': {
      const a = clamp(local / 0.32, 0, 1);
      scale = lerp(0.55, 1, easeOutBack(a));
      alpha = clamp(local / 0.12, 0, 1);
      break;
    }
    case 'type': {
      const total = text.length;
      const span = Math.min(dur * 0.6, total * 0.035);
      chars = Math.floor(total * clamp(local / Math.max(span, 0.01), 0, 1));
      break;
    }
    case 'words': {
      const span = dur * 0.85;
      const per = span / allWords;
      wordsShown = Math.min(allWords, Math.floor(local / per) + 1);
      hiWord = wordsShown - 1;
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
    ctx.fillStyle = P.box;
    if (cap.preset === 'comic') {
      ctx.fillStyle = '#000';
      ctx.fillRect(-bw / 2 + size * 0.1, -bh / 2 + size * 0.1, bw, bh);
      ctx.fillStyle = P.box;
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.lineWidth = size * 0.07;
      ctx.strokeStyle = '#000';
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    } else {
      const r = size * 0.35;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, r);
      ctx.fill();
    }
  } else if (cap.preset === 'cinema') {
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = size * 0.35;
  }

  let charCount = 0, wordIdx = 0;
  lines.forEach((line, li) => {
    const y = -blockH / 2 + lh * (li + 0.5);
    const words = line.split(' ');
    const full = ctx.measureText(line).width;
    let x = -full / 2;
    ctx.textAlign = 'left';
    for (let wi = 0; wi < words.length; wi++) {
      let w = words[wi];
      const ww = ctx.measureText(w).width;
      const space = ctx.measureText(' ').width;
      if (wordIdx >= wordsShown) return;
      if (charCount >= chars) return;
      if (charCount + w.length > chars) w = w.slice(0, chars - charCount);
      charCount += words[wi].length + 1;
      const isHi = wordIdx === hiWord;
      let wordScale = 1;
      if (cap.anim === 'words' && isHi) {
        const per = (dur * 0.85) / allWords;
        wordScale = lerp(1.18, 1, easeOutCubic(clamp((local - hiWord * per) / 0.18, 0, 1)));
      }
      ctx.save();
      ctx.translate(x + ww / 2, y);
      ctx.scale(wordScale, wordScale);
      ctx.textAlign = 'center';
      if (P.stroke) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * P.strokeW;
        ctx.strokeStyle = P.stroke;
        if (cap.preset === 'impact') {
          ctx.fillStyle = '#000';
          ctx.fillText(w, size * 0.07, size * 0.07);
        }
        ctx.strokeText(w, 0, 0);
      }
      ctx.fillStyle = isHi && cap.anim === 'words' ? P.hi : P.fill;
      ctx.fillText(w, 0, 0);
      ctx.restore();
      x += ww + space;
      wordIdx++;
    }
  });
  ctx.restore();
}

/* ------------------------------------------------------------ the frame */

export interface Renderer {
  W: number;
  H: number;
  draw(ctx: Ctx, project: Project, t: number): void;
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

export function createRenderer(W: number, H: number): Renderer {
  const A = makeBuf(W, H), B = makeBuf(W, H);
  const actx = A.getContext('2d')!, bctx = B.getContext('2d')!;

  function renderShot(ctx: Ctx, project: Project, shot: Shot, local: number, motionStart = 0, override?: { view: View; clip: Rect }) {
    const aspect = W / H;
    const rtl = project.readingOrder === 'rtl';
    ctx.save();
    const [sx, sy] = shakeOffset(shot, local, W);
    if (sx || sy) {
      ctx.translate(sx, sy);
    }
    if (shot.pageId == null) {
      drawTitleCard(ctx, W, H, shot, local);
    } else {
      const span = Math.max(0.01, shot.duration - motionStart);
      const p = (local - motionStart) / span;
      const view = override?.view ?? cameraAt(shot, p, aspect, rtl);
      const clip = override?.clip ?? shot.rect;
      if (sx || sy) {
        // draw with transform: drawPanel resets transform, so draw into temp via translate in view space
        const s = W / view.vw;
        drawPanel(ctx, W, H, project, shot, { ...view, cx: view.cx - sx / s, cy: view.cy - sy / s }, clip);
      } else drawPanel(ctx, W, H, project, shot, view, clip);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawCaption(ctx, W, H, shot.caption, local, shot.duration, shot.pageId == null);
  }

  return {
    W, H,
    draw(ctx, project, t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      const timed = layout(project.shots);
      const cur = shotAt(timed, t);
      if (!cur) {
        ctx.fillStyle = '#0B0B0D';
        ctx.fillRect(0, 0, W, H);
        return;
      }
      const local = t - cur.start;
      const shot = cur.shot;
      const prevT = cur.index > 0 ? timed[cur.index - 1] : null;
      const td = Math.min(shot.transitionDur, shot.duration * 0.9);
      const inTrans = prevT && shot.transition !== 'cut' && local < td;
      const aspect = W / H;
      const rtl = project.readingOrder === 'rtl';
      const glideOk = shot.transition === 'glide' && prevT && prevT.shot.pageId && prevT.shot.pageId === shot.pageId;
      const motionStart = glideOk ? td : 0;

      if (!inTrans || !prevT) {
        renderShot(ctx, project, shot, local, motionStart);
        drawWatermark(ctx, W, H, project.watermark);
        return;
      }
      const a = clamp(local / td, 0, 1);
      const prev = prevT.shot;
      const prevLocal = prev.duration + local;

      if (glideOk) {
        const e = easeInOutCubic(a);
        const v0 = cameraAt(prev, 1, aspect, rtl);
        const v1 = cameraAt(shot, 0, aspect, rtl);
        const view = { cx: lerp(v0.cx, v1.cx, e), cy: lerp(v0.cy, v1.cy, e), vw: lerp(v0.vw, v1.vw, e) };
        const r0 = prev.rect, r1 = shot.rect;
        const clip = { x: lerp(r0.x, r1.x, e), y: lerp(r0.y, r1.y, e), w: lerp(r0.w, r1.w, e), h: lerp(r0.h, r1.h, e) };
        renderShot(ctx, project, { ...shot, caption: { ...shot.caption, text: '' }, shake: 0 }, local, 0, { view, clip });
        // captions: old fades out, new pops in after half
        ctx.save();
        ctx.globalAlpha = 1 - clamp(a * 2, 0, 1);
        drawCaption(ctx, W, H, prev.caption, prevLocal, prev.duration);
        ctx.restore();
        if (a > 0.5) drawCaption(ctx, W, H, shot.caption, local - td * 0.5, shot.duration);
        drawWatermark(ctx, W, H, project.watermark);
        return;
      }

      renderShot(actx, project, prev, prevLocal);
      renderShot(bctx, project, shot, local, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const vertical = H > W;
      const kind = shot.transition === 'glide' ? 'slide' : shot.transition;
      switch (kind) {
        case 'fade': {
          ctx.drawImage(A, 0, 0);
          ctx.globalAlpha = easeInOutSine(a);
          ctx.drawImage(B, 0, 0);
          break;
        }
        case 'slide': {
          const e = easeInOutCubic(a);
          if (vertical) {
            ctx.drawImage(A, 0, -e * H);
            ctx.drawImage(B, 0, (1 - e) * H);
          } else {
            ctx.drawImage(A, -e * W, 0);
            ctx.drawImage(B, (1 - e) * W, 0);
          }
          break;
        }
        case 'whip': {
          const e = easeInOutCubic(a);
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
          const e = easeInOutCubic(a);
          const s0 = lerp(1, 1.6, e);
          ctx.globalAlpha = 1 - e;
          ctx.drawImage(A, W / 2 - (W * s0) / 2, H / 2 - (H * s0) / 2, W * s0, H * s0);
          const s1 = lerp(0.8, 1, e);
          ctx.globalAlpha = e;
          ctx.drawImage(B, W / 2 - (W * s1) / 2, H / 2 - (H * s1) / 2, W * s1, H * s1);
          break;
        }
        case 'flash': {
          ctx.drawImage(a < 0.5 ? A : B, 0, 0);
          ctx.globalAlpha = 1 - Math.abs(a - 0.5) * 2;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, W, H);
          break;
        }
        default:
          ctx.drawImage(B, 0, 0);
      }
      ctx.globalAlpha = 1;
      drawWatermark(ctx, W, H, project.watermark);
    },
  };
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
  ctx.fillText(text, W - size * 1.2, size * 1.2);
  ctx.restore();
}

export const frameSize = (p: Project) => FORMATS[p.format];
