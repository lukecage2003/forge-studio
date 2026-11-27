/**
 * AUDIO CHECK of a source recording (the rush, a voice-over): what a sound
 * engineer looks at before mixing. Clipped passages (the recording itself
 * saturated: no mix can repair them), the noise floor (room, hum), and a
 * voice recorded too low. Pure on samples; the result is cached per media.
 */
export interface SourceAudio { clippedRuns: number; clippedSec: number; noiseDb: number; speechDb: number; lowLevel: boolean; noisy: boolean }

export function checkSource(ch: Float32Array[], sr: number): SourceAudio {
  const x = ch[0];
  let runs = 0, clipped = 0, run = 0;
  for (let i = 0; i < x.length; i++) {
    const hot = ch.some((c) => Math.abs(c[i]) >= 0.998);
    if (hot) { run++; clipped++; } else { if (run >= 3) runs++; run = 0; }
  }
  if (run >= 3) runs++;
  // loudness of 50 ms frames: the quietest tenth is the room, the loudest third is the voice
  const f = Math.max(1, Math.round(sr * 0.05)), db: number[] = [];
  for (let i = 0; i + f <= x.length; i += f) { let s = 0; for (let k = i; k < i + f; k++) s += x[k] * x[k]; db.push(10 * Math.log10(s / f + 1e-12)); }
  db.sort((a, b) => a - b);
  const noiseDb = db.length ? db[Math.floor(db.length * 0.1)] : -100;
  const speechDb = db.length ? db[Math.floor(db.length * 0.85)] : -100;
  return { clippedRuns: runs, clippedSec: clipped / sr, noiseDb, speechDb, lowLevel: speechDb < -32, noisy: speechDb - noiseDb < 25 };
}

const cache = new Map<string, SourceAudio>();
export function sourceAudio(mediaId: string, buf: AudioBuffer | undefined): SourceAudio | null {
  if (!buf) return null;
  const hit = cache.get(mediaId);
  if (hit) return hit;
  const r = checkSource(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate);
  cache.set(mediaId, r);
  return r;
}
