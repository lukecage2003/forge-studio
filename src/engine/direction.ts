/**
 * Creative Direction Engine: 8 editing profiles. Each one decides the rhythm,
 * the typography of the texts, which transitions are allowed at which
 * intensity, how much the camera moves, the colour, the sound and how dense
 * the effects can be. The auto edit builds the cut, then `direct()` applies
 * the profile shot by shot from what the narration says (engine/narrative),
 * under an effects budget: a strong effect must be earned, never repeated
 * back to back, never on every cut.
 */
import type { CaptionAnim, CaptionPreset, Layout, Look, Project, Shot, Transition } from '../types';
import { TRANSITION } from './effects';
import { BEAT_FR, beatOf, beatWeight, type Beat } from './narrative';
import { rng, hashSeed } from './rng';

export type ProfileId = 'premium' | 'cosmic' | 'action' | 'character' | 'science' | 'timeline' | 'power' | 'editorial';
type BaseStyle = 'explainer' | 'energetic' | 'dynamic' | 'cinematic' | 'manga';

export interface Profile {
  id: ProfileId;
  label: string;
  desc: string;
  /** auto-edit style the profile starts from, with and without a face cam */
  base: { face: BaseStyle; solo: BaseStyle };
  /** rhythm: shot lengths (s), camera intensity, words per subtitle */
  rhythm: { base: number; min: number; max: number; intensity: number; maxWords: number };
  /** typography of the texts */
  type: { preset: CaptionPreset; anim: CaptionAnim };
  /** transitions by intensity: calm (most cuts), accent, strong */
  palette: { calm: Transition[]; accent: Transition[]; strong: Transition[] };
  /** durations by intensity, seconds */
  dur: [number, number, number];
  /** effects budget, per minute of video */
  budget: { accent: number; strong: number };
  /** camera: maximum impact shake, handheld drift */
  camera: { shake: number; handheld: number };
  /** colour and texture */
  look: Partial<Look>;
  /** sound design: level and whooshes per minute */
  sound: { volume: number; perMin: number };
  /** density: layouts allowed for comics-only edits */
  layouts: [Layout, number][];
  /** 3D scene the profile may build from its panels on the right beat (at most one per 90 s) */
  scene?: { kind: 'cosmos' | 'tiers' | 'orbit'; beat: Beat };
}

export const PROFILES: Profile[] = [
  {
    id: 'premium', label: 'Documentaire comics premium', desc: 'Sobre et soigné : coupes franches, fondus rares, trame BD réservée aux grands moments.',
    base: { face: 'explainer', solo: 'cinematic' },
    rhythm: { base: 3.4, min: 2, max: 7, intensity: 0.45, maxWords: 6 },
    type: { preset: 'clean', anim: 'words' },
    palette: { calm: ['cut', 'cut', 'fade'], accent: ['wipe', 'defocus', 'slide'], strong: ['halftone', 'inkbleed'] },
    dur: [0.45, 0.6, 0.9], budget: { accent: 4, strong: 1 },
    camera: { shake: 0, handheld: 0.2 },
    look: { grade: 'cinema', vignette: 0.35, grain: 0.2, paper: 0.25, chroma: false, speedLines: false, balloonPop: true, parallax: true },
    sound: { volume: 0.4, perMin: 3 },
    layouts: [['full', 6], ['page', 1.2], ['grid', 0.5]],
  },
  {
    id: 'cosmic', label: 'Cinématique cosmique', desc: 'Lent et ample : mises au point, lumière, saut en vitesse lumière et trou noir pour les révélations.',
    base: { face: 'explainer', solo: 'cinematic' },
    rhythm: { base: 3.8, min: 2.2, max: 8, intensity: 0.4, maxWords: 7 },
    type: { preset: 'cinema', anim: 'type' },
    palette: { calm: ['fade', 'cut', 'defocus'], accent: ['warp', 'burn', 'blur'], strong: ['warpspeed', 'gravitylens'] },
    dur: [0.6, 0.8, 1.1], budget: { accent: 4, strong: 1.5 },
    camera: { shake: 0, handheld: 0.25 },
    look: { grade: 'cinema', vignette: 0.5, grain: 0.3, paper: 0, chroma: true, speedLines: false, balloonPop: true, parallax: true },
    sound: { volume: 0.55, perMin: 4 },
    layouts: [['full', 6], ['page', 1]],
    scene: { kind: 'cosmos', beat: 'cosmic' },
  },
  {
    id: 'action', label: 'Action et combat', desc: 'Nerveux : whips, coupes BD, zooms flous et tremblements sur les coups.',
    base: { face: 'energetic', solo: 'dynamic' },
    rhythm: { base: 1.8, min: 0.9, max: 3.6, intensity: 0.8, maxWords: 3 },
    type: { preset: 'impact', anim: 'pop' },
    palette: { calm: ['cut', 'cut'], accent: ['whip', 'slash', 'zoom'], strong: ['crosszoom', 'flash'] },
    dur: [0, 0.3, 0.4], budget: { accent: 10, strong: 4 },
    camera: { shake: 0.8, handheld: 0.4 },
    look: { grade: 'punch', vignette: 0.25, grain: 0.1, paper: 0, chroma: true, speedLines: true, balloonPop: true, parallax: true },
    sound: { volume: 0.7, perMin: 10 },
    layouts: [['full', 5], ['grid', 1.5]],
  },
  {
    id: 'character', label: 'Analyse de personnage', desc: 'Au service du visage et du regard : cadres serrés, fondus, encre pour les tournants intimes.',
    base: { face: 'explainer', solo: 'cinematic' },
    rhythm: { base: 3.2, min: 1.8, max: 6.5, intensity: 0.5, maxWords: 5 },
    type: { preset: 'clean', anim: 'words' },
    palette: { calm: ['cut', 'cut', 'fade'], accent: ['defocus', 'iris', 'slide'], strong: ['inkbleed'] },
    dur: [0.45, 0.6, 1], budget: { accent: 4, strong: 1 },
    camera: { shake: 0.2, handheld: 0.25 },
    look: { grade: 'natural', vignette: 0.3, grain: 0.15, paper: 0.1, chroma: false, speedLines: false, balloonPop: true, parallax: true },
    sound: { volume: 0.45, perMin: 3 },
    layouts: [['full', 6], ['page', 0.8], ['grid', 0.6]],
  },
  {
    id: 'science', label: 'Explication scientifique', desc: 'Clair avant tout : coupes nettes, volets propres, presque aucun effet.',
    base: { face: 'explainer', solo: 'cinematic' },
    rhythm: { base: 3.2, min: 1.8, max: 7, intensity: 0.4, maxWords: 6 },
    type: { preset: 'clean', anim: 'words' },
    palette: { calm: ['cut', 'cut', 'cut', 'fade'], accent: ['wipe', 'slide'], strong: ['warp'] },
    dur: [0.4, 0.5, 0.7], budget: { accent: 3, strong: 0.8 },
    camera: { shake: 0, handheld: 0.1 },
    look: { grade: 'natural', vignette: 0.15, grain: 0, paper: 0, chroma: false, speedLines: false, balloonPop: true, parallax: true },
    sound: { volume: 0.35, perMin: 2 },
    layouts: [['full', 5], ['grid', 1.5], ['page', 0.8]],
  },
  {
    id: 'timeline', label: 'Frise historique', desc: 'Chronologique : papier vieilli, volets pour chaque date, brûlure pellicule pour les époques.',
    base: { face: 'explainer', solo: 'cinematic' },
    rhythm: { base: 3.4, min: 2, max: 7, intensity: 0.45, maxWords: 6 },
    type: { preset: 'cinema', anim: 'type' },
    palette: { calm: ['cut', 'fade', 'cut'], accent: ['wipe', 'dip', 'burn'], strong: ['halftone'] },
    dur: [0.5, 0.65, 0.9], budget: { accent: 5, strong: 1 },
    camera: { shake: 0, handheld: 0.15 },
    look: { grade: 'warm', vignette: 0.35, grain: 0.3, paper: 0.5, chroma: false, speedLines: false, balloonPop: true, parallax: true },
    sound: { volume: 0.4, perMin: 3 },
    layouts: [['full', 6], ['page', 1.2]],
  },
  {
    id: 'power', label: 'Échelle de puissance', desc: 'Comparaisons qui montent en intensité : coupes BD, zooms flous, vitesse lumière au sommet.',
    base: { face: 'energetic', solo: 'dynamic' },
    rhythm: { base: 2.2, min: 1.1, max: 4.5, intensity: 0.7, maxWords: 4 },
    type: { preset: 'impact', anim: 'pop' },
    palette: { calm: ['cut', 'cut'], accent: ['slash', 'zoom', 'crosszoom'], strong: ['warpspeed', 'flash', 'gravitylens'] },
    dur: [0, 0.35, 0.8], budget: { accent: 8, strong: 2.5 },
    camera: { shake: 0.6, handheld: 0.3 },
    look: { grade: 'punch', vignette: 0.3, grain: 0.1, paper: 0, chroma: true, speedLines: true, balloonPop: true, parallax: true },
    sound: { volume: 0.65, perMin: 8 },
    layouts: [['full', 5], ['grid', 1.6]],
    scene: { kind: 'tiers', beat: 'compare' },
  },
  {
    id: 'editorial', label: 'Commentaire éditorial', desc: 'Ton avis face caméra : coupes sèches, poussées et volets, un flash pour souligner une opinion forte.',
    base: { face: 'energetic', solo: 'dynamic' },
    rhythm: { base: 2.6, min: 1.3, max: 5, intensity: 0.6, maxWords: 4 },
    type: { preset: 'tiktok', anim: 'words' },
    palette: { calm: ['cut', 'cut', 'cut'], accent: ['slide', 'wipe', 'zoom'], strong: ['flash', 'crosszoom'] },
    dur: [0, 0.4, 0.4], budget: { accent: 5, strong: 1.5 },
    camera: { shake: 0.4, handheld: 0.25 },
    look: { grade: 'natural', vignette: 0.2, grain: 0, paper: 0, chroma: true, speedLines: true, balloonPop: true, parallax: true },
    sound: { volume: 0.5, perMin: 5 },
    layouts: [['full', 5], ['grid', 1], ['page', 0.6]],
  },
];

export const PROFILE: Record<ProfileId, Profile> = Object.fromEntries(PROFILES.map((p) => [p.id, p])) as Record<ProfileId, Profile>;

/** which category of transition answers which beat */
const BEAT_CAT: Partial<Record<Beat, string>> = { action: 'action', cosmic: 'cosmic', date: 'info', compare: 'action', list: 'info', emotion: 'cinematic' };

export interface DirectionReport { profile: ProfileId; accents: number; strong: number; scenes: number; beats: Partial<Record<Beat, number>> }

/** shots in time order with their start time (works with and without a face cam) */
function timeline(shots: Shot[]): { s: Shot; i: number; t: number }[] {
  let acc = 0;
  return shots.map((s, i) => { const t = s.start ?? acc; acc = t + s.duration; return { s, i, t }; }).sort((a, b) => a.t - b.t);
}

/**
 * Apply a profile to an edit: transitions chosen from what each sentence says,
 * under the per-minute budget, no identical visible transition twice in a row,
 * shakes capped. Only touches shots the auto edit made (shot.auto) and never
 * the camera glides between panels of the same page.
 */
export function direct(shots: Shot[], prof: Profile): { shots: Shot[]; report: DirectionReport } {
  const out = shots.map((s) => ({ ...s }));
  const rand = rng(hashSeed(prof.id + shots.length));
  const used: { t: number; level: 1 | 2 }[] = [];
  const report: DirectionReport = { profile: prof.id, accents: 0, strong: 0, scenes: 0, beats: {} };
  let prevTr: Transition | null = null;
  let lastVisible: Transition | null = null;
  let sinceMark = 9;
  let prevPage: string | null = null;
  const order = timeline(out);
  const beats = order.map(({ s }, k) => beatOf(s.match?.sentence || s.caption.text || s.text || '', k));
  order.forEach(({ s, t }, k) => {
    const beat = beats[k];
    report.beats[beat] = (report.beats[beat] ?? 0) + 1;
    const newPage = !!s.pageId && s.pageId !== prevPage;
    if (s.pageId) prevPage = s.pageId;
    if (!s.auto || k === 0 || s.transition === 'glide' || s.id.startsWith('brand_') || s.id.startsWith('hook_')) {
      prevTr = s.transition;
      if (s.transition !== 'cut' && s.transition !== 'glide') lastVisible = s.transition;
      sinceMark++;
      return;
    }
    const splash = s.zone === 'splash';
    // a new page earns an accent only when the story does not need one right after
    const nextStrong = k + 1 < beats.length && beatWeight(beats[k + 1]) === 2;
    let level: 0 | 1 | 2 = Math.max(beatWeight(beat), splash ? 2 : 0, newPage && !nextStrong ? 1 : 0) as 0 | 1 | 2;
    // budget over the last 60 s, and breathing room between two marked transitions
    const inMin = (lv: 1 | 2) => used.filter((u) => u.t > t - 60 && u.level >= lv).length;
    if (level === 2 && (inMin(2) >= Math.max(1, Math.floor(prof.budget.strong)) || sinceMark < 1)) level = 1;
    if (level >= 1 && (inMin(1) >= Math.max(1, Math.floor(prof.budget.accent)) || sinceMark < 1)) level = 0;
    const pool = level === 2 ? prof.palette.strong : level === 1 ? prof.palette.accent : prof.palette.calm;
    const cat = BEAT_CAT[beat];
    const fits = (tr: Transition) => (TRANSITION[tr]?.minDur ?? 0) <= s.duration * 0.45 + 1e-6;
    let cand = pool.filter((tr) => fits(tr) && (tr === 'cut' || (tr !== prevTr && tr !== lastVisible)));
    if (!cand.length) cand = pool.filter((tr) => fits(tr) && tr !== prevTr);
    if (!cand.length) cand = ['cut'];
    const preferred = cat ? cand.filter((tr) => TRANSITION[tr]?.category === cat) : [];
    const pickFrom = preferred.length ? preferred : cand;
    const tr = pickFrom[Math.floor(rand() * pickFrom.length)];
    const realLevel: 0 | 1 | 2 = tr === 'cut' ? 0 : level;
    const dur = tr === 'cut' ? 0 : Math.min(s.duration * 0.45, Math.max(prof.dur[realLevel] || prof.dur[1], TRANSITION[tr]?.minDur ?? 0));
    s.transition = tr;
    s.transitionDur = +dur.toFixed(3);
    s.why = `${BEAT_FR[beat]}${splash ? ' (case pleine page)' : ''}${newPage ? ' · nouvelle page' : ''} → ${realLevel === 2 ? 'effet fort' : realLevel === 1 ? 'accent' : 'coupe sobre'} « ${TRANSITION[tr]?.label ?? tr} »`;
    s.tp = undefined;
    // camera: impacts only where the story hits
    const hit = beat === 'action' || splash;
    s.shake = hit ? Math.min(Math.max(s.shake, prof.camera.shake * 0.8), prof.camera.shake) : Math.min(s.shake, prof.camera.shake * 0.4);
    if (realLevel >= 1) { used.push({ t, level: realLevel as 1 | 2 }); sinceMark = 0; if (realLevel === 2) report.strong++; else report.accents++; } else sinceMark++;
    prevTr = tr;
    if (tr !== 'cut' && tr !== 'glide') lastVisible = tr;
  });
  // 3D scenes from the panels themselves, on the beat the profile is about
  if (prof.scene) {
    let last = -1e9;
    const panelsAround = (k: number) => {
      const seen = new Set<string>();
      const items: { s: Shot }[] = [];
      for (const d of [0, 1, -1, 2, -2, 3]) {
        const o = order[k + d]?.s;
        if (!o?.pageId || o.diagram) continue;
        const key = o.pageId + JSON.stringify(o.rect);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ s: o });
        if (items.length >= 3) break;
      }
      return items;
    };
    order.forEach(({ s, t }, k) => {
      if (report.scenes >= 2 || t - last < 90 || k === 0 || beats[k] !== prof.scene!.beat || !s.pageId || !s.auto || s.duration < 2.4) return;
      const items = panelsAround(k);
      if (items.length < 2) return;
      if (prof.scene!.kind === 'tiers') items.sort((a, b) => order.findIndex((o) => o.s === a.s) - order.findIndex((o) => o.s === b.s));
      s.diagram = {
        kind: prof.scene!.kind, title: '', links: [],
        items: items.map(({ s: o }, i) => ({ id: `d3_${s.id}_${i}`, label: o.nameTag ?? o.chars?.[0] ?? '', sub: '', pageId: o.pageId!, rect: o.rect })),
      };
      s.pageId = null;
      s.layout = 'full';
      s.shake = 0;
      s.why = `${BEAT_FR[beats[k]]} → scène 3D « ${prof.scene!.kind} » avec les cases voisines`;
      last = t;
      report.scenes++;
    });
  }
  return { shots: out, report };
}

/** project-wide settings of a profile: look, sound budget, text style */
export function applyProfileLook(p: Project, prof: Profile): Project {
  return {
    ...p,
    direction: { profile: prof.id },
    look: { ...p.look, ...prof.look, handheld: prof.camera.handheld },
    autoSfx: { on: p.autoSfx?.on ?? true, volume: prof.sound.volume, perMin: prof.sound.perMin },
  };
}
