import { describe, expect, it } from 'vitest';
import { polishVoice, speechSpread } from '../src/engine/voicepro';
import { rng } from '../src/engine/rng';

const sr = 48000;
/** a synthetic voice: phrases alternately loud and quiet, voiced harmonics, some « s », and 40 Hz rumble */
function take(secs = 12) {
  const r = rng(3);
  return Float32Array.from({ length: sr * secs }, (_, i) => {
    const t = i / sr, phrase = Math.floor(t / 2), inP = t % 2;
    if (inP > 1.6) return 0.002 * Math.sin(2 * Math.PI * 40 * t);
    const lvl = phrase % 2 ? 0.08 : 0.4; // 14 dB apart
    const syl = (t % 0.25) < 0.17 ? Math.sin(Math.PI * ((t % 0.25) / 0.17)) : 0;
    const voiced = Math.sin(2 * Math.PI * 140 * t) + 0.6 * Math.sin(2 * Math.PI * 280 * t) + 0.3 * Math.sin(2 * Math.PI * 1100 * t);
    const s = (t % 1) > 0.9 ? (r() * 2 - 1) * 1.5 : 0; // « s » bursts
    return lvl * (syl * voiced * 0.5 + s * 0.3) + 0.02 * Math.sin(2 * Math.PI * 40 * t);
  });
}

describe('voix radio', () => {
  it('rapproche les phrases fortes et faibles, coupe le grondement et les sifflantes', () => {
    const x = take();
    const r = polishVoice([x], sr, 'radio');
    expect(r.report.levelSpreadAfter).toBeLessThan(r.report.levelSpreadBefore - 4);
    expect(r.report.rumbleCutDb).toBeGreaterThan(10);
    expect(r.report.sibilanceCutDb).toBeGreaterThan(0.5);
    let peak = 0; for (const v of r.channels[0]) peak = Math.max(peak, Math.abs(v));
    expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-0.99);
  });
  it('« naturel » et « aucun » ne touchent pas au signal', () => {
    const x = take(4);
    expect(polishVoice([x], sr, 'natural').channels[0]).toBe(x);
    expect(speechSpread(x, sr)).toBeGreaterThan(8);
  });
});

import { bedGain, musicClips, pickTrack, type Track } from '../src/engine/library';
describe('bibliothèque musicale et mixage', () => {
  const T = (o: Partial<Track>): Track => ({ id: 't', name: 'Morceau', mediaId: 'm', duration: 30, lufs: -12, bpm: 120, energy: 0.3, dynamics: 6, mood: 'calme', tags: [], added: '2026', ...o });
  it('niveau calé sur la mesure réelle : un morceau fort est baissé, un faible remonté', () => {
    expect(20 * Math.log10(bedGain(-12))).toBeCloseTo(-9, 1);
    expect(20 * Math.log10(bedGain(-27))).toBeCloseTo(6, 1);
  });
  it('un morceau trop court boucle sur des mesures entières, avec fondus croisés, jusqu’à la fin exacte', () => {
    const clips = musicClips(T({ duration: 30, bpm: 120 }), 75);
    const bar = 2; // 4 beats at 120 BPM
    for (const c of clips.slice(0, -1)) expect(((c.duration - 2) / bar) % 1).toBeCloseTo(0, 5);
    const last = clips.at(-1)!;
    expect(last.start + last.duration).toBeCloseTo(75, 2);
    for (let i = 1; i < clips.length; i++) expect(clips[i].start).toBeCloseTo(clips[i - 1].start + clips[i - 1].duration - 2, 3);
    expect(clips[0].fadeIn).toBeCloseTo(0.6);
    expect(last.fadeOut).toBeGreaterThanOrEqual(2);
  });
  it('choisit la musique selon le profil', () => {
    const tracks = [T({ id: 'a', mood: 'calme' }), T({ id: 'b', mood: 'energique' }), T({ id: 'c', mood: 'epique' })];
    expect(pickTrack(tracks, 'action', 40)!.id).toBe('b');
    expect(pickTrack(tracks, 'cosmic', 40)!.id).toBe('c');
    expect(pickTrack(tracks, 'premium', 40)!.id).toBe('a');
  });
});
