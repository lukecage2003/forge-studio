import type { Project, Shot, Subtitle } from '../types';
import { layoutShots } from './timeline';
import { comicNames } from './lexicon';
import { narrationWords } from './narration';

/**
 * POLISH — editorial checks of a finished edit, each with a fix the user
 * applies (qc.ts shows them): the opening shot, panels shown again and again,
 * names misspelled in the subtitles; plus the timing of balloons on the voice
 * and a short version of a long video. Pure functions (tested).
 */

const area = (s: Shot) => s.rect.w * s.rect.h;

/** the strongest opening: a full-page splash, else the biggest story panel of the first half */
export function hookCandidate(p: Project): Shot | null {
  const timed = layoutShots(p).filter((t) => t.shot.pageId && !t.shot.diagram);
  if (timed.length < 3) return null;
  const page = (s: Shot) => p.pages.find((x) => x.id === s.pageId);
  const pool = timed.slice(0, Math.ceil(timed.length / 2)).map((t) => t.shot).filter((s) => !page(s)?.skip && page(s)?.kind !== 'cover');
  const splash = pool.find((s) => page(s)?.kind === 'splash' || s.zone === 'splash');
  const best = splash ?? [...pool].sort((a, b) => area(b) - area(a))[0];
  if (!best || best.id === timed[0].shot.id) return null;
  // worth it only when clearly stronger than the current opening (1.6× the drawing)
  return splash || area(best) > 1.6 * area(timed[0].shot) ? best : null;
}
/** the edit with that panel opening the video (the user's own first shot is never moved: auto shots only) */
export function openWith(p: Project, id: string): Project {
  const i = p.shots.findIndex((s) => s.id === id);
  if (i <= 0) return p;
  const shots = [...p.shots];
  const [s] = shots.splice(i, 1);
  shots.unshift({ ...s, transition: 'cut', why: `${s.why ? s.why + ' · ' : ''}ouverture : la case la plus forte d’abord` });
  return { ...p, shots };
}

/** panels shown more than twice, or twice in a row */
export function repeatedPanels(p: Project): { key: string; shots: string[]; times: number[] }[] {
  const timed = layoutShots(p).filter((t) => t.shot.pageId && !t.shot.diagram);
  const key = (s: Shot) => `${s.pageId}:${Math.round(s.rect.x / 20)}:${Math.round(s.rect.y / 20)}:${Math.round(s.rect.w / 20)}:${Math.round(s.rect.h / 20)}`;
  const groups = new Map<string, { shots: string[]; times: number[]; idx: number[] }>();
  timed.forEach((t, i) => { const g = groups.get(key(t.shot)) ?? { shots: [], times: [], idx: [] }; g.shots.push(t.shot.id); g.times.push(t.start); g.idx.push(i); groups.set(key(t.shot), g); });
  return [...groups.entries()].filter(([, g]) => g.shots.length > 2 || g.idx.some((x, k) => k > 0 && x === g.idx[k - 1] + 1)).map(([k, g]) => ({ key: k, shots: g.shots, times: g.times }));
}

/* ---------------------------------------------------------------- names in the subtitles */
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** words of the subtitles that are a known name misspelled (« Galactos » → « Galactus »); names from the script and the panels */
export function nameFixes(p: Project): { from: string; to: string; n: number }[] {
  // known names, plus capitalised words the script repeats (a name opening its sentences is still a name)
  const counts = new Map<string, number>();
  for (const m of (p.script ?? '').matchAll(/\b(\p{Lu}[\p{L}’'-]{4,})/gu)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, n]) => n >= 2).map(([w]) => w);
  const names = [...new Set([...comicNames(p).filter((n) => n.strong).flatMap((n) => n.name.split(/\s+/)), ...repeated])].filter((w) => w.length >= 4);
  const known = new Set(names.map(fold));
  const out = new Map<string, { to: string; n: number }>();
  for (const s of p.subtitles) for (const w of s.text.split(/[\s,.!?;:«»"()]+/)) {
    if (w.length < 4 || known.has(fold(w))) continue;
    const hit = names.find((n) => { const d = lev(fold(w), fold(n)); return d > 0 && d <= (n.length >= 7 ? 2 : 1) && fold(w)[0] === fold(n)[0]; });
    if (hit) { const o = out.get(w) ?? { to: hit, n: 0 }; o.n++; out.set(w, o); }
  }
  return [...out.entries()].map(([from, v]) => ({ from, to: v.to, n: v.n }));
}
export function applyNameFixes(subs: Subtitle[], fixes: { from: string; to: string }[]): Subtitle[] {
  if (!fixes.length) return subs;
  const re = new RegExp(`(^|[^\\p{L}])(${fixes.map((f) => f.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^\\p{L}])`, 'gu');
  const to = new Map(fixes.map((f) => [f.from, f.to]));
  const fix = (t: string) => t.replace(re, (_, a: string, w: string) => a + (to.get(w) ?? w));
  return subs.map((s) => ({ ...s, text: fix(s.text), words: s.words.map((x) => ({ ...x, w: fix(x.w) })) }));
}

/* ---------------------------------------------------------------- balloons on the voice */
const timesCache = new WeakMap<Project, Map<string, number[] | null>>();
/**
 * when each balloon of a shot appears (seconds into the shot): on the words the
 * voice says during the shot, spread over them, instead of a fixed rhythm; null
 * when nothing is said over the shot (the fixed rhythm then applies)
 */
export function balloonTimes(p: Project, shotId: string, start: number, dur: number, n: number): number[] | null {
  let c = timesCache.get(p);
  if (!c) { c = new Map(); timesCache.set(p, c); }
  const k = `${shotId}:${start.toFixed(2)}:${n}`;
  if (c.has(k)) return c.get(k)!;
  let words: { s: number }[] = [];
  try { words = narrationWords(p).filter((w) => w.s >= start - 0.05 && w.s < start + dur - 0.2); } catch { words = []; }
  const r = words.length >= n && n > 0 ? Array.from({ length: n }, (_, i) => Math.max(0.05, words[Math.floor((i * words.length) / n)].s - start - 0.08)) : null;
  c.set(k, r);
  return r;
}

/* ---------------------------------------------------------------- short version */
/**
 * the passages of a long video worth a Short (≤ target seconds): the hook (first
 * sentence), sentences naming characters, the revelation and the conclusion of
 * the creative director, in their order; returns time ranges of the timeline
 */
export function shortRanges(p: Project, target = 45): { s: number; e: number; why: string }[] {
  const words = narrationWords(p);
  if (!words.length) return [];
  // sentences from the voice's words
  const sents: { s: number; e: number; text: string }[] = [];
  let cur: { s: number; e: number; text: string } | null = null;
  for (const w of words) {
    if (!cur) cur = { s: w.s, e: w.e, text: '' };
    cur.text += (cur.text ? ' ' : '') + w.w; cur.e = w.e;
    if (/[.!?…]$/.test(w.w)) { sents.push(cur); cur = null; }
  }
  if (cur) sents.push(cur);
  const names = comicNames(p).filter((n) => n.strong).map((n) => fold(n.name));
  const seq = p.direction?.sequences ?? [];
  const inSeq = (t: number, types: string[]) => seq.some((q) => types.includes(q.type) && t >= q.start - 0.5 && t <= q.start + 0.5 + (q.to - q.from) * 3);
  const scored = sents.map((s, i) => ({ ...s, i,
    score: (i === 0 ? 10 : 0) + (inSeq(s.s, ['revelation']) ? 6 : 0) + (inSeq(s.s, ['conclusion']) || i === sents.length - 1 ? 4 : 0) + (names.some((n) => fold(s.text).includes(n)) ? 3 : 0) + (/[!?]$/.test(s.text) ? 1 : 0),
  }));
  const keep: typeof scored = [];
  let total = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    const d = s.e - s.s + 0.25;
    if (total + d > target) continue;
    keep.push(s); total += d;
  }
  return keep.sort((a, b) => a.i - b.i).map((s) => ({ s: Math.max(0, s.s - 0.1), e: s.e + 0.15, why: s.i === 0 ? 'accroche' : s.score >= 6 ? 'révélation' : s.score >= 4 ? 'conclusion' : 'personnage nommé' }));
}
