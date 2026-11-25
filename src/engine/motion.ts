/**
 * Motion design tokens: the one place that says how long, how soft and how
 * strong things move. Effects read these instead of hard-coded numbers, so a
 * creative profile can calm or sharpen a whole edit consistently.
 */
import { easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic } from '../lib/util';

/** durations, seconds */
export const DUR = {
  instant: 0.12,
  quick: 0.3,
  base: 0.5,
  slow: 0.8,
  epic: 1.2,
} as const;

/** cubic-bezier(x1, y1, x2, y2) as CSS defines it, solved by Newton + bisection */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-6) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** easing curves, by role */
export const EASE = {
  /** default for transitions and camera moves (unchanged from Forge 2) */
  standard: easeInOutCubic,
  /** dissolves and crossfades */
  soft: easeInOutSine,
  /** things arriving and settling */
  enter: easeOutCubic,
  /** pop-ins with a small overshoot (balloons, stickers) */
  pop: easeOutBack,
  /** cinematic: slow start, long settle */
  cinematic: cubicBezier(0.65, 0, 0.35, 1),
  /** snappy action cut-ins */
  snap: cubicBezier(0.2, 0.9, 0.1, 1),
  linear: (t: number) => t,
} as const;
export type EaseName = keyof typeof EASE;

/** effect strength presets (multiplier on an effect's own default) */
export const INTENSITY = { subtle: 0.5, normal: 1, strong: 1.4 } as const;

/** damped spring, 0 → 1, for shakes and overshoots */
export function spring(t: number, stiffness = 170, damping = 12): number {
  if (t <= 0) return 0;
  const w = Math.sqrt(stiffness), z = damping / (2 * w);
  if (z >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}
