import { FORMATS, type Caption, type Diagram, type FxItem, type Grade, type Layout, type Project, type Rect, type Shot } from '../types';
import { personMask } from './segment';
import { faceAt } from './faces';
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
    case 'zoom-in':
    case 'zoom-out': {
      // aim at the point of interest (faces, action) rather than the geometric centre
      const f = shot.focus && r === shot.rect ? shot.focus : { x: 0.5, y: 0.5 };
      const fx = r.x + f.x * r.w, fy = r.y + f.y * r.h;
      const a = motion === 'zoom-in' ? e : 1 - e;
      const vw = v.vw * lerp(1, 1 - 0.24 * k, a);
      return { cx: lerp(v.cx, fx, a * 0.75), cy: lerp(v.cy, fy, a * 0.75), vw };
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

/** page shown blurred when nothing else fills the frame: never a black screen */
let bgPageHint: string | null = null;

export function pageBlur(ctx: Ctx, project: Project, box: Box, pageId?: string | null, region?: Rect | null) {
  const page = project.pages.find((p) => p.id === (pageId ?? bgPageHint)) ?? project.pages.find((p) => !p.skip && getImage(p.mediaId)) ?? project.pages[0];
  const asset = page && getImage(page.mediaId);
  if (!asset) {
    ctx.drawImage(halftone(Math.max(8, Math.round(box.w)), Math.max(8, Math.round(box.h)), project.accent), box.x, box.y, box.w, box.h);
    return;
  }
  const b = asset.blur;
  // the whole page, covering the box, centred on the region of interest
  const sc = Math.max(box.w / b.width, box.h / b.height) * 1.25;
  const dw = b.width * sc, dh = b.height * sc;
  const cx = region ? ((region.x + region.w / 2) / asset.width) * dw : dw / 2;
  const cy = region ? ((region.y + region.h / 2) / asset.height) * dh : dh / 2;
  const ox = clamp(box.x + box.w / 2 - cx, box.x + box.w - dw, box.x);
  const oy = clamp(box.y + box.h / 2 - cy, box.y + box.h - dh, box.y);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(b, ox, oy, dw, dh);
  const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  g.addColorStop(0, 'rgba(8,8,10,0.5)');
  g.addColorStop(0.5, 'rgba(8,8,10,0.32)');
  g.addColorStop(1, 'rgba(8,8,10,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

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
    pageBlur(ctx, project, box, pageId, region);
  }}

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

const GRADE: Record<Grade, string> = {
  natural: 'none',
  cinema: 'contrast(1.08) saturate(0.88) sepia(0.12) brightness(0.98)',
  warm: 'contrast(1.05) saturate(1.1) sepia(0.22) brightness(1.02)',
  punch: 'contrast(1.18) saturate(1.3)',
  noir: 'grayscale(1) contrast(1.3) brightness(0.95)',
};

interface Placement { img: CanvasImageSource; ox: number; oy: number; dw: number; dh: number; src: number }

/** where the face-cam frame lands in `box`: cover-fit on the focus point, punch-ins on cuts, slow drift */
function placeFace(project: Project, box: Box, face: FaceSource, segs: Seg[], t: number): Placement | null {
  const ar = project.aroll;
  if (!ar || !segs.length) return null;
  const { src, i, local } = toSource(segs, t);
  const img = face(src);
  if (!img) return null;
  const vw = ar.width, vh = ar.height;
  let z = 1;
  if (ar.punchIn > 0) z *= [1, 1 + 0.16 * ar.punchIn, 1 + 0.07 * ar.punchIn][i % 3];
  const segLen = segs[i].e - segs[i].s;
  if (ar.drift > 0) z *= 1 + 0.05 * ar.drift * clamp(local / Math.max(segLen, 0.5), 0, 1);
  const fk = faceAt(ar.faceTrack, src);
  // never zoom so far that the face fills more than ~45 % of the width
  if (fk && fk.s > 0) {
    const base = Math.max(box.w / vw, box.h / vh);
    const faceW = fk.s * vw * base;
    z = Math.min(z, Math.max(1, (box.w * 0.45) / faceW));
  }
  const sc = Math.max(box.w / vw, box.h / vh) * z;
  const dw = vw * sc, dh = vh * sc;
  const focus = fk ?? ar.focus;
  const fx = focus.x * dw, fy = focus.y * dh;
  const ox = clamp(box.x + box.w / 2 - fx, box.x + box.w - dw, box.x);
  const oy = clamp(box.y + box.h * 0.42 - fy, box.y + box.h - dh, box.y);
  return { img, ox, oy, dw, dh, src };
}

function drawFace(ctx: Ctx, project: Project, box: Box, face: FaceSource, segs: Seg[], t: number, radius = 0) {
  ctx.save();
  clipBox(ctx, box, radius);
  const pl = placeFace(project, box, face, segs, t);
  if (!pl || pl.dw < box.w - 1 || pl.dh < box.h - 1) pageBlur(ctx, project, box);
  if (pl) {
    ctx.imageSmoothingQuality = 'high';
    const g = GRADE[project.look?.grade ?? 'natural'];
    if (g !== 'none') ctx.filter = g;
    ctx.drawImage(pl.img, pl.ox, pl.oy, pl.dw, pl.dh);
    ctx.filter = 'none';
  }
  ctx.restore();
}

/* ---------------------------------------------------- face-cam effects */

let personBuf: HTMLCanvasElement | null = null;

function bigText(ctx: Ctx, W: number, H: number, fx: FxItem, local: number, accent: string, behind: boolean) {
  const text = (fx.text || '').toUpperCase();
  if (!text) return;
  const size = Math.min(W, H) * (behind ? 0.24 : 0.16) * (fx.size ?? 1);
  ctx.save();
  ctx.font = `${behind ? '400' : '400'} ${size}px ${behind ? FONT_STACK.anton : FONT_STACK.bangers}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, W * 0.92);
  const a = easeOutCubic(clamp(local / 0.35, 0, 1));
  const out = clamp((fx.duration - local) / 0.25, 0, 1);
  ctx.globalAlpha = Math.min(a, out);
  const y0 = (fx.y ?? (behind ? 0.33 : 0.45)) * H;
  const lh = size * (behind ? 0.95 : 1.05);
  const scale = behind ? lerp(1.12, 1, a) : lerp(0.4, 1, easeOutBack(clamp(local / 0.3, 0, 1)));
  ctx.translate(W / 2, y0);
  ctx.scale(scale, scale);
  if (!behind) {
    const sh = Math.max(0, 1 - local / 0.4) * size * 0.06;
    ctx.translate(Math.sin(local * 80) * sh, Math.cos(local * 63) * sh);
    ctx.rotate(-0.05);
  }
  lines.forEach((l, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    if (behind) {
      ctx.fillStyle = fx.color || '#FFFFFF';
      ctx.fillText(l, 0, y);
    } else {
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#000';
      ctx.fillText(l, size * 0.06, y + size * 0.06);
      ctx.strokeText(l, 0, y);
      ctx.fillStyle = fx.color || accent;
      ctx.fillText(l, 0, y);
    }
  });
  ctx.restore();
}

/** Full-frame face with background effects; the person is cut out and put back on top. */
function drawFaceWithFx(ctx: Ctx, project: Project, W: number, H: number, face: FaceSource, segs: Seg[], t: number, active: FxItem[]) {
  const box: Box = { x: 0, y: 0, w: W, h: H };
  const behind = active.filter((f) => f.kind !== 'callout');
  if (!behind.length) { drawFace(ctx, project, box, face, segs, t); return; }
  const pl = placeFace(project, box, face, segs, t);
  const mask = pl && project.look?.cutout !== false ? personMask(pl.img, pl.src) : null;
  // 1. background: the room, replaced or treated
  const bgFx = behind.find((f) => f.kind === 'panelBehind' || f.kind === 'bgHalftone' || f.kind === 'bgBlur');
  if (bgFx?.kind === 'panelBehind' && bgFx.pageId && bgFx.rect && mask) {
    drawPanelIn(ctx, project, bgFx.pageId, box, baseView(bgFx.rect, W / H, 'fill'), bgFx.rect, { bg: false });
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
  } else if (bgFx?.kind === 'bgHalftone' && mask) {
    ctx.drawImage(halftone(W, H, project.accent), 0, 0);
  } else {
    drawFace(ctx, project, box, face, segs, t);
    if (bgFx?.kind === 'bgBlur' && mask && pl) {
      ctx.save();
      ctx.filter = 'blur(' + Math.round(Math.min(W, H) * 0.012) + 'px) brightness(0.8)';
      ctx.drawImage(pl.img, pl.ox, pl.oy, pl.dw, pl.dh);
      ctx.restore();
    }
  }
  // 2. what goes behind the person
  for (const f of behind) if (f.kind === 'textBehind') bigText(ctx, W, H, f, t - f.start, project.accent, true);
  // 3. the person on top
  if (pl && mask) {
    personBuf ??= document.createElement('canvas');
    if (personBuf.width !== W || personBuf.height !== H) { personBuf.width = W; personBuf.height = H; }
    const p = personBuf.getContext('2d')!;
    p.globalCompositeOperation = 'source-over';
    p.clearRect(0, 0, W, H);
    const g = GRADE[project.look?.grade ?? 'natural'];
    if (g !== 'none') p.filter = g;
    p.drawImage(pl.img, pl.ox, pl.oy, pl.dw, pl.dh);
    p.filter = 'none';
    p.globalCompositeOperation = 'destination-in';
    p.imageSmoothingQuality = 'high';
    p.drawImage(mask, pl.ox, pl.oy, pl.dw, pl.dh);
    p.globalCompositeOperation = 'source-over';
    ctx.drawImage(personBuf, 0, 0);
  }
}

/* ------------------------------------------------------------ diagrams */

function card(ctx: Ctx, project: Project, it: { label: string; sub?: string; pageId?: string; rect?: Rect }, cx: number, cy: number, w: number, h: number, a: number, accent: string, U: number) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a * 1.5);
  ctx.translate(cx, cy + (1 - a) * U * 3);
  const s = lerp(0.85, 1, easeOutBack(clamp(a, 0, 1)));
  ctx.scale(s, s);
  const imgH = it.pageId && it.rect ? h - U * 2.6 : 0;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = U * 1.2;
  ctx.fillStyle = '#16161b';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, U * 0.5);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (imgH > 0) {
    const box: Box = { x: -w / 2 + U * 0.3, y: -h / 2 + U * 0.3, w: w - U * 0.6, h: imgH - U * 0.3 };
    drawPanelIn(ctx, project, it.pageId!, box, baseView(it.rect!, box.w / box.h, 'fill'), it.rect!, { bg: false });
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = U * 0.18;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, U * 0.5);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ly = imgH > 0 ? -h / 2 + imgH + U * 1.05 : -U * 0.5;
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${U * 0.95}px ${FONT_STACK.grotesk}`;
  ctx.fillText(it.label.toUpperCase(), 0, ly, w - U * 0.6);
  if (it.sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `500 ${U * 0.7}px ${FONT_STACK.inter}`;
    ctx.fillText(it.sub, 0, ly + U * 1.0, w - U * 0.6);
  }
  ctx.restore();
}

function drawDiagram(ctx: Ctx, project: Project, W: number, H: number, d: Diagram, local: number, dur: number) {
  const accent = project.accent;
  const vertical = H > W;
  const U = Math.min(W, H) * 0.035;
  ctx.drawImage(halftone(W, H, accent), 0, 0);
  const z = 1 + 0.03 * easeInOutSine(clamp(local / dur, 0, 1));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, z);
  ctx.translate(-W / 2, -H / 2);
  // title
  if (d.title) {
    const a = easeOutCubic(clamp(local / 0.4, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `700 ${U * 1.8}px ${FONT_STACK.grotesk}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    const ty = vertical ? H * 0.11 : H * 0.12;
    ctx.fillText(d.title.toUpperCase(), W / 2, ty, W * 0.9);
    const tw = Math.min(W * 0.9, ctx.measureText(d.title.toUpperCase()).width);
    ctx.fillStyle = accent;
    ctx.fillRect(W / 2 - (tw / 2) * a, ty + U * 0.6, tw * a, U * 0.22);
    ctx.restore();
  }
  const n = d.items.length;
  if (!n) { ctx.restore(); return; }
  const span = Math.max(0.5, dur * 0.7);
  const appear = (i: number) => clamp((local - 0.35 - (i * span) / n) / 0.45, 0, 1);
  const top = vertical ? H * 0.17 : H * 0.22, bottom = H * 0.93;

  if (d.kind === 'timeline') {
    if (vertical) {
      const x = W / 2, y0 = top + U, y1 = bottom - U;
      const step = (y1 - y0) / Math.max(1, n);
      const prog = clamp((local - 0.3) / span, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x - U * 0.1, y0, U * 0.2, y1 - y0);
      ctx.fillStyle = accent;
      ctx.fillRect(x - U * 0.1, y0, U * 0.2, (y1 - y0) * prog);
      const cw = W * 0.4, ch = Math.min(step * 0.92, cw * 0.95);
      d.items.forEach((it, i) => {
        const cy = y0 + step * (i + 0.5), a = appear(i);
        ctx.fillStyle = a > 0 ? accent : 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.arc(x, cy, U * 0.45, 0, Math.PI * 2); ctx.fill();
        card(ctx, project, it, i % 2 ? x + U + cw / 2 : x - U - cw / 2, cy, cw, ch, a, accent, U);
      });
    } else {
      const y = (top + bottom) / 2, x0 = W * 0.06, x1 = W * 0.94;
      const step = (x1 - x0) / Math.max(1, n);
      const prog = clamp((local - 0.3) / span, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x0, y - U * 0.1, x1 - x0, U * 0.2);
      ctx.fillStyle = accent;
      ctx.fillRect(x0, y - U * 0.1, (x1 - x0) * prog, U * 0.2);
      const cw = Math.min(step * 0.92, W * 0.24), ch = (bottom - top) / 2 - U * 1.2;
      d.items.forEach((it, i) => {
        const cx = x0 + step * (i + 0.5), a = appear(i);
        ctx.fillStyle = a > 0 ? accent : 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.arc(cx, y, U * 0.45, 0, Math.PI * 2); ctx.fill();
        card(ctx, project, it, cx, i % 2 ? y + U + ch / 2 : y - U - ch / 2, cw, ch, a, accent, U);
      });
    }
  } else if (d.kind === 'versus') {
    const [A, B] = d.items;
    const cw = vertical ? W * 0.62 : W * 0.34, ch = vertical ? (bottom - top) / 2 - U * 2 : (bottom - top) * 0.85;
    const pa = vertical ? [W / 2, top + ch / 2 + U] : [W * 0.26, (top + bottom) / 2];
    const pb = vertical ? [W / 2, bottom - ch / 2 - U] : [W * 0.74, (top + bottom) / 2];
    if (A) card(ctx, project, A, pa[0], pa[1], cw, ch, appear(0), accent, U);
    if (B) card(ctx, project, B, pb[0], pb[1], cw, ch, appear(Math.min(1, n - 1)), accent, U);
    const va = easeOutBack(clamp((local - 0.35 - span * 0.5) / 0.35, 0, 1));
    if (va > 0) {
      ctx.save();
      ctx.translate((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
      ctx.scale(va, va);
      ctx.rotate(-0.08);
      ctx.fillStyle = accent;
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const r = (k % 2 ? 2.2 : 3.4) * U, ang = (k / 16) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.font = `${U * 2.6}px ${FONT_STACK.bangers}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = U * 0.3;
      ctx.strokeStyle = '#000';
      ctx.strokeText('VS', 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText('VS', 0, 0);
      ctx.restore();
    }
  } else if (d.kind === 'ranking') {
    const rows = n, rh = (bottom - top) / rows;
    const cw = vertical ? W * 0.62 : W * 0.5;
    d.items.forEach((it, i) => {
      const order = rows - 1 - i; // countdown: last rank appears first
      const a = appear(order);
      const cy = top + rh * (i + 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `${rh * 0.6}px ${FONT_STACK.bangers}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = accent;
      ctx.fillText(`#${i + 1}`, W / 2 - cw / 2 - U * 0.6, cy);
      ctx.restore();
      card(ctx, project, it, W / 2 + U, cy, cw, rh * 0.86, a, accent, U);
    });
  } else {
    // network: first item at the centre when there are 4+, others around
    const cx = W / 2, cy = (top + bottom) / 2;
    const hub = n >= 4;
    const ring = hub ? d.items.slice(1) : d.items;
    const R = Math.min(W * 0.36, (bottom - top) * 0.36);
    const pos = d.items.map((_, i) => {
      if (hub && i === 0) return [cx, cy];
      const k = hub ? i - 1 : i, m = ring.length;
      const ang = -Math.PI / 2 + (k / m) * Math.PI * 2;
      return [cx + Math.cos(ang) * R * (vertical ? 0.95 : 1.25), cy + Math.sin(ang) * R];
    });
    const cs = Math.min(W, H) * (n > 5 ? 0.2 : 0.25);
    const linkT = clamp((local - 0.35 - span) / 0.5, 0, 1);
    const links: { a: number; b: number; label?: string }[] = d.links.length ? d.links : hub ? ring.map((_, k) => ({ a: 0, b: k + 1 })) : [];
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = U * 0.2;
    ctx.setLineDash([U * 0.6, U * 0.4]);
    for (const [li, l] of links.entries()) {
      const pa = pos[l.a], pb = pos[l.b];
      if (!pa || !pb) continue;
      const e = clamp(linkT * links.length - li * 0.5, 0, 1);
      if (e <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(lerp(pa[0], pb[0], e), lerp(pa[1], pb[1], e));
      ctx.stroke();
      if (l.label && e >= 1) {
        const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
        ctx.save();
        ctx.setLineDash([]);
        ctx.font = `700 ${U * 0.7}px ${FONT_STACK.grotesk}`;
        const tw = ctx.measureText(l.label.toUpperCase()).width;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2 - U * 0.4, my - U * 0.55, tw + U * 0.8, U * 1.1, U * 0.55);
        ctx.fill();
        ctx.fillStyle = '#140700';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(l.label.toUpperCase(), mx, my);
        ctx.restore();
      }
    }
    ctx.restore();
    d.items.forEach((it, i) => card(ctx, project, it, pos[i][0], pos[i][1], cs, cs * 1.15, appear(i), accent, U));
  }
  ctx.restore();
}

/* ---------------------------------------------------- vignette & grain */

let grainTile: HTMLCanvasElement | null = null;
function drawLook(ctx: Ctx, project: Project, W: number, H: number, t: number) {
  const look = project.look;
  if (!look) return;
  if (look.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${0.75 * look.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (look.grain > 0) {
    if (!grainTile) {
      grainTile = document.createElement('canvas');
      grainTile.width = grainTile.height = 256;
      const x = grainTile.getContext('2d')!;
      const im = x.createImageData(256, 256);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = Math.random() * 255;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
        im.data[i + 3] = 255;
      }
      x.putImageData(im, 0, 0);
    }
    ctx.save();
    ctx.globalAlpha = 0.09 * look.grain;
    ctx.globalCompositeOperation = 'overlay';
    const pat = ctx.createPattern(grainTile, 'repeat')!;
    const f = Math.floor(t * 24);
    ctx.translate((f * 97) % 256, (f * 61) % 256);
    ctx.fillStyle = pat;
    ctx.fillRect(-256, -256, W + 512, H + 512);
    ctx.restore();
  }
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
  /** true when the frame moves fast (transitions, impacts): export renders it with motion blur */
  fast(project: Project, t: number): boolean;
  draw(ctx: Ctx, project: Project, t: number, face?: FaceSource): void;
}

function makeBuf(W: number, H: number) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

/** impact shake: a damped spring (position + a touch of rotation), not random jitter */
function shakeOffset(shot: Shot, local: number, W: number): [number, number, number] {
  if (!shot.shake || local > 0.7) return [0, 0, 0];
  const env = Math.exp(-local * 7.5) * shot.shake;
  return [Math.cos(local * 41) * env * W * 0.028, Math.sin(local * 33 + 1) * env * W * 0.02, Math.sin(local * 29) * env * 0.025];
}

/** subtle hand-held drift: smooth, never repeating within a shot */
function handheld(amount: number, t: number, W: number): [number, number] {
  if (!amount) return [0, 0];
  const a = amount * W * 0.004;
  return [a * (Math.sin(t * 0.9) + 0.5 * Math.sin(t * 2.3 + 1.7)), a * (Math.cos(t * 0.7 + 0.4) + 0.5 * Math.sin(t * 1.9))];
}

/** manga speed lines on impacts, radiating from the frame edges */
function speedLines(ctx: Ctx, W: number, H: number, local: number, strength: number) {
  if (local > 0.55 || strength <= 0) return;
  const a = (1 - local / 0.55) * Math.min(1, strength) * 0.55;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  const R = Math.hypot(W, H) / 2;
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  for (let i = 0; i < 70; i++) {
    const ang = (i / 70) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.05;
    const inner = R * (0.55 + 0.25 * Math.abs(Math.sin(i * 78.233)));
    const wid = 0.004 + 0.006 * Math.abs(Math.sin(i * 3.1));
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang - wid) * R * 1.1, Math.sin(ang - wid) * R * 1.1);
    ctx.lineTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
    ctx.lineTo(Math.cos(ang + wid) * R * 1.1, Math.sin(ang + wid) * R * 1.1);
    ctx.fill();
  }
  ctx.restore();
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
    const [sx, sy, rot] = shakeOffset(shot, local, W);
    const [hx, hy] = layoutKind === 'title' ? [0, 0] : handheld(project.look?.handheld ?? 0, t, W);
    const p = (local - motionStart) / Math.max(0.01, shot.duration - motionStart);
    if (shot.pageId) bgPageHint = shot.pageId;
    ctx.save();
    pageBlur(ctx, project, { x: 0, y: 0, w: W, h: H }, shot.pageId, shot.pageId ? shot.rect : null);
    ctx.translate(W / 2 + sx + hx, H / 2 + sy + hy);
    ctx.rotate(rot);
    // a shaking frame is scaled a little so its edges never show
    const pad = 1 + Math.abs(sx) / W * 2.2 + Math.abs(sy) / H * 2.2 + Math.abs(rot) * 1.2 + (hx || hy ? 0.012 : 0);
    ctx.scale(pad, pad);
    ctx.translate(-W / 2, -H / 2);
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
        } else if (shot.diagram) {
          drawDiagram(ctx, project, W, H, shot.diagram, local, shot.duration);
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
        let view: View;
        if (shot.zone === 'zones') {
          // zone tour: frame the zone, gentle push-in, neighbours stay visible but dimmed
          // guided view: tighter than "fit" so text stays readable, travelling along the band
          const A = W / H, r = shot.rect;
          const fit = baseView(r, A, 'fit', 1.06), fill = baseView(r, A, 'fill');
          const vw = Math.max(fill.vw, Math.sqrt(fit.vw * fill.vw));
          const ep = easeInOutSine(clamp(p, 0, 1));
          if (vw < r.w * 0.98) {
            const x0 = r.x + vw / 2, x1 = r.x + r.w - vw / 2;
            const rtl = project.readingOrder === 'rtl';
            view = { cx: lerp(rtl ? x1 : x0, rtl ? x0 : x1, ep), cy: fit.cy, vw };
          } else {
            const vh = vw / A;
            const y0 = r.y + Math.min(vh, r.h) / 2, y1 = r.y + r.h - Math.min(vh, r.h) / 2;
            view = { cx: fit.cx, cy: vh < r.h ? lerp(y0, y1, ep) : fit.cy, vw: vw * lerp(1.06, 1, ep) };
          }
        } else {
          const target = { cx: lerp(whole.cx, tight.cx, 0.55), cy: lerp(whole.cy, tight.cy, 0.55), vw: lerp(whole.vw, Math.max(tight.vw, whole.vw * 0.55), 1) };
          view = { cx: lerp(whole.cx, target.cx, e), cy: lerp(whole.cy, target.cy, e), vw: lerp(whole.vw, target.vw, e) };
        }
        const dim = shot.zone === 'zones' ? 0.5 : lerp(0.15, 0.68, clamp(local / 0.6, 0, 1));
        drawPanelIn(ctx, project, page.id, full, view, shot.rect, { bg: false, dimPage: dim, border: Math.min(W, H) * 0.006 });
        break;
      }
    }
    ctx.restore();
    if (shot.shake > 0 && project.look?.speedLines !== false && layoutKind !== 'title') speedLines(ctx, W, H, local, shot.shake);
    if (shot.pageId == null) {
      drawCaption(ctx, W, H, shot.caption, local, shot.duration, true, undefined, project.accent);
    } else {
      drawCaption(ctx, W, H, shot.caption, local, shot.duration, false, undefined, project.accent);
      if (shot.nameTag) drawNameTag(ctx, W, H, shot.nameTag, local, shot.duration, project.accent);
    }
  }

  function renderState(ctx: Ctx, project: Project, st: State, t: number, face: FaceSource, segs: Seg[]) {
    if (st.kind === 'shot') renderShot(ctx, project, st.ts, t, face, segs);
    else if (st.kind === 'face') drawFaceWithFx(ctx, project, W, H, face, segs, t, (project.fx ?? []).filter((f) => t >= f.start && t < f.start + f.duration));
    else pageBlur(ctx, project, { x: 0, y: 0, w: W, h: H });
  }

  function overlays(ctx: Ctx, project: Project, t: number, total: number, st: State) {
    drawLook(ctx, project, W, H, t);
    for (const f of project.fx ?? []) {
      if (f.kind === 'callout' && t >= f.start && t < f.start + f.duration) bigText(ctx, W, H, f, t - f.start, project.accent, false);
    }
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
    fast(project, t) {
      for (const ts of layoutShots(project)) {
        const local = t - ts.start;
        if (local < 0 || local > ts.shot.duration) continue;
        const td = Math.min(ts.shot.transitionDur, ts.shot.duration * 0.9);
        if (['whip', 'slide', 'zoom', 'slash', 'glide'].includes(ts.shot.transition) && local < td) return true;
        if (ts.shot.shake > 0 && local < 0.35) return true;
      }
      return false;
    },
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
      pageBlur(ctx, project, { x: 0, y: 0, w: W, h: H }, shot.pageId, shot.pageId ? shot.rect : null);
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
        case 'slash': {
          // diagonal comic-panel wipe with an accent edge
          ctx.drawImage(A, 0, 0);
          const k = e * (W + H * 0.6) * 1.05 - H * 0.3;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(-H * 0.3, 0); ctx.lineTo(k, 0); ctx.lineTo(k - H * 0.3, H); ctx.lineTo(-H * 0.3, H);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(B, 0, 0);
          ctx.restore();
          ctx.strokeStyle = project.accent;
          ctx.lineWidth = Math.min(W, H) * 0.018;
          ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k - H * 0.3, H); ctx.stroke();
          break;
        }
        case 'iris': {
          ctx.drawImage(A, 0, 0);
          const rad = e * Math.hypot(W, H) * 0.55;
          ctx.save();
          ctx.beginPath(); ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(B, 0, 0);
          ctx.restore();
          if (e < 1) {
            ctx.strokeStyle = project.accent;
            ctx.lineWidth = Math.min(W, H) * 0.012;
            ctx.beginPath(); ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2); ctx.stroke();
          }
          break;
        }
        case 'glitch': {
          const src = a < 0.5 ? A : B;
          ctx.drawImage(src, 0, 0);
          const amt = 1 - Math.abs(a - 0.5) * 2;
          const slices = 9;
          for (let i = 0; i < slices; i++) {
            const r1 = Math.abs(Math.sin((i + 1) * 91.7 + Math.floor(a * 12) * 13.1));
            if (r1 < 0.45) continue;
            const y = (i / slices) * H, sh = H / slices * (0.4 + r1 * 0.6);
            const dx = (r1 - 0.7) * W * 0.12 * amt;
            ctx.drawImage(a < 0.5 ? B : A, 0, y, W, sh, dx, y, W, sh);
          }
          ctx.globalAlpha = 0.35 * amt;
          ctx.globalCompositeOperation = 'screen';
          ctx.drawImage(src, W * 0.012 * amt, 0);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          break;
        }
        case 'dip': {
          ctx.drawImage(a < 0.5 ? A : B, 0, 0);
          ctx.fillStyle = `rgba(0,0,0,${1 - Math.abs(a - 0.5) * 2})`;
          ctx.fillRect(0, 0, W, H);
          break;
        }
        case 'blur': {
          const bl = Math.round(Math.min(W, H) * 0.02 * Math.sin(Math.PI * a));
          ctx.filter = bl > 0 ? `blur(${bl}px)` : 'none';
          ctx.drawImage(A, 0, 0);
          ctx.globalAlpha = easeInOutSine(a);
          ctx.drawImage(B, 0, 0);
          ctx.filter = 'none';
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
