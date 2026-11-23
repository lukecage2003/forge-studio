/**
 * Lightweight beat tracker: onset envelope (energy flux) → tempo by
 * autocorrelation (70–180 BPM) → best phase. Good enough to cut on the beat.
 */
export interface BeatGrid { bpm: number; offset: number; beats: number[]; confidence: number }

export function detectBeats(buf: AudioBuffer, from = 0, to = buf.duration): BeatGrid | null {
  const sr = buf.sampleRate;
  const hop = 512;
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
  const s0 = Math.floor(from * sr), s1 = Math.min(ch0.length, Math.floor(to * sr));
  const n = Math.floor((s1 - s0) / hop);
  if (n < 64) return null;
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    const b = s0 + i * hop;
    for (let j = 0; j < hop; j++) {
      const v = (ch0[b + j] + ch1[b + j]) * 0.5;
      e += v * v;
    }
    e = Math.log1p(e * 100);
    env[i] = Math.max(0, e - prev);
    prev = e;
  }
  // normalise
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  for (let i = 0; i < n; i++) env[i] = Math.max(0, env[i] - mean);

  const fps = sr / hop;
  const minLag = Math.floor((60 / 180) * fps), maxLag = Math.ceil((60 / 70) * fps);
  let bestLag = 0, best = 0, total = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    // mild preference for ~120 BPM
    const bpm = (60 * fps) / lag;
    s *= Math.exp(-Math.pow(Math.log2(bpm / 120), 2) * 0.5);
    total += s;
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag || best <= 0) return null;
  // phase
  let bestPh = 0, bestPhS = -1;
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0;
    for (let i = ph; i < n; i += bestLag) s += env[i];
    if (s > bestPhS) { bestPhS = s; bestPh = ph; }
  }
  const period = bestLag / fps;
  const offset = from + bestPh / fps;
  const beats: number[] = [];
  for (let t = offset; t < to; t += period) beats.push(t);
  const confidence = best / (total / (maxLag - minLag + 1)) ;
  return { bpm: 60 / period, offset, beats, confidence };
}
