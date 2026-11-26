import type { CaptionAnim, CaptionPreset, Layout, Motion, Project, Rect, Shot, Subtitle, Transition, Word } from '../types';
import { FORMATS } from '../types';
import { clamp, uid } from '../lib/util';
import { cachedDetection, comicOrder, cutPageSmart } from './panelAI';
import { directSequences, seqTypeOf, variety, type DirectorOptions } from './director';
import { holdFor, important } from './hold';
import { detectBeats } from './beats';
import { ensureMedia, getAudio, getImage } from './media';
import { newShot } from '../store';
import { resolveMotion } from './render';
import { segmentsOf } from './timeline';
import { alignScript } from './align';
import { isFiller, keptShare, toTimeline, segsDuration, type Seg } from './speech';
import { validateProject } from './validate';
import { narration } from './narration';
import { planStory } from './story';
import { emphasisTimes } from './emphasis';
import { brandOf } from './brand';
import type { FxItem } from '../types';
import { PROFILE, applyProfileLook, direct, type ProfileId } from './direction';
import { BEAT_FR } from './narrative';
import { faceMult, intensityMult, noteMontage, paceMult, pickLayout, preferredMotion } from './brain';

/**
 * Auto editor. Two modes:
 *  - comics only: pages → paced sequence of camera moves, beat-synced
 *  - face cam + comics: the rough-cut rush is the spine, panels are laid over
 *    it in blocks that start and end on jump cuts / sentence ends, with a mix
 *    of layouts (full, split, bubble, multi-panel, whole page).
 */

export type ProductionModel = 'face' | 'face-comics' | 'graphic' | 'reveal';
export const MODELS: Record<ProductionModel, { label: string; desc: string; profile: ProfileId; uses: string[] }> = {
  face: { label: 'Face caméra', desc: 'Toi avant tout : prise nettoyée, recadrée, sous-titrée, quelques illustrations et mots-clés.', profile: 'editorial', uses: ['titre'] },
  'face-comics': { label: 'Face caméra + comics', desc: 'Analyse de personnages et d’histoires : ton visage et les cases en alternance, zooms et relief.', profile: 'premium', uses: [] },
  graphic: { label: 'Explication graphique', desc: 'Concepts complexes : frises, relations, échelles et lieux tirés du script, avec tes cases.', profile: 'science', uses: ['chronologie', 'reseau', 'echelle', 'carte', 'titre'] },
  reveal: { label: 'Révélation et comparaison', desc: 'Exploits et pouvoirs : preuves en grand, duels, échelles, citations sourcées, conclusion nette.', profile: 'power', uses: ['versus', 'echelle', 'citation', 'titre'] },
};

export type AutoStyle = 'explainer' | 'energetic' | 'dynamic' | 'cinematic' | 'manga';
export type AutoLength = 'auto' | 'voice' | 15 | 30 | 60 | 90 | 120 | 180 | 240 | 300;

export interface AutoOptions {
  style: AutoStyle;
  length: AutoLength;
  hook: string;
  redetect: boolean;
  beatSync: boolean;
  /** take a track from the music library when the project has none (chosen by profile) */
  music?: boolean;
  captionStyle: boolean;
  subtitles: boolean;
  /** panelId → sentence index (from Gemini), optional */
  matches?: Record<string, number>;
  /** follow the narration: each sentence gets the panel that illustrates it */
  story?: 'auto' | 'local' | 'google' | false;
  /** creative direction profile (engine/direction): rhythm, palette, look, sound, budget */
  profile?: ProfileId;
  /** production model: what the video is made of (see MODELS) */
  model?: ProductionModel;
  /** creative director: which decisions it may take (all on by default) */
  director?: Partial<DirectorOptions>;
  onProgress?: (label: string, p: number) => void;
}

interface StyleDef {
  label: string; desc: string; face: boolean;
  base: number; min: number; max: number;
  intensity: number; glide: number; pageTr: Transition; pageTrDur: number;
  splashTr: Transition; splashShake: number;
  preset: CaptionPreset; anim: CaptionAnim; beatEvery: number; rtl?: boolean;
  /** layouts for comics-only projects */
  soloLayouts: [Layout, number][];
  /** layouts over a face cam */
  faceLayouts: [Layout, number][];
  hook: number; faceDur: [number, number]; block: [number, number];
  enterTr: Transition; punchIn: number; drift: number; maxWords: number;
  /** variety between pages */
  pagePool?: Transition[];
}

export const STYLES: Record<AutoStyle, StyleDef> = {
  explainer: {
    label: 'Explication', desc: 'Format « comics expliqués » : cases plein écran, page entière, visage en ouverture et en relance.',
    face: true, base: 3.6, min: 2.2, max: 8, intensity: 0.5, glide: 0.75, pageTr: 'fade', pageTrDur: 0.5,
    splashTr: 'zoom', splashShake: 0, preset: 'clean', anim: 'words', beatEvery: 4,
    soloLayouts: [['full', 6], ['page', 1.2], ['grid', 0.8]],
    faceLayouts: [['full', 6], ['page', 1.3], ['pip', 1.2], ['grid', 0.8], ['split', 0.3]],
    hook: 3, faceDur: [2.2, 3.5], block: [12, 22], enterTr: 'fade', punchIn: 0.45, drift: 0.4, maxWords: 6, pagePool: ['fade', 'dip', 'blur', 'slide', 'burn'],
  },
  energetic: {
    label: 'Énergique', desc: 'Face caméra très présente, zooms de coupe, écrans partagés, bulles et multi-cases.',
    face: true, base: 2.2, min: 1.2, max: 4.5, intensity: 0.8, glide: 0.4, pageTr: 'whip', pageTrDur: 0.28,
    splashTr: 'flash', splashShake: 0.75, preset: 'tiktok', anim: 'words', beatEvery: 2,
    soloLayouts: [['full', 5], ['grid', 1.5], ['page', 0.6]],
    faceLayouts: [['split', 3], ['pip', 2.2], ['full', 2.4], ['grid', 1.2], ['page', 0.6]],
    hook: 2.2, faceDur: [1.8, 3.6], block: [4, 8], enterTr: 'zoom', punchIn: 0.95, drift: 0.5, maxWords: 3, pagePool: ['whip', 'slash', 'glitch', 'iris'],
  },
  dynamic: {
    label: 'Dynamique', desc: 'TikTok / Shorts sans visage : rythme serré, coupes sur le beat, sous-titres mot à mot.',
    face: false, base: 1.7, min: 0.9, max: 3.4, intensity: 0.8, glide: 0.38, pageTr: 'whip', pageTrDur: 0.32,
    splashTr: 'flash', splashShake: 0.7, preset: 'tiktok', anim: 'words', beatEvery: 2,
    soloLayouts: [['full', 6], ['grid', 1]], faceLayouts: [['full', 1]],
    hook: 2, faceDur: [2, 3], block: [5, 8], enterTr: 'whip', punchIn: 0.8, drift: 0.4, maxWords: 3, pagePool: ['whip', 'slash', 'zoom', 'glitch', 'smear'],
  },
  cinematic: {
    label: 'Cinématique', desc: 'YouTube sans visage : mouvements lents, fondus, place à la lecture et à la narration.',
    face: false, base: 3.4, min: 2, max: 7, intensity: 0.45, glide: 0.8, pageTr: 'fade', pageTrDur: 0.7,
    splashTr: 'zoom', splashShake: 0, preset: 'cinema', anim: 'type', beatEvery: 4,
    soloLayouts: [['full', 6], ['page', 1]], faceLayouts: [['full', 1]],
    hook: 3, faceDur: [2.5, 3.5], block: [12, 20], enterTr: 'fade', punchIn: 0.3, drift: 0.3, maxWords: 7, pagePool: ['fade', 'blur', 'dip', 'burn'],
  },
  manga: {
    label: 'Manga', desc: 'Lecture de droite à gauche, impacts, flashs et cadrages nerveux.',
    face: false, base: 2.1, min: 1, max: 4.2, intensity: 0.7, glide: 0.42, pageTr: 'slide', pageTrDur: 0.4,
    splashTr: 'flash', splashShake: 0.85, preset: 'comic', anim: 'pop', beatEvery: 2, rtl: true,
    soloLayouts: [['full', 5], ['grid', 1.4]], faceLayouts: [['full', 3], ['split', 2], ['pip', 1]],
    hook: 2, faceDur: [2, 3], block: [5, 9], enterTr: 'flash', punchIn: 0.9, drift: 0.4, maxWords: 3, pagePool: ['slash', 'slide', 'flash', 'whip'],
  },
};

export interface AutoReport {
  shots: number; pages: number; duration: number; bpm: number | null;
  followedVoice: boolean; faceShare: number | null; subtitles: number; notes: string[];
}

/* -------------------------------------------------------------- utils */

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Point of interest in a panel: centroid of the strongest detail, ignoring
 * flat balloons and the frame edges (where the eye goes: faces, hands, action).
 */
export function panelFocus(img: CanvasImageSource, r: Rect): { x: number; y: number } {
  const S = 64;
  const k = S / Math.max(r.w, r.h);
  const w = Math.max(8, Math.round(r.w * k)), h = Math.max(8, Math.round(r.h * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const L = (i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const sat = (i: number) => { const a = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), b = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); return a ? (a - b) / a : 0; };
  const vals: { x: number; y: number; v: number }[] = [];
  for (let y = 2; y < h - 2; y++) for (let xx = 2; xx < w - 2; xx++) {
    const i = y * w + xx;
    if (L(i) > 235) continue; // balloons
    const g = Math.abs(L(i + 1) - L(i - 1)) + Math.abs(L(i + w) - L(i - w));
    vals.push({ x: xx / w, y: y / h, v: g * (0.6 + sat(i)) });
  }
  if (vals.length < 20) return { x: 0.5, y: 0.45 };
  vals.sort((a, b) => b.v - a.v);
  const top = vals.slice(0, Math.max(10, Math.floor(vals.length * 0.15)));
  const sw = top.reduce((a, p) => a + p.v, 0) || 1;
  const fx = top.reduce((a, p) => a + p.x * p.v, 0) / sw, fy = top.reduce((a, p) => a + p.y * p.v, 0) / sw;
  // stay reasonable: never push the camera into a corner
  return { x: clamp(0.5 + (fx - 0.5) * 0.85, 0.25, 0.75), y: clamp(0.5 + (fy - 0.5) * 0.85, 0.22, 0.75) };
}

/** How much there is to look at / read in a panel: edges + balloon-white area. */
function panelLoad(img: CanvasImageSource, r: Rect): number {
  const S = 96;
  const c = document.createElement('canvas');
  const k = S / Math.max(r.w, r.h);
  c.width = Math.max(8, Math.round(r.w * k));
  c.height = Math.max(8, Math.round(r.h * k));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const w = c.width, h = c.height;
  let edges = 0, white = 0;
  const L = (i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      if (Math.abs(L(i + 1) - L(i - 1)) + Math.abs(L(i + w) - L(i - w)) > 60) edges++;
      if (L(i) > 235) white++;
    }
  }
  const n = (w - 2) * (h - 2);
  return clamp((edges / n) * 2.2 + (white / n) * 0.9, 0, 1.5);
}

export function panelThumb(project: Project, pageId: string, r: Rect, size = 384): string {
  const page = project.pages.find((p) => p.id === pageId)!;
  const a = getImage(page.mediaId)!;
  const k = size / Math.max(r.w, r.h);
  const c = document.createElement('canvas');
  c.width = Math.round(r.w * k);
  c.height = Math.round(r.h * k);
  c.getContext('2d')!.drawImage(a.img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8).split(',')[1];
}

/**
 * The script laid on the kept voice: each word gets a share of the speaking
 * time proportional to its length, through the spoken segments only.
 */
export function scriptOnVoice(script: string, segs: Seg[], pauses: { t: number; d: number }[] = []): Word[] {
  const spans = segs.map((g) => [g.t, g.t + (g.e - g.s)] as [number, number]);
  const total = spans.reduce((a, [s, e]) => a + e - s, 0);
  if (!total) return [];
  // spoken time ↔ timeline time (removed silences are skipped)
  const at = (f: number) => {
    let left = f * total;
    for (const [s, e] of spans) { if (left <= e - s) return s + left; left -= e - s; }
    return spans.length ? spans[spans.length - 1][1] : 0;
  };
  const spoken = (t: number) => {
    let acc = 0;
    for (const [s, e] of spans) { if (t <= s) return acc; if (t <= e) return acc + t - s; acc += e - s; }
    return acc;
  };
  const sentences = (script.replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) ?? [])
    .map((x) => x.trim().split(' ').filter((w) => /[\p{L}\d]/u.test(w))).filter((x) => x.length);
  const weight = (ws: string[]) => ws.reduce((a, w) => a + w.length + 1, 0);
  const W = sentences.reduce((a, ws) => a + weight(ws), 0);
  // where the voice breathes, on the timeline: inner pauses, plus the joins of removed silences
  const cand: { t: number; d: number }[] = [];
  for (const p of pauses) {
    const g = segs.find((x) => p.t >= x.s && p.t <= x.e);
    if (g) cand.push({ t: g.t + (p.t - g.s), d: p.d });
  }
  for (let i = 1; i < segs.length; i++) cand.push({ t: segs[i].t, d: Math.max(0.3, segs[i].s - segs[i - 1].e) });
  cand.sort((x, y) => x.t - y.t);
  // proportional guess for each sentence end, then snapped to the best nearby breath, in order
  const bounds: number[] = [0];
  let acc = 0, last = 0;
  for (let k = 0; k < sentences.length - 1; k++) {
    acc += weight(sentences[k]);
    const guess = acc / W * total;
    const win = Math.max(0.6, (weight(sentences[k]) / W) * total * 0.4);
    let best = guess, score = Infinity;
    for (const c of cand) {
      const sp = spoken(c.t);
      if (sp <= last + 0.3 || Math.abs(sp - guess) > win) continue;
      // nearer is better, a longer breath is a more likely sentence end
      const sc = Math.abs(sp - guess) / win - Math.min(1, c.d / 0.6) * 0.6;
      if (sc < score) { score = sc; best = sp; }
    }
    bounds.push(best);
    last = best;
  }
  bounds.push(total);
  const out: Word[] = [];
  sentences.forEach((ws, k) => {
    const s0 = bounds[k], s1 = bounds[k + 1], Wk = weight(ws);
    let a2 = 0;
    for (const w of ws) {
      const s = at((s0 + (a2 / Wk) * (s1 - s0)) / total);
      a2 += w.length + 1;
      out.push({ w, s, e: Math.max(s + 0.05, at((s0 + (a2 / Wk) * (s1 - s0)) / total) - 0.02) });
    }
  });
  return out;
}

/** Transcript words placed on the edited timeline (cut words removed). */
export function timelineWords(p: Project): Word[] {
  const ar = p.aroll;
  if (!ar) return [];
  const segs = segmentsOf(ar);
  // an unreliable transcript is not shown: the pasted script is laid on the voice instead
  // no usable transcript: the pasted script is laid on the voice, its sentences ending on the breaths
  if ((ar.transcriptCheck && !ar.transcriptCheck.ok) || (!ar.words.length && p.script?.trim())) return p.script?.trim() ? scriptOnVoice(p.script, segs, ar.pauses) : [];
  // with a script: its words (correct spelling, names) on the transcript's timing
  let source = ar.words;
  if (p.script?.trim()) {
    // only what survives the cuts: a removed retake must not catch the script's words
    const al = alignScript(p.script, ar.words.filter((w) => !w.filler && !isFiller(w.w) && keptShare(segs, w.s, w.e) >= 0.4));
    if (al.coverage >= 0.35) source = al.words;
  }
  const out: Word[] = [];
  for (const w of source) {
    if (w.filler || isFiller(w.w)) continue;
    // transcript timestamps are approximate: a word stays if a good part of it survives,
    // or if it only fell into a removed *silence* (then it belongs to the next spoken segment)
    let s = w.s, e = w.e;
    if (keptShare(segs, s, e) < 0.4) {
      const m = (s + e) / 2;
      const by = ar.cuts.find((c) => c.on && m >= c.s && m <= c.e);
      if (!by || by.reason !== 'silence') continue;
      const next = segs.find((g) => g.s >= by.e - 0.05 && g.s - by.e < 0.3);
      if (!next) continue;
      const len = Math.min(e - s, 0.6);
      s = next.s;
      e = next.s + len;
    }
    // clamp the word into the kept audio, then map it
    const seg = segs.find((g) => Math.min(g.e, e) - Math.max(g.s, s) > 0);
    if (seg) { s = Math.max(s, seg.s); e = Math.min(e, seg.e); }
    const ts = toTimeline(segs, s), te = toTimeline(segs, e);
    if (ts == null) continue;
    out.push({ w: w.w, s: Math.max(0, ts), e: Math.max(ts + 0.05, te ?? ts + (e - s)) });
  }
  return out;
}

export function sentencesOf(words: Word[]) {
  const out: { text: string; s: number; e: number }[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ text: cur.map((w) => w.w).join(' '), s: cur[0].s, e: cur[cur.length - 1].e });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?…]$/.test(w.w) || (next && next.s - w.e > 0.7) || cur.length > 24) flush();
  });
  flush();
  return out;
}

export function buildSubtitles(words: Word[], maxWords: number): Subtitle[] {
  const subs: Subtitle[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    subs.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(' '), words: cur.map((w) => ({ w: w.w, s: w.s, e: w.e })) });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    // a sentence end always breaks the line; a comma only when the line already says something
    if (cur.length && (cur.length >= maxWords || (prev && w.s - prev.e > 0.4) || /[.!?…]$/.test(prev?.w ?? '') || (/[,;:]$/.test(prev?.w ?? '') && cur.length >= 3))) flush();
    cur.push(w);
  });
  flush();
  // readability: a line too short to be read (< 0.8 s, or more than 20 characters per second) joins the next one of the same sentence
  for (let i = 0; i < subs.length - 1; i++) {
    const a = subs[i], b = subs[i + 1];
    const d = a.e - a.s, cps = a.text.length / Math.max(0.05, d);
    const sameSentence = !/[.!?…]$/.test(a.text) && b.s - a.e < 0.4;
    if (sameSentence && (d < 0.8 || cps > 20) && a.words.length + b.words.length <= maxWords + 3) {
      subs.splice(i, 2, { s: a.s, e: b.e, text: a.text + ' ' + b.text, words: [...a.words, ...b.words] });
      i--;
    }
  }
  // hold each subtitle until the next one (max +0.5 s) so text doesn't flicker
  for (let i = 0; i < subs.length; i++) {
    const next = subs[i + 1];
    subs[i].e = next ? Math.min(next.s, subs[i].e + 0.5) : subs[i].e + 0.5;
  }
  return subs;
}

/* --------------------------------------------------------------- main */

interface Panel { shot: Shot; w: number; area: number; pan: boolean; splash: boolean; cover?: string; /** balloons + captions inside (AI detector), -1 unknown */ bubbles: number }

export async function autoMontage(p: Project, o: AutoOptions): Promise<{ project: Project; report: AutoReport }> {
  const prof = o.profile ? PROFILE[o.profile] : null;
  const st: StyleDef = prof ? {
    ...STYLES[o.style],
    base: prof.rhythm.base, min: prof.rhythm.min, max: prof.rhythm.max, intensity: prof.rhythm.intensity, maxWords: prof.rhythm.maxWords,
    preset: prof.type.preset, anim: prof.type.anim, splashShake: prof.camera.shake, soloLayouts: prof.layouts,
  } : { ...STYLES[o.style] };
  if (o.model === 'face') Object.assign(st, { block: [2.5, 4] as [number, number], faceDur: [12, 20] as [number, number] });
  const notes: string[] = [];
  await Promise.all([
    ...p.pages.map((pg) => ensureMedia(pg.mediaId, 'image')),
    ...p.audio.map((a) => ensureMedia(a.mediaId, 'audio')),
  ]);
  const readingOrder = st.rtl ? 'rtl' : p.readingOrder;
  let proj: Project = { ...p, readingOrder };
  const { w: FW, h: FH } = FORMATS[p.format];
  const aspect = FW / FH;
  const pace = paceMult(o.style);
  const imult = intensityMult();
  const rand = rng(p.shots.length * 7919 + p.pages.length * 31 + o.style.length);

  o.onProgress?.('Lecture des planches et découpe des cases…', 0.05);
  /* 1. panels — keep the user's own cuts unless asked to redo them */
  const titleCards = proj.shots.filter((s) => s.pageId == null && !s.id.startsWith('hook_'));
  const kept = new Map<string, Shot[]>();
  for (const s of proj.shots) if (s.pageId) kept.set(s.pageId, [...(kept.get(s.pageId) ?? []), s]);
  const raw: Shot[] = [];
  for (const pg of proj.pages) {
    if (pg.skip) continue;
    const a = getImage(pg.mediaId);
    if (!a) continue;
    let list: Shot[] = o.redetect ? [] : (kept.get(pg.id) ?? []).map((s) => ({ ...s, group: undefined }));
    if (!list.length) {
      const old = kept.get(pg.id) ?? [];
      const cut = await cutPageSmart(pg.mediaId, a.img, a.width, a.height, readingOrder === 'rtl');
      list = cut.rects.map((rect, i) =>
        newShot(proj, { pageId: pg.id, rect, zone: cut.kind === 'panels' ? undefined : cut.kind, caption: old[i]?.caption ?? { text: '', ...proj.defaultCaption } }));
    }
    raw.push(...list.map((s) => ({ ...s })));
  }
  const hasFace = !!proj.aroll && segmentsOf(proj.aroll).length > 0;
  if (!raw.length && !titleCards.length && !hasFace) throw new Error('Importe des planches ou un rush face caméra avant de lancer le montage auto.');

  const panels: Panel[] = raw.map((s) => {
    const pg = proj.pages.find((x) => x.id === s.pageId)!;
    const a = getImage(pg.mediaId)!;
    const area = (s.rect.w * s.rect.h) / (pg.width * pg.height);
    const pan = resolveMotion({ ...s, motion: 'auto' }, aspect, readingOrder === 'rtl').motion.startsWith('pan');
    let w = 0.65 + panelLoad(a.img, s.rect) * 0.9 + Math.sqrt(area) * 0.6;
    if (pan) w *= 1.3;
    const isCover = pg.kind === 'cover';
    const sources = new Set(proj.pages.filter((x) => !x.skip).map((x) => x.source)).size;
    const cover = isCover ? (sources > 1 ? prettySource(pg.source ?? pg.name) : '') : undefined;
    if (isCover) w *= 1.5;
    // balloons inside the panel (known from the import's AI reading): text to read = time and weight
    const det = cachedDetection(pg.mediaId);
    const bubbles = det ? det.bubbles.filter((b) => b.s >= 0.35 && b.x + b.w / 2 > s.rect.x && b.x + b.w / 2 < s.rect.x + s.rect.w && b.y + b.h / 2 > s.rect.y && b.y + b.h / 2 < s.rect.y + s.rect.h).length : -1;
    if (bubbles > 0) w *= 1 + Math.min(4, bubbles) * 0.12;
    return { shot: s, w, area, pan, splash: s.zone === 'splash' || (area > 0.42 && s.zone !== 'zones'), cover, bubbles };
  });
  /** long videos breathe: shots get longer as the video does (1 min = ×1, 5 min ≈ ×1.6) */
  let breathe = 1;
  /** shortest time a panel can stay on screen and still be read */
  const readFloor = (x: Panel) => breathe * (x.bubbles > 0 ? 1.15 + Math.min(4, x.bubbles) * 0.4 : x.bubbles === 0 ? 1.0 : Math.max(0.9, st.min)) * (x.shot.group ? 1 + x.shot.group.length * 0.4 : 1);

  const minRead = (s: Shot) => {
    const n = s.caption.text.trim().split(/\s+/).filter(Boolean).length;
    return n ? 0.6 + n * 0.32 : 0;
  };

  /** camera + style for one panel shot */
  const dress = (pn: Panel, layout: Layout, flip: boolean): Shot => {
    const s = pn.shot;
    // unreliable panels: travel the page zone by zone with the spotlight, always readable
    if (s.zone === 'zones' && layout !== 'split' && layout !== 'pip') layout = 'page';
    // covers: the whole cover, slow reveal, the issue name when several issues are edited together
    if (pn.cover !== undefined) {
      return { ...s, layout: layout === 'pip' ? 'pip' : 'full', motion: 'zoom-out', framing: 'fit', intensity: 0.55, shake: 0, nameTag: pn.cover || s.nameTag,
        caption: o.captionStyle ? { ...s.caption, preset: st.preset, anim: st.anim } : s.caption };
    }
    let motion: Motion = 'auto';
    if (!pn.pan) motion = pn.splash ? 'zoom-out' : flip ? 'zoom-out' : 'zoom-in';
    motion = preferredMotion(motion);
    const pg = proj.pages.find((x) => x.id === s.pageId);
    const a = pg && getImage(pg.mediaId);
    const focus = s.focus ?? (a ? panelFocus(a.img, s.rect) : undefined);
    return {
      ...s,
      focus,
      layout,
      motion,
      framing: 'fit',
      intensity: clamp((pn.splash ? st.intensity + 0.15 : st.intensity) * imult, 0, 1),
      shake: pn.splash ? st.splashShake : 0,
      caption: o.captionStyle ? { ...s.caption, preset: st.preset, anim: st.anim } : s.caption,
    };
  };

  /** merge consecutive panels of the same page into multi-panel shots */
  const groupPanels = (list: Panel[], maxGroups: number): Panel[] => {
    const out: Panel[] = [];
    let merged = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i], b = list[i + 1], c = list[i + 2];
      if (merged < maxGroups && b && a.shot.pageId === b.shot.pageId && !a.splash && !b.splash && !a.shot.zone && !b.shot.zone && a.cover === undefined && b.cover === undefined) {
        const take = c && c.shot.pageId === a.shot.pageId && !c.splash && rand() < 0.4 ? [b, c] : [b];
        out.push({
          ...a,
          w: a.w + take.reduce((x, y) => x + y.w * 0.6, 0),
          shot: { ...a.shot, group: take.map((x) => ({ pageId: x.shot.pageId!, rect: x.shot.rect })) },
        });
        i += take.length;
        merged++;
      } else out.push(a);
    }
    return out;
  };

  let shots: Shot[] = [];
  let followedVoice = false;
  let faceShare: number | null = null;
  let total = 0;

  const narr = o.story ? narration(proj) : { sentences: [], source: 'none' as const };
  if (o.story && narr.sentences.length && panels.length) {
    /* ============================ story mode: follow the narration ============================ */
    const sents = narr.sentences;
    const plan = await planStory(proj, panels.map((x) => x.shot), sents, o.story, o.onProgress);
    const byId = new Map(panels.map((x) => [x.shot.id, x]));
    const used = new Set<string>();
    const named = new Set<string>();
    const out: Shot[] = [];
    let flip = false, prevPage: string | null = null, lastLayout: Layout | null = null;
    const order = panels.map((x) => x.shot.id);
    const T = hasFace ? segsDuration(segmentsOf(proj.aroll!)) : Math.max(sents[sents.length - 1].e + 0.8, 1);
    let reviewN = 0;
    sents.forEach((se, i) => {
      const a = plan.assign.find((x) => x.sentence === i);
      const ws = se.s, we = i + 1 < sents.length ? sents[i + 1].s : Math.min(T, se.e + 0.8);
      const len = we - ws;
      if (len < 0.3) return;
      // uncertain over a face cam: show the speaker rather than a wrong panel —
      // unless the story's order vouches for it: it sits between the sure panels
      // of the sentences around it (a narration moves through the comic in order)
      if (!a?.shotId) return;
      if (hasFace && a.conf < 0.35) {
        const sure = (j: number) => { const b = plan.assign.find((x) => x.sentence === j); return b?.shotId && b.conf >= 0.35 ? order.indexOf(b.shotId) : null; };
        let lo = -1, hi = order.length;
        for (let j = i - 1; j >= 0; j--) { const v = sure(j); if (v != null) { lo = v; break; } }
        for (let j = i + 1; j < sents.length; j++) { const v = sure(j); if (v != null) { hi = v; break; } }
        const k = order.indexOf(a.shotId);
        if (a.conf < 0.2 || k < lo || k > hi) return;
      }
      let ids = [a.shotId, ...a.more].filter((id) => byId.has(id));
      // long sentence: an important image (revelation, splash, many details) is kept and
      // explored in stages; an ordinary one hands over to the next panels of the story
      const main = byId.get(ids[0])!;
      const hold = holdFor({ ...main.shot, balloons: Array.from({ length: Math.max(0, main.bubbles) }, () => ({ x: 0, y: 0, w: 1, h: 1 })) },
        { seq: seqTypeOf(se.text, i, sents.length), density: clamp((main.w - 0.65) / 0.9, 0, 1.5), ranges: proj.holds, pace: 0.6 });
      const keepOne = important(hold) && len <= hold.max * 1.3;
      const want = keepOne ? 1 : Math.max(1, Math.min(3, Math.round(len / (st.base * pace * 1.1))));
      for (let k = order.indexOf(ids[ids.length - 1]) + 1; ids.length < want && k < order.length; k++) if (!used.has(order[k])) ids.push(order[k]);
      ids = ids.slice(0, want);
      const per = len / ids.length;
      ids.forEach((id, k) => {
        const pn = byId.get(id)!;
        used.add(id);
        const start = ws + k * per;
        const prev = out[out.length - 1];
        if (prev && prev.id === id && Math.abs((prev.start ?? 0) + prev.duration - start) < 0.05) { prev.duration += per; return; }
        let layout: Layout = pn.shot.group?.length ? 'grid' : pickLayout((hasFace ? st.faceLayouts : st.soloLayouts).filter(([l]) => l !== 'grid' && !(l === lastLayout && l === 'page')), rand());
        if (pn.splash && (layout === 'split' || layout === 'page')) layout = 'full';
        lastLayout = layout;
        const shot = dress(pn, layout, flip);
        flip = !flip;
        let tr: Transition, td: number;
        if (!prev) { tr = hasFace ? st.enterTr : 'cut'; td = 0.3; }
        else if (pn.splash) { tr = st.splashTr; td = 0.3; }
        else if (prevPage === pn.shot.pageId && layout === 'full' && prev.layout === 'full') { tr = 'glide'; td = st.glide; }
        else { tr = st.pagePool ? st.pagePool[Math.floor(rand() * st.pagePool.length)] : st.pageTr; td = st.pageTrDur; }
        // character name on screen at its first mention
        let nameTag = shot.nameTag;
        for (const c of pn.shot.chars ?? []) {
          const key = c.toLowerCase();
          if (!named.has(key) && se.text.toLowerCase().includes(key.split(' ').pop() ?? key)) { nameTag = c; named.add(key); break; }
        }
        const conf = k === 0 ? a.conf : Math.max(0.3, a.conf - 0.15);
        if (conf < 0.5) reviewN++;
        out.push({
          ...shot, id: shot.id + (out.some((x) => x.id === shot.id) ? uid('_') : ''), start: +start.toFixed(3), duration: +per.toFixed(3),
          ...(keepOne && per > 3.6 && layout === 'full' ? { motion: 'tour' as const, why: `image importante (${hold.why}) gardée ${per.toFixed(1)} s et explorée en étapes` } : {}),
          transition: tr, transitionDur: Math.min(td, per * 0.45), nameTag,
          match: { sentence: se.text, conf, alts: k === 0 ? a.alts : [], source: plan.engine },
          auto: { duration: per, layout, motion: keepOne && per > 3.6 && layout === 'full' ? 'tour' : shot.motion, style: o.style },
        });
        prevPage = pn.shot.pageId;
      });
    });
    // schemas proposed by Google replace the panels of their sentence
    for (const sc of plan.schemas) {
      const se = sents[sc.sentence];
      if (!se || sc.items.length < 2) continue;
      const ws = se.s, we = sc.sentence + 1 < sents.length ? sents[sc.sentence + 1].s : se.e + 0.8;
      const items = sc.items.map((it) => { const pn = byId.get(it.panel); return pn ? { id: uid('di_'), label: it.label, sub: it.sub ?? '', pageId: pn.shot.pageId!, rect: pn.shot.rect } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
      if (items.length < 2) continue;
      for (let k = out.length - 1; k >= 0; k--) if ((out[k].start ?? 0) >= ws - 0.01 && (out[k].start ?? 0) < we - 0.01) out.splice(k, 1);
      out.push({ ...newShot(proj, { pageId: null }), start: ws, duration: Math.max(3, we - ws), transition: 'fade', transitionDur: 0.35, layout: 'full', diagram: { kind: sc.kind, title: sc.title, items, links: [] } });
    }
    out.sort((x, y) => (x.start ?? 0) - (y.start ?? 0));
    if (hasFace) {
      shots = out;
      proj = { ...proj, aroll: { ...proj.aroll!, punchIn: st.punchIn, drift: st.drift } };
      faceShare = T > 0 ? 1 - out.reduce((a2, x) => a2 + x.duration, 0) / T : 1;
    } else {
      // comics only: the sequence is continuous; a lead-in cover fills the time before the first sentence
      const first = out[0]?.start ?? 0;
      shots = out.map((x, k) => ({ ...x, start: undefined, duration: +(((out[k + 1]?.start ?? T) - (x.start ?? 0))).toFixed(3) })).filter((x) => x.duration >= 0.3);
      if (first > 0.4 && shots[0]) {
        const cover = panels.find((x) => x.cover !== undefined) ?? panels[0];
        shots.unshift({ ...dress(cover, 'full', false), id: cover.shot.id + uid('_'), duration: +first.toFixed(3), transition: 'cut', transitionDur: 0 });
      }
    }
    total = T;
    const words = narr.sentences.flatMap((x) => x.words);
    if (o.subtitles && words.length) proj = { ...proj, subtitles: buildSubtitles(words, st.maxWords), subtitleStyle: { ...proj.subtitleStyle, on: true, preset: st.preset, anim: 'words', maxWords: st.maxWords } };
    notes.push(`Narration suivie (${narr.source === 'script' ? 'script, durées estimées' : 'voix'}) · associations ${plan.engine === 'google' ? 'Google' : 'locales'} · ${used.size} cases retenues sur ${panels.length}${reviewN ? ` · ${reviewN} à vérifier` : ''}.`);
  } else if (hasFace) {
    /* ============================ face cam + comics ============================ */
    const ar = proj.aroll!;
    const segs: Seg[] = segmentsOf(ar);
    const T = segsDuration(segs);
    const words = timelineWords(proj);
    const sentences = sentencesOf(words);
    // natural places to switch visuals: jump cuts and sentence ends
    const points = [...new Set([...segs.map((g) => +g.t.toFixed(3)), ...sentences.map((s) => +s.e.toFixed(3))])].filter((x) => x > 0.5 && x < T - 0.5).sort((a, b) => a - b);
    const snap = (t: number, win = 0.9) => {
      let best = t, bd = win;
      for (const x of points) { const d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } }
      return best;
    };

    // blocks: face hook → [comics, face] …
    const fm = faceMult();
    const blocks: { s: number; e: number }[] = [];
    let t = snap(Math.min(T * 0.25, st.hook * fm), 0.8);
    if (!panels.length) t = T;
    while (t < T - 0.8) {
      const len = st.block[0] + rand() * (st.block[1] - st.block[0]);
      let e = Math.min(T, snap(t + len / fm));
      if (T - e < st.faceDur[0] + 0.5) e = T; // no tiny face tail
      if (e - t > 0.8) blocks.push({ s: t, e });
      const face = (st.faceDur[0] + rand() * (st.faceDur[1] - st.faceDur[0])) * fm;
      t = e >= T ? T : snap(e + face, 0.7);
    }
    const B = blocks.reduce((a, b) => a + b.e - b.s, 0);
    faceShare = T > 0 ? 1 - B / T : 1;

    // enough time per panel? otherwise show several at once, then skip
    let list = panels;
    if (o.matches) {
      const sTime = (pn: Panel) => {
        const k = o.matches![pn.shot.id];
        return k != null && sentences[k] ? sentences[k].s : Infinity;
      };
      const order = new Map(list.map((x, i) => [x, i]));
      list = [...list].sort((a, b) => (sTime(a) - sTime(b)) || (order.get(a)! - order.get(b)!));
    }
    const minPer = st.min * pace;
    if (list.length && B / list.length < minPer) list = groupPanels(list, Math.ceil(list.length / 2));
    if (list.length && B / list.length < minPer * 0.75) {
      const keep = Math.max(1, Math.floor(B / (minPer * 0.9)));
      const step = list.length / keep;
      list = Array.from({ length: keep }, (_, i) => list[Math.floor(i * step)]);
      notes.push(`Rush court pour autant de cases : ${keep} cases montrées sur ${panels.length}.`);
    }

    // distribute panels across blocks, proportionally to block length
    let idx = 0, cum = 0, flip = false, lastLayout: Layout | null = null, streak = 0;
    for (const [bi, blk] of blocks.entries()) {
      cum += blk.e - blk.s;
      let upto = Math.round((cum / B) * list.length);
      if (bi === blocks.length - 1) upto = list.length;
      if (upto <= idx && idx < list.length) upto = idx + 1;
      const these = list.slice(idx, upto);
      idx = upto;
      if (!these.length) continue;
      const wsum = these.reduce((a, x) => a + x.w, 0);
      let tt = blk.s;
      these.forEach((pn, k) => {
        let d = ((blk.e - blk.s) * pn.w) / wsum;
        let end = k === these.length - 1 ? blk.e : snap(tt + d, Math.min(0.5, d * 0.25));
        d = end - tt;
        if (d < 0.4) { end = tt + 0.4; d = 0.4; }
        let layout: Layout;
        if (pn.shot.group?.length) layout = 'grid';
        else {
          const opts = st.faceLayouts.filter(([l]) => l !== 'grid' && !(streak >= 2 && l === lastLayout));
          layout = pickLayout(opts, rand());
          if (pn.splash && layout === 'split') layout = 'full';
        }
        streak = layout === lastLayout ? streak + 1 : 1;
        lastLayout = layout;
        const prev = shots[shots.length - 1];
        const contiguous = prev && Math.abs((prev.start ?? 0) + prev.duration - tt) < 0.01;
        let tr: Transition, td: number;
        if (!contiguous) { tr = st.enterTr; td = st.enterTr === 'fade' ? 0.35 : 0.28; }
        else if (pn.splash) { tr = st.splashTr; td = 0.3; }
        else if (prev.pageId === pn.shot.pageId && layout === 'full' && prev.layout === 'full') { tr = 'glide'; td = st.glide; }
        else { tr = st.pagePool ? st.pagePool[Math.floor(rand() * st.pagePool.length)] : st.pageTr; td = st.pageTrDur; }
        const shot = dress(pn, layout, flip);
        flip = !flip;
        shots.push({
          ...shot, id: shot.id + (shots.some((x) => x.id === shot.id) ? uid('_') : ''), start: +tt.toFixed(3), duration: +d.toFixed(3),
          transition: tr, transitionDur: Math.min(td, d * 0.45),
          auto: { duration: d, layout, motion: shot.motion, style: o.style },
        });
        tt = end;
      });
    }
    // remaining title cards (user-made) are kept at their place
    for (const tc of titleCards) shots.push(tc);

    // face-cam effects made by the editor: hook written behind the speaker, panel teasers behind them
    const fx: FxItem[] = (proj.fx ?? []).filter((f) => !f.id.startsWith('auto_'));
    const cutout = proj.look?.cutout !== false;
    const gaps: { s: number; e: number }[] = [];
    let prevEnd = 0;
    for (const b of blocks) { if (b.s - prevEnd > 0.8) gaps.push({ s: prevEnd, e: b.s }); prevEnd = b.e; }
    if (T - prevEnd > 0.8) gaps.push({ s: prevEnd, e: T });
    if (cutout && o.hook.trim() && gaps[0]?.s === 0) {
      fx.push({ id: 'auto_' + uid(), kind: 'textBehind', start: 0, duration: Math.min(gaps[0].e, 3), text: o.hook.trim() });
    }
    if (cutout && o.style === 'energetic') {
      gaps.slice(1).forEach((g, k) => {
        const next = shots.find((x) => (x.start ?? 0) >= g.e - 0.01 && x.pageId);
        if (k % 2 === 0 && next && g.e - g.s > 1.6) {
          fx.push({ id: 'auto_' + uid(), kind: 'panelBehind', start: g.s, duration: g.e - g.s, pageId: next.pageId!, rect: next.rect });
        }
      });
    }
    proj = { ...proj, fx };

    if (o.hook.trim() && !cutout) {
      shots.push({
        ...newShot(proj, { pageId: null }), id: 'hook_' + uid(), start: 0, duration: Math.min(st.hook, 2.2), layout: 'full',
        transition: 'cut', transitionDur: 0, titleBg: 'face',
        caption: { text: o.hook.trim(), preset: o.style === 'explainer' ? 'neon' : 'impact', anim: 'pop', y: 0.5, size: 1 },
      });
    }
    shots.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    proj = { ...proj, aroll: { ...ar, punchIn: st.punchIn, drift: st.drift } };
    total = T;
    if (o.subtitles && words.length) {
      proj = { ...proj, subtitles: buildSubtitles(words, st.maxWords), subtitleStyle: { ...proj.subtitleStyle, on: true, preset: st.preset === 'clean' ? 'clean' : st.preset, anim: 'words', maxWords: st.maxWords } };
    } else if (o.subtitles && !words.length) {
      notes.push('Transcris le rush pour obtenir les sous-titres automatiques.');
    }
  } else {
    /* =============================== comics only =============================== */
    const voices = proj.audio.filter((c) => c.kind === 'voice');
    const voiceEnd = voices.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    const hookDur = o.hook.trim() ? (o.style === 'cinematic' || o.style === 'explainer' ? 2.6 : 1.6) : 0;
    const titleDur = titleCards.reduce((a, s) => a + s.duration, 0);
    let list = panels;
    let target: number | null = null;
    if ((o.length === 'voice' || o.length === 'auto') && voiceEnd > 0) {
      target = voiceEnd + 0.8;
      followedVoice = true;
    } else if (typeof o.length === 'number') target = o.length;
    if (target && list.length && (target - hookDur - titleDur) / list.length < st.min * 0.85) {
      list = groupPanels(list, Math.ceil(list.length / 3));
    }
    if (target && !followedVoice) breathe = clamp(1 + (target - 75) / 225 * 0.6, 1, 1.6);
    // still too many panels to READ in the asked length: keep the strongest ones
    // (covers and splashes first, then by weight: art density, size, dialogue),
    // spread over the whole story, in reading order — never a slideshow of flashes
    const room0 = target ? target - hookDur - titleDur : 0;
    const need = list.reduce((a, x) => a + readFloor(x), 0);
    if (target && !followedVoice && list.length && need > room0) {
      const must = list.filter((x) => x.cover !== undefined || x.splash);
      const pick = new Set<Panel>();
      let used = 0;
      for (const x of must) { if (used + readFloor(x) <= room0 || !pick.size) { pick.add(x); used += readFloor(x); } }
      // best panel of each stretch of the story first, so no part is skipped entirely
      const rest = list.filter((x) => !pick.has(x));
      const chunks = Math.max(1, Math.round(room0 / 6));
      const byChunk = Array.from({ length: chunks }, (_, c) => rest.slice(Math.floor((c * rest.length) / chunks), Math.floor(((c + 1) * rest.length) / chunks)).sort((a, b) => b.w - a.w));
      for (let round = 0; byChunk.some((c) => c.length); round++) {
        for (const c of byChunk) {
          const x = c.shift();
          if (x && used + readFloor(x) <= room0) { pick.add(x); used += readFloor(x); }
        }
        if (round > 40) break;
      }
      const before = list.length;
      list = list.filter((x) => pick.has(x));
      notes.push(`${list.length} cases choisies sur ${before} (les plus fortes, réparties sur toute l’histoire) pour avoir le temps de les lire en ${target} s.`);
    }
    if (followedVoice) {
      const floor = list.length * st.min * 0.85 + hookDur + titleDur;
      if (target! < floor) {
        target = floor;
        notes.push('Voix off courte pour autant de cases : la vidéo dure plus longtemps que la narration.');
      }
    }
    if (o.length === 'voice' && !voiceEnd) notes.push('Pas de voix off : durée calculée automatiquement.');

    // a long video from too few panels: no shot may outstay attention (about 6 s
    // a panel, 9 s a grid or a talky panel); the video gets shorter and says why
    if (target && !followedVoice && list.length) {
      const cap = (x: Panel) => Math.max(readFloor(x) * 1.6, x.shot.group ? 9 : 6);
      const most = list.reduce((a, x) => a + cap(x), 0) + hookDur + titleDur;
      if (most < target * 0.92) {
        const perPanel = 3.2;
        const missing = Math.ceil((target - most) / perPanel);
        notes.push(`Pas assez de cases pour ${Math.round(target / 60 * 10) / 10} min sans voix off : la vidéo dure ${Math.round(most)} s pour garder du rythme. Ajoute environ ${missing} cases (${Math.max(1, Math.round(missing / 6))} numéro(s) de plus) ou une voix off pour atteindre la durée.`);
        target = Math.round(most);
      }
    }

    let durs = list.map((x) => st.base * x.w * pace * (x.shot.group ? 1 + x.shot.group.length * 0.5 : 1));
    if (target) {
      const avail = Math.max(list.length * 0.6, target - hookDur - titleDur);
      const k = avail / durs.reduce((a, b) => a + b, 0);
      durs = durs.map((d) => d * k);
      const lo = Math.min(st.min, avail / list.length), hi = Math.max(st.max, (avail / list.length) * 1.6);
      durs = durs.map((d, i) => clamp(Math.max(d, minRead(list[i].shot), readFloor(list[i])), Math.max(0.85, lo * 0.75), Math.max(hi, readFloor(list[i]))));
      const s2 = durs.reduce((a, b) => a + b, 0);
      // rescale to the target but never under the reading time of the panel
      durs = durs.map((d, i) => Math.max(followedVoice ? 0.8 : Math.min(readFloor(list[i]), 0.8 + readFloor(list[i]) * 0.5), d * (avail / s2)));
    } else {
      durs = durs.map((d, i) => clamp(Math.max(d, minRead(list[i].shot)), st.min, st.max * (list[i].shot.group ? 1.6 : 1)));
    }

    let flip = false, lastLayout: Layout | null = null;
    shots = list.map((pn, i) => {
      const prev = list[i - 1];
      let layout: Layout = pn.shot.group?.length ? 'grid' : pickLayout(st.soloLayouts.filter(([l]) => l !== 'grid' && !(l === 'page' && lastLayout === 'page')), rand());
      if (pn.splash && layout === 'page') layout = 'full';
      lastLayout = layout;
      let tr: Transition, td: number;
      if (i === 0 && !hookDur && !titleCards.length) { tr = 'cut'; td = 0; }
      else if (pn.splash) { tr = st.splashTr; td = st.splashTr === 'flash' ? 0.3 : 0.5; }
      else if (prev && prev.shot.pageId === pn.shot.pageId && layout === 'full') { tr = 'glide'; td = st.glide; }
      else { tr = st.pagePool ? st.pagePool[Math.floor(rand() * st.pagePool.length)] : st.pageTr; td = tr === 'iris' || tr === 'blur' ? Math.max(st.pageTrDur, 0.45) : st.pageTrDur; }
      const s = dress(pn, layout, flip);
      flip = !flip;
      return { ...s, start: undefined, duration: +durs[i].toFixed(3), transition: tr, transitionDur: Math.min(td, durs[i] * 0.45), auto: { duration: durs[i], layout, motion: s.motion, style: o.style } };
    });

    const lead: Shot[] = [...titleCards];
    if (hookDur) {
      lead.unshift({
        ...newShot(proj, { pageId: null }), id: 'hook_' + uid(), duration: hookDur, transition: 'cut', transitionDur: 0, layout: 'full',
        caption: { text: o.hook.trim(), preset: o.style === 'cinematic' ? 'cinema' : 'impact', anim: 'pop', y: 0.5, size: 1 },
        titleBg: '#0B0B0D', shake: o.style === 'cinematic' ? 0 : 0.4,
      });
    }
    if (lead.length && shots[0]) shots[0] = { ...shots[0], transition: o.style === 'cinematic' ? 'fade' : 'zoom', transitionDur: 0.45 };
    shots = [...lead, ...shots];

    // beat sync on the first music clip
    const music = proj.audio.find((c) => c.kind === 'music');
    const musicBuf = music && getAudio(music.mediaId);
    if (o.beatSync && music && musicBuf && !followedVoice) {
      const grid = detectBeats(musicBuf, music.offset, Math.min(musicBuf.duration, music.offset + 600));
      if (grid && grid.confidence > 1.15) {
        let step = 60 / grid.bpm;
        while (step < 0.3) step *= 2;
        const minLen = step * st.beatEvery;
        const first = grid.offset - music.offset;
        let tt = 0;
        shots = shots.map((s) => {
          const end = tt + s.duration;
          const k = Math.max(1, Math.round((end - first) / step));
          let snapped = first + k * step;
          while (snapped - tt < minLen - 1e-6) snapped += step;
          const d = snapped - tt;
          tt = snapped;
          return { ...s, duration: +d.toFixed(3), transitionDur: Math.min(s.transitionDur, d * 0.45), auto: s.auto ? { ...s.auto, duration: d } : undefined };
        });
        notes.push(`Coupes calées sur ${Math.round(grid.bpm)} BPM.`);
      } else notes.push('Tempo de la musique peu marqué : pas de calage sur le beat.');
    }
    total = shots.reduce((a, s) => a + s.duration, 0);
  }

  proj = { ...proj, shots };

  // balloons already read at import: the director needs them to choose a reading camera
  proj = { ...proj, shots: proj.shots.map((s) => {
    if (s.balloons || !s.pageId) return s;
    const pg = proj.pages.find((x) => x.id === s.pageId);
    const det = pg && cachedDetection(pg.mediaId);
    if (!det) return s;
    const inside = det.bubbles.filter((b) => b.s >= 0.35 && b.x + b.w / 2 > s.rect.x && b.x + b.w / 2 < s.rect.x + s.rect.w && b.y + b.h / 2 > s.rect.y && b.y + b.h / 2 < s.rect.y + s.rect.h)
      .map(({ x, y, w, h }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }));
    return inside.length ? { ...s, balloons: comicOrder(inside, readingOrder === 'rtl').slice(0, 6) } : s;
  }) };

  o.onProgress?.('Direction créative : transitions selon le récit…', 0.8);
  /* creative direction: transitions from the narration, under the effects budget */
  if (prof) {
    const d = direct(proj.shots, prof);
    proj = applyProfileLook({ ...proj, shots: d.shots }, prof);
    const beats = Object.entries(d.report.beats).filter(([b]) => b !== 'plain' && b !== 'hook').sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([b, n]) => `${n} ${BEAT_FR[b as keyof typeof BEAT_FR]}`).join(', ');
    notes.push(`Direction « ${prof.label} » : ${d.report.strong} effet(s) fort(s), ${d.report.accents} accent(s)${d.report.scenes ? `, ${d.report.scenes} scène(s) 3D` : ''}, le reste en coupes franches.${beats ? ' Temps forts repérés : ' + beats + '.' : ''}`);
  }

  /* creative director: sequences, treatments, camera grammar, transition diversity */
  {
    const dopt: DirectorOptions = { transitions: true, camera: true, sequences: true, ...o.director };
    if (dopt.transitions || dopt.camera) {
      let acc = 0;
      const timed = proj.shots.map((s, i) => { const t = s.start ?? acc; acc = t + s.duration; return { s, i, t }; }).sort((a, b) => a.t - b.t || a.i - b.i);
      const before = variety(timed.map((x) => x.s));
      const d = directSequences(timed.map((x) => x.s), aspect, dopt, readingOrder === 'rtl');
      const byId = new Map(d.shots.map((s) => [s.id, s]));
      proj = { ...proj, shots: proj.shots.map((s) => byId.get(s.id) ?? s), direction: { ...(proj.direction ?? { profile: o.profile ?? 'premium' }), sequences: d.report.sequences } };
      const after = variety(timed.map((x) => byId.get(x.s.id)!));
      notes.push(...d.report.notes);
      if (before.maxMotionRun > after.maxMotionRun || before.closeRepeats > after.closeRepeats) notes.push(`Variété : plus longue suite de mouvements identiques ${before.maxMotionRun} → ${after.maxMotionRun}, transitions répétées de près ${before.closeRepeats} → ${after.closeRepeats}.`);
    }
  }

  /* production model: visuals the script calls for, built from the user's panels */
  if (o.model && MODELS[o.model].uses.length) {
    const { analyseScript } = await import('./scriptIntel');
    const { suggestionElement } = await import('./suggest');
    const uses = MODELS[o.model].uses;
    const sgs = analyseScript(proj).suggestions.filter((g) => uses.includes(g.kind));
    let last = -1e9, added = 0;
    let shotsNow = proj.shots;
    const fx: FxItem[] = [...(proj.fx ?? [])];
    for (const g of sgs) {
      if (g.at - last < 15 || added >= Math.max(2, Math.round(total / 25))) continue;
      const el = suggestionElement({ ...proj, shots: shotsNow }, g);
      if (el.fx) { fx.push({ id: uid('fx_'), kind: 'callout', start: g.at, duration: 1.4, ...el.fx } as FxItem); last = g.at; added++; continue; }
      const sh = el.shot!;
      if (proj.aroll) { shotsNow = [...shotsNow, sh]; }
      else {
        // comics only: the visual replaces the shots it covers, so the voice stays in sync
        let t = 0, i = 0;
        while (i < shotsNow.length && t + shotsNow[i].duration <= g.at) { t += shotsNow[i].duration; i++; }
        if (i >= shotsNow.length) continue;
        let j = i, d = 0;
        while (j < shotsNow.length && d < sh.duration * 0.7) { d += shotsNow[j].duration; j++; }
        sh.duration = +d.toFixed(3);
        sh.transition = shotsNow[i].transition === 'cut' ? 'fade' : shotsNow[i].transition;
        sh.auto = { duration: d, layout: 'full', motion: 'auto', style: o.style };
        shotsNow = [...shotsNow.slice(0, i), sh, ...shotsNow.slice(j)];
      }
      last = g.at; added++;
    }
    proj = { ...proj, shots: shotsNow, fx };
    const { fixRepeats } = await import('./suggest');
    proj = { ...proj, shots: fixRepeats(proj) };
    if (added) notes.push(`Modèle « ${MODELS[o.model].label} » : ${added} visuel(s) tiré(s) du script (frise, relations, échelle, citation…), à vérifier.`);
  }

  o.onProgress?.('Musique et mixage…', 0.9);
  /* music from the library when the project has none */
  let libMusic = false;
  if (o.music !== false && !proj.audio.some((c) => c.kind === 'music') && total > 3) {
    try {
      const lib = await import('./library');
      const t = lib.pickTrack(await lib.listTracks(), o.profile, total);
      if (t) {
        await ensureMedia(t.mediaId, 'audio');
        proj = lib.withMusic(proj, t, total);
        libMusic = true;
        notes.push(`Musique « ${t.name} » (${lib.MOOD_FR[t.mood].toLowerCase()}${t.bpm ? `, ${t.bpm} BPM` : ''}) choisie dans ta bibliothèque et mixée sous la voix.`);
      }
    } catch { /* no library */ }
  }

  /* mix: music fitted to the edit, ducked under the voice */
  const music = proj.audio.find((c) => c.kind === 'music');
  proj = {
    ...proj,
    ducking: hasFace || proj.audio.some((c) => c.kind === 'voice') ? true : proj.ducking,
    audio: proj.audio.map((c) =>
      c.kind === 'music' && !libMusic ? { ...c, start: 0, duration: Math.min(c.sourceDuration - c.offset, total), fadeIn: 0.3, fadeOut: Math.min(2, total * 0.1) } : c),
  };
  if (music && !libMusic && music.sourceDuration - music.offset < total - 0.5) notes.push('La musique est plus courte que la vidéo : passe par la bibliothèque musicale pour la faire boucler sur les mesures.');
  if (st.rtl && p.readingOrder !== 'rtl') notes.push('Sens de lecture passé en manga (droite → gauche).');
  // channel identity: intro sting, a chapter card before each issue, YouTube end screen
  const br = brandOf(proj);
  const card = (titleBg: string, text: string, duration: number, start?: number): Shot => ({
    ...newShot(proj, { pageId: null }), id: 'brand_' + uid(), titleBg, duration, start, layout: 'full', transition: 'cut', transitionDur: 0,
    caption: { ...proj.defaultCaption, text },
  });
  const overlay = !!proj.aroll;
  let sh = proj.shots.filter((x) => !x.id.startsWith('brand_'));
  if (!overlay) {
    const out: Shot[] = [];
    for (const x of sh) {
      if (x.nameTag && proj.pages.find((pg) => pg.id === x.pageId)?.kind === 'cover') out.push(card('brand', x.nameTag, 1.6));
      out.push(x);
    }
    sh = out;
    if (br.intro) sh = [card('intro', '', 1.2), ...sh];
    if (br.outro && proj.format === '16:9') sh = [...sh, { ...card('outro', '', 10), transition: 'fade', transitionDur: 0.5 }];
    if (sh[1] && br.intro) sh[1] = { ...sh[1], transition: 'zoom', transitionDur: 0.35 };
  } else {
    if (br.intro) sh = [card('intro', '', 1.2, 0), ...sh];
    const end = Math.max(segsDuration(segmentsOf(proj.aroll!)), ...sh.map((x) => (x.start ?? 0) + x.duration));
    if (br.outro && proj.format === '16:9') sh = [...sh, { ...card('outro', '', 10, end), transition: 'fade', transitionDur: 0.5 }];
  }
  proj = { ...proj, shots: sh, accent: br.bg };

  // punch-ins on the stressed moments of the voice
  try { proj = { ...proj, emphasis: await emphasisTimes(proj) }; } catch { /* no audio */ }
  // the narration matched no panel with confidence (other comics, very short script…): never leave the edit empty
  if (o.story && panels.length && !proj.shots.some((x) => x.pageId)) {
    const again = await autoMontage(p, { ...o, story: false });
    again.report.notes.unshift('Aucune case ne correspond clairement à la narration : alternance visage / cases classique à la place. Ajoute les bonnes planches ou corrige dans « À vérifier ».');
    return again;
  }
  o.onProgress?.('Contrôle final…', 0.97);
  noteMontage();
  const checked = validateProject(proj);
  proj = checked.project;

  return {
    project: proj,
    report: {
      shots: shots.filter((s) => s.pageId).length, pages: proj.pages.length, duration: total,
      bpm: null, followedVoice, faceShare, subtitles: proj.subtitles.length, notes,
    },
  };
}

/** "Before_Watchmen_Dr._Manhattan_Issue_3" → "Before Watchmen Dr. Manhattan #3" */
export function prettySource(src: string) {
  return src
    .replace(/^[0-9a-f]{6,}-/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s*(issue|num(é|e)ro|no\.?|#)\s*0*(\d+)/i, ' #$3')
    .replace(/\s+/g, ' ')
    .trim();
}
