/**
 * Loudness as the platforms measure it (ITU-R BS.1770-4 / EBU R128):
 * K-weighting, 400 ms blocks with 75 % overlap, absolute gate at -70 LUFS and
 * relative gate at -10 LU. Then a gain to the target (YouTube, TikTok and
 * Spotify play around -14 LUFS) and a peak limiter so nothing clips.
 * Pure functions on Float32Array channels: testable and the same everywhere.
 */

/** biquad coefficients of the K-weighting pre-filter + RLB high-pass, for any sample rate */
function kFilters(sr: number) {
  // pre-filter (high shelf, +4 dB above ~1.5 kHz)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0],
  };
  // RLB high-pass (~38 Hz)
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / sr);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x: Float32Array, f: { b: number[]; a: number[] }): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const [b0, b1, b2] = f.b, [a1, a2] = f.a;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

export interface Loudness { integrated: number; peak: number; peakDb: number; lra: number }

/** integrated loudness (LUFS), sample peak and loudness range of a stereo/mono signal */
export function measureLoudness(channels: Float32Array[], sr: number): Loudness {
  const [shelf, hp] = kFilters(sr);
  const w = channels.map((c) => biquad(biquad(c, shelf), hp));
  const block = Math.round(sr * 0.4), hop = Math.round(sr * 0.1);
  const n = channels[0]?.length ?? 0;
  const blocks: number[] = [];
  for (let s = 0; s + block <= n; s += hop) {
    let z = 0;
    for (const c of w) { let acc = 0; for (let i = s; i < s + block; i++) acc += c[i] * c[i]; z += acc / block; }
    blocks.push(z);
  }
  const lk = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
  let integrated = -Infinity;
  if (abs.length) {
    const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((z) => lk(z) > rel);
    if (gated.length) integrated = lk(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
  // loudness range: 10th to 95th percentile of short-term (3 s) loudness, gated at -20 LU
  const st: number[] = [];
  const sb = Math.round(sr * 3);
  for (let s = 0; s + sb <= n; s += sr) {
    let z = 0;
    for (const c of w) { let acc = 0; for (let i = s; i < s + sb; i += 2) acc += c[i] * c[i]; z += acc / (sb / 2); }
    if (z > 0 && lk(z) > -70) st.push(lk(z));
  }
  let lra = 0;
  if (st.length > 2 && Number.isFinite(integrated)) {
    const g = st.filter((v) => v > integrated - 20).sort((a, b) => a - b);
    if (g.length > 2) lra = g[Math.floor(g.length * 0.95) - 1] - g[Math.floor(g.length * 0.1)];
  }
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
  return { integrated, peak, peakDb: 20 * Math.log10(peak || 1e-9), lra };
}

/**
 * Bring a mix to `target` LUFS without clipping: one gain, then a look-ahead
 * limiter at `ceilingDb` (dBFS, sample peak, -1.5 leaves room for codec overshoot).
 * Returns new channels; the input is untouched.
 */
export function normalize(channels: Float32Array[], sr: number, target = -14, ceilingDb = -1.5): { channels: Float32Array[]; gainDb: number; before: Loudness; after: Loudness } {
  const before = measureLoudness(channels, sr);
  if (!Number.isFinite(before.integrated)) return { channels, gainDb: 0, before, after: before };
  // the limiter takes energy off the peaks: correct and try again (3 passes at most)
  let gainDb = target - before.integrated;
  let best = { channels, gainDb: 0, after: before };
  for (let pass = 0; pass < 3; pass++) {
    gainDb = Math.max(-30, Math.min(30, gainDb));
    const out = limit(channels, sr, gainDb, ceilingDb);
    const after = measureLoudness(out, sr);
    best = { channels: out, gainDb, after };
    const miss = target - after.integrated;
    if (Math.abs(miss) < 0.3) break;
    gainDb += miss;
  }
  return { ...best, before };
}

/** gain then look-ahead peak limiter (5 ms ahead, 80 ms release) and a hard safety clip */
function limit(channels: Float32Array[], sr: number, gainDb: number, ceilingDb: number): Float32Array[] {
  const g = Math.pow(10, gainDb / 20);
  const ceil = Math.pow(10, ceilingDb / 20);
  const n = channels[0].length;
  const look = Math.round(sr * 0.005), rel = Math.exp(-1 / (sr * 0.08));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of channels) p = Math.max(p, Math.abs(c[i] * g));
    need[i] = p > ceil ? ceil / p : 1;
  }
  const env = new Float32Array(n);
  const dq: number[] = [];
  let head = 0;
  for (let i = 0; i < n + look; i++) {
    if (i < n) { while (dq.length > head && need[dq[dq.length - 1]] >= need[i]) dq.pop(); dq.push(i); }
    const j = i - look;
    if (j >= 0) { while (dq[head] < j) head++; env[j] = need[dq[head]]; }
  }
  let cur = 1;
  for (let i = 0; i < n; i++) { const tgt = env[i]; cur = tgt < cur ? tgt : tgt - (tgt - cur) * rel; env[i] = cur; }
  return channels.map((c) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = c[i] * g * env[i]; if (v > ceil) v = ceil; else if (v < -ceil) v = -ceil; o[i] = v; }
    return o;
  });
}
