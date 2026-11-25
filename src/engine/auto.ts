import type { CaptionAnim, CaptionPreset, Layout, Motion, Project, Rect, Shot, Subtitle, Transition, Word } from '../types';
import { FORMATS } from '../types';
import { clamp, uid } from '../lib/util';
import { cutPage } from './detect';
import { detectBeats } from './beats';
import { ensureMedia, getAudio, getImage } from './media';
import { newShot } from '../store';
import { resolveMotion } from './render';
import { segmentsOf } from './timeline';
import { isFiller, keptShare, toTimeline, segsDuration, type Seg } from './speech';
import { validateProject } from './validate';
import type { FxItem } from '../types';
import { faceMult, intensityMult, noteMontage, paceMult, pickLayout, preferredMotion } from './brain';

/**
 * Auto editor. Two modes:
 *  - comics only: pages → paced sequence of camera moves, beat-synced
 *  - face cam + comics: the rough-cut rush is the spine, panels are laid over
 *    it in blocks that start and end on jump cuts / sentence ends, with a mix
 *    of layouts (full, split, bubble, multi-panel, whole page).
 */

export type AutoStyle = 'explainer' | 'energetic' | 'dynamic' | 'cinematic' | 'manga';
export type AutoLength = 'auto' | 'voice' | 15 | 30 | 60 | 90 | 180;

export interface AutoOptions {
  style: AutoStyle;
  length: AutoLength;
  hook: string;
  redetect: boolean;
  beatSync: boolean;
  captionStyle: boolean;
  subtitles: boolean;
  /** panelId → sentence index (from Gemini), optional */
  matches?: Record<string, number>;
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
}

export const STYLES: Record<AutoStyle, StyleDef> = {
  explainer: {
    label: 'Explication', desc: 'Format « comics expliqués » : cases plein écran, page entière, visage en ouverture et en relance.',
    face: true, base: 3.6, min: 2.2, max: 8, intensity: 0.5, glide: 0.75, pageTr: 'fade', pageTrDur: 0.5,
    splashTr: 'zoom', splashShake: 0, preset: 'clean', anim: 'words', beatEvery: 4,
    soloLayouts: [['full', 6], ['page', 1.2], ['grid', 0.8]],
    faceLayouts: [['full', 6], ['page', 1.3], ['pip', 1.2], ['grid', 0.8], ['split', 0.3]],
    hook: 3, faceDur: [2.2, 3.5], block: [12, 22], enterTr: 'fade', punchIn: 0.45, drift: 0.4, maxWords: 6,
  },
  energetic: {
    label: 'Énergique', desc: 'Face caméra très présente, zooms de coupe, écrans partagés, bulles et multi-cases.',
    face: true, base: 2.2, min: 1.2, max: 4.5, intensity: 0.8, glide: 0.4, pageTr: 'whip', pageTrDur: 0.28,
    splashTr: 'flash', splashShake: 0.75, preset: 'tiktok', anim: 'words', beatEvery: 2,
    soloLayouts: [['full', 5], ['grid', 1.5], ['page', 0.6]],
    faceLayouts: [['split', 3], ['pip', 2.2], ['full', 2.4], ['grid', 1.2], ['page', 0.6]],
    hook: 2.2, faceDur: [1.8, 3.6], block: [4, 8], enterTr: 'zoom', punchIn: 0.95, drift: 0.5, maxWords: 3,
  },
  dynamic: {
    label: 'Dynamique', desc: 'TikTok / Shorts sans visage : rythme serré, coupes sur le beat, sous-titres mot à mot.',
    face: false, base: 1.7, min: 0.9, max: 3.4, intensity: 0.8, glide: 0.38, pageTr: 'whip', pageTrDur: 0.32,
    splashTr: 'flash', splashShake: 0.7, preset: 'tiktok', anim: 'words', beatEvery: 2,
    soloLayouts: [['full', 6], ['grid', 1]], faceLayouts: [['full', 1]],
    hook: 2, faceDur: [2, 3], block: [5, 8], enterTr: 'whip', punchIn: 0.8, drift: 0.4, maxWords: 3,
  },
  cinematic: {
    label: 'Cinématique', desc: 'YouTube sans visage : mouvements lents, fondus, place à la lecture et à la narration.',
    face: false, base: 3.4, min: 2, max: 7, intensity: 0.45, glide: 0.8, pageTr: 'fade', pageTrDur: 0.7,
    splashTr: 'zoom', splashShake: 0, preset: 'cinema', anim: 'type', beatEvery: 4,
    soloLayouts: [['full', 6], ['page', 1]], faceLayouts: [['full', 1]],
    hook: 3, faceDur: [2.5, 3.5], block: [12, 20], enterTr: 'fade', punchIn: 0.3, drift: 0.3, maxWords: 7,
  },
  manga: {
    label: 'Manga', desc: 'Lecture de droite à gauche, impacts, flashs et cadrages nerveux.',
    face: false, base: 2.1, min: 1, max: 4.2, intensity: 0.7, glide: 0.42, pageTr: 'slide', pageTrDur: 0.4,
    splashTr: 'flash', splashShake: 0.85, preset: 'comic', anim: 'pop', beatEvery: 2, rtl: true,
    soloLayouts: [['full', 5], ['grid', 1.4]], faceLayouts: [['full', 3], ['split', 2], ['pip', 1]],
    hook: 2, faceDur: [2, 3], block: [5, 9], enterTr: 'flash', punchIn: 0.9, drift: 0.4, maxWords: 3,
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

/** Transcript words placed on the edited timeline (cut words removed). */
export function timelineWords(p: Project): Word[] {
  const ar = p.aroll;
  if (!ar) return [];
  const segs = segmentsOf(ar);
  const out: Word[] = [];
  for (const w of ar.words) {
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
    if (cur.length && (cur.length >= maxWords || (prev && w.s - prev.e > 0.4) || /[.!?…,;:]$/.test(prev?.w ?? ''))) flush();
    cur.push(w);
  });
  flush();
  // hold each subtitle until the next one (max +0.5 s) so text doesn't flicker
  for (let i = 0; i < subs.length; i++) {
    const next = subs[i + 1];
    subs[i].e = next ? Math.min(next.s, subs[i].e + 0.5) : subs[i].e + 0.5;
  }
  return subs;
}

/* --------------------------------------------------------------- main */

interface Panel { shot: Shot; w: number; area: number; pan: boolean; splash: boolean; cover?: string }

export async function autoMontage(p: Project, o: AutoOptions): Promise<{ project: Project; report: AutoReport }> {
  const st = STYLES[o.style];
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
      const cut = cutPage(a.img, a.width, a.height, readingOrder === 'rtl');
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
    return { shot: s, w, area, pan, splash: s.zone === 'splash' || (area > 0.42 && s.zone !== 'zones'), cover };
  });

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
    return {
      ...s,
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

  if (hasFace) {
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
        else { tr = st.pageTr === 'fade' ? 'slide' : st.pageTr; td = st.pageTrDur; }
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
    if (followedVoice) {
      const floor = list.length * st.min * 0.85 + hookDur + titleDur;
      if (target! < floor) {
        target = floor;
        notes.push('Voix off courte pour autant de cases : la vidéo dure plus longtemps que la narration.');
      }
    }
    if (o.length === 'voice' && !voiceEnd) notes.push('Pas de voix off : durée calculée automatiquement.');

    let durs = list.map((x) => st.base * x.w * pace * (x.shot.group ? 1 + x.shot.group.length * 0.5 : 1));
    if (target) {
      const avail = Math.max(list.length * 0.6, target - hookDur - titleDur);
      const k = avail / durs.reduce((a, b) => a + b, 0);
      durs = durs.map((d) => d * k);
      const lo = Math.min(st.min, avail / list.length), hi = Math.max(st.max, (avail / list.length) * 1.6);
      durs = durs.map((d, i) => clamp(Math.max(d, minRead(list[i].shot)), lo * 0.75, hi));
      const s2 = durs.reduce((a, b) => a + b, 0);
      durs = durs.map((d) => d * (avail / s2));
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
      else { tr = st.pageTr; td = st.pageTrDur; }
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

  /* mix: music fitted to the edit, ducked under the voice */
  const music = proj.audio.find((c) => c.kind === 'music');
  proj = {
    ...proj,
    ducking: hasFace || proj.audio.some((c) => c.kind === 'voice') ? true : proj.ducking,
    audio: proj.audio.map((c) =>
      c.kind === 'music' ? { ...c, start: 0, duration: Math.min(c.sourceDuration - c.offset, total), fadeIn: 0.3, fadeOut: Math.min(2, total * 0.1) } : c),
  };
  if (music && music.sourceDuration - music.offset < total - 0.5) notes.push('La musique est plus courte que la vidéo.');
  if (st.rtl && p.readingOrder !== 'rtl') notes.push('Sens de lecture passé en manga (droite → gauche).');
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
