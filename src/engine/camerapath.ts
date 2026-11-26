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

export type Ease = 'smooth' | 'linear' | 'in' | 'out';
export interface CamKey { t: number; cx: number; cy: number; vw: number; /** stillness on this key (fraction of the shot) */ hold?: number; /** how the move that LEAVES this key accelerates */ ease?: Ease }
const EASES: Record<Ease, (x: number) => number> = { smooth: (x) => x * x * (3 - 2 * x), linear: (x) => x, in: (x) => x * x, out: (x) => 1 - (1 - x) * (1 - x) };
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
  const u = (EASES[a.ease ?? 'smooth'] ?? smooth)(clamp((q - start) / Math.max(1e-6, b.t - start), 0, 1));
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

/**
 * NARRATIVE SYNC — retime a path on the voice.
 * `events` are moments (seconds from the shot start) where the narration
 * turns: sentence starts and breaths. The camera arrives on each stop as one
 * of them happens (the viewer looks where the voice goes), moves during the
 * gap before it, and holds long enough to read. When the shot is too short
 * for every stop at a readable pace, the least important stops are dropped:
 * the camera never rushes.
 */
export function syncPath(keys: CamKey[], duration: number, events: number[], diag: number, o: { minHold?: number } = {}): CamKey[] {
  if (keys.length < 2 || duration <= 0) return keys;
  const minHold = o.minHold ?? 1.1;
  const moveTime = (a: View, b: View) => Math.min(2.2, Math.max(0.45, 0.45 + (Math.hypot(a.cx - b.cx, a.cy - b.cy) / diag) * 2.4 + Math.abs(Math.log(b.vw / a.vw)) * 0.6));
  let ks = keys.map((k) => ({ ...k }));
  const need = () => ks.slice(1).reduce((a, k, i) => a + moveTime(ks[i], k), 0) + ks.length * minHold;
  // too much to show for the time: drop the stop that matters least (shortest hold), never the ends
  while (ks.length > 2 && need() > duration) {
    let worst = 1;
    for (let i = 2; i < ks.length - 1; i++) if ((ks[i].hold ?? 0) < (ks[worst].hold ?? 0)) worst = i;
    ks.splice(worst, 1);
  }
  const n = ks.length;
  const moves = ks.slice(1).map((k, i) => moveTime(ks[i], k));
  const scale = Math.min(1, duration / Math.max(1e-6, need())); // only for 2 stops that still don't fit
  const ev = [...new Set(events.filter((e) => e > 0.3 && e < duration - 0.3).map((e) => +e.toFixed(3)))].sort((a, b) => a - b);
  // ideal arrival times: proportional to the original timing
  const ideal = ks.map((k) => k.t * duration);
  const arrive: number[] = [0];
  for (let i = 1; i < n; i++) {
    const earliest = arrive[i - 1] + minHold * scale + moves[i - 1] * scale;
    const restNeed = moves.slice(i).reduce((a, m) => a + m, 0) * scale + (n - i) * minHold * scale;
    const latest = Math.max(earliest, duration - restNeed);
    // the narration turn closest to where this stop would have arrived
    const cands = ev.filter((e) => e >= earliest && e <= latest);
    const target = Math.min(latest, Math.max(earliest, ideal[i]));
    arrive.push(cands.length ? cands.reduce((b, e) => (Math.abs(e - target) < Math.abs(b - target) ? e : b), cands[0]) : target);
  }
  return ks.map((k, i) => {
    const nextStart = i < n - 1 ? arrive[i + 1] - moves[i] * scale : duration;
    return { ...k, t: arrive[i] / duration, hold: Math.max(0, nextStart - arrive[i]) / duration };
  });
}
