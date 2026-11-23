import type { Project, Shot } from '../types';

export interface TimedShot { shot: Shot; index: number; start: number; end: number }

export function layout(shots: Shot[]): TimedShot[] {
  let t = 0;
  return shots.map((shot, index) => {
    const start = t;
    t += shot.duration;
    return { shot, index, start, end: t };
  });
}

export function videoDuration(p: Project) {
  const s = p.shots.reduce((a, b) => a + b.duration, 0);
  if (s > 0) return s;
  return p.audio.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

export function shotAt(timed: TimedShot[], t: number): TimedShot | null {
  if (!timed.length) return null;
  for (const ts of timed) if (t >= ts.start && t < ts.end) return ts;
  return timed[timed.length - 1];
}
