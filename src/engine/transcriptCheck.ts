/**
 * Is a transcript trustworthy enough to edit with? Whisper sometimes
 * "hallucinates" (a phrase repeated in a loop, words where nobody speaks).
 * Cutting retakes from such a transcript would remove real speech, so the
 * edit only uses it when it passes these checks.
 */
import type { Word } from '../types';

export interface TranscriptQuality { ok: boolean; reason?: string; repeated: number; wps: number }

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']/g, '');

/** `speech` = seconds of actual voice in the take (from the audio analysis) */
export function transcriptQuality(words: Word[], speech: number): TranscriptQuality {
  const toks = words.map((w) => norm(w.w)).filter(Boolean);
  if (toks.length < 5) return { ok: toks.length > 0, repeated: 0, wps: 0, reason: toks.length ? undefined : 'transcription vide' };
  // share of words that belong to a 4-word phrase seen 3 times or more
  const grams = new Map<string, number>();
  for (let i = 0; i + 4 <= toks.length; i++) { const g = toks.slice(i, i + 4).join(' '); grams.set(g, (grams.get(g) ?? 0) + 1); }
  let looped = 0;
  for (let i = 0; i + 4 <= toks.length; i++) if ((grams.get(toks.slice(i, i + 4).join(' ')) ?? 0) >= 3) looped++;
  const repeated = looped / Math.max(1, toks.length - 3);
  const wps = toks.length / Math.max(1, speech);
  if (repeated > 0.25) return { ok: false, repeated, wps, reason: `la même phrase revient en boucle (${Math.round(repeated * 100)} % du texte) : Whisper a halluciné` };
  if (wps > 5.5) return { ok: false, repeated, wps, reason: `${wps.toFixed(1)} mots par seconde de voix : impossible à l’oral` };
  if (speech > 10 && wps < 0.6) return { ok: false, repeated, wps, reason: 'presque aucun mot pour la durée de voix : transcription incomplète' };
  return { ok: true, repeated, wps };
}
