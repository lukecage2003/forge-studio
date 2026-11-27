import type { Project, Word } from '../types';
import { isFiller } from './speech';
import { timelineWords, sentencesOf } from './auto';
import { alignScript } from './align';

/**
 * Everything the viewer will hear, as timed sentences on the edit timeline:
 * the face-cam transcript, voice-over transcripts, or — with no audio — the
 * pasted script with times estimated at a natural narration pace.
 */
export interface Sentence { text: string; s: number; e: number; words: Word[] }

const WPS = 2.6; // ~155 words / minute, a typical YouTube narration pace

export function narrationWords(p: Project): Word[] {
  const out: Word[] = [];
  // a rush: its transcript, or the pasted script laid on its voice when there is no transcript
  if (p.aroll && (p.aroll.words.length || p.script?.trim())) out.push(...timelineWords(p));
  const voice: Word[] = [];
  for (const c of p.audio) {
    if (c.kind !== 'voice' || !c.words?.length) continue;
    for (const w of c.words) {
      if (w.filler || isFiller(w.w)) continue;
      if (w.s < c.offset || w.e > c.offset + c.duration) continue;
      voice.push({ w: w.w, s: c.start + (w.s - c.offset), e: c.start + (w.e - c.offset) });
    }
  }
  voice.sort((a, b) => a.s - b.s);
  // a voice-over with a pasted script: the script's words (exact spelling, names, punctuation)
  // on the transcript's timing, as for a rush (engine/align)
  if (!p.aroll && voice.length && p.script?.trim()) {
    const al = alignScript(p.script, voice);
    if (al.coverage >= 0.35) return al.words;
  }
  out.push(...voice);
  return out.sort((a, b) => a.s - b.s);
}

export function scriptSentences(script: string, start = 0): Sentence[] {
  const parts = script.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) ?? [];
  let t = start;
  return parts.map((txt) => txt.trim()).filter(Boolean).map((text) => {
    const n = text.split(' ').length;
    const d = Math.max(1.6, n / WPS);
    const words: Word[] = text.split(' ').map((w, i) => ({ w, s: t + (i * d) / n, e: t + ((i + 1) * d) / n }));
    const sen = { text, s: t, e: t + d, words };
    t += d + 0.25;
    return sen;
  });
}

export function narration(p: Project): { sentences: Sentence[]; source: 'audio' | 'script' | 'none' } {
  const words = narrationWords(p);
  if (words.length) {
    const sents = sentencesOf(words).map((s) => ({ ...s, words: words.filter((w) => w.s >= s.s - 1e-3 && w.e <= s.e + 1e-3) }));
    return { sentences: sents, source: 'audio' };
  }
  if (p.script?.trim()) return { sentences: scriptSentences(p.script), source: 'script' };
  return { sentences: [], source: 'none' };
}
