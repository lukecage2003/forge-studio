import type { CaptionAnim, CaptionPreset, Motion, Project, Rect, Shot, Transition } from '../types';
import { FORMATS } from '../types';
import { clamp, uid } from '../lib/util';
import { detectPanels } from './detect';
import { detectBeats } from './beats';
import { ensureMedia, getAudio, getImage } from './media';
import { newShot } from '../store';
import { resolveMotion } from './render';

/**
 * Auto-montage: turns a set of pages (+ optional music / voice-over) into a
 * finished edit — cuts, camera moves, pacing, transitions, beat-sync, mix.
 */

export type AutoStyle = 'dynamic' | 'cinematic' | 'manga';
export type AutoLength = 'auto' | 'voice' | 15 | 30 | 60 | 90 | 180;

export interface AutoOptions {
  style: AutoStyle;
  length: AutoLength;
  hook: string;
  redetect: boolean;
  beatSync: boolean;
  captionStyle: boolean;
}

export const STYLES: Record<AutoStyle, {
  label: string; desc: string;
  base: number; min: number; max: number;
  intensity: number; glide: number; pageTr: Transition; pageTrDur: number;
  splashTr: Transition; splashShake: number;
  preset: CaptionPreset; anim: CaptionAnim; beatEvery: number; rtl?: boolean;
}> = {
  dynamic: {
    label: 'Dynamique', desc: 'TikTok / Shorts — rythme serré, coupes sur le beat, sous-titres mot à mot.',
    base: 1.7, min: 0.9, max: 3.4, intensity: 0.8, glide: 0.38, pageTr: 'whip', pageTrDur: 0.32,
    splashTr: 'flash', splashShake: 0.7, preset: 'tiktok', anim: 'words', beatEvery: 2,
  },
  cinematic: {
    label: 'Cinématique', desc: 'YouTube — mouvements lents, fondus, place à la lecture et à la narration.',
    base: 3.4, min: 2, max: 7, intensity: 0.45, glide: 0.8, pageTr: 'fade', pageTrDur: 0.7,
    splashTr: 'zoom', splashShake: 0, preset: 'cinema', anim: 'type', beatEvery: 4,
  },
  manga: {
    label: 'Manga', desc: 'Lecture de droite à gauche, impacts, flashs et cadrages nerveux.',
    base: 2.1, min: 1, max: 4.2, intensity: 0.7, glide: 0.42, pageTr: 'slide', pageTrDur: 0.4,
    splashTr: 'flash', splashShake: 0.85, preset: 'comic', anim: 'pop', beatEvery: 2, rtl: true,
  },
};

export interface AutoReport {
  shots: number;
  pages: number;
  duration: number;
  bpm: number | null;
  followedVoice: boolean;
  notes: string[];
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
      const g = Math.abs(L(i + 1) - L(i - 1)) + Math.abs(L(i + w) - L(i - w));
      if (g > 60) edges++;
      if (L(i) > 235) white++;
    }
  }
  const n = (w - 2) * (h - 2);
  return clamp((edges / n) * 2.2 + (white / n) * 0.9, 0, 1.5);
}

export async function autoMontage(p: Project, o: AutoOptions): Promise<{ project: Project; report: AutoReport }> {
  const st = STYLES[o.style];
  const notes: string[] = [];
  await Promise.all([
    ...p.pages.map((pg) => ensureMedia(pg.mediaId, 'image')),
    ...p.audio.map((a) => ensureMedia(a.mediaId, 'audio')),
  ]);
  const readingOrder = st.rtl ? 'rtl' : o.style === 'manga' ? 'rtl' : p.readingOrder;
  let proj: Project = { ...p, readingOrder };
  const { w: FW, h: FH } = FORMATS[p.format];
  const aspect = FW / FH;

  /* 1. cuts — keep the user's own cuts unless asked to redo them */
  const titleCards = proj.shots.filter((s) => s.pageId == null && !s.id.startsWith('hook_'));
  const kept = new Map<string, Shot[]>();
  for (const s of proj.shots) if (s.pageId) kept.set(s.pageId, [...(kept.get(s.pageId) ?? []), s]);
  const shots: Shot[] = [];
  for (const pg of proj.pages) {
    const a = getImage(pg.mediaId);
    if (!a) continue;
    let list = o.redetect ? [] : kept.get(pg.id) ?? [];
    if (!list.length) {
      const old = kept.get(pg.id) ?? [];
      list = detectPanels(a.img, a.width, a.height, readingOrder === 'rtl').map((rect, i) =>
        newShot(proj, { pageId: pg.id, rect, caption: old[i]?.caption ?? { text: '', ...proj.defaultCaption } }));
    }
    shots.push(...list.map((s) => ({ ...s })));
  }
  if (!shots.length && !titleCards.length) throw new Error('Importe au moins une planche avant de lancer le montage auto.');

  /* 2. per-shot weight → raw duration */
  const weights = shots.map((s) => {
    const pg = proj.pages.find((x) => x.id === s.pageId)!;
    const a = getImage(pg.mediaId)!;
    const area = (s.rect.w * s.rect.h) / (pg.width * pg.height);
    const load = panelLoad(a.img, s.rect);
    const pan = resolveMotion({ ...s, motion: 'auto' }, aspect, readingOrder === 'rtl').motion.startsWith('pan');
    let w = 0.65 + load * 0.9 + Math.sqrt(area) * 0.6;
    if (pan) w *= 1.3;
    return { w, area, pan };
  });
  const minRead = (s: Shot) => {
    const words = s.caption.text.trim().split(/\s+/).filter(Boolean).length;
    return words ? 0.6 + words * 0.32 : 0;
  };

  /* 3. target length */
  const voices = proj.audio.filter((c) => c.kind === 'voice');
  const voiceEnd = voices.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const hookDur = o.hook.trim() ? (o.style === 'cinematic' ? 2.6 : 1.6) : 0;
  const titleDur = titleCards.reduce((a, s) => a + s.duration, 0);
  let target: number | null = null;
  let followedVoice = false;
  if ((o.length === 'voice' || o.length === 'auto') && voiceEnd > 0) {
    target = voiceEnd + 0.8;
    followedVoice = true;
    // never squeeze panels below what the eye can read
    const floor = shots.length * st.min * 0.85 + hookDur + titleDur;
    if (target < floor) {
      target = floor;
      notes.push('Voix off courte pour autant de cases : la vidéo dure plus longtemps que la narration.');
    }
  } else if (typeof o.length === 'number') target = o.length;
  if (o.length === 'voice' && !voiceEnd) notes.push('Pas de voix off : durée calculée automatiquement.');

  let durs = weights.map((x) => st.base * x.w);
  if (target) {
    const avail = Math.max(shots.length * 0.6, target - hookDur - titleDur);
    const sum = durs.reduce((a, b) => a + b, 0);
    const k = avail / sum;
    durs = durs.map((d) => d * k);
    const lo = Math.min(st.min, avail / shots.length), hi = Math.max(st.max, avail / shots.length * 1.6);
    durs = durs.map((d, i) => clamp(Math.max(d, minRead(shots[i])), lo * 0.75, hi));
    // re-normalise after clamping so we land on the target
    const s2 = durs.reduce((a, b) => a + b, 0);
    durs = durs.map((d) => d * (avail / s2));
    if (avail / shots.length < 0.8) notes.push('Beaucoup de cases pour la durée choisie : rythme très rapide.');
  } else {
    durs = durs.map((d, i) => clamp(Math.max(d, minRead(shots[i])), st.min, st.max));
  }

  /* 4. motion, transitions, captions */
  let zoomFlip = false;
  shots.forEach((s, i) => {
    const prev = shots[i - 1];
    const { area, pan } = weights[i];
    const splash = area > 0.42;
    let motion: Motion = 'auto';
    if (!pan) {
      motion = splash ? 'zoom-out' : zoomFlip ? 'zoom-out' : 'zoom-in';
      zoomFlip = !zoomFlip;
    }
    let tr: Transition; let td: number;
    if (i === 0 && !hookDur && !titleCards.length) { tr = 'cut'; td = 0; }
    else if (splash && st.splashTr) { tr = st.splashTr; td = st.splashTr === 'flash' ? 0.3 : 0.5; }
    else if (prev && prev.pageId === s.pageId) { tr = 'glide'; td = st.glide; }
    else { tr = st.pageTr; td = st.pageTrDur; }
    s.motion = motion;
    s.framing = 'fit';
    s.intensity = splash ? Math.min(1, st.intensity + 0.15) : st.intensity;
    s.transition = tr;
    s.transitionDur = Math.min(td, durs[i] * 0.45);
    s.shake = splash ? st.splashShake : 0;
    s.duration = +durs[i].toFixed(3);
    if (o.captionStyle) s.caption = { ...s.caption, preset: st.preset, anim: st.anim };
  });

  /* 5. hook title card */
  const lead: Shot[] = [...titleCards];
  if (hookDur) {
    lead.unshift({
      ...newShot(proj, { pageId: null }), id: 'hook_' + uid(), duration: hookDur, transition: 'cut', transitionDur: 0,
      caption: { text: o.hook.trim(), preset: o.style === 'cinematic' ? 'cinema' : 'impact', anim: 'pop', y: 0.5, size: 1 },
      titleBg: '#0B0B0D', shake: o.style === 'cinematic' ? 0 : 0.4,
    });
  }
  let all = [...lead, ...shots];
  if (all.length > 1 && lead.length && shots[0]) shots[0].transition = o.style === 'cinematic' ? 'fade' : 'zoom';

  /* 6. beat sync on the first music clip */
  let bpm: number | null = null;
  const music = proj.audio.find((c) => c.kind === 'music');
  const musicBuf = music && getAudio(music.mediaId);
  if (o.beatSync && music && musicBuf && !followedVoice) {
    const grid = detectBeats(musicBuf, music.offset, Math.min(musicBuf.duration, music.offset + 600));
    if (grid && grid.confidence > 1.15) {
      bpm = Math.round(grid.bpm);
      // snap every cut to the nearest beat; a shot lasts at least `beatEvery` beats
      let step = 60 / grid.bpm;
      while (step < 0.3) step *= 2;
      const minLen = step * st.beatEvery;
      // timeline time of beats (music placed at 0 after fit)
      const first = grid.offset - music.offset;
      let t = 0;
      all = all.map((s) => {
        const end = t + s.duration;
        const k = Math.max(1, Math.round((end - first) / step));
        let snapped = first + k * step;
        while (snapped - t < minLen - 1e-6) snapped += step;
        const d = snapped - t;
        t = snapped;
        return { ...s, duration: +d.toFixed(3), transitionDur: Math.min(s.transitionDur, d * 0.45) };
      });
    } else notes.push('Tempo de la musique peu marqué : pas de calage sur le beat.');
  }

  proj = { ...proj, shots: all };
  const total = all.reduce((a, s) => a + s.duration, 0);

  /* 7. mix: music fitted to the edit, ducked under the voice */
  proj = {
    ...proj,
    ducking: voices.length > 0 ? true : proj.ducking,
    audio: proj.audio.map((c) =>
      c.kind === 'music'
        ? { ...c, start: 0, duration: Math.min(c.sourceDuration - c.offset, total), fadeIn: 0.3, fadeOut: Math.min(2, total * 0.1) }
        : c),
  };
  if (music && musicBuf && music.sourceDuration - music.offset < total - 0.5) notes.push('La musique est plus courte que la vidéo.');
  if (o.style === 'manga' && p.readingOrder !== 'rtl') notes.push('Sens de lecture passé en manga (droite → gauche).');

  return {
    project: proj,
    report: { shots: shots.length, pages: proj.pages.length, duration: total, bpm, followedVoice, notes },
  };
}
