import type { ARoll, Cut, RoughCutSettings, Word } from '../types';

/**
 * Speech analysis on the face-cam rush: frame energy, voice activity,
 * silences, acoustic hesitations ("euuuh", "mmmh"), filler words and
 * false starts from the transcript. Everything snaps to energy minima so
 * cuts land between sounds, never inside one.
 */

export const HOP = 0.01; // 10 ms frames
export const SR = 16000;

export interface Analysis {
  db: Float32Array; // frame level in dBFS
  zcr: Float32Array; // zero crossings per frame (0..1)
  floor: number; // noise floor dB
  speech: number; // typical speech level dB
  duration: number;
}

export async function toMono16k(buf: AudioBuffer): Promise<Float32Array> {
  const len = Math.ceil(buf.duration * SR);
  const ctx = new OfflineAudioContext(1, Math.max(1, len), SR);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

export function analyse(pcm: Float32Array): Analysis {
  const hop = Math.round(SR * HOP);
  const n = Math.floor(pcm.length / hop);
  const db = new Float32Array(n), zcr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0, z = 0;
    const o = i * hop;
    for (let j = 0; j < hop; j++) {
      const v = pcm[o + j];
      e += v * v;
      if (j && (v >= 0) !== (pcm[o + j - 1] >= 0)) z++;
    }
    db[i] = 10 * Math.log10(e / hop + 1e-10);
    zcr[i] = z / hop;
  }
  const sorted = Float32Array.from(db).sort();
  const pct = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.floor(p * n)))];
  return { db, zcr, floor: pct(0.08), speech: pct(0.85), duration: pcm.length / SR };
}

/** voiced / unvoiced per frame, with hangover so word-internal dips don't count as silence */
export function voiceMask(a: Analysis, thresholdDb: number) {
  const n = a.db.length;
  const thr = Math.min(a.floor + thresholdDb, a.speech - 6);
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = a.db[i] > thr ? 1 : 0;
  // remove blips < 40 ms, fill holes < 90 ms
  const runs = (val: number, maxLen: number, set: number) => {
    let i = 0;
    while (i < n) {
      if (m[i] !== val) { i++; continue; }
      let j = i;
      while (j < n && m[j] === val) j++;
      if (j - i < maxLen && i > 0 && j < n) m.fill(set, i, j);
      i = j;
    }
  };
  runs(1, 4, 0);
  runs(0, 9, 1);
  return { mask: m, thr };
}

interface Island { a: number; b: number } // frame indices [a,b)

function islands(mask: Uint8Array): Island[] {
  const out: Island[] = [];
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) { i++; continue; }
    let j = i;
    while (j < mask.length && mask[j]) j++;
    out.push({ a: i, b: j });
    i = j;
  }
  return out;
}

/** nudge a time to the quietest frame nearby so the cut sits between sounds */
export function snapToQuiet(a: Analysis, t: number, radius = 0.04) {
  const c = Math.round(t / HOP), r = Math.round(radius / HOP);
  let best = c, bv = Infinity;
  for (let i = Math.max(0, c - r); i <= Math.min(a.db.length - 1, c + r); i++) {
    const v = a.db[i] + Math.abs(i - c) * 0.15; // slight bias to stay close
    if (v < bv) { bv = v; best = i; }
  }
  return best * HOP;
}

function syllableNuclei(a: Analysis, isl: Island) {
  // smoothed energy peaks with ≥ 4 dB prominence
  const s: number[] = [];
  for (let i = isl.a; i < isl.b; i++) {
    let v = 0, k = 0;
    for (let j = i - 3; j <= i + 3; j++) if (j >= isl.a && j < isl.b) { v += a.db[j]; k++; }
    s.push(v / k);
  }
  let peaks = 0, lastMin = Infinity, rising = true, peakV = -Infinity;
  for (let i = 1; i < s.length; i++) {
    if (rising && s[i] < s[i - 1]) {
      peakV = s[i - 1];
      if (peakV - lastMin > 4 || peaks === 0) peaks++;
      rising = false;
      lastMin = s[i];
    } else if (!rising && s[i] > s[i - 1]) {
      rising = true;
    }
    if (!rising) lastMin = Math.min(lastMin, s[i]);
  }
  return Math.max(1, peaks);
}

function stats(arr: Float32Array, a: number, b: number) {
  let m = 0;
  for (let i = a; i < b; i++) m += arr[i];
  m /= b - a;
  let v = 0, mx = -Infinity;
  for (let i = a; i < b; i++) { v += (arr[i] - m) ** 2; mx = Math.max(mx, arr[i]); }
  return { mean: m, std: Math.sqrt(v / (b - a)), max: mx };
}

const FILLERS = new Set([
  'euh', 'euhh', 'euhhh', 'heu', 'heuu', 'eu', 'hum', 'humm', 'hmm', 'hm', 'mmh', 'mh', 'mmm', 'bah', 'beh', 'ben',
  'uh', 'um', 'umm', 'erm', 'er', 'ah', 'oh', 'eh', 'heuh', 'euhm',
]);
const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']/g, '');
export const isFiller = (w: string) => FILLERS.has(norm(w).replace(/(.)\1{2,}/g, '$1$1'));

/**
 * Propose all cuts for a rush. Returns cuts sorted by time; `on` = applied.
 * Strong evidence is applied, borderline cases are proposed for review.
 */
export function proposeCuts(a: Analysis, words: Word[], st: RoughCutSettings, bias = { hesitation: 0, retake: 0 }): Cut[] {
  const { mask } = voiceMask(a, st.threshold);
  const isl = islands(mask);
  const cuts: Cut[] = [];
  const T = a.duration;

  // 1. silences (including head and tail)
  const gaps: [number, number][] = [];
  let prev = 0;
  for (const i of isl) { gaps.push([prev * HOP, i.a * HOP]); prev = i.b; }
  gaps.push([prev * HOP, T]);
  for (const [s0, e0] of gaps) {
    const head = s0 === 0, tail = e0 >= T - 1e-6;
    if (e0 - s0 < st.minSilence && !head && !tail) continue;
    const s = head ? 0 : snapToQuiet(a, s0 + st.padding);
    const e = tail ? T : snapToQuiet(a, e0 - st.padding);
    if (e - s > 0.06) cuts.push({ s, e, reason: 'silence', on: true });
  }

  // 2. acoustic hesitations: one long, steady, isolated voiced sound
  if (st.hesitations) {
    for (let k = 0; k < isl.length; k++) {
      const it = isl[k];
      const dur = (it.b - it.a) * HOP;
      if (dur < 0.28 || dur > 1.4) continue;
      const before = k === 0 ? 1 : (it.a - isl[k - 1].b) * HOP;
      const after = k === isl.length - 1 ? 1 : (isl[k + 1].a - it.b) * HOP;
      if (before < 0.12 || after < 0.12) continue;
      const e = stats(a.db, it.a, it.b), z = stats(a.zcr, it.a, it.b);
      const nuclei = syllableNuclei(a, it);
      if (nuclei > 1) continue;
      // steady energy, no fricatives (low ZCR), not louder than usual speech
      let conf = 0;
      conf += e.std < 3 ? 0.35 : e.std < 4.5 ? 0.2 : 0;
      conf += z.max < 0.12 ? 0.25 : z.max < 0.2 ? 0.12 : 0;
      conf += dur > 0.45 ? 0.25 : 0.1;
      conf += e.mean < a.speech ? 0.15 : 0;
      if (conf < 0.5 - bias.hesitation) continue;
      const pad = Math.min(st.padding, 0.06);
      cuts.push({
        s: snapToQuiet(a, it.a * HOP - pad), e: snapToQuiet(a, it.b * HOP + pad),
        reason: 'hesitation', on: conf >= 0.75 - bias.hesitation, label: `son tenu ${dur.toFixed(2)} s`,
      });
    }
  }

  // 3. filler words from the transcript, located precisely with the acoustics
  if (st.fillers && words.length) {
    for (const w of words) {
      if (!w.filler && !isFiller(w.w)) continue;
      // find the voiced island that best overlaps the word
      const c = (w.s + w.e) / 2;
      let best: Island | null = null, bd = Infinity;
      for (const it of isl) {
        const m = ((it.a + it.b) / 2) * HOP;
        const d = Math.abs(m - c);
        if (d < bd && d < 0.6) { bd = d; best = it; }
      }
      const s = best && (best.b - best.a) * HOP < 1.6 ? best.a * HOP : w.s;
      const e = best && (best.b - best.a) * HOP < 1.6 ? best.b * HOP : w.e;
      cuts.push({ s: snapToQuiet(a, s - 0.03), e: snapToQuiet(a, e + 0.03), reason: 'filler', on: true, label: `« ${w.w} »` });
    }
  }

  // 4. false starts / retakes: a phrase restarted shortly after
  if (st.retakes && words.length > 4) {
    const W = words.map((w) => norm(w.w)).filter(Boolean);
    const ws = words.filter((w) => norm(w.w));
    for (let i = 0; i < W.length - 2; i++) {
      for (let j = i + 1; j < Math.min(W.length, i + 14); j++) {
        if (ws[j].s - ws[i].s > 9) break;
        let k = 0;
        while (j + k < W.length && i + k < j && W[i + k] === W[j + k]) k++;
        const strong = k >= 3, weak = k === 2 && ws[j].s - ws[j - 1].e > 0.35;
        if ((strong || weak) && !FILLERS.has(W[i])) {
          const s = snapToQuiet(a, ws[i].s - 0.03);
          const e = snapToQuiet(a, ws[j].s - 0.03);
          if (e - s > 0.25) {
            cuts.push({ s, e, reason: 'retake', on: strong || bias.retake > 0.25, label: `reprise : « ${ws.slice(i, j).map((x) => x.w).join(' ').slice(0, 60)} »` });
            i = j - 1;
          }
          break;
        }
      }
    }
  }
  return cuts.sort((x, y) => x.s - y.s);
}

/* ------------------------------------------------------- source ↔ edit */

export interface Seg { s: number; e: number; t: number } // source [s,e) placed at timeline t

export function keepSegments(ar: ARoll): Seg[] {
  const active = ar.cuts.filter((c) => c.on).map((c) => [Math.max(0, c.s), Math.min(ar.duration, c.e)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const c of active) {
    const l = merged[merged.length - 1];
    if (l && c[0] <= l[1] + 0.02) l[1] = Math.max(l[1], c[1]);
    else merged.push([...c]);
  }
  const segs: Seg[] = [];
  let cur = 0, t = 0;
  for (const [s, e] of merged) {
    if (s - cur >= 0.12) { segs.push({ s: cur, e: s, t }); t += s - cur; }
    cur = Math.max(cur, e);
  }
  if (ar.duration - cur >= 0.12) segs.push({ s: cur, e: ar.duration, t });
  return segs;
}

export const segsDuration = (segs: Seg[]) => segs.reduce((a, g) => a + (g.e - g.s), 0);

/** timeline time → { source time, segment index } */
export function toSource(segs: Seg[], t: number) {
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i];
    if (t < g.t + (g.e - g.s) || i === segs.length - 1) return { src: Math.min(g.e, g.s + Math.max(0, t - g.t)), i, local: t - g.t };
  }
  return { src: 0, i: 0, local: 0 };
}

/** source time → timeline time (null if the moment was cut) */
export function toTimeline(segs: Seg[], src: number): number | null {
  for (const g of segs) if (src >= g.s && src <= g.e) return g.t + (src - g.s);
  return null;
}

export const defaultRoughCut = (): RoughCutSettings => ({
  threshold: 14, minSilence: 0.38, padding: 0.09, hesitations: true, fillers: true, retakes: true,
});
