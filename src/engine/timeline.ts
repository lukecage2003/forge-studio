import type { ARoll, Project, Shot } from '../types';
import { keepSegments, segsDuration, type Seg } from './speech';

export interface TimedShot { shot: Shot; index: number; start: number; end: number }

const segCache = new WeakMap<ARoll, Seg[]>();
export function segmentsOf(ar: ARoll | null): Seg[] {
  if (!ar) return [];
  let s = segCache.get(ar);
  if (!s) { s = keepSegments(ar); segCache.set(ar, s); }
  return s;
}

export const overlayMode = (p: Project) => !!p.aroll;

/** Shots placed in time. Sequential for comics-only projects, free placement over a face-cam rush. */
export function layoutShots(p: Project): TimedShot[] {
  if (!overlayMode(p)) {
    let t = 0;
    return p.shots.map((shot, index) => {
      const start = t;
      t += shot.duration;
      return { shot, index, start, end: t };
    });
  }
  return p.shots
    .map((shot, index) => ({ shot, index, start: shot.start ?? 0, end: (shot.start ?? 0) + shot.duration }))
    .sort((a, b) => a.start - b.start);
}

/** kept for compatibility with comics-only helpers */
export function layout(shots: Shot[]): TimedShot[] {
  let t = 0;
  return shots.map((shot, index) => {
    const start = t;
    t += shot.duration;
    return { shot, index, start, end: t };
  });
}

export function arollDuration(p: Project) {
  return p.aroll ? segsDuration(segmentsOf(p.aroll)) : 0;
}

export function videoDuration(p: Project) {
  const timed = layoutShots(p);
  const shotsEnd = timed.reduce((m, t) => Math.max(m, t.end), 0);
  if (p.aroll) return Math.max(arollDuration(p), shotsEnd);
  if (shotsEnd > 0) return shotsEnd;
  return p.audio.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

export function shotAt(timed: TimedShot[], t: number, overlay = false): TimedShot | null {
  if (!timed.length) return null;
  let hit: TimedShot | null = null;
  for (const ts of timed) {
    if (t < ts.start || t >= ts.end) continue;
    // schemas and title cards placed over comic shots win
    if (!hit || ts.shot.pageId == null || hit.shot.pageId != null) hit = ts;
  }
  if (hit || overlay) return hit;
  return timed[timed.length - 1];
}
