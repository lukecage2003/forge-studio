import type { Project } from '../types';
import { getAudio } from './media';
import { analyse, toMono16k, HOP } from './speech';
import { segmentsOf } from './timeline';

/**
 * Emphasis points of the narration: moments where the voice clearly pushes
 * (a stressed word, a rise in energy). The edit punches in slightly on them,
 * like an editor reacting to the delivery.
 */
function peaks(db: Float32Array, toTimeline: (src: number) => number | null): number[] {
  const n = db.length, sm = new Float32Array(n), base = new Float32Array(n);
  const win = 10, wide = 150; // 100 ms / 1.5 s
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += db[i]; if (i >= win) acc -= db[i - win]; sm[i] = acc / Math.min(i + 1, win); }
  acc = 0;
  for (let i = 0; i < n; i++) { acc += sm[i]; if (i >= wide) acc -= sm[i - wide]; base[i] = acc / Math.min(i + 1, wide); }
  const out: number[] = [];
  let last = -1e9;
  for (let i = 1; i < n - 1; i++) {
    if (sm[i] < sm[i - 1] || sm[i] < sm[i + 1]) continue;
    if (sm[i] - base[Math.max(0, i - 40)] < 6) continue;
    const t = toTimeline(i * HOP);
    if (t == null || t - last < 2.8) continue;
    out.push(t);
    last = t;
  }
  return out;
}

export async function emphasisTimes(p: Project): Promise<number[]> {
  const out: number[] = [];
  const ar = p.aroll;
  if (ar && getAudio(ar.mediaId)) {
    const a = analyse(await toMono16k(getAudio(ar.mediaId)!));
    const segs = segmentsOf(ar);
    out.push(...peaks(a.db, (src) => {
      const g = segs.find((x) => src >= x.s && src <= x.e);
      return g ? g.t + (src - g.s) : null;
    }));
  }
  for (const c of p.audio) {
    if (c.kind !== 'voice' || !getAudio(c.mediaId)) continue;
    const a = analyse(await toMono16k(getAudio(c.mediaId)!));
    out.push(...peaks(a.db, (src) => (src >= c.offset && src <= c.offset + c.duration ? c.start + src - c.offset : null)));
  }
  return out.sort((x, y) => x - y);
}

/** 0..1 punch envelope at time t: fast attack, soft release */
export function emphasisAt(times: number[] | undefined, t: number) {
  if (!times?.length) return 0;
  let v = 0;
  for (const e of times) {
    const d = t - e;
    if (d < -0.06 || d > 0.9) continue;
    v = Math.max(v, d < 0 ? 1 + d / 0.06 : Math.exp(-d * 4.5));
  }
  return v;
}
