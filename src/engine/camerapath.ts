import type { Rect } from '../types';

/**
 * CAMERA PATH ENGINE
 *
 * A camera path is a list of key views on the page (centre + width, page
 * pixels) placed in time (0..1 of the shot), each optionally held. Between
 * keys the camera moves on a smooth curve: position and zoom follow a
 * Catmull-Rom spline (no corner at a key the camera passes through), time
 * follows an ease in/out (no jolt when it starts or stops at a hold).
 * Paths are plain data: built by the comic camera engine, stored on the shot,
 * editable, savable as presets, and rendered by `cameraAt` like any move.
 */

export interface CamKey { t: number; cx: number; cy: number; vw: number; /** seconds of stillness on this key (fraction of the shot, set by the builder) */ hold?: number }
export interface View { cx: number; cy: number; vw: number }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (x: number) => x * x * (3 - 2 * x); // ease in/out with zero speed at both ends

/** centripetal-ish Catmull-Rom between p1 and p2 (p0, p3 neighbours), u in 0..1 */
function cr(p0: number, p1: number, p2: number, p3: number, u: number) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** where the camera is at p (0..1 of the shot) */
export function evalPath(keys: CamKey[], p: number): View {
  if (!keys.length) return { cx: 0, cy: 0, vw: 1 };
  if (keys.length === 1) return { cx: keys[0].cx, cy: keys[0].cy, vw: keys[0].vw };
  const q = clamp(p, 0, 1);
  // holds: the camera stays on key i during [t_i, t_i + hold_i]
  let i = 0;
  while (i < keys.length - 1 && q >= keys[i + 1].t) i++;
  if (i >= keys.length - 1) return { ...keys[keys.length - 1] };
  const a = keys[i], b = keys[i + 1];
  const start = Math.min(b.t, a.t + (a.hold ?? 0));
  if (q <= start) return { cx: a.cx, cy: a.cy, vw: a.vw };
  const u = smooth(clamp((q - start) / Math.max(1e-6, b.t - start), 0, 1));
  const k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(keys.length - 1, i + 2)];
  // zoom interpolated in log space: a zoom of ×2 feels the same speed as ×0.5
  const lw = (k: CamKey) => Math.log(k.vw);
  return {
    cx: cr(k0.cx, a.cx, b.cx, k3.cx, u),
    cy: cr(k0.cy, a.cy, b.cy, k3.cy, u),
    vw: Math.exp(cr(lw(k0), lw(a), lw(b), lw(k3), u)),
  };
}

/** the view that frames a region with some context around it */
export function frame(r: Rect, aspect: number, margin = 1.12): View {
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, vw: Math.max(r.w * margin, r.h * margin * aspect) };
}

/**
 * Time a sequence of views: each move gets time in proportion to how far the
 * camera travels (position and zoom), each stop a hold weighted by its
 * importance. Speed adapts to the page size: the same trip reads the same on
 * a big and a small scan.
 */
export function timePath(views: (View & { weight?: number })[], diag: number, opts: { lead?: number; tail?: number } = {}): CamKey[] {
  if (views.length < 2) return views.map((v) => ({ ...v, t: 0 }));
  const dist = (a: View, b: View) => Math.hypot(a.cx - b.cx, a.cy - b.cy) / diag + Math.abs(Math.log(b.vw / a.vw)) * 0.45;
  const moves = views.slice(1).map((v, i) => 0.35 + dist(views[i], v) * 2.2);
  const holds = views.map((v, i) => (i === 0 ? opts.lead ?? 0.6 : i === views.length - 1 ? opts.tail ?? 0.5 : 0.9) * (v.weight ?? 1));
  const total = moves.reduce((a, b) => a + b, 0) + holds.reduce((a, b) => a + b, 0);
  const keys: CamKey[] = [];
  let acc = 0;
  views.forEach((v, i) => {
    keys.push({ t: acc / total, cx: v.cx, cy: v.cy, vw: v.vw, hold: holds[i] / total });
    acc += holds[i] + (i < moves.length ? moves[i] : 0);
  });
  return keys;
}

/** a path only ever shows the page: clamp every key inside it (when the view is smaller than the page) */
export function keepInside(keys: CamKey[], page: Rect, aspect: number): CamKey[] {
  return keys.map((k) => {
    const vw = Math.min(k.vw, Math.max(page.w, page.h * aspect));
    const vh = vw / aspect;
    const cx = page.w > vw ? clamp(k.cx, page.x + vw / 2, page.x + page.w - vw / 2) : page.x + page.w / 2;
    const cy = page.h > vh ? clamp(k.cy, page.y + vh / 2, page.y + page.h - vh / 2) : page.y + page.h / 2;
    return { ...k, cx, cy, vw };
  });
}

/**
 * Smoothness of a path: largest change of velocity between two frames, as a
 * share of the page diagonal per second² at 30 fps. Used by the validation
 * and the review: a cut-like jump scores high, a glide stays low.
 */
export function jerk(keys: CamKey[], duration: number, diag: number, fps = 30) {
  const n = Math.max(3, Math.round(duration * fps));
  const pts = Array.from({ length: n + 1 }, (_, i) => evalPath(keys, i / n));
  let worst = 0;
  for (let i = 2; i <= n; i++) {
    const v1 = Math.hypot(pts[i].cx - pts[i - 1].cx, pts[i].cy - pts[i - 1].cy) + Math.abs(pts[i].vw - pts[i - 1].vw) * 0.5;
    const v0 = Math.hypot(pts[i - 1].cx - pts[i - 2].cx, pts[i - 1].cy - pts[i - 2].cy) + Math.abs(pts[i - 1].vw - pts[i - 2].vw) * 0.5;
    worst = Math.max(worst, Math.abs(v1 - v0) * fps * fps / diag);
  }
  return worst;
}
