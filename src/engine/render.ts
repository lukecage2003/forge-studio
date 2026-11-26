import { DIAGRAM_3D, FORMATS, type Caption, type Diagram, type FxItem, type Grade, type Layout, type Project, type Rect, type Shot } from '../types';
import { personMask } from './segment';
import { faceAt } from './faces';
import { layersFor, type Layers } from './layers';
import { emphasisAt } from './emphasis';
import { brandOf, drawChapter, drawEndScreen, drawIntro } from './brand';
import { clamp, easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic, lerp } from '../lib/util';
import { getImage } from './media';
import { hashSeed, rng } from './rng';
import { TRANSITION, tp } from './effects';
import { EASE } from './motion';
import { arrowHead, balloon, benDay, boil, bowPath, brush, caption, feltCircle, inkBox, INK, LETTER, PAPER_CARD, CAPTION, paperBackground, panelFrame, paperTexture, TITLE } from './ink';
import { drawGlTransition } from './gl';
import { draw3D, itemValues } from './scene3d';
import { keyToken, keywordsOf } from './scriptIntel';

const keyCache = new WeakMap<object, Set<string>>();
/** keywords of the subtitles, computed once per subtitle list */
function subtitleKeys(p: Project): Set<string> {
  let k = keyCache.get(p.subtitles);
  if (!k) { k = keywordsOf(p.subtitles.map((s) => s.text), p.shots.flatMap((s) => s.chars ?? [])); keyCache.set(p.subtitles, k); }
  return k;
}
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
    document.fonts.load(`700 80px "Comic Neue"`),
  ]).catch(() => {});
}

/** Provides the face-cam frame for a given source time. */
export type FaceSource = (src: number) => CanvasImageSource | null;

/* ---------------------------------------------------------------- camera */

/** balloons far enough apart inside the panel for the camera to travel between them */
export function readable(shot: Shot) {
  const b = shot.balloons;
  if (!b || b.length < 2) return false;
  const cx = b.map((r) => r.x + r.w / 2), cy = b.map((r) => r.y + r.h / 2);
  const spread = Math.max((Math.max(...cx) - Math.min(...cx)) / shot.rect.w, (Math.max(...cy) - Math.min(...cy)) / shot.rect.h);
  return spread >= 0.3;
}

export function resolveMotion(shot: Shot, aspect: number, rtl: boolean) {
  if (shot.motion === 'read') return readable(shot) ? { motion: 'read' as const, framing: 'fill' as const } : { motion: 'zoom-in' as const, framing: shot.framing };
  if (shot.motion !== 'auto') return { motion: shot.motion, framing: shot.framing };
  if (readable(shot)) return { motion: 'read' as const, framing: 'fill' as const };
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
    case 'read': {
      // the eye goes balloon to balloon: hold on each, then a smooth move to the next
      const b = shot.balloons ?? [];
      // close enough to read, never so close that a balloon is cut
      const need = Math.max(...b.map((q) => Math.max(q.w * 1.25, q.h * 1.3 * aspect)));
      const vw = Math.min(Math.max(v.vw * lerp(1, 0.84, k), need), Math.max(v.vw, r.w)), h2 = vw / aspect;
      const fit = (x: number, y: number) => ({
        cx: r.w > vw ? clamp(x, r.x + vw / 2, r.x + r.w - vw / 2) : r.x + r.w / 2,
        cy: r.h > h2 ? clamp(y, r.y + h2 / 2, r.y + r.h - h2 / 2) : r.y + r.h / 2,
      });
      const pts = b.map((q) => fit(q.x + q.w / 2, q.y + q.h / 2));
      const seg = clamp(p, 0, 1) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(seg)), f = seg - i;
      const m = easeInOutCubic(clamp((f - 0.45) / 0.55, 0, 1));
      return { cx: lerp(pts[i].cx, pts[i + 1].cx, m), cy: lerp(pts[i].cy, pts[i + 1].cy, m), vw };
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
  if (project.background === 'paper') {
    // the panel lies on newsprint, like a page cut out of the comic
    ctx.save();
    ctx.translate(box.x, box.y);
    paperBackground(ctx, box.w, box.h, project.accent, Math.min(box.w, box.h) * 0.035, 0);
    ctx.restore();
    return;
  }
  if (project.background === 'blur' || project.background === 'page') {
    pageBlur(ctx, project, box, pageId, region);
  }}

/** Draw a panel of a page inside `box`, seen through `view`, clipped to `clip`. */
function drawPanelIn(ctx: Ctx, project: Project, pageId: string, box: Box, view: View, clip: Rect, opts: { bg?: boolean; dimPage?: number; border?: number; layers?: { L: Layers; dx: number; dy: number; s: number }; balloons?: BalloonAnim } = {}) {
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
  const paper = project.background === 'paper' && opts.bg !== false;
  if (paper) {
    // printed look: a hard ink shadow, no blur
    const d = Math.min(box.w, box.h) * 0.016 / s;
    ctx.fillStyle = INK;
    ctx.fillRect(clip.x + d, clip.y + d, clip.w, clip.h);
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 44 / s;
    ctx.shadowOffsetY = 12 / s;
    ctx.fillStyle = '#000';
    ctx.fillRect(clip.x, clip.y, clip.w, clip.h);
    ctx.shadowColor = 'transparent';
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  if (opts.layers) {
    // 2.5D: background drifts a little, the subject drifts more and comes forward
    const { L, dx, dy, s: sc } = opts.layers;
    const g = 1.04;
    ctx.drawImage(L.bg, clip.x - (clip.w * (g - 1)) / 2 - dx * 0.35, clip.y - (clip.h * (g - 1)) / 2 - dy * 0.35, clip.w * g, clip.h * g);
    const fw = clip.w * g * sc, fh = clip.h * g * sc;
    ctx.drawImage(L.fg, clip.x + clip.w / 2 - fw / 2 + dx * 0.65, clip.y + clip.h / 2 - fh / 2 + dy * 0.65, fw, fh);
  } else ctx.drawImage(asset.img, 0, 0);
  if (opts.balloons) drawBalloons(ctx, asset, opts.balloons);
  ctx.restore();
  if (paper) {
    ctx.lineWidth = Math.min(box.w, box.h) * 0.007 / s;
    ctx.strokeStyle = INK;
    ctx.strokeRect(clip.x, clip.y, clip.w, clip.h);
  }
  if (opts.border) {
    ctx.lineWidth = opts.border / s;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(clip.x, clip.y, clip.w, clip.h);
  }
  ctx.restore();
}

/* -------------------------------------------- balloons popping in order */

interface BalloonAnim { rects: Rect[]; local: number; dur: number }

/** before its turn a balloon is hidden under a soft patch of its surroundings, then it pops in */
function drawBalloons(ctx: Ctx, asset: { img: CanvasImageSource; blur: HTMLCanvasElement; width: number; height: number }, b: BalloonAnim) {
  const n = b.rects.length;
  if (!n) return;
  const span = Math.max(0.6, b.dur * 0.6);
  b.rects.forEach((r, i) => {
    const t0 = 0.12 + (i * span) / n;
    const a = clamp((b.local - t0) / 0.28, 0, 1);
    if (a >= 1) return; // fully shown: it's already in the art
    const pad = Math.max(r.w, r.h) * 0.06;
    const bx = (r.x - pad) / asset.width * asset.blur.width, by = (r.y - pad) / asset.height * asset.blur.height;
    const bw = (r.w + pad * 2) / asset.width * asset.blur.width, bh = (r.h + pad * 2) / asset.height * asset.blur.height;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + pad, r.h / 2 + pad, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(asset.blur, bx, by, bw, bh, r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
    ctx.restore();
    if (a > 0) {
      const e = easeOutBack(a);
      const sc = lerp(0.55, 1, e);
      ctx.save();
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(sc, sc);
      ctx.drawImage(asset.img, r.x, r.y, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
    }
  });
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
  z *= 1 + 0.05 * emphasisAt(project.emphasis, t);
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

/** "Encre" style is on while a diagram is drawn (set by drawDiagram) */
let encre = false;
let inkT = 0;

/** a comic panel on paper: hard spot-colour shadow, wobbly ink, the name on a caption over its bottom edge */
function cardInk(ctx: Ctx, project: Project, it: { label: string; sub?: string; pageId?: string; rect?: Rect }, cx: number, cy: number, w: number, h: number, a: number, accent: string, U: number) {
  if (a <= 0) return;
  const key = hashSeed(it.label || 'x');
  const seed = key + boil(inkT) * 131;
  const e = easeOutCubic(clamp(a, 0, 1));
  ctx.save();
  ctx.globalAlpha = Math.min(1, a * 2);
  ctx.translate(cx, cy + (1 - e) * U * 1.6);
  const tilt = ((key % 7) - 3) * 0.007;
  ctx.rotate(tilt * (1 + (1 - e) * 4));
  const s = lerp(1.14, 1, e);
  ctx.scale(s, s);
  const capFs = Math.min(U * 1.05, w * 0.16);
  const capH = capFs * 1.25 + (it.sub ? capFs * 0.7 : 0);
  inkBox(ctx, -w / 2, -h / 2, w, h, { fill: PAPER_CARD, lw: U * 0.16, shadow: accent, shadowOff: U * 0.42, seed });
  const m = U * 0.32;
  const inner = { x: -w / 2 + m, y: -h / 2 + m, w: w - 2 * m, h: h - 2 * m - capH * 0.45 };
  if (it.pageId && it.rect) {
    drawPanelIn(ctx, project, it.pageId, inner, baseView(it.rect, inner.w / inner.h, 'fill'), it.rect, { bg: false });
    ctx.strokeStyle = INK; ctx.lineWidth = U * 0.07; ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
  } else if (it.label) {
    // no panel: initials over a disc of spot-colour dots, printed not glowing
    const rr = Math.min(inner.w, inner.h) * 0.38, cy0 = inner.y + inner.h * 0.48;
    ctx.save();
    ctx.beginPath(); ctx.arc(0, cy0, rr, 0, Math.PI * 2); ctx.clip();
    benDay(ctx, -rr, cy0 - rr, rr * 2, rr * 2, accent, rr * 0.22, 'left');
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = U * 0.1;
    ctx.beginPath(); ctx.arc(0, cy0, rr, 0, Math.PI * 2); ctx.stroke();
    const mono = it.label.replace(/[^\p{L}\d ]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '•';
    ctx.font = `400 ${rr * (mono.length > 1 ? 0.95 : 1.2)}px ${TITLE}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = rr * 0.12; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
    ctx.strokeText(mono, 0, cy0 + rr * 0.06);
    ctx.fillStyle = '#fff';
    ctx.fillText(mono, 0, cy0 + rr * 0.06);
  }
  if (it.label) caption(ctx, it.label, it.sub, 0, h / 2 - capH * 0.75, capFs, { align: 'center', tilt: -tilt * 2, seed: seed + 11, maxW: w * 1.08 });
  ctx.restore();
}

function card(ctx: Ctx, project: Project, it: { label: string; sub?: string; pageId?: string; rect?: Rect }, cx: number, cy: number, w: number, h: number, a: number, accent: string, U: number) {
  if (a <= 0) return;
  if (encre) return cardInk(ctx, project, it, cx, cy, w, h, a, accent, U);
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
  if (imgH <= 0 && it.label) {
    // no panel: a monogram in an accent ring instead of an empty frame
    const rr = Math.min(w * 0.3, h * 0.24);
    const cy0 = -h / 2 + h * 0.36;
    const g = ctx.createRadialGradient(0, cy0, rr * 0.2, 0, cy0, rr);
    g.addColorStop(0, hexA(accent, 0.35)); g.addColorStop(1, hexA(accent, 0.08));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, cy0, rr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = U * 0.12; ctx.stroke();
    const mono = it.label.replace(/[^\p{L}\d ]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '•';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${rr * (mono.length > 1 ? 0.8 : 1)}px ${FONT_STACK.grotesk}`;
    ctx.fillText(mono, 0, cy0 + rr * 0.04);
  }
  const ly = imgH > 0 ? -h / 2 + imgH + U * 1.05 : it.label ? -h / 2 + h * 0.36 + Math.min(w * 0.3, h * 0.24) + U * 1.1 : -U * 0.5;
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

/** where each place sits (0..1 of the map); places not yet positioned are spread on a diagonal */
export function mapPoints(d: Diagram): { x: number; y: number; placed: boolean }[] {
  const n = d.items.length;
  return d.items.map((it, i) => (it.x != null && it.y != null ? { x: it.x, y: it.y, placed: true } : { x: 0.2 + (0.6 * (i + 0.5)) / Math.max(1, n), y: 0.3 + (0.4 * (i + 0.5)) / Math.max(1, n), placed: false }));
}

/**
 * Animated map. The camera opens on the whole map, travels to each place in
 * turn (the route draws as it goes), the pin drops with a pulse and its label,
 * then pulls back to show the whole journey.
 */
function drawMap(ctx: Ctx, project: Project, W: number, H: number, d: Diagram, local: number, dur: number, U: number, accent: string) {
  const n = d.items.length;
  const box = { x: 0, y: 0, w: W, h: H };
  const m = d.map;
  const area: Rect = m ? m.rect : { x: 0, y: 0, w: W, h: H };
  const pts = mapPoints(d).map((p) => ({ ...p, px: area.x + p.x * area.w, py: area.y + p.y * area.h }));
  const aspect = W / H;
  const whole: View = baseView(area, aspect, 'fit', 1.06);
  const zoomW = Math.max(area.w / 2.6, area.h * aspect / 2.6);
  const near = (i: number): View => ({ cx: pts[i].px, cy: pts[i].py, vw: zoomW });
  const intro = dur * 0.12, outro = dur * 0.14;
  const slot = n ? (dur - intro - outro) / n : 1;
  const cur = n ? Math.min(n - 1, Math.max(-1, Math.floor((local - intro) / slot))) : -1;
  const ease = EASE.cinematic;
  let view = whole;
  let travel = 0; // 0..1 of the trip to place `cur`
  if (local >= dur - outro && n) {
    const e = ease(clamp((local - (dur - outro)) / (outro * 0.8), 0, 1));
    const a = near(n - 1);
    view = { cx: lerp(a.cx, whole.cx, e), cy: lerp(a.cy, whole.cy, e), vw: lerp(a.vw, whole.vw, e) };
  } else if (cur >= 0) {
    travel = clamp((local - intro - cur * slot) / (slot * 0.42), 0, 1);
    const e = ease(travel);
    const a = cur === 0 ? whole : near(cur - 1), b = near(cur);
    // a long trip pulls back a little in the middle, like a camera on a crane
    const lift = Math.sin(Math.PI * e) * Math.hypot(b.cx - a.cx, b.cy - a.cy) * 0.35;
    view = { cx: lerp(a.cx, b.cx, e), cy: lerp(a.cy, b.cy, e), vw: lerp(a.vw, b.vw, e) + (cur === 0 ? 0 : lift) };
  }
  if (m) drawPanelIn(ctx, project, m.pageId, box, view, area, { bg: true });
  else if (encre) paperBackground(ctx, W, H, accent, U, local);
  else { ctx.drawImage(halftone(W, H, accent), 0, 0); }
  const s = W / view.vw;
  const toScreen = (x: number, y: number) => [W / 2 + (x - view.cx) * s, H / 2 + (y - view.cy) * s] as const;
  if (encre) { if (m) paperTexture(ctx, W, H, 0.4); drawMapInk(ctx, W, H, d, local, dur, U, accent, pts.map((p) => toScreen(p.px, p.py)), cur, travel, intro, slot, outro); return; }
  // routes drawn so far
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = U * 0.22;
  ctx.setLineDash([U * 0.7, U * 0.45]);
  ctx.strokeStyle = accent;
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = U * 0.4;
  for (let i = 1; i < n; i++) {
    const done = local >= dur - outro ? 1 : i < cur ? 1 : i === cur ? travel : 0;
    if (done <= 0) continue;
    const [x0, y0] = toScreen(pts[i - 1].px, pts[i - 1].py), [x1, y1] = toScreen(pts[i].px, pts[i].py);
    const mx = (x0 + x1) / 2 - (y1 - y0) * 0.15, my = (y0 + y1) / 2 + (x1 - x0) * 0.15;
    ctx.beginPath();
    const steps = 40;
    for (let k = 0; k <= steps * done; k++) {
      const t = k / steps, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      const x = a * x0 + b * mx + c * x1, y = a * y0 + b * my + c * y1;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // pins and labels
  for (let i = 0; i < n; i++) {
    const shown = local >= dur - outro || i < cur || (i === cur && travel >= 0.85);
    if (!shown) continue;
    const t0 = intro + i * slot + slot * 0.36;
    const pop = local >= dur - outro && i > cur ? 1 : clamp((local - t0) / 0.35, 0, 1);
    const [x, y] = toScreen(pts[i].px, pts[i].py);
    const r = U * 0.55 * lerp(0.2, 1, easeOutBack(pop));
    if (i === cur && local < dur - outro) {
      const ph = ((local - t0) % 1.2) / 1.2;
      ctx.strokeStyle = hexA(accent, 0.8 * (1 - ph));
      ctx.lineWidth = U * 0.12;
      ctx.beginPath(); ctx.arc(x, y, r + U * 1.6 * ph, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = U * 0.5;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = U * 0.14; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.restore();
    // label: full card on the current place, compact on the others
    const it = d.items[i];
    const big = i === cur && local < dur - outro;
    const la = big ? clamp((local - t0 - 0.15) / 0.3, 0, 1) : 1;
    if (la <= 0 || !it.label) continue;
    ctx.save();
    ctx.globalAlpha = la;
    const fs = U * (big ? 1.25 : 0.75);
    ctx.font = `700 ${fs}px ${FONT_STACK.grotesk}`;
    const tw = ctx.measureText(it.label.toUpperCase()).width;
    ctx.font = `500 ${fs * 0.62}px ${FONT_STACK.inter}`;
    const sw = big && it.sub ? ctx.measureText(it.sub).width : 0;
    const bw = Math.max(tw, sw) + fs * 1.4, bh = fs * (big && it.sub ? 2.35 : 1.55);
    let bx = x + r + U * 0.5, by = y - bh / 2;
    if (bx + bw > W - U) bx = x - r - U * 0.5 - bw;
    by = clamp(by, U, H - bh - U);
    ctx.fillStyle = 'rgba(12,12,16,0.86)';
    ctx.beginPath(); ctx.roundRect(bx, by + (1 - la) * U, bw, bh, fs * 0.3); ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(bx, by + (1 - la) * U, fs * 0.18, bh);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px ${FONT_STACK.grotesk}`;
    ctx.fillText(it.label.toUpperCase(), bx + fs * 0.6, by + (1 - la) * U + (big && it.sub ? fs * 0.78 : bh / 2));
    if (big && it.sub) { ctx.font = `500 ${fs * 0.62}px ${FONT_STACK.inter}`; ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.fillText(it.sub, bx + fs * 0.6, by + (1 - la) * U + fs * 1.72); }
    ctx.restore();
  }
}


/** the map annotated like a comic: brush route with an arrow, felt-pen circles, numbered stamps, yellow captions */
function drawMapInk(ctx: Ctx, W: number, H: number, d: Diagram, local: number, dur: number, U: number, accent: string, scr: (readonly [number, number])[], cur: number, travel: number, intro: number, slot: number, outro: number) {
  const n = d.items.length, end = local >= dur - outro, b = boil(local) * 97;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 1; i < n; i++) {
    const done = end ? 1 : i < cur ? 1 : i === cur ? travel : 0;
    if (done <= 0) continue;
    const [x0, y0] = scr[i - 1], [x1, y1] = scr[i];
    const full = bowPath(x0, y0, x1, y1, i % 2 ? 0.16 : -0.16, 60);
    // stop short of both places so the line never runs through the felt circles
    const gap = U * 1.7;
    const path = full.filter(([px, py]) => Math.hypot(px - x0, py - y0) > gap && Math.hypot(px - x1, py - y1) > gap);
    if (path.length < 2) continue;
    // paper halo first so the ink reads on dark and light map areas alike
    brush(ctx, path, U * 0.62, 'rgba(251,246,234,0.9)', 5 + i, done, U * 0.95);
    brush(ctx, path, U * 0.3, INK, 9 + i + b, done, U * 0.95);
    arrowHead(ctx, path, done, U * 1.1, INK);
  }
  for (let i = 0; i < n; i++) {
    const shown = end || i < cur || (i === cur && travel >= 0.85);
    if (!shown) continue;
    const t0 = intro + i * slot + slot * 0.36;
    const pop = end && i > cur ? 1 : clamp((local - t0) / 0.5, 0, 1);
    const [x, y] = scr[i];
    const big = i === cur && !end;
    // the exact spot: an ink dot
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(x, y, U * 0.26, 0, Math.PI * 2); ctx.fill();
    feltCircle(ctx, x, y, U * (big ? 1.5 : 1.05), accent, U * (big ? 0.34 : 0.26), pop, 31 * (i + 1) + b);
    // numbered stamp
    const sp = easeOutBack(clamp((local - t0 - 0.1) / 0.3, 0, 1));
    if (end && i > cur) { /* final recap: all stamps */ }
    const st = end ? 1 : sp;
    if (st > 0) {
      const r = U * 0.62 * st, bx = x - U * 1.35, by = y - U * 1.35;
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(bx + U * 0.12, by + U * 0.12, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = CAPTION; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = U * 0.1; ctx.stroke();
      ctx.fillStyle = INK; ctx.font = `400 ${r * 1.25}px ${TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), bx, by + r * 0.06);
    }
    const it = d.items[i];
    const la = big ? clamp((local - t0 - 0.2) / 0.35, 0, 1) : 1;
    if (la <= 0 || !it.label) continue;
    // a place out of shot keeps its label out of shot too
    if (x < -U || x > W + U || y < -U || y > H + U) continue;
    const fs = U * (big ? 1.35 : 0.85);
    ctx.font = `400 ${fs}px ${TITLE}`;
    const tw = Math.min(W * 0.62, ctx.measureText(it.label.toUpperCase()).width + fs * 1.2);
    const th = fs * 1.25 + (big && it.sub ? fs * 0.7 : 0);
    const minY = (H > W ? H * 0.075 : H * 0.06) + U * 4.2, maxY = H - U * 4;
    // try right, left, above, below the place; then slide down until no label is hit
    const hits = (bx: number, by: number) => placed.some((q) => bx < q.x + q.w + U * 0.3 && q.x < bx + tw + U * 0.3 && by < q.y + q.h + U * 0.3 && q.y < by + th + U * 0.3)
      || scr.some(([px, py]) => px > bx - U && px < bx + tw + U && py > by - U && py < by + th + U);
    const cands: [number, number][] = [[x + U * 1.9, y - th / 2], [x - U * 1.9 - tw, y - th / 2], [x - tw / 2, y - U * 2 - th], [x - tw / 2, y + U * 2]];
    let lx = cands[0][0], ly = cands[0][1];
    search: for (let dy = 0; dy < H * 0.4; dy += th * 0.6) {
      for (const [cx0, cy0] of cands) {
        const bx = clamp(cx0, U * 1.2, W - tw - U * 1.2), by = clamp(cy0 + dy, minY, maxY);
        if (!hits(bx, by)) { lx = bx; ly = by; break search; }
      }
    }
    placed.push({ x: lx, y: ly, w: tw, h: th });
    caption(ctx, it.label, big ? it.sub : undefined, lx, ly, fs, { tilt: i % 2 ? 0.025 : -0.025, seed: 51 * (i + 1) + b, a: big ? la : 1, maxW: W * 0.62 });
  }
}

const FALLBACK_2D: Partial<Record<Diagram['kind'], Diagram['kind']>> = { orbit: 'ranking', cosmos: 'ranking', tiers: 'scale' };

/** a figure that counts up while its bar grows (manim's DecimalNumber) */
function fmtValue(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + ' Md';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + ' M';
  if (a >= 1e4) return Math.round(v / 1e3) + ' k';
  return a >= 100 ? String(Math.round(v)) : String(+v.toFixed(1));
}

function drawDiagram(ctx: Ctx, project: Project, W: number, H: number, d: Diagram, local: number, dur: number) {
  const accent = project.accent;
  const vertical = H > W;
  const U = Math.min(W, H) * 0.035;
  const in3D = DIAGRAM_3D.includes(d.kind) && draw3D(ctx, project, d, W, H, local, dur);
  encre = !in3D && (project.diagramStyle ?? 'encre') === 'encre';
  inkT = local;
  if (!in3D) {
    if (d.kind !== 'map') { if (encre) paperBackground(ctx, W, H, accent, U, local); else ctx.drawImage(halftone(W, H, accent), 0, 0); }
    const fb = FALLBACK_2D[d.kind];
    if (fb) d = { ...d, kind: fb };
  }
  // the map fills the frame: drawn first, the title goes on top of it
  if (d.kind === 'map' && !in3D) drawMap(ctx, project, W, H, d, local, dur, U, accent);
  const z = 1 + 0.03 * easeInOutSine(clamp(local / dur, 0, 1));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, z);
  ctx.translate(-W / 2, -H / 2);
  // title
  if (d.title && encre) {
    const a = clamp(local / 0.35, 0, 1);
    const ty = (vertical ? H * 0.075 : H * 0.06) + (d.kind === 'map' ? U * 0.6 : 0);
    caption(ctx, d.title, undefined, W / 2, ty, U * (vertical ? 2.3 : 2.0), { align: 'center', tilt: -0.03, seed: 3 + boil(local) * 17, a: easeOutBack(a), maxW: W * 0.86 });
  } else if (d.title) {
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
  if (!n || in3D) { ctx.restore(); if (encre) panelFrame(ctx, W, H, U, 1 + boil(local)); encre = false; return; }
  const span = Math.max(0.5, dur * 0.7);
  const appear = (i: number) => clamp((local - 0.35 - (i * span) / n) / 0.45, 0, 1);
  const top = vertical ? H * 0.17 : H * 0.22, bottom = H * 0.93;

  if (d.kind === 'map') {
    /* drawn before the title (see above) */
  } else if (d.kind === 'quote') {
    // a quotation: the words appear as they are read, then the source signs it
    const it = d.items[0];
    const words = (it.label || '').split(/\s+/).filter(Boolean);
    const hasImg = !!(it.pageId && it.rect);
    const box = vertical ? { x: W * 0.1, y: top + U * 2, w: W * 0.8, h: (bottom - top) * (hasImg ? 0.5 : 0.75) } : { x: hasImg ? W * 0.42 : W * 0.12, y: top + U, w: hasImg ? W * 0.5 : W * 0.76, h: bottom - top - U * 3 };
    if (hasImg) {
      const a = easeOutCubic(clamp((local - 0.1) / 0.6, 0, 1));
      const iw = vertical ? W * 0.7 : W * 0.3, ih = vertical ? (bottom - top) * 0.36 : (bottom - top) * 0.8;
      const ix = vertical ? (W - iw) / 2 : W * 0.07, iy = vertical ? bottom - ih - U : top + (bottom - top - ih) / 2;
      ctx.save(); ctx.globalAlpha = a;
      const pb: Box = { x: ix, y: iy + (1 - a) * U * 2, w: iw, h: ih };
      if (encre) inkBox(ctx, pb.x, pb.y, pb.w, pb.h, { fill: PAPER_CARD, lw: U * 0.16, shadow: accent, shadowOff: U * 0.45, seed: 77 + boil(local) });
      drawPanelIn(ctx, project, it.pageId!, pb, baseView(it.rect!, pb.w / pb.h, 'fill'), it.rect!, { bg: false });
      if (encre) { ctx.strokeStyle = INK; ctx.lineWidth = U * 0.16; ctx.strokeRect(pb.x, pb.y, pb.w, pb.h); }
      else { ctx.strokeStyle = accent; ctx.lineWidth = U * 0.18; ctx.strokeRect(pb.x, pb.y, pb.w, pb.h); }
      ctx.restore();
    }
    const qFont = (f: number) => (encre ? `700 ${f}px ${LETTER}` : `600 ${f}px ${FONT_STACK.grotesk}`);
    if (encre) { box.x += U * 1.2; box.w -= U * 2.4; }
    let fs = U * (words.length > 18 ? 1.5 : words.length > 10 ? 1.9 : 2.4);
    ctx.font = qFont(fs);
    const lines: string[] = [];
    const wrap = () => { lines.length = 0; let cur = ''; for (const w of words) { const t2 = cur ? cur + ' ' + w : w; if (ctx.measureText(t2).width > box.w && cur) { lines.push(cur); cur = w; } else cur = t2; } if (cur) lines.push(cur); };
    wrap();
    while (lines.length * fs * 1.25 > box.h * 0.8 && fs > U) { fs *= 0.9; ctx.font = qFont(fs); wrap(); }
    const per = Math.max(0.05, Math.min(0.22, (dur * 0.55) / Math.max(1, words.length)));
    const shown = Math.floor(clamp((local - 0.3) / per, 0, words.length));
    const y0 = box.y + fs * 1.4;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (encre) {
      // the quotation is said: a real speech balloon, its tail toward the speaker's panel
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const bw = widest + fs * 2.6, bh = lines.length * fs * 1.25 + fs * 2.2;
      const bx = box.x + (box.w - widest) / 2 - fs * 1.3, by = y0 - fs * 1.1;
      const pop = easeOutBack(clamp(local / 0.35, 0, 1));
      const tx = hasImg ? (vertical ? W / 2 + W * 0.12 : W * 0.3) : bx + bw * 0.22;
      const ty = hasImg ? (vertical ? by + bh + U * 3 : (top + bottom) / 2) : by + bh + fs * 2.2;
      ctx.save();
      ctx.translate(bx + bw / 2, by + bh / 2); ctx.scale(pop, pop); ctx.translate(-(bx + bw / 2), -(by + bh / 2));
      balloon(ctx, bx, by, bw, bh, tx, ty, U * 0.18, 5 + boil(local));
      ctx.restore();
      box.x = bx + (bw - widest) / 2;
    } else {
      ctx.fillStyle = accent;
      ctx.font = `700 ${fs * 2.6}px ${FONT_STACK.grotesk}`;
      ctx.globalAlpha = clamp(local / 0.3, 0, 1);
      ctx.fillText('«', box.x - fs * 0.4, box.y - fs * 0.9);
      ctx.globalAlpha = 1;
    }
    ctx.font = qFont(fs);
    let k = 0;
    lines.forEach((ln, li) => {
      let x = box.x;
      for (const w of ln.split(' ')) {
        const a = clamp((local - 0.3 - k * per) / 0.25, 0, 1);
        if (a > 0) { ctx.globalAlpha = a; ctx.fillStyle = encre ? INK : '#fff'; ctx.fillText(w, x, y0 + li * fs * 1.25 + (1 - a) * fs * 0.3); }
        x += ctx.measureText(w + ' ').width;
        k++;
      }
    });
    ctx.globalAlpha = 1;
    if (it.sub && shown >= words.length && encre) {
      const a = clamp((local - 0.3 - words.length * per - 0.2) / 0.4, 0, 1);
      caption(ctx, '— ' + it.sub, undefined, box.x + box.w * 0.15, y0 + lines.length * fs * 1.25 + fs * 1.6, fs * 0.75, { tilt: 0.02, seed: 9 + boil(local), a: easeOutBack(a), maxW: W * 0.8 });
    } else if (it.sub && shown >= words.length) {
      const a = easeOutCubic(clamp((local - 0.3 - words.length * per - 0.2) / 0.4, 0, 1));
      ctx.globalAlpha = a;
      ctx.fillStyle = accent;
      ctx.font = `700 ${fs * 0.55}px ${FONT_STACK.inter}`;
      ctx.fillText('— ' + it.sub, box.x, y0 + lines.length * fs * 1.25 + fs * 0.5);
      ctx.globalAlpha = 1;
    }
  } else if (d.kind === 'scale') {
    // manim-style chart: axes are drawn on, bars grow, the figures count up
    const vals = itemValues(d);
    const numeric = d.items.every((it) => Number.isFinite(parseFloat(String(it.sub ?? '').replace(/\s/g, '').replace(',', '.'))));
    const vmax = Math.max(...vals), vmin = Math.min(...vals);
    const useLog = vmax / Math.max(1e-9, vmin) > 40;
    const norm = (v: number) => (useLog ? Math.log1p(v) / Math.log1p(vmax) : v / vmax);
    const ax = EASE.standard(clamp((local - 0.15) / 0.6, 0, 1));
    ctx.strokeStyle = encre ? INK : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = U * (encre ? 0.2 : 0.12);
    ctx.lineCap = 'round';
    const valueFont = (f: number) => (encre ? `400 ${f * 1.25}px ${TITLE}` : `700 ${f}px ${FONT_STACK.grotesk}`);
    /** a printed bar: flat spot colour, a band of dots on its shaded side, ink outline */
    const inkBar = (x: number, y: number, w: number, h: number, i: number) => {
      if (w <= 0 || h <= 0) return;
      inkBox(ctx, x, y, w, h, { fill: accent, lw: U * 0.14, shadow: INK, shadowOff: U * 0.22, seed: 300 + i + boil(local) * 13, amp: U * 0.03 });
      if (vertical) benDay(ctx, x, y + h * 0.62, w, h * 0.38, INK, U * 0.45, 'flat', 0.35);
      else benDay(ctx, x + w * 0.62, y, w * 0.38, h, INK, U * 0.45, 'right', 0.35);
    };
    if (!vertical) {
      const x0 = W * 0.07, x1 = W * 0.95, yb = bottom - U * 1.4, yt = top + U * 0.8;
      ctx.beginPath(); ctx.moveTo(x0, yb); ctx.lineTo(x0 + (x1 - x0) * ax, yb); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, yb); ctx.lineTo(x0, yb - (yb - yt) * ax); ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.12 * ax; ctx.setLineDash([U * 0.4, U * 0.4]); ctx.lineWidth = U * 0.06;
      for (let k = 1; k <= 4; k++) { const y = yb - ((yb - yt) * k) / 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      ctx.restore();
      const step = (x1 - x0) / n, ch = Math.min((yb - yt) * 0.42, step * 1.1), cw = Math.min(step * 0.86, ch * 0.95);
      d.items.forEach((it, i) => {
        const g = EASE.enter(appear(i));
        const cx = x0 + step * (i + 0.5);
        const bh = (yb - yt - ch - U) * norm(vals[i]) * g;
        if (encre) inkBar(cx - step * 0.22, yb - bh, step * 0.44, bh, i);
        else {
          const grad = ctx.createLinearGradient(0, yb - bh, 0, yb);
          grad.addColorStop(0, accent); grad.addColorStop(1, hexA(accent, 0.25));
          ctx.fillStyle = grad;
          ctx.fillRect(cx - step * 0.22, yb - bh, step * 0.44, bh);
        }
        card(ctx, project, { ...it, sub: numeric ? undefined : it.sub }, cx, yb - bh - ch / 2 - U * 0.3, cw, ch, appear(i), accent, U);
        if (numeric && g > 0) {
          ctx.fillStyle = encre ? '#fff' : '#fff'; ctx.font = valueFont(U * 1.1); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (encre) { ctx.lineWidth = U * 0.25; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.strokeText(fmtValue(vals[i] * g), cx, yb - bh / 2, step * 0.9); }
          ctx.fillText(fmtValue(vals[i] * g), cx, yb - bh / 2, step * 0.9);
        }
      });
    } else {
      const x0 = W * 0.08, x1 = W * 0.94, y0 = top + U, y1 = bottom - U;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + (y1 - y0) * ax); ctx.stroke();
      const step = (y1 - y0) / n, ch = step * 0.84, cw = Math.min(W * 0.3, ch * 0.9);
      d.items.forEach((it, i) => {
        const g = EASE.enter(appear(i));
        const cy = y0 + step * (i + 0.5);
        card(ctx, project, { ...it, sub: numeric ? undefined : it.sub }, x0 + U * 0.6 + cw / 2, cy, cw, ch, appear(i), accent, U);
        const bx = x0 + cw + U * 1.2, bw = (x1 - bx) * norm(vals[i]) * g;
        if (encre) inkBar(bx, cy - ch * 0.18, bw, ch * 0.36, i);
        else {
          const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
          grad.addColorStop(0, hexA(accent, 0.3)); grad.addColorStop(1, accent);
          ctx.fillStyle = grad;
          ctx.fillRect(bx, cy - ch * 0.18, bw, ch * 0.36);
        }
        if (numeric && g > 0) {
          ctx.fillStyle = encre ? INK : '#fff'; ctx.font = valueFont(U * 1.1); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(fmtValue(vals[i] * g), bx + U * 0.4, cy - ch * 0.32);
        }
      });
    }
  } else if (d.kind === 'timeline') {
    if (vertical) {
      const x = W / 2, y0 = top + U, y1 = bottom - U;
      const step = (y1 - y0) / Math.max(1, n);
      const prog = clamp((local - 0.3) / span, 0, 1);
      if (encre) brush(ctx, [[x, y0], [x, y0 + (y1 - y0) * 0.5], [x, y1]], U * 0.4, INK, 41 + boil(local), prog);
      else {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x - U * 0.1, y0, U * 0.2, y1 - y0);
      ctx.fillStyle = accent;
      ctx.fillRect(x - U * 0.1, y0, U * 0.2, (y1 - y0) * prog);
      }
      const cw = W * 0.4, ch = Math.min(step * 0.92, cw * 0.95);
      d.items.forEach((it, i) => {
        const cy = y0 + step * (i + 0.5), a = appear(i);
        ctx.fillStyle = a > 0 ? accent : encre ? 'rgba(21,18,15,0.25)' : 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.arc(x, cy, U * 0.45, 0, Math.PI * 2); ctx.fill();
        if (encre) { ctx.strokeStyle = INK; ctx.lineWidth = U * 0.14; ctx.stroke(); }
        card(ctx, project, it, i % 2 ? x + U + cw / 2 : x - U - cw / 2, cy, cw, ch, a, accent, U);
      });
    } else {
      const y = (top + bottom) / 2, x0 = W * 0.06, x1 = W * 0.94;
      const step = (x1 - x0) / Math.max(1, n);
      const prog = clamp((local - 0.3) / span, 0, 1);
      if (encre) brush(ctx, [[x0, y], [(x0 + x1) / 2, y], [x1, y]], U * 0.4, INK, 41 + boil(local), prog);
      else {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x0, y - U * 0.1, x1 - x0, U * 0.2);
      ctx.fillStyle = accent;
      ctx.fillRect(x0, y - U * 0.1, (x1 - x0) * prog, U * 0.2);
      }
      const cw = Math.min(step * 0.92, W * 0.24), ch = (bottom - top) / 2 - U * 1.2;
      d.items.forEach((it, i) => {
        const cx = x0 + step * (i + 0.5), a = appear(i);
        ctx.fillStyle = a > 0 ? accent : encre ? 'rgba(21,18,15,0.25)' : 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.arc(cx, y, U * 0.45, 0, Math.PI * 2); ctx.fill();
        if (encre) { ctx.strokeStyle = INK; ctx.lineWidth = U * 0.14; ctx.stroke(); }
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
      if (encre) { ctx.save(); ctx.translate(U * 0.3, U * 0.3); ctx.fillStyle = INK; ctx.fill(); ctx.restore(); ctx.fillStyle = CAPTION; }
      ctx.fill();
      if (encre) { ctx.lineWidth = U * 0.18; ctx.strokeStyle = INK; ctx.stroke(); }
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
      if (encre) {
        ctx.lineJoin = 'round';
        ctx.fillStyle = INK; ctx.fillText(`#${i + 1}`, W / 2 - cw / 2 - U * 0.6 + U * 0.25, cy + U * 0.25);
        ctx.lineWidth = U * 0.18; ctx.strokeStyle = INK; ctx.strokeText(`#${i + 1}`, W / 2 - cw / 2 - U * 0.6, cy);
      }
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
    // cards never overlap: the ring is as tall as the space allows, the cards as big as the ring allows
    const avail = (bottom - top) / 2;
    let cs = Math.min(W, H) * (n > 5 ? 0.2 : 0.25);
    if (hub) cs = Math.min(cs, (avail * 0.55) / 1.15); // leaves a visible gap (and the link) between centre and ring
    const Ry = hub ? Math.max(cs * 1.15, avail - (cs * 1.15) / 2) : Math.min(W * 0.36, (bottom - top) * 0.36);
    const Rx = vertical ? Math.min(W * 0.36, Ry * 0.95) : Math.min(W * 0.4, Math.max(Ry * 1.6, cs * 2.2));
    const pos = d.items.map((_, i) => {
      if (hub && i === 0) return [cx, cy];
      const k = hub ? i - 1 : i, m = ring.length;
      const ang = -Math.PI / 2 + (k / m) * Math.PI * 2;
      return [cx + Math.cos(ang) * Rx, cy + Math.sin(ang) * Ry];
    });
    const linkT = clamp((local - 0.35 - span) / 0.5, 0, 1);
    const links: Diagram['links'] = d.links.length ? d.links : hub ? ring.map((_, k) => ({ a: 0, b: k + 1 })) : [];
    ctx.save();
    // colour = nature of the relation, line = how sure it is (fact, reading, hypothesis)
    const KIND_COL: Record<string, string> = { allie: accent, ennemi: '#ff4d4d', famille: '#6cb8ff', autre: '#d9d9e0' };
    const DASH: Record<string, number[]> = { source: [], interpretation: [U * 0.9, U * 0.5], hypothese: [U * 0.15, U * 0.45] };
    ctx.lineWidth = U * 0.2;
    ctx.lineCap = 'round';
    for (const [li, l] of links.entries()) {
      const pa = pos[l.a], pb = pos[l.b];
      if (!pa || !pb) continue;
      const e = clamp(linkT * links.length - li * 0.5, 0, 1);
      if (e <= 0) continue;
      ctx.strokeStyle = KIND_COL[l.kind ?? ''] ?? accent;
      ctx.setLineDash(l.status ? DASH[l.status] : [U * 0.6, U * 0.4]);
      ctx.globalAlpha = l.status === 'hypothese' ? 0.8 : 1;
      if (encre) {
        const col = l.kind && l.kind !== 'autre' ? (KIND_COL[l.kind] ?? INK) : INK;
        const path = bowPath(pa[0], pa[1], pb[0], pb[1], 0.06, 30);
        const dash = l.status === 'hypothese' ? U * 0.35 : l.status === 'interpretation' ? U * 0.9 : undefined;
        brush(ctx, path, U * 0.5, col, 60 + li + boil(local) * 7, e, dash);
      } else {
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(lerp(pa[0], pb[0], e), lerp(pa[1], pb[1], e));
        ctx.stroke();
      }
      if (l.label && e >= 1 && encre) {
        const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
        ctx.save(); ctx.setLineDash([]);
        ctx.font = `400 ${U * 0.75}px ${TITLE}`;
        const tw = ctx.measureText(l.label.toUpperCase()).width + U * 0.75;
        caption(ctx, l.label + (l.status === 'hypothese' ? ' ?' : ''), undefined, mx - tw / 2, my - U * 0.55, U * 0.75, { tilt: (li % 2 ? 1 : -1) * 0.04, seed: 90 + li, fill: '#fff' });
        ctx.restore();
      } else if (l.label && e >= 1) {
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
        ctx.fillText(l.label.toUpperCase() + (l.status === 'hypothese' ? ' ?' : ''), mx, my);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    // legend, only when the diagram mixes certainties
    const used = [...new Set(links.map((l) => l.status).filter(Boolean))] as string[];
    if (used.length && linkT > 0) {
      const LBL: Record<string, string> = { source: 'Fait sourcé', interpretation: 'Interprétation', hypothese: 'Hypothèse' };
      ctx.globalAlpha = clamp(linkT * 2, 0, 1);
      ctx.font = `600 ${U * 0.62}px ${FONT_STACK.inter}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let lx = W * 0.05;
      const ly = H - U * 1.6;
      for (const k of ['source', 'interpretation', 'hypothese'].filter((x) => used.includes(x))) {
        ctx.strokeStyle = encre ? INK : '#fff';
        ctx.setLineDash(DASH[k]);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + U * 2, ly); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = encre ? INK : 'rgba(255,255,255,0.85)';
        if (encre) ctx.font = `700 ${U * 0.7}px ${LETTER}`;
        ctx.fillText(LBL[k], lx + U * 2.4, ly);
        lx += U * 2.8 + ctx.measureText(LBL[k]).width + U * 1.2;
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    d.items.forEach((it, i) => card(ctx, project, it, pos[i][0], pos[i][1], cs, cs * 1.15, appear(i), accent, U));
  }
  ctx.restore();
  if (encre) panelFrame(ctx, W, H, U, 1 + boil(local));
  encre = false;
}

/* ---------------------------------------------------- print & lens */

let paperTile: HTMLCanvasElement | null = null;
/** printed-comic feel: warm paper fibres and a faint halftone over the comic art */
function drawPaper(ctx: Ctx, W: number, H: number, amount: number) {
  if (amount <= 0) return;
  if (!paperTile) {
    paperTile = document.createElement('canvas');
    paperTile.width = paperTile.height = 192;
    const x = paperTile.getContext('2d')!;
    const im = x.createImageData(192, 192);
    const rnd = rng(hashSeed('paper'));
    for (let i = 0; i < im.data.length; i += 4) {
      const p = i / 4, px = p % 192, py = (p / 192) | 0;
      const fibre = Math.sin(px * 0.9 + Math.sin(py * 0.13) * 6) * 8 + (rnd() - 0.5) * 26;
      const dot = ((px % 6) - 3) ** 2 + ((py % 6) - 3) ** 2 < 3 ? -18 : 0;
      const v = 236 + fibre + dot;
      im.data[i] = v; im.data[i + 1] = v - 6; im.data[i + 2] = v - 18; im.data[i + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.55 * amount;
  ctx.fillStyle = ctx.createPattern(paperTile, 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** lens split on impacts: red and blue fringes that settle in a few frames */
function chroma(ctx: Ctx, W: number, H: number, src: HTMLCanvasElement, amount: number) {
  if (amount <= 0.02) return;
  const d = Math.max(1, Math.round(Math.min(W, H) * 0.012 * amount));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.5 * amount;
  ctx.filter = 'sepia(1) saturate(6) hue-rotate(-50deg)';
  ctx.drawImage(src, -d, 0);
  ctx.filter = 'sepia(1) saturate(6) hue-rotate(170deg)';
  ctx.drawImage(src, d, 0);
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
      const rnd = rng(hashSeed('grain'));
      for (let i = 0; i < im.data.length; i += 4) {
        const v = rnd() * 255;
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

function drawTitleCard(ctx: Ctx, W: number, H: number, shot: Shot, local: number, accent: string, inkStyle = false) {
  if (inkStyle && !shot.titleBg) {
    // printed look: newsprint, a band of spot-colour dots, a panel border
    const U = Math.min(W, H) * 0.035;
    paperBackground(ctx, W, H, accent, U, local);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.55, 0); ctx.lineTo(0, H * 0.35); ctx.closePath(); ctx.clip();
    benDay(ctx, 0, 0, W, H, INK, U * 0.7, 'left', 0.18);
    ctx.restore();
    panelFrame(ctx, W, H, U, 7 + boil(local));
    return;
  }
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
export function drawCaption(ctx: Ctx, W: number, H: number, cap: Caption, local: number, dur: number, isTitle = false, wordTimes?: number[], accent = '#FF5A1F', keys?: Set<string>) {
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
    case 'slide': {
      const a = easeOutCubic(clamp(local / 0.35, 0, 1));
      alpha = a;
      ctx.translate(0, (1 - a) * size * 0.9);
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
      // with keywords on, colour means « important word »: the spoken word only pops (scale), it does not change colour
      const isKey = !!keys?.has(keyToken(words[wi]));
      ctx.fillStyle = isKey ? accent : isHi && !keys ? hiColor : P.fill;
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
    const pad = (1 + Math.abs(sx) / W * 2.2 + Math.abs(sy) / H * 2.2 + Math.abs(rot) * 1.2 + (hx || hy ? 0.012 : 0)) * (layoutKind === 'title' ? 1 : 1 + 0.035 * emphasisAt(project.emphasis, t));
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
        } else if (shot.titleBg === 'brand') {
          drawChapter(ctx, W, H, brandOf(project), shot.caption.text, local);
        } else if (shot.titleBg === 'intro') {
          drawIntro(ctx, W, H, brandOf(project), local);
        } else if (shot.titleBg === 'outro') {
          drawEndScreen(ctx, W, H, brandOf(project), local);
        } else if (shot.diagram) {
          drawDiagram(ctx, project, W, H, shot.diagram, local, shot.duration);
        } else drawTitleCard(ctx, W, H, shot, local, project.accent, (project.diagramStyle ?? 'encre') === 'encre');
        break;
      case 'full': {
        const view = override?.view ?? cameraAt(shot, p, W / H, rtl);
        const L = !override && project.look?.parallax !== false && !shot.zone ? layersFor(project, shot) : null;
        let layers;
        if (L) {
          const e = easeInOutSine(clamp(p, 0, 1));
          const A = shot.rect.w * 0.03 * (0.5 + shot.intensity);
          const m = resolveMotion(shot, W / H, rtl).motion;
          const dx = m === 'pan-right' ? (0.5 - e) * A * 2 : m === 'pan-left' ? (e - 0.5) * A * 2 : (e - 0.5) * A * 0.8;
          const dy = m === 'pan-down' ? (0.5 - e) * A * 2 : m === 'pan-up' ? (e - 0.5) * A * 2 : 0;
          const sc = m === 'zoom-in' ? 1 + 0.045 * e : m === 'zoom-out' ? 1.045 - 0.045 * e : 1.015;
          layers = { L, dx, dy, s: sc };
        }
        const balloons = !override && project.look?.balloonPop && shot.balloons?.length ? { rects: shot.balloons, local, dur: shot.duration } : undefined;
        drawPanelIn(ctx, project, shot.pageId!, full, view, override?.clip ?? shot.rect, { dimPage: project.background === 'page' ? 0.72 : 0, layers, balloons });
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
    if (layoutKind !== 'title') drawPaper(ctx, W, H, project.look?.paper ?? 0);
    if (shot.shake > 0 && project.look?.speedLines !== false && layoutKind !== 'title') speedLines(ctx, W, H, local, shot.shake);
    if (shot.pageId == null) {
      if (!['brand', 'intro', 'outro'].includes(shot.titleBg ?? '')) drawCaption(ctx, W, H, shot.caption, local, shot.duration, true, undefined, project.accent);
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
    if (project.look?.chroma !== false && st.kind === 'shot' && st.ts.shot.shake > 0) {
      const local = t - st.ts.start;
      const amt = Math.exp(-local * 9) * Math.min(1, st.ts.shot.shake);
      if (amt > 0.02) {
        actx.setTransform(1, 0, 0, 1, 0, 0);
        actx.globalAlpha = 1;
        actx.drawImage(ctx.canvas, 0, 0, W, H);
        chroma(ctx, W, H, A, amt);
      }
    }
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
          // vertical videos: never under the TikTok / Shorts buttons and description
          const y0 = lay === 'split' && vertical ? 0.56 : project.subtitleStyle.y;
          const y = project.format === '9:16' ? Math.min(0.78, Math.max(0.12, y0)) : y0;
          const cap: Caption = { ...project.subtitleStyle, text: sub.text, y };
          drawCaption(ctx, W, H, cap, t - sub.s, sub.e - sub.s, false, sub.words.map((w) => w.s - sub.s), project.accent, project.subtitleStyle.keywords === false ? undefined : subtitleKeys(project));
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
        if (TRANSITION[ts.shot.transition]?.moves && local < td) return true;
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
      const def = TRANSITION[shot.transition];
      const e = EASE.standard(a);
      const amt = tp(shot, 'amount');
      if (def?.gl) {
        ctx.drawImage(A, 0, 0);
        if (!drawGlTransition(ctx, def.gl, A, B, a, shot.tp ?? {})) {
          ctx.globalAlpha = EASE.soft(a);
          ctx.drawImage(B, 0, 0);
        }
        ctx.globalAlpha = 1;
        overlays(ctx, project, t, total, cur);
        return;
      }
      switch (kind) {
        case 'fade':
          ctx.drawImage(A, 0, 0);
          ctx.globalAlpha = EASE.soft(a);
          ctx.drawImage(B, 0, 0);
          break;
        case 'slide':
          if (vertical) { ctx.drawImage(A, 0, -e * H); ctx.drawImage(B, 0, (1 - e) * H); }
          else { ctx.drawImage(A, -e * W, 0); ctx.drawImage(B, (1 - e) * W, 0); }
          break;
        case 'whip': {
          const n = Math.max(1, Math.round(tp(shot, 'trails')));
          const sp = 0.025 * tp(shot, 'spread');
          for (let i = 0; i < n; i++) {
            const ee = clamp(e + (i - n / 2) * sp, 0, 1);
            ctx.globalAlpha = 1 / (i + 1) + 0.15;
            const off = vertical ? [0, -ee * H, 0, (1 - ee) * H] : [-ee * W, 0, (1 - ee) * W, 0];
            ctx.drawImage(A, off[0], off[1]);
            ctx.drawImage(B, off[2], off[3]);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'zoom': {
          const s0 = lerp(1, 1 + 0.6 * amt, e);
          ctx.globalAlpha = 1 - e;
          ctx.drawImage(A, W / 2 - (W * s0) / 2, H / 2 - (H * s0) / 2, W * s0, H * s0);
          const s1 = lerp(1 - 0.2 * amt, 1, e);
          ctx.globalAlpha = e;
          ctx.drawImage(B, W / 2 - (W * s1) / 2, H / 2 - (H * s1) / 2, W * s1, H * s1);
          break;
        }
        case 'slash': {
          // diagonal comic-panel wipe with an accent edge
          ctx.drawImage(A, 0, 0);
          const sk = H * tp(shot, 'angle');
          const k = e * (W + sk * 2) * 1.05 - sk;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(-sk, 0); ctx.lineTo(k, 0); ctx.lineTo(k - sk, H); ctx.lineTo(-sk, H);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(B, 0, 0);
          ctx.restore();
          ctx.strokeStyle = project.accent;
          ctx.lineWidth = Math.min(W, H) * 0.018 * tp(shot, 'edge');
          if (ctx.lineWidth > 0) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k - sk, H); ctx.stroke(); }
          break;
        }
        case 'iris': {
          ctx.drawImage(A, 0, 0);
          const rad = e * Math.hypot(W, H) * 0.55;
          ctx.save();
          ctx.beginPath(); ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(B, 0, 0);
          ctx.restore();
          if (e < 1 && tp(shot, 'edge') > 0) {
            ctx.strokeStyle = project.accent;
            ctx.lineWidth = Math.min(W, H) * 0.012 * tp(shot, 'edge');
            ctx.beginPath(); ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2); ctx.stroke();
          }
          break;
        }
        case 'glitch': {
          const src = a < 0.5 ? A : B;
          ctx.drawImage(src, 0, 0);
          const gAmt = (1 - Math.abs(a - 0.5) * 2) * amt;
          const slices = 9;
          for (let i = 0; i < slices; i++) {
            const r1 = Math.abs(Math.sin((i + 1) * 91.7 + Math.floor(a * 12) * 13.1));
            if (r1 < 0.45) continue;
            const y = (i / slices) * H, sh = H / slices * (0.4 + r1 * 0.6);
            const dx = (r1 - 0.7) * W * 0.12 * gAmt;
            ctx.drawImage(a < 0.5 ? B : A, 0, y, W, sh, dx, y, W, sh);
          }
          ctx.globalAlpha = clamp(0.35 * gAmt, 0, 1);
          ctx.globalCompositeOperation = 'screen';
          ctx.drawImage(src, W * 0.012 * gAmt, 0);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          break;
        }
        case 'burn': {
          // film burn: a hot light leak sweeps across while the pictures cross
          ctx.drawImage(A, 0, 0);
          ctx.globalAlpha = clamp((a - 0.35) / 0.3, 0, 1);
          ctx.drawImage(B, 0, 0);
          ctx.globalAlpha = 1;
          const k = Math.sin(Math.PI * a) * amt;
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          const cx = lerp(-W * 0.2, W * 1.2, e), cy = H * (0.3 + 0.4 * Math.sin(a * 3));
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
          g.addColorStop(0, `rgba(255,236,190,${Math.min(1, 0.95 * k)})`);
          g.addColorStop(0.25, `rgba(255,140,40,${Math.min(1, 0.75 * k)})`);
          g.addColorStop(0.6, `rgba(200,40,20,${Math.min(1, 0.35 * k)})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
          break;
        }
        case 'dip': {
          ctx.drawImage(a < 0.5 ? A : B, 0, 0);
          ctx.fillStyle = `rgba(0,0,0,${(1 - Math.abs(a - 0.5) * 2) * amt})`;
          ctx.fillRect(0, 0, W, H);
          break;
        }
        case 'blur': {
          const bl = Math.round(Math.min(W, H) * 0.02 * amt * Math.sin(Math.PI * a));
          ctx.filter = bl > 0 ? `blur(${bl}px)` : 'none';
          ctx.drawImage(A, 0, 0);
          ctx.globalAlpha = EASE.soft(a);
          ctx.drawImage(B, 0, 0);
          ctx.filter = 'none';
          break;
        }
        case 'flash':
          ctx.drawImage(a < 0.5 ? A : B, 0, 0);
          ctx.globalAlpha = (1 - Math.abs(a - 0.5) * 2) * clamp(amt, 0, 1);
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
