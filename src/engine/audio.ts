import type { AudioClip, Project } from '../types';
import { audioCtx, getAudio } from './media';
import { segmentsOf } from './timeline';
import { scheduleSfx } from './sfx';

type KF = [number, number];

/** value of a keyframed level at time t; several keyframes at the same time: the last one wins (a step) */
export function valueAt(kfs: KF[], t: number) {
  if (!kfs.length) return 1;
  if (t < kfs[0][0]) return kfs[0][1];
  let i = 0;
  while (i + 1 < kfs.length && kfs[i + 1][0] <= t) i++;
  if (i + 1 >= kfs.length) return kfs[i][1];
  const [t0, v0] = kfs[i], [t1, v1] = kfs[i + 1];
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
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

function duckKfs(p: Project, level = p.duckLevel): KF[] {
  const k: KF[] = [[0, 1]];
  for (const [s, e] of voiceIntervals(p)) {
    k.push([Math.max(0, s - 0.2), 1], [s, level], [e, level], [e + 0.45, 1]);
  }
  return k;
}

/** sound effects stay under the voice too (less than the music: they are short accents) */
export const SFX_UNDER_VOICE = 0.6;

/**
 * Voice priority: rumble cut under 80 Hz, a gentle compressor that evens out
 * the words, a presence lift around 3 kHz and make-up gain. Returns the input node.
 */
function voiceChain(ctx: BaseAudioContext, dest: AudioNode): AudioNode {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.2;
  const pres = ctx.createBiquadFilter();
  pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 2.5;
  const make = ctx.createGain();
  make.gain.value = 1.45;
  hp.connect(comp); comp.connect(pres); pres.connect(make); make.connect(dest);
  return hp;
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
  const clean = p.mix?.voiceClean !== false;
  const voiceIn = clean ? voiceChain(ctx, dest) : dest;
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
    tail.connect(c.kind === 'voice' ? voiceIn : dest);
    src.start(T0 + (from - t0), c.offset + (from - c.start), end - from);
    nodes.push(src);
  }
  // face-cam rush: each kept segment, with 6 ms micro-fades so jump cuts never click
  const ar = p.aroll;
  const abuf = ar && getAudio(ar.mediaId);
  if (ar && abuf) {
    const bus = ctx.createGain();
    bus.gain.value = ar.volume;
    bus.connect(voiceIn);
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
  // sound effects: one bus, lowered while someone speaks
  const sfxBus = ctx.createGain();
  if (voiceIntervals(p).length) applyKfs(sfxBus.gain, duckKfs(p, SFX_UNDER_VOICE), t0, T0);
  sfxBus.connect(dest);
  nodes.push(...scheduleSfx(ctx, sfxBus, p, t0, T0, until));
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

export interface MixInfo { before: number; after: number; peakDb: number; lra: number; gainDb: number; target: number | null }

/** The export mix: rendered offline, then brought to the loudness target (see engine/loudness). */
export async function masterMix(p: Project, duration: number, sampleRate = 48000): Promise<{ buffer: AudioBuffer; info: MixInfo }> {
  const raw = await renderMix(p, duration, sampleRate);
  const { measureLoudness, normalize } = await import('./loudness');
  const chans = [raw.getChannelData(0), raw.getChannelData(1)];
  const target = p.mix?.target ?? null;
  if (target == null) {
    const m = measureLoudness(chans, sampleRate);
    return { buffer: raw, info: { before: m.integrated, after: m.integrated, peakDb: m.peakDb, lra: m.lra, gainDb: 0, target } };
  }
  const r = normalize(chans, sampleRate, target, -1.5);
  const out = new AudioBuffer({ length: raw.length, numberOfChannels: 2, sampleRate });
  r.channels.forEach((c, i) => out.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return { buffer: out, info: { before: r.before.integrated, after: r.after.integrated, peakDb: r.after.peakDb, lra: r.after.lra, gainDb: r.gainDb, target } };
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
