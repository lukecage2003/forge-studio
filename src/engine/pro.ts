import type { FxItem, Motion, Project, Shot, Transition } from '../types';
import { layoutShots } from './timeline';
import { comicNames } from './lexicon';
import { narrationWords } from './narration';
import { cachedLines } from './paddleOcr';
import type { Issue } from './qc';

/**
 * PRO FINISH — the touches of a professional edit, on top of the auto edit:
 * impacts on onomatopoeias, rhythm by emotion, a name banner when a character is
 * first named, black and yellow chapter cards, varied framing, music following
 * the story, a looping ending, the TikTok cover chosen, the first second checked.
 * Pure and deterministic. Only shots the auto edit made and the user never
 * touched change (each says why); the drawing is never altered (views only).
 */

/** a shot the user never edited: the auto edit's own choices are still there */
export const untouched = (s: Shot) => !!s.auto && s.auto.motion === s.motion && s.auto.layout === s.layout && Math.abs(s.auto.duration - s.duration) < 0.05;
const why = (s: Shot, w: string) => (s.why?.includes(w) ? s.why : `${s.why ? s.why + ' · ' : ''}${w}`);
const said = (p: Project, s: Shot, a: number, b: number, words = narrationWords(p)) =>
  `${s.match?.sentence ?? ''} ${words.filter((w) => w.s >= a && w.s < b).map((w) => w.w).join(' ')}`;

/* ---------------------------------------------------------------- 1. onomatopoeias */
export const ONOMATO = /\b(KA-?BOOM|BOOM|BLAM|BAM|POW|KRA+K|CRACK|CRASH|KRASH|SMASH|WHAM|ZAP|THWIP|SNIKT|BANG|THOOM|WHOOSH|SPLASH|THUD|CHOOM|BZZT|FWOOSH|KRUNCH|SKRE+|BLAST|SPLAT|THWACK|KLANG|CLANG|BRAKA|RATATA|BUDDA)\b/i;

/** shots whose panel shows a sound effect, with where the word is (page px) when the lettering was read */
export function onomatopoeias(p: Project): { shotId: string; word: string; at?: { x: number; y: number } }[] {
  const out: { shotId: string; word: string; at?: { x: number; y: number } }[] = [];
  for (const s of p.shots) {
    if (!s.pageId || s.diagram) continue;
    const pg = p.pages.find((x) => x.id === s.pageId);
    const r = s.rect;
    const lines = ((pg && cachedLines(pg.mediaId)) ?? []).filter((l) => l.x + l.w / 2 > r.x && l.x + l.w / 2 < r.x + r.w && l.y + l.h / 2 > r.y && l.y + l.h / 2 < r.y + r.h);
    const hit = lines.find((l) => ONOMATO.test(l.text));
    const m = hit?.text.match(ONOMATO) ?? s.text?.match(ONOMATO);
    if (m) out.push({ shotId: s.id, word: m[1].toUpperCase(), at: hit ? { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 } : undefined });
  }
  return out;
}
function withImpacts(p: Project): Project {
  const hits = new Map(onomatopoeias(p).map((h) => [h.shotId, h]));
  return { ...p, shots: p.shots.map((s) => {
    const h = hits.get(s.id);
    if (!h || !untouched(s) || s.path?.length) return s;
    const focus = h.at ? { x: Math.min(1, Math.max(0, (h.at.x - s.rect.x) / s.rect.w)), y: Math.min(1, Math.max(0, (h.at.y - s.rect.y) / s.rect.h)) } : s.focus;
    return { ...s, motion: 'zoom-in', intensity: Math.max(s.intensity, 0.75), shake: Math.max(s.shake, 0.6), sfx: s.sfx && s.sfx !== 'auto' ? s.sfx : 'impact', focus, auto: { ...s.auto!, motion: 'zoom-in' }, why: why(s, `impact sur « ${h.word} »`) };
  }) };
}

/* ---------------------------------------------------------------- 2. rhythm by emotion */
const ACTION = /\b(combat\w*|bat(?:tent|aille)\w*|frappe\w*|explos\w*|attaqu\w*|fonce\w*|poursui\w*|tir(?:e|ent)\b|guerre|affront\w*|cogne\w*|écrase\w*|détrui\w*|fuit|course)\b/i;
const EMOTION = /\b(mort|meurt|mourir|deuil|triste\w*|larmes?|pleur\w*|perd\w*|adieu|souvenir\w*|regret\w*|silence|amour|aime)\b/i;
export type Mood = 'action' | 'emotion' | null;
export const moodOf = (text: string): Mood => (ACTION.test(text) ? 'action' : EMOTION.test(text) ? 'emotion' : null);
function withEmotionRhythm(p: Project): Project {
  const words = narrationWords(p);
  const timed = layoutShots(p);
  const mood = new Map(timed.map((t) => [t.shot.id, moodOf(said(p, t.shot, t.start, t.end, words))]));
  return { ...p, shots: p.shots.map((s, i) => {
    const m = mood.get(s.id);
    if (!m || !untouched(s) || i === 0) return s;
    if (m === 'action') {
      const tr: Transition = s.transition === 'cut' || s.transition === 'whip' ? s.transition : i % 2 ? 'whip' : 'cut';
      return { ...s, transition: tr, transitionDur: Math.min(s.transitionDur, 0.2), intensity: Math.max(s.intensity, 0.7), why: why(s, 'action : coupes sèches') };
    }
    return { ...s, transition: s.transition === 'cut' ? 'fade' : s.transition, transitionDur: Math.min(s.duration * 0.4, Math.max(s.transitionDur, 0.6)), intensity: Math.min(s.intensity, 0.35), why: why(s, 'émotion : on ralentit') };
  }) };
}

/* ---------------------------------------------------------------- 3. name banner */
export function withNameBanners(p: Project): Project {
  const names = comicNames(p).filter((n) => n.strong);
  if (!names.length) return p;
  const words = narrationWords(p);
  const done = new Set(p.shots.map((s) => s.nameTag?.toLowerCase()).filter(Boolean));
  const re = (a: string) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const tags = new Map<string, string>();
  for (const t of layoutShots(p)) {
    const s = t.shot;
    if (s.nameTag || !s.pageId || !untouched(s)) continue;
    const text = said(p, s, t.start, t.end, words);
    const n = names.find((x) => !done.has(x.name.toLowerCase()) && [x.name, ...x.aliases].some((a) => re(a).test(text)));
    if (n) { tags.set(s.id, n.name); done.add(n.name.toLowerCase()); }
  }
  return tags.size ? { ...p, shots: p.shots.map((s) => (tags.has(s.id) ? { ...s, nameTag: tags.get(s.id), why: why(s, 'bandeau : première apparition') } : s)) } : p;
}

/* ---------------------------------------------------------------- 4. chapter cards */
/** chapter titles a viewer reads (the sequence's story role, not the director's camera treatment) */
const CHAPTER_FR: Record<string, string> = { introduction: 'Le début', personnage: 'Les personnages', contexte: 'Le contexte', explication: 'Comment ça marche', demonstration: 'La preuve', comparaison: 'Face à face', confrontation: 'L’affrontement', revelation: 'La révélation', conclusion: 'Ce qu’il faut retenir' };
export function chapterCards(p: Project): FxItem[] {
  const seq = (p.direction?.sequences ?? []).filter((q, i, a) => i > 0 && q.type !== a[i - 1].type).slice(0, 6);
  return seq.map((q, i) => ({ id: `chap_${i}`, kind: 'chapter' as const, start: q.start, duration: 1.6, text: `${i + 2}. ${(CHAPTER_FR[q.type] ?? q.type).toUpperCase()}` }));
}

/* ---------------------------------------------------------------- 7. framing variety */
const CYCLE: Motion[] = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'];
export function withFramingVariety(p: Project): Project {
  const shots = [...p.shots];
  for (let i = 2; i < shots.length; i++) {
    const [a, b, c] = [shots[i - 2], shots[i - 1], shots[i]];
    if (!c.pageId || !untouched(c) || c.path?.length || c.diagram) continue;
    if (a.motion === b.motion && b.motion === c.motion) {
      const m = CYCLE.find((x, k) => x !== b.motion && k >= i % CYCLE.length) ?? CYCLE.find((x) => x !== b.motion)!;
      shots[i] = { ...c, motion: m, auto: { ...c.auto!, motion: m }, why: why(c, 'variété : pas trois fois le même mouvement') };
    }
  }
  return { ...p, shots };
}

/* ---------------------------------------------------------------- wide panels in a vertical video */
/**
 * a long horizontal panel in 9:16 is a thin strip lost in the blurred background; filled
 * whole it would be blown up and soft. Middle way: about half its width, panned across
 * in reading order: twice bigger on screen, never enlarged past ~1.3× its own pixels.
 */
export function withWidePans(p: Project): Project {
  if (p.format !== '9:16' && p.format !== '4:5') return p;
  const W = p.format === '9:16' ? 1080 : 1080;
  const rtl = p.readingOrder === 'rtl';
  return { ...p, shots: p.shots.map((s) => {
    if (!s.pageId || s.diagram || s.path?.length || !untouched(s) || s.layout !== 'full' || s.rect.w / s.rect.h < 2.2) return s;
    const vw = Math.max(s.rect.w * 0.5, W / 1.3, s.rect.h * 1.2);
    if (vw >= s.rect.w * 0.9) return s;
    const cy = s.rect.y + s.rect.h / 2, a = s.rect.x + vw / 2, b = s.rect.x + s.rect.w - vw / 2;
    return { ...s, path: [{ t: 0, cx: rtl ? b : a, cy, vw, ease: 'smooth' as const }, { t: 1, cx: rtl ? a : b, cy, vw, ease: 'smooth' as const }], why: why(s, 'case large : panoramique pour la lire en grand') };
  }) };
}

/* ---------------------------------------------------------------- 8. music by sequence */
const LEVEL: Record<string, number> = { revelation: 1.3, confrontation: 1.2, demonstration: 1.05, personnage: 1, introduction: 1, comparaison: 1, contexte: 0.85, explication: 0.8, conclusion: 1.1 };
/** music gain keyframes [time, gain]: louder on revelations and fights, quieter while explaining */
export function musicCurve(p: Project): [number, number][] {
  const seq = p.direction?.sequences ?? [];
  if (seq.length < 2) return [];
  const k: [number, number][] = [];
  for (const q of seq) {
    const g = LEVEL[q.type] ?? 1;
    const prev = k.length ? k[k.length - 1][1] : g;
    k.push([Math.max(0, q.start - 0.6), prev], [q.start, g]);
  }
  return k;
}

/* ---------------------------------------------------------------- 9. TikTok cover */
/** the panels that make the strongest cover: big, characters, a splash; few balloons (text covers faces) */
export function coverPicks(p: Project, n = 2): Shot[] {
  const names = comicNames(p).filter((x) => x.strong).map((x) => x.name.toLowerCase());
  const pool = p.shots.filter((s) => s.pageId && !s.diagram && p.pages.find((x) => x.id === s.pageId)?.kind !== 'cover');
  if (!pool.length) return [];
  const maxA = Math.max(...pool.map((s) => s.rect.w * s.rect.h));
  const score = (s: Shot) => (s.rect.w * s.rect.h) / maxA + 0.35 * Math.min(2, s.chars?.length ?? 0) + (s.chars?.some((c) => names.includes(c.toLowerCase())) ? 0.4 : 0)
    + (s.zone === 'splash' || p.pages.find((x) => x.id === s.pageId)?.kind === 'splash' ? 0.5 : 0) - 0.12 * Math.min(4, s.balloons?.length ?? 0);
  const out: Shot[] = [];
  for (const s of [...pool].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))) {
    // two different panels (not the same one shown twice)
    if (out.some((o) => o.pageId === s.pageId && Math.abs(o.rect.x - s.rect.x) < 20 && Math.abs(o.rect.y - s.rect.y) < 20)) continue;
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

/* ---------------------------------------------------------------- 10. the first second */
export function firstSecondIssues(p: Project): Issue[] {
  const timed = layoutShots(p);
  if (!timed.length) return [];
  const out: Issue[] = [];
  const first = timed[0].shot;
  const pg = first.pageId ? p.pages.find((x) => x.id === first.pageId) : null;
  if (!p.aroll && (!first.pageId || pg?.kind === 'cover') && timed.length > 2) {
    const k = timed.findIndex((t) => t.shot.pageId && p.pages.find((x) => x.id === t.shot.pageId)?.kind !== 'cover');
    out.push({ level: 'warn', at: 0, text: 'Première seconde : la vidéo s’ouvre sur un carton ou une couverture ; sur TikTok, une case forte retient mieux.',
      fix: k > 0 ? { label: 'Ouvrir sur la première case', apply: (x) => { const s = [...x.shots]; const i = s.findIndex((y) => y.id === timed[k].shot.id); const [m] = s.splice(i, 1); s.unshift({ ...m, transition: 'cut' }); return { ...x, shots: s }; } } : undefined });
  }
  if (first.transition !== 'cut' && !p.aroll) out.push({ level: 'warn', at: 0, text: 'Première seconde : la première image arrive en transition (noir au départ).', fix: { label: 'Couper net au début', apply: (x) => ({ ...x, shots: x.shots.map((s) => (s.id === first.id ? { ...s, transition: 'cut' } : s)) }) } });
  if (first.motion === 'static' && first.pageId) out.push({ level: 'warn', at: 0, text: 'Première seconde : image fixe ; un léger mouvement accroche l’œil.', fix: { label: 'Zoom avant léger', apply: (x) => ({ ...x, shots: x.shots.map((s) => (s.id === first.id && s.motion === 'static' ? { ...s, motion: 'zoom-in', intensity: Math.max(0.4, s.intensity) } : s)) }) } });
  const voice = narrationWords(p)[0];
  if (voice && voice.s > 1.2) out.push({ level: 'warn', at: 0, text: `Première seconde : la voix ne commence qu’à ${voice.s.toFixed(1)} s ; coupe le silence du début.` });
  return out;
}

/* ---------------------------------------------------------------- all at once */
export interface ProOptions { impacts: boolean; emotion: boolean; names: boolean; chapters: boolean; variety: boolean; music: boolean; loop: boolean }
export const PRO_ALL: ProOptions = { impacts: true, emotion: true, names: true, chapters: true, variety: true, music: true, loop: true };

export function withProFinish(p: Project, o: ProOptions = PRO_ALL): Project {
  let x = p;
  if (o.impacts) x = withImpacts(x);
  if (o.emotion) x = withEmotionRhythm(x);
  if (o.variety) x = withFramingVariety(x);
  x = withWidePans(x);
  if (o.names) x = withNameBanners(x);
  const fx = (x.fx ?? []).filter((f) => !f.id.startsWith('chap_'));
  x = { ...x, fx: o.chapters ? [...fx, ...chapterCards(x)] : fx };
  if (o.music) { const c = musicCurve(x); x = { ...x, musicCurve: c.length ? c : undefined }; }
  // a short vertical video loops on itself: its last frame melts into the first
  if (o.loop && x.format !== '16:9') x = { ...x, loopEnd: true };
  return x;
}
