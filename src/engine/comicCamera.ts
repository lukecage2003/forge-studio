import type { Motion, Rect, Shot } from '../types';
import { frame, keepInside, timePath, type CamKey, type View } from './camerapath';
import type { CameraGrammar } from './director';

/**
 * COMIC INTELLIGENCE CAMERA ENGINE
 *
 * The Creative Director says WHAT the moment needs (push, pull back, read,
 * hold…); this engine decides HOW to film it on this page, from its geometry:
 *  - a panel that can be isolated is framed on its own (with its real shape:
 *    slanted gutters give a non-rectangular mask, never a crop of the neighbour);
 *  - overlapping or borderless panels are filmed inside the page (shared
 *    composition) instead of being cut out;
 *  - a splash page is revealed, glided across or simply held;
 *  - a long shot on a whole page navigates its panels in reading order.
 * Artwork is never altered: only views (camera) and masks (clip) change.
 */

export type Pt = { x: number; y: number };

export interface PageInfo {
  w: number;
  h: number;
  kind?: string;
  /** panels of the page, in reading order */
  panels: Rect[];
  /** balloons of the page (AI detector), in reading order */
  balloons: Rect[];
  /** the user locked this page: no automatic camera change */
  locked?: boolean;
}

export interface CameraChoice { motion: Motion; path?: CamKey[]; shared?: boolean; why: string }

const area = (r: Rect) => r.w * r.h;
function inter(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** a panel cut out on its own would take a slice of its neighbours: film it inside the page */
export function overlapsOthers(r: Rect, panels: Rect[]) {
  return panels.some((o) => o !== r && !(o.x === r.x && o.y === r.y && o.w === r.w && o.h === r.h) && inter(r, o) > Math.min(area(r), area(o)) * 0.12);
}

/* ------------------------------------------------------------------ shapes */

/**
 * The real outline of a panel inside its detected box: along each side the
 * gutter (page paper colour) is followed; a straight but slanted gutter gives
 * a tilted edge. Returns a quadrilateral, or null when the panel is a plain
 * rectangle (or its edges can't be read, e.g. art bleeding off the page).
 */
export function panelShape(img: CanvasImageSource, width: number, height: number, r: Rect): Pt[] | null {
  const S = Math.min(1, 700 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * S)), h = Math.max(8, Math.round(height * S));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const border: number[][] = [];
  for (let yy = 0; yy < h; yy += 3) for (const xx of [1, w - 2]) { const i = (yy * w + xx) * 4; border.push([d[i], d[i + 1], d[i + 2]]); }
  for (let xx = 0; xx < w; xx += 3) for (const yy of [1, h - 2]) { const i = (yy * w + xx) * 4; border.push([d[i], d[i + 1], d[i + 2]]); }
  const med = [0, 1, 2].map((k) => border.map((p) => p[k]).sort((a, b) => a - b)[border.length >> 1]);
  const gutter = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return true;
    const i = (py * w + px) * 4;
    return Math.abs(d[i] - med[0]) + Math.abs(d[i + 1] - med[1]) + Math.abs(d[i + 2] - med[2]) < 50;
  };
  const R = { x: r.x * S, y: r.y * S, w: r.w * S, h: r.h * S };
  // first art pixel met when scanning from outside the box inward, at several positions along a side
  const edge = (side: 'top' | 'bottom' | 'left' | 'right') => {
    const horiz = side === 'top' || side === 'bottom';
    const len = horiz ? R.w : R.h, depth = horiz ? R.h : R.w;
    const out: Pt[] = [];
    for (let k = 1; k <= 9; k++) {
      const along = (horiz ? R.x : R.y) + (len * k) / 10;
      let hit: number | null = null;
      for (let s = -depth * 0.08; s <= depth * 0.3; s += 1) {
        const pos = side === 'top' ? R.y + s : side === 'bottom' ? R.y + R.h - s : side === 'left' ? R.x + s : R.x + R.w - s;
        const px = Math.round(horiz ? along : pos), py = Math.round(horiz ? pos : along);
        const px2 = Math.round(horiz ? along : pos + (side === 'left' ? 1 : -1)), py2 = Math.round(horiz ? pos + (side === 'top' ? 1 : -1) : along);
        if (!gutter(px, py) && !gutter(px2, py2)) { hit = pos; break; }
      }
      if (hit != null) out.push(horiz ? { x: along, y: hit } : { x: hit, y: along });
    }
    return out;
  };
  // least-squares line through the samples: y = a + b·x (horizontal sides) or x = a + b·y (vertical)
  const fit = (pts: Pt[], horiz: boolean) => {
    if (pts.length < 6) return null;
    const u = pts.map((p) => (horiz ? p.x : p.y)), v = pts.map((p) => (horiz ? p.y : p.x));
    const mu = u.reduce((a, b) => a + b, 0) / u.length, mv = v.reduce((a, b) => a + b, 0) / v.length;
    let num = 0, den = 0;
    u.forEach((ui, i) => { num += (ui - mu) * (v[i] - mv); den += (ui - mu) ** 2; });
    const b = den ? num / den : 0, a = mv - b * mu;
    const res = Math.sqrt(v.reduce((acc, vi, i) => acc + (vi - (a + b * u[i])) ** 2, 0) / v.length);
    return { a, b, res };
  };
  const lines = {
    top: fit(edge('top'), true), bottom: fit(edge('bottom'), true),
    left: fit(edge('left'), false), right: fit(edge('right'), false),
  };
  let tilted = false;
  const ok = (l: { a: number; b: number; res: number } | null, span: number, depth: number) => {
    if (!l || l.res > depth * 0.02 + 1.5) return null; // ragged: not a clean gutter
    if (Math.abs(l.b) * span > depth * 0.04) tilted = true;
    return l;
  };
  const T = ok(lines.top, R.w, R.h) ?? { a: R.y, b: 0 }, B = ok(lines.bottom, R.w, R.h) ?? { a: R.y + R.h, b: 0 };
  const L = ok(lines.left, R.h, R.w) ?? { a: R.x, b: 0 }, Rt = ok(lines.right, R.h, R.w) ?? { a: R.x + R.w, b: 0 };
  if (!tilted) return null;
  // corners: intersect y = Ta + Tb·x with x = La + Lb·y, etc.
  const meet = (hz: { a: number; b: number }, vt: { a: number; b: number }) => {
    const y = (hz.a + hz.b * vt.a) / (1 - hz.b * vt.b);
    return { x: (vt.a + vt.b * y) / S, y: y / S };
  };
  const quad = [meet(T, L), meet(T, Rt), meet(B, Rt), meet(B, L)];
  // stay within the detected box (the network's box contains the panel)
  const pad = Math.max(r.w, r.h) * 0.04;
  if (quad.some((p) => p.x < r.x - pad || p.x > r.x + r.w + pad || p.y < r.y - pad || p.y > r.y + r.h + pad)) return null;
  return quad.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

/* ------------------------------------------------------------- camera modes */

/** A. glide across the whole page through its important places (balloons, panels), wide at both ends */
export function pageGlide(page: PageInfo, aspect: number): CamKey[] {
  const whole = frame({ x: 0, y: 0, w: page.w, h: page.h }, aspect, 1.04);
  const spots = (page.balloons.length >= 2 ? page.balloons : page.panels).slice(0, 5);
  const near = spots.map((r) => ({ ...frame(r, aspect, 2.4), weight: 0.8 }));
  return keepInside(timePath([whole, ...near, whole], Math.hypot(page.w, page.h), { lead: 0.5, tail: 0.6 }), { x: 0, y: 0, w: page.w, h: page.h }, aspect);
}

/** B. panel to panel in reading order inside one shot; each stop lasts with what there is to read */
export function panelNavigation(page: PageInfo, aspect: number): CamKey[] {
  // a panel much wider than the screen (a strip in a vertical video) would only fit by showing the
  // whole page: it is read in two stops instead, left then right, at a readable scale
  const stops = page.panels.flatMap((r) => {
    const weight = 0.8 + 0.2 * Math.min(3, page.balloons.filter((b) => inter(b, r) > area(b) * 0.5).length);
    const fit = frame(r, aspect, 1.1), fillW = Math.min(r.w, r.h * 1.1 * aspect);
    if (fit.vw < fillW * 1.6) return [{ ...fit, weight }];
    const vw = Math.sqrt(fit.vw * fillW);
    const x0 = r.x + vw / 2, x1 = r.x + r.w - vw / 2, cy = r.y + r.h / 2;
    return [{ cx: x0, cy, vw, weight: weight * 0.6 }, { cx: x1, cy, vw, weight: weight * 0.6 }];
  });
  return keepInside(timePath(stops, Math.hypot(page.w, page.h), { lead: 0.9, tail: 1 }), { x: 0, y: 0, w: page.w, h: page.h }, aspect);
}

/** D. cinematic reveal: close on the key detail, then the whole composition opens up */
export function reveal(page: PageInfo, focus: Rect, aspect: number, region: Rect = { x: 0, y: 0, w: page.w, h: page.h }): CamKey[] {
  const close = frame(focus, aspect, 1.6), whole = frame(region, aspect, 1.04);
  return keepInside(timePath([{ ...close, weight: 1 }, { ...whole, weight: 1.4 }], Math.hypot(page.w, page.h), { lead: 0.8, tail: 1.6 }), { x: 0, y: 0, w: page.w, h: page.h }, aspect);
}

/** E. detail exploration inside a region: composition → detail (with context) → back */
export function detail(page: PageInfo, region: Rect, spot: Rect, aspect: number): CamKey[] {
  const base = frame(region, aspect, 1.05), close = frame(spot, aspect, 2.2);
  return keepInside(timePath([base, { ...close, weight: 1.2 }, base], Math.hypot(page.w, page.h), { lead: 0.6, tail: 0.5 }), { x: 0, y: 0, w: page.w, h: page.h }, aspect);
}

/**
 * Execute the director's intention on this shot, given the page's geometry.
 * Returns null to keep the panel-level move the director already chose.
 */
export function executeCamera(s: Shot, page: PageInfo, intent: CameraGrammar, aspect: number, prev: Motion | null): CameraChoice | null {
  if (page.locked || !s.pageId || s.diagram) return null;
  const wholePage = s.rect.w >= page.w * 0.95 && s.rect.h >= page.h * 0.95;
  const focusRect = page.balloons[0] ?? page.panels[0] ?? { x: page.w * 0.3, y: page.h * 0.3, w: page.w * 0.4, h: page.h * 0.4 };
  // a full page (splash, cover, spread): reveal it, glide across it, or leave it alone
  if (wholePage || s.zone === 'splash') {
    if (intent === 'hold') return { motion: 'static', why: 'pleine page : plan tenu, le dessin parle seul' };
    if ((intent === 'pullback' || s.zone === 'splash') && prev !== 'reveal' && s.duration >= 3) return { motion: 'reveal', path: reveal(page, focusRect, aspect), why: 'pleine page : révélée depuis son détail clé' };
    if (s.duration >= 4 && page.panels.length >= 3 && page.kind !== 'splash') return { motion: 'panel-nav', path: panelNavigation(page, aspect), why: `planche entière : la caméra passe de case en case (${page.panels.length})` };
    if (s.duration >= 3.5) return { motion: 'page-glide', path: pageGlide(page, aspect), why: 'pleine page : travelling sur les éléments importants' };
    return { motion: 'static', why: 'pleine page courte : plan tenu' };
  }
  // a panel that can't be cut out without slicing its neighbours: film it inside the page
  if (overlapsOthers(s.rect, page.panels) || s.zone === 'zones') {
    const region = s.rect;
    const spot = page.balloons.find((b) => inter(b, region) > area(b) * 0.5);
    const path = spot && s.duration >= 3.2 && intent !== 'hold' ? detail(page, region, spot, aspect) : keepInside(timePath([{ ...frame(region, aspect, 1.25) }, { ...frame(region, aspect, 1.08) }], Math.hypot(page.w, page.h), { lead: 0.2, tail: 0.3 }), { x: 0, y: 0, w: page.w, h: page.h }, aspect);
    return { motion: spot && s.duration >= 3.2 && intent !== 'hold' ? 'tour' : 'zoom-in', path, shared: true, why: 'cases qui se chevauchent : filmée dans la page (composition partagée), sans découpe' };
  }
  return null;
}

/** the view a path gives at p, or null when the shot has no path */
export const pathView = (s: Shot, p: number, evalFn: (k: CamKey[], p: number) => View): View | null => (s.path?.length ? evalFn(s.path, p) : null);

/** where the camera goes: a centre-of-interest for the focus of a panel */
export const interest = (page: PageInfo, r: Rect): Pt => {
  const b = page.balloons.filter((q) => inter(q, r) > area(q) * 0.5);
  return b.length ? centre(b[0]) : centre(r);
};
