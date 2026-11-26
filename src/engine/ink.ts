import { hashSeed, rng } from './rng';

/**
 * "Encre" art direction: diagrams and maps drawn like a printed comic page
 * instead of app UI. Newsprint, black ink with a hand wobble, flat spot
 * colour, Ben-Day dots, hard offset shadows (never blurred), yellow narrative
 * captions and real speech balloons. All deterministic: the wobble only
 * changes 8 times a second ("line boil"), like hand-drawn animation.
 */
type Ctx = CanvasRenderingContext2D;

export const INK = '#15120f';
export const PAPER = '#efe5cf';
export const PAPER_CARD = '#fbf6ea';
export const CAPTION = '#ffd94a';
export const LETTER = '"Comic Neue", "Comic Sans MS", cursive';
export const TITLE = '"Bangers", "Comic Sans MS", cursive';

/** wobble seed: stable within 1/8 s, so lines "boil" gently */
export const boil = (t: number) => Math.floor(t * 8);

/** a hand-inked closed shape through the corners of a rectangle */
function wobblyRect(ctx: Ctx, x: number, y: number, w: number, h: number, amp: number, seed: number) {
  const r = rng(seed);
  const j = () => (r() - 0.5) * 2 * amp;
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  ctx.beginPath();
  pts.forEach(([px, py], i) => {
    const [nx, ny] = pts[(i + 1) % 4];
    if (i === 0) ctx.moveTo(px + j(), py + j());
    // one slight bow per edge
    ctx.quadraticCurveTo((px + nx) / 2 + j() * 1.5, (py + ny) / 2 + j() * 1.5, nx + j(), ny + j());
  });
  ctx.closePath();
}

export interface InkBoxOpts { fill?: string; stroke?: string; lw: number; shadow?: string; shadowOff?: number; seed: number; amp?: number }

/** panel-like box: hard offset shadow, flat fill, wobbly ink border */
export function inkBox(ctx: Ctx, x: number, y: number, w: number, h: number, o: InkBoxOpts) {
  const amp = o.amp ?? o.lw * 0.35;
  if (o.shadow) {
    const d = o.shadowOff ?? o.lw * 2.2;
    ctx.fillStyle = o.shadow;
    wobblyRect(ctx, x + d, y + d, w, h, amp, o.seed + 7);
    ctx.fill();
  }
  if (o.fill) {
    ctx.fillStyle = o.fill;
    wobblyRect(ctx, x, y, w, h, amp, o.seed);
    ctx.fill();
  }
  ctx.strokeStyle = o.stroke ?? INK;
  ctx.lineWidth = o.lw;
  ctx.lineJoin = 'round';
  wobblyRect(ctx, x, y, w, h, amp, o.seed);
  ctx.stroke();
}

/**
 * A brush stroke along a path: the width swells in the middle and tapers at
 * both ends like a loaded brush. `upTo` (0..1) draws only the first part.
 */
export function brush(ctx: Ctx, pts: [number, number][], width: number, color: string, seed: number, upTo = 1, dash?: number) {
  if (pts.length < 2 || upTo <= 0) return;
  const r = rng(seed);
  const len: number[] = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1] || 1;
  const stop = total * upTo;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const jit = width * 0.25;
  for (let i = 1; i < pts.length; i++) {
    if (len[i - 1] >= stop) break;
    const u = len[i] / total;
    if (dash && Math.floor(len[i - 1] / dash) % 2 === 1) continue;
    const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * 0.6 + 0.4;
    ctx.lineWidth = width * taper * (0.85 + r() * 0.3);
    const f = Math.min(1, (stop - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]));
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    ctx.beginPath();
    ctx.moveTo(ax + (r() - 0.5) * jit, ay + (r() - 0.5) * jit);
    ctx.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
    ctx.stroke();
  }
  ctx.restore();
}

/** points on a gently bowed path from a to b (for routes and links) */
export function bowPath(x0: number, y0: number, x1: number, y1: number, bow = 0.15, steps = 48): [number, number][] {
  const mx = (x0 + x1) / 2 - (y1 - y0) * bow, my = (y0 + y1) / 2 + (x1 - x0) * bow;
  const out: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.push([a * x0 + b * mx + c * x1, a * y0 + b * my + c * y1]);
  }
  return out;
}

/** solid ink arrowhead at the end of a path */
export function arrowHead(ctx: Ctx, pts: [number, number][], upTo: number, size: number, color: string) {
  if (pts.length < 2 || upTo <= 0.02) return;
  const i = Math.max(1, Math.min(pts.length - 1, Math.round(upTo * (pts.length - 1))));
  const [x, y] = pts[i], [px, py] = pts[i - 1];
  const a = Math.atan2(y - py, x - px);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size * 0.6, 0);
  ctx.lineTo(-size * 0.6, -size * 0.55);
  ctx.lineTo(-size * 0.3, 0);
  ctx.lineTo(-size * 0.6, size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Ben-Day dots filling the current clip, bigger towards `toward` */
export function benDay(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, step: number, gradient: 'left' | 'right' | 'flat' = 'flat', alpha = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let yy = y, row = 0; yy < y + h + step; yy += step * 0.866, row++) {
    for (let xx = x + (row % 2 ? step / 2 : 0); xx < x + w + step; xx += step) {
      const u = gradient === 'flat' ? 0.7 : gradient === 'right' ? (xx - x) / w : 1 - (xx - x) / w;
      const r = step * 0.42 * Math.max(0.08, Math.min(1, u));
      ctx.beginPath();
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

let newsprint: HTMLCanvasElement | null = null;
/** newsprint background: warm paper, fibres, a faint dot screen */
export function paperBackground(ctx: Ctx, W: number, H: number, accent: string, U: number, t: number) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  if (!newsprint) {
    newsprint = document.createElement('canvas');
    newsprint.width = newsprint.height = 256;
    const x = newsprint.getContext('2d')!;
    const im = x.createImageData(256, 256);
    const r = rng(hashSeed('newsprint'));
    for (let i = 0; i < im.data.length; i += 4) {
      const p = i / 4, px = p % 256, py = (p / 256) | 0;
      const fibre = Math.sin(px * 0.7 + Math.sin(py * 0.11) * 5) * 6 + (r() - 0.5) * 22;
      const v = 245 + fibre;
      im.data[i] = v; im.data[i + 1] = v - 4; im.data[i + 2] = v - 12; im.data[i + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = ctx.createPattern(newsprint, 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // a slow sweep of spot-colour dots across one corner: the printed "tone"
  const drift = Math.sin(t * 0.4) * U * 0.6;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(W * 0.45 + drift, H);
  ctx.lineTo(W, H * 0.48 + drift);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.clip();
  benDay(ctx, 0, 0, W, H, accent, U * 0.9, 'right', 0.55);
  ctx.restore();
}

/** the frame is a comic panel: thick ink border with a gutter of paper */
export function panelFrame(ctx: Ctx, W: number, H: number, U: number, seed: number) {
  const g = U * 0.55;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = U * 0.32;
  wobblyRect(ctx, g, g, W - 2 * g, H - 2 * g, U * 0.05, seed);
  ctx.stroke();
  ctx.restore();
}

/** set the font, shrinking it until `text` fits `maxW` */
export function fitFont(ctx: Ctx, text: string, family: string, weight: string, size: number, maxW: number) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > size * 0.45) { s *= 0.92; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

/**
 * Narrative caption (the yellow "récitatif" box of comics): sharp corners,
 * ink border, hard shadow, slightly tilted. Returns its size.
 */
export function caption(ctx: Ctx, text: string, sub: string | undefined, x: number, y: number, size: number, o: { align?: 'left' | 'center'; tilt?: number; fill?: string; seed: number; maxW?: number; a?: number }) {
  const a = o.a ?? 1;
  if (a <= 0) return { w: 0, h: 0 };
  const label = text.toUpperCase();
  const fs = fitFont(ctx, label, TITLE, '400', size, (o.maxW ?? 1e9) - size * 1.2);
  const tw = ctx.measureText(label).width;
  let sw = 0, ss = fs * 0.5;
  if (sub) { ss = fitFont(ctx, sub, LETTER, '700', fs * 0.52, (o.maxW ?? 1e9) - size * 1.2); sw = ctx.measureText(sub).width; }
  const w = Math.max(tw, sw) + fs * 1.0, h = fs * 1.25 + (sub ? ss * 1.35 : 0);
  const x0 = o.align === 'center' ? x - w / 2 : x;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, a * 1.4);
  ctx.translate(x0 + w / 2, y + h / 2);
  // slaps on: a little too big, settles
  const s = a >= 1 ? 1 : 1 + (1 - a) * 0.18;
  ctx.scale(s, s);
  ctx.rotate((o.tilt ?? 0) * (0.6 + 0.4 * a));
  ctx.translate(-w / 2, -h / 2);
  inkBox(ctx, 0, 0, w, h, { fill: o.fill ?? CAPTION, lw: fs * 0.09, shadow: INK, shadowOff: fs * 0.16, seed: o.seed });
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `400 ${fs}px ${TITLE}`;
  ctx.fillText(label, fs * 0.5, fs * 0.68);
  if (sub) {
    ctx.font = `700 ${ss}px ${LETTER}`;
    ctx.fillText(sub, fs * 0.5, fs * 1.3 + ss * 0.55);
  }
  ctx.restore();
  return { w, h };
}

/** speech balloon (rounded, ink outline) with a tail toward the speaker */
export function balloon(ctx: Ctx, x: number, y: number, w: number, h: number, tailX: number, tailY: number, lw: number, seed: number) {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  const at = (t: number): [number, number] => {
    const c = Math.cos(t), s = Math.sin(t), wob = 1 + Math.sin(t * 3 + seed) * 0.012;
    // rounder than an ellipse: a superellipse
    return [cx + Math.sign(c) * Math.abs(c) ** 0.75 * rx * wob, cy + Math.sign(s) * Math.abs(s) ** 0.75 * ry * wob];
  };
  const ang = Math.atan2((tailY - cy) / ry, (tailX - cx) / rx);
  const b1 = at(ang - 0.22), b2 = at(ang + 0.12);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let k = 0; k <= 72; k++) { const [px, py] = at((k / 72) * Math.PI * 2); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // tail: white wedge over the outline, then its two inked sides
  ctx.beginPath();
  ctx.moveTo(b1[0], b1[1]);
  ctx.quadraticCurveTo((b1[0] + tailX) / 2, (b1[1] + tailY) / 2 + lw, tailX, tailY);
  ctx.quadraticCurveTo((b2[0] + tailX) / 2, (b2[1] + tailY) / 2, b2[0], b2[1]);
  ctx.fill();
  ctx.stroke();
  // hide the outline segment inside the tail's base
  ctx.beginPath();
  ctx.moveTo(b1[0], b1[1]);
  ctx.lineTo(b2[0], b2[1]);
  ctx.lineTo((b1[0] + b2[0]) / 2 + (cx - (b1[0] + b2[0]) / 2) * 0.08, (b1[1] + b2[1]) / 2 + (cy - (b1[1] + b2[1]) / 2) * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * A place circled with a felt pen on the map: the loop draws itself and
 * overshoots its start, as a hand does.
 */
export function feltCircle(ctx: Ctx, x: number, y: number, r: number, color: string, lw: number, p: number, seed: number) {
  if (p <= 0) return;
  const rnd = rng(seed);
  const start = rnd() * Math.PI * 2, sweep = Math.PI * 2.25 * Math.min(1, p);
  const pts: [number, number][] = [];
  for (let k = 0; k <= 60; k++) {
    const t = start + (sweep * k) / 60;
    const rr = r * (1 + 0.12 * Math.sin(t * 2 + seed) + 0.06 * (k / 60));
    pts.push([x + Math.cos(t) * rr * 1.15, y + Math.sin(t) * rr]);
  }
  brush(ctx, pts, lw, color, seed + 3);
}

/** newsprint grain over an existing picture (maps), multiply */
export function paperTexture(ctx: Ctx, W: number, H: number, alpha: number) {
  if (!newsprint) { paperBackground(document.createElement('canvas').getContext('2d')!, 1, 1, '#000', 1, 0); }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.createPattern(newsprint!, 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
