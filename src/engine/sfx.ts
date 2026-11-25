import type { Project } from '../types';
import { layoutShots } from './timeline';

/**
 * Automatic sound design, synthesised (no sound files): an airy whoosh on
 * moving transitions, a low impact on splash pages and shake hits, a soft
 * tick on cuts between panels. Levels stay under the voice.
 */
type Kind = 'whoosh' | 'impact' | 'swish';
const cache = new Map<string, AudioBuffer>();

function biquadBP(x: Float32Array, sr: number, f0At: (i: number) => number, q: number) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const w0 = (2 * Math.PI * f0At(i)) / sr, al = Math.sin(w0) / (2 * q), c = Math.cos(w0);
    const a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

function make(ctx: BaseAudioContext, kind: Kind): AudioBuffer {
  const key = kind + ctx.sampleRate;
  const hit = cache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const dur = kind === 'impact' ? 0.9 : kind === 'whoosh' ? 0.55 : 0.22;
  const n = Math.round(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const noise = Float32Array.from({ length: n }, () => Math.random() * 2 - 1);
  let out: Float32Array;
  if (kind === 'impact') {
    out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 38 + 70 * Math.exp(-t * 14); // pitch drop
      ph += (2 * Math.PI * f) / sr;
      const body = Math.sin(ph) * Math.exp(-t * 4.2);
      const crack = noise[i] * Math.exp(-t * 38) * 0.45;
      out[i] = Math.tanh((body + crack) * 1.6) * 0.9;
    }
  } else {
    const sweepUp = kind === 'whoosh';
    const filt = biquadBP(noise, sr, (i) => {
      const p = i / n;
      return sweepUp ? 350 + 3200 * Math.sin(p * Math.PI) ** 1.5 : 2500 + 3500 * p;
    }, 1.2);
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const env = sweepUp ? Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 2 : Math.exp(-p * 9) * (1 - Math.exp(-p * 300));
      out[i] = filt[i] * env * (sweepUp ? 1.6 : 1.1);
    }
  }
  // gentle stereo movement for whooshes
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const pan = kind === 'whoosh' ? (c === 0 ? 1 - (i / n) * 0.6 : 0.4 + (i / n) * 0.6) : 1;
      ch[i] = out[i] * pan;
    }
  }
  cache.set(key, buf);
  return buf;
}

const MOVING = new Set(['whip', 'slide', 'zoom', 'slash', 'iris', 'glitch', 'burn']);

export interface SfxEvent { t: number; kind: Kind; gain: number }

export function sfxEvents(p: Project): SfxEvent[] {
  if (!p.autoSfx?.on) return [];
  const ev: SfxEvent[] = [];
  const timed = layoutShots(p);
  for (const ts of timed) {
    const s = ts.shot;
    if (MOVING.has(s.transition)) ev.push({ t: ts.start - 0.18, kind: 'whoosh', gain: s.transition === 'whip' ? 0.9 : 0.6 });
    else if (s.transition === 'glide') ev.push({ t: ts.start - 0.05, kind: 'swish', gain: 0.25 });
    if (s.shake > 0.3 || s.transition === 'flash') ev.push({ t: ts.start, kind: 'impact', gain: 0.5 + 0.5 * Math.min(1, s.shake) });
  }
  for (const f of p.fx ?? []) if (f.kind === 'callout') ev.push({ t: f.start, kind: 'impact', gain: 0.6 });
  return ev.filter((e) => e.t >= 0).sort((a, b) => a.t - b.t);
}

export function scheduleSfx(ctx: BaseAudioContext, dest: AudioNode, p: Project, t0: number, T0: number, until = Infinity) {
  const nodes: AudioBufferSourceNode[] = [];
  const vol = p.autoSfx?.volume ?? 0.6;
  for (const e of sfxEvents(p)) {
    if (e.t < t0 - 0.05 || e.t >= until) continue;
    const src = ctx.createBufferSource();
    src.buffer = make(ctx, e.kind);
    const g = ctx.createGain();
    g.gain.value = vol * e.gain * 0.5;
    src.connect(g);
    g.connect(dest);
    src.start(T0 + Math.max(0, e.t - t0));
    nodes.push(src);
  }
  return nodes;
}
