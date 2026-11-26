/**
 * Broadcast voice ("voix radio"): the processing chain of a radio or YouTube
 * voice, computed once on the take (offline, deterministic) so the preview
 * and the export sound identical.
 *   1. high-pass 80 Hz (24 dB/oct): rumble, desk knocks, plosive thumps
 *   2. EQ: −3 dB at 250 Hz (mud), +3 dB at 3.5 kHz (presence), +2 dB shelf at 10 kHz (air)
 *   3. de-esser: the 5–9 kHz band is pulled down only while an « s » dominates
 *   4. leveler: slow automatic gain that brings loud and quiet sentences together
 *   5. compressor 3:1 (fast), then a soft limiter at −1 dBFS
 * Each stage is measured in the report (no claim without a number).
 */
export type VoicePreset = 'off' | 'natural' | 'radio';

interface Bq { b0: number; b1: number; b2: number; a1: number; a2: number }
function rbj(type: 'hp' | 'lp' | 'peak' | 'hshelf', f: number, sr: number, q = 0.707, gainDb = 0): Bq {
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  else { const s2 = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + s2); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - s2); a0 = (A + 1) - (A - 1) * cs + s2; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - s2; }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
export function filter(x: Float32Array, f: Bq): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
const lin = (d: number) => Math.pow(10, d / 20);

/** RMS level (dB) in windows of `win` seconds */
export function levels(x: Float32Array, sr: number, win = 0.05): number[] {
  const n = Math.round(sr * win), out: number[] = [];
  for (let s = 0; s + n <= x.length; s += n) { let e = 0; for (let i = s; i < s + n; i++) e += x[i] * x[i]; out.push(db(Math.sqrt(e / n))); }
  return out;
}

export interface VoiceReport { preset: VoicePreset; levelSpreadBefore: number; levelSpreadAfter: number; sibilanceCutDb: number; rumbleCutDb: number; gainDb: number }

/** spread (dB) between loud and quiet speech: 90th − 20th percentile of the voiced 400 ms levels */
export function speechSpread(x: Float32Array, sr: number): number {
  const lv = levels(x, sr, 0.4).filter((v) => v > -60).sort((a, b) => a - b);
  if (lv.length < 5) return 0;
  return lv[Math.floor(lv.length * 0.9)] - lv[Math.floor(lv.length * 0.2)];
}
const bandDb = (x: Float32Array, f: Bq[]) => { let y = x; for (const q of f) y = filter(y, q); let e = 0; for (let i = 0; i < y.length; i++) e += y[i] * y[i]; return db(Math.sqrt(e / Math.max(1, y.length))); };

export function polishVoice(ch: Float32Array[], sr: number, preset: VoicePreset): { channels: Float32Array[]; report: VoiceReport } {
  const mono = ch[0];
  const RUMBLE = () => [rbj('lp', 55, sr), rbj('lp', 55, sr), rbj('lp', 55, sr)]; // 36 dB/oct: below the voice only
  const rumbleBefore = bandDb(mono, RUMBLE());
  const spreadBefore = speechSpread(mono, sr);
  if (preset !== 'radio') return { channels: ch, report: { preset, levelSpreadBefore: spreadBefore, levelSpreadAfter: spreadBefore, sibilanceCutDb: 0, rumbleCutDb: 0, gainDb: 0 } };
  const deEss: number[] = [];
  const out = ch.map((x0) => {
    // 1–2. EQ
    let x = x0;
    for (const f of [rbj('hp', 80, sr, 0.54), rbj('hp', 80, sr, 1.31), rbj('peak', 250, sr, 1, -3), rbj('peak', 3500, sr, 0.9, 3), rbj('hshelf', 12000, sr, 0.707, 2)]) x = filter(x, f);
    // 3. de-esser: subtract part of the 5–9 kHz band while it dominates the voice
    const band = filter(filter(x, rbj('hp', 5000, sr)), rbj('lp', 9000, sr));
    // the body of the voice (vowels): an « s » is when the high band dominates it
    const body = filter(filter(x, rbj('hp', 200, sr)), rbj('lp', 2000, sr));
    const atk = Math.exp(-1 / (sr * 0.002)), rel = Math.exp(-1 / (sr * 0.06));
    let eb = 0, ef = 0, sb = 0, sa = 0;
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const ab = Math.abs(band[i]), af = Math.abs(body[i]);
      eb = ab > eb ? atk * eb + (1 - atk) * ab : rel * eb + (1 - rel) * ab;
      ef = af > ef ? atk * ef + (1 - atk) * af : rel * ef + (1 - rel) * af;
      const ratio = eb / Math.max(ef, 1e-6); // high band against the body of the voice
      const cut = ratio > 0.8 ? Math.min(0.6, (ratio - 0.8) * 1.2) : 0; // up to −8 dB on the band only
      y[i] = x[i] - cut * band[i];
      sb += band[i] * band[i]; sa += (band[i] * (1 - cut)) ** 2;
    }
    deEss.push(10 * Math.log10(Math.max(sb, 1e-12) / Math.max(sa, 1e-12)));
    // 4. leveler: slow gain towards −20 dBFS RMS on speech, held during pauses
    const win = Math.round(sr * 0.05), target = -20;
    const lv = levels(y, sr, 0.05);
    const floor = [...lv].sort((a, b) => a - b)[Math.floor(lv.length * 0.15)] ?? -80;
    const gains: number[] = [];
    let g = 0;
    for (const l of lv) {
      if (l > floor + 8 && l > -55) { const want = Math.max(-6, Math.min(9, target - l)); g += (want - g) * (want < g ? 0.3 : 0.12); } // ~0.15 s down, ~0.4 s up
      gains.push(g);
    }
    const z = new Float32Array(y.length);
    for (let i = 0; i < y.length; i++) {
      const k = Math.min(gains.length - 1, Math.floor(i / win)), k2 = Math.min(gains.length - 1, k + 1), u = (i % win) / win;
      z[i] = y[i] * lin(gains[k] * (1 - u) + gains[k2] * u);
    }
    // 5. compressor 3:1 above −18 dBFS (5 ms / 80 ms), then soft limit at −1 dBFS
    const ca = Math.exp(-1 / (sr * 0.005)), cr = Math.exp(-1 / (sr * 0.08));
    let env = 0;
    const w = new Float32Array(z.length);
    const ceil = lin(-1);
    for (let i = 0; i < z.length; i++) {
      const a = Math.abs(z[i]);
      env = a > env ? ca * env + (1 - ca) * a : cr * env + (1 - cr) * a;
      const over = db(env) + 18;
      const gr = over > 0 ? -over * (1 - 1 / 3) : 0;
      let v = z[i] * lin(gr + 3); // +3 dB make-up
      v = Math.tanh(v / ceil) * ceil;
      w[i] = v;
    }
    return w;
  });
  const o = out[0];
  return {
    channels: out,
    report: {
      preset,
      levelSpreadBefore: spreadBefore,
      levelSpreadAfter: speechSpread(o, sr),
      sibilanceCutDb: deEss[0] ?? 0,
      rumbleCutDb: (rumbleBefore - bandDb(mono, [])) - (bandDb(o, RUMBLE()) - bandDb(o, [])),
      gainDb: bandDb(o, []) - bandDb(mono, []),
    },
  };
}
