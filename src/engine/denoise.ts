/**
 * Voice clean-up: adaptive noise reduction (spectral Wiener filter with a
 * decision-directed SNR estimate, the classic broadcast method), local and
 * deterministic. The noise is learnt from the quietest moments of the take.
 * Strength follows the measured signal-to-noise ratio: a clean take is left
 * alone, a noisy one is reduced, never to silence: a gain floor keeps the
 * breaths and the room so the voice does not sound "underwater".
 */
export type DenoiseMode = 'off' | 'auto' | 'light' | 'strong';
export interface NoiseReport { noiseDb: number; speechDb: number; snr: number; reductionDb: number; noiseAfterDb: number; applied: boolean }

const N = 1024, HOP = 256;

/** in-place radix-2 FFT (re, im of length N) */
function fft(re: Float64Array, im: Float64Array, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const db = (p: number) => 10 * Math.log10(Math.max(p, 1e-12));

/** frame energies (dB) of 20 ms blocks */
function blockDb(x: Float32Array, sr: number): number[] {
  const b = Math.round(sr * 0.02), out: number[] = [];
  for (let s = 0; s + b <= x.length; s += b) { let e = 0; for (let i = s; i < s + b; i++) e += x[i] * x[i]; out.push(db(e / b)); }
  return out;
}

/** noise floor and speech level of a take, from the distribution of 20 ms levels (digital silence excluded) */
export function analyseNoise(x: Float32Array, sr: number): { noiseDb: number; speechDb: number; snr: number } {
  // digital silence counts as « no noise » (−120 dB), not as missing data
  const lv = blockDb(x, sr).map((v) => Math.max(v, -120)).sort((a, b) => a - b);
  if (lv.length < 10) return { noiseDb: -120, speechDb: -120, snr: 99 };
  const noiseDb = lv[Math.floor(lv.length * 0.1)];
  const speechDb = lv[Math.floor(lv.length * 0.9)];
  return { noiseDb, speechDb, snr: speechDb - noiseDb };
}

/** how much to reduce (dB) for a mode and a measured SNR: nothing on a clean take, never more than 18 dB */
export function reductionFor(mode: DenoiseMode, snr: number, noiseDb: number): number {
  if (mode === 'off') return 0;
  if (mode === 'light') return 6;
  if (mode === 'strong') return 18;
  if (noiseDb < -70 || snr > 38) return 0;
  if (snr > 28) return 6;
  if (snr > 18) return 10;
  if (snr > 10) return 14;
  return 18;
}

/** denoise one channel; returns the cleaned signal (same length) */
export function denoise(x: Float32Array, _sr: number, reductionDb: number): Float32Array {
  if (reductionDb <= 0) return x;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // sqrt-Hann, analysis and synthesis
  const frames = Math.max(1, Math.ceil((x.length - N) / HOP) + 1);
  const bins = N / 2 + 1;
  // 1. power spectra of all frames, then the noise as the 15 % quietest frames
  const pow: Float32Array[] = [];
  const energy: number[] = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  const spec: { re: Float64Array; im: Float64Array }[] = [];
  for (let f = 0; f < frames; f++) {
    const s = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const p = new Float32Array(bins);
    let e = 0;
    for (let k = 0; k < bins; k++) { p[k] = re[k] * re[k] + im[k] * im[k]; e += p[k]; }
    pow.push(p); energy.push(e);
    spec.push({ re: re.slice(), im: im.slice() });
  }
  const order = energy.map((e, i) => [e, i] as const).filter(([e]) => e > 1e-14).sort((a, b) => a[0] - b[0]);
  const quiet = order.slice(0, Math.max(3, Math.floor(order.length * 0.15))).map(([, i]) => i);
  const noise = new Float64Array(bins);
  for (const i of quiet) for (let k = 0; k < bins; k++) noise[k] += pow[i][k] / quiet.length;
  // 2. decision-directed Wiener gain with a floor, smoothed across frequency
  const gmin = Math.pow(10, -reductionDb / 20), alpha = 0.98;
  const prevG = new Float64Array(bins).fill(1), prevP = new Float64Array(bins);
  const out = new Float32Array(x.length);
  const g = new Float64Array(bins), gs = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const p = pow[f];
    for (let k = 0; k < bins; k++) {
      const nk = Math.max(noise[k], 1e-14);
      const post = p[k] / nk;
      const prio = alpha * (prevG[k] * prevG[k] * prevP[k]) / nk + (1 - alpha) * Math.max(post - 1, 0);
      g[k] = Math.max(gmin, prio / (1 + prio));
    }
    for (let k = 0; k < bins; k++) gs[k] = (g[Math.max(0, k - 1)] + 2 * g[k] + g[Math.min(bins - 1, k + 1)]) / 4;
    const { re: r, im: m } = spec[f];
    for (let k = 0; k < bins; k++) {
      prevG[k] = gs[k]; prevP[k] = p[k];
      r[k] *= gs[k]; m[k] *= gs[k];
      if (k > 0 && k < N / 2) { r[N - k] = r[k]; m[N - k] = -m[k]; }
    }
    fft(r, m, true);
    const s = f * HOP;
    for (let i = 0; i < N && s + i < out.length; i++) out[s + i] += r[i] * win[i] * (HOP * 2 / N); // sqrt-Hann² at 75 % overlap sums to N/(2·HOP)
  }
  return out;
}

/** full clean-up of a take: analysis, adaptive reduction, report */
export function cleanVoice(channels: Float32Array[], sr: number, mode: DenoiseMode): { channels: Float32Array[]; report: NoiseReport } {
  const a = analyseNoise(channels[0], sr);
  const red = reductionFor(mode, a.snr, a.noiseDb);
  if (red <= 0) return { channels, report: { ...a, reductionDb: 0, noiseAfterDb: a.noiseDb, applied: false } };
  const out = channels.map((c) => denoise(c, sr, red));
  const after = analyseNoise(out[0], sr);
  return { channels: out, report: { ...a, reductionDb: red, noiseAfterDb: after.noiseDb, applied: true } };
}
