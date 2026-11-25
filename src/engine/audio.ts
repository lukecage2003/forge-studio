import type { AudioClip, Project } from '../types';
import { audioCtx, getAudio } from './media';
import { segmentsOf } from './timeline';
import { scheduleSfx } from './sfx';

type KF = [number, number];

function valueAt(kfs: KF[], t: number) {
  if (!kfs.length) return 1;
  if (t <= kfs[0][0]) return kfs[0][1];
  for (let i = 1; i < kfs.length; i++) {
    const [t1, v1] = kfs[i];
    const [t0, v0] = kfs[i - 1];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return kfs[kfs.length - 1][1];
}

function fadeKfs(c: AudioClip): KF[] {
  const s = c.start, e = c.start + c.duration, v = c.volume;
  const fi = Math.min(c.fadeIn, c.duration / 2), fo = Math.min(c.fadeOut, c.duration / 2);
  return [[s, fi > 0 ? 0 : v], [s + fi, v], [e - fo, v], [e, fo > 0 ? 0 : v]];
}

export function voiceIntervals(p: Project) {
  const iv = [
    ...p.audio.filter((c) => c.kind === 'voice').map((c) => [c.start, c.start + c.duration] as [number, number]),
    ...segmentsOf(p.aroll).map((g) => [g.t, g.t + g.e - g.s] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const i of iv) {
    const last = out[out.length - 1];
    if (last && i[0] <= last[1] + 0.4) last[1] = Math.max(last[1], i[1]);
    else out.push([...i]);
  }
  return out;
}

function duckKfs(p: Project): KF[] {
  const k: KF[] = [[0, 1]];
  for (const [s, e] of voiceIntervals(p)) {
    k.push([Math.max(0, s - 0.2), 1], [s, p.duckLevel], [e, p.duckLevel], [e + 0.45, 1]);
  }
  return k;
}

function applyKfs(param: AudioParam, kfs: KF[], t0: number, T0: number) {
  param.setValueAtTime(valueAt(kfs, t0), T0);
  for (const [t, v] of kfs) if (t > t0) param.linearRampToValueAtTime(v, T0 + (t - t0));
}

/**
 * Schedule every clip of the project on `ctx`, as if timeline time `t0` happens at context time `T0`.
 * Returns the created source nodes so preview playback can stop them.
 */
export function schedule(ctx: BaseAudioContext, dest: AudioNode, p: Project, t0: number, T0: number, until = Infinity) {
  const nodes: AudioBufferSourceNode[] = [];
  const duck = p.ducking ? duckKfs(p) : null;
  for (const c of p.audio) {
    const buf = getAudio(c.mediaId);
    if (!buf) continue;
    const end = Math.min(c.start + c.duration, until);
    if (end <= t0) continue;
    const from = Math.max(c.start, t0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    applyKfs(g.gain, fadeKfs(c), t0, T0);
    let tail: AudioNode = g;
    src.connect(g);
    if (duck && c.kind === 'music') {
      const dg = ctx.createGain();
      applyKfs(dg.gain, duck, t0, T0);
      g.connect(dg);
      tail = dg;
    }
    tail.connect(dest);
    src.start(T0 + (from - t0), c.offset + (from - c.start), end - from);
    nodes.push(src);
  }
  // face-cam rush: each kept segment, with 6 ms micro-fades so jump cuts never click
  const ar = p.aroll;
  const abuf = ar && getAudio(ar.mediaId);
  if (ar && abuf) {
    const bus = ctx.createGain();
    bus.gain.value = ar.volume;
    bus.connect(dest);
    for (const g of segmentsOf(ar)) {
      const len = g.e - g.s, end = Math.min(g.t + len, until);
      if (end <= t0) continue;
      const from = Math.max(g.t, t0);
      const src = ctx.createBufferSource();
      src.buffer = abuf;
      const gn = ctx.createGain();
      const at = T0 + (from - t0), stop = T0 + (end - t0);
      const f = Math.min(0.006, (stop - at) / 3);
      gn.gain.setValueAtTime(0, at);
      gn.gain.linearRampToValueAtTime(1, at + f);
      gn.gain.setValueAtTime(1, stop - f);
      gn.gain.linearRampToValueAtTime(0, stop);
      src.connect(gn);
      gn.connect(bus);
      src.start(at, g.s + (from - g.t), end - from);
      nodes.push(src);
    }
  }
  nodes.push(...scheduleSfx(ctx, dest, p, t0, T0, until));
  return nodes;
}

/* ----------------------------------------------------- preview transport */

let live: AudioBufferSourceNode[] = [];
let master: GainNode | null = null;

export function startPreviewAudio(p: Project, t0: number) {
  stopPreviewAudio();
  const ctx = audioCtx();
  if (ctx.state === 'suspended') void ctx.resume();
  master = ctx.createGain();
  master.connect(ctx.destination);
  const T0 = ctx.currentTime + 0.05;
  live = schedule(ctx, master, p, t0, T0);
  return T0;
}

export function stopPreviewAudio() {
  for (const n of live) {
    try { n.stop(); } catch { /* already stopped */ }
    n.disconnect();
  }
  live = [];
  master?.disconnect();
  master = null;
}

/** Mix the full soundtrack offline. */
export async function renderMix(p: Project, duration: number, sampleRate = 48000) {
  const len = Math.max(1, Math.ceil(duration * sampleRate));
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  schedule(ctx, ctx.destination, p, 0, 0, duration);
  return ctx.startRendering();
}

/** Peak data for waveform drawing. */
const peakCache = new Map<string, Float32Array>();
export function peaks(mediaId: string, buckets = 2000) {
  const key = mediaId + ':' + buckets;
  if (peakCache.has(key)) return peakCache.get(key)!;
  const b = getAudio(mediaId);
  if (!b) return null;
  const ch = b.getChannelData(0);
  const out = new Float32Array(buckets);
  const step = ch.length / buckets;
  for (let i = 0; i < buckets; i++) {
    let m = 0;
    const s = Math.floor(i * step), e = Math.floor((i + 1) * step);
    for (let j = s; j < e; j += 8) m = Math.max(m, Math.abs(ch[j]));
    out[i] = m;
  }
  peakCache.set(key, out);
  return out;
}
