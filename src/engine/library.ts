/**
 * Music library: the user's own tracks, kept across projects (IndexedDB),
 * each analysed once: real loudness (LUFS), tempo, energy and a mood.
 * Mixing rules used when a track goes into an edit:
 *   - level set from the measured loudness, not from a guess (bed at −21 LUFS,
 *     ~7 dB under a −14 LUFS voice, then −11 dB more while someone speaks)
 *   - a track shorter than the video loops on a bar line, with a 2 s crossfade
 *   - fade-in 0.6 s, fade-out over the last 2.5 s of the video
 */
import type { AudioClip, Project } from '../types';
import { uid } from '../lib/util';
import { detectBeats } from './beats';
import { measureLoudness } from './loudness';

export type Mood = 'calme' | 'tension' | 'epique' | 'energique';
export const MOOD_FR: Record<Mood, string> = { calme: 'Calme', tension: 'Tension', epique: 'Épique', energique: 'Énergique' };
export interface Track { id: string; name: string; mediaId: string; duration: number; lufs: number; bpm: number | null; energy: number; dynamics: number; mood: Mood; tags: string[]; added: string }

/** loudness, tempo, energy and dynamics of a track → its mood (the user can change it) */
export function analyseTrack(buf: AudioBuffer): Omit<Track, 'id' | 'name' | 'mediaId' | 'tags' | 'added'> {
  const ch = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
  const L = measureLoudness(ch, buf.sampleRate);
  const grid = detectBeats(buf, 0, Math.min(buf.duration, 90));
  const bpm = grid && grid.confidence > 1.15 ? Math.round(grid.bpm) : null;
  // energy = share of high-frequency movement (zero-crossing rate), dynamics = loudness range
  const x = ch[0];
  let zc = 0;
  for (let i = 1; i < x.length; i += 4) if ((x[i] >= 0) !== (x[i - 4] >= 0)) zc++;
  const energy = Math.min(1, (zc / (x.length / 4)) * 6);
  const dynamics = L.lra;
  const fast = (bpm ?? 90) >= 115;
  const mood: Mood = fast && energy > 0.35 ? 'energique' : dynamics > 9 && (bpm ?? 0) < 115 ? 'epique' : energy > 0.3 ? 'tension' : 'calme';
  return { duration: buf.duration, lufs: Number.isFinite(L.integrated) ? L.integrated : -30, bpm, energy, dynamics, mood };
}

/* ----------------------------------------------------------- storage */
const DB = 'forge-library';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('tracks', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function listTracks(): Promise<Track[]> {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('tracks').objectStore('tracks').getAll(); q.onsuccess = () => res((q.result as Track[]).sort((a, b) => b.added.localeCompare(a.added))); q.onerror = () => rej(q.error); });
}
export async function saveTrack(t: Track) {
  const db = await idb();
  return new Promise<void>((res, rej) => { const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').put(t); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function deleteTrack(id: string) {
  const db = await idb();
  return new Promise<void>((res, rej) => { const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

/* ----------------------------------------------------------- choosing and mixing */
/** which moods suit a creative profile (first = best) */
export const PROFILE_MOODS: Record<string, Mood[]> = {
  premium: ['calme', 'epique', 'tension'], cosmic: ['epique', 'calme', 'tension'], action: ['energique', 'tension', 'epique'],
  character: ['calme', 'tension', 'epique'], science: ['calme', 'tension'], timeline: ['calme', 'epique'], power: ['epique', 'energique', 'tension'], editorial: ['energique', 'calme', 'tension'],
};
export function pickTrack(tracks: Track[], profile: string | undefined, duration: number): Track | null {
  if (!tracks.length) return null;
  const moods = PROFILE_MOODS[profile ?? 'premium'] ?? ['calme'];
  const score = (t: Track) => (moods.includes(t.mood) ? 10 - moods.indexOf(t.mood) * 3 : 0) + (t.duration >= duration ? 2 : 0) + (t.bpm ? 1 : 0);
  return [...tracks].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0];
}

export const BED_LUFS = -21;
/** clip gain that brings this track to the bed level */
export const bedGain = (lufs: number) => Math.min(2, Math.max(0.05, Math.pow(10, (BED_LUFS - lufs) / 20)));

/** music clips covering the whole video: loops on bar lines with crossfades, faded in and out */
export function musicClips(t: Track, videoLen: number): AudioClip[] {
  const out: AudioClip[] = [];
  const vol = bedGain(t.lufs);
  const bar = t.bpm ? (60 / t.bpm) * 4 : 2;
  const xf = 2;
  let at = 0;
  while (at < videoLen - 0.05 && out.length < 40) {
    const left = videoLen - at;
    // a loop ends on a whole number of bars (minus the crossfade) so the beat keeps its place
    let len = Math.min(t.duration, left);
    if (len < left) len = Math.max(bar, Math.floor((len - xf) / bar) * bar + xf);
    out.push({ id: uid('a_'), kind: 'music', name: t.name + (out.length ? ` (boucle ${out.length + 1})` : ''), mediaId: t.mediaId, start: +at.toFixed(3), offset: 0, duration: +len.toFixed(3), sourceDuration: t.duration, volume: +vol.toFixed(3), fadeIn: out.length ? xf : 0.6, fadeOut: xf });
    if (len >= left - 1e-3) break;
    at += len - xf;
  }
  const last = out[out.length - 1];
  if (last) last.fadeOut = Math.min(2.5, last.duration / 2);
  return out;
}

/** replace the music of a project by this track, fitted to the video */
export function withMusic(p: Project, t: Track, videoLen: number): Project {
  return { ...p, ducking: true, duckLevel: Math.min(p.duckLevel ?? 0.28, 0.28), audio: [...p.audio.filter((c) => c.kind !== 'music'), ...musicClips(t, videoLen)] };
}
