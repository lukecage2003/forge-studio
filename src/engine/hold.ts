import type { Shot } from '../types';
import type { SeqType } from './director';

/**
 * VISUAL HOLD INTELLIGENCE
 *
 * How long an image must stay so the viewer understands it, from what is in
 * it (balloons to read, details, art density, a full-page splash), what it is
 * for (a revelation is held longer than a passing context shot) and the
 * project's own ranges (starting points the user can change). Never a
 * universal duration: every image gets its own min / ideal / max and a reason.
 *
 * When the voice keeps an important image on screen longer than one framing
 * can sustain, the image is not swapped for another: it is explored in
 * stages (wide, push in, detail, pan, back to wide) — see the 'tour' camera.
 */

export type HoldKind = 'simple' | 'panel' | 'page' | 'reveal';
export const HOLD_KIND_FR: Record<HoldKind, string> = { simple: 'image simple', panel: 'case avec du texte', page: 'planche détaillée', reveal: 'révélation' };
export type HoldRanges = Record<HoldKind, readonly [number, number]>;
/** the brief's starting points, seconds */
export const HOLD_DEFAULT: HoldRanges = { simple: [2, 3], panel: [4, 6], page: [6, 9], reveal: [5, 8] };

export interface Hold {
  kind: HoldKind;
  /** points of interest: balloons, figures, a busy drawing */
  details: number;
  /** reading time of its text alone (s) */
  reading: number;
  min: number;
  ideal: number;
  max: number;
  /** how many camera stages the image can carry (1 = one framing) */
  stages: number;
  why: string;
}

export interface HoldContext {
  seq?: SeqType;
  /** art density 0..1.5 (edges + balloon white), from the auto editor */
  density?: number;
  ranges?: Partial<HoldRanges>;
  /** pace of the edit (1 = the ranges as given; a TikTok explainer runs ≈ 0.5) */
  pace?: number;
  /** a voice tells the story: the viewer listens and looks, reading the balloons matters much less */
  narrated?: boolean;
}

const CPS = 15; // characters read per second on a phone, comfortably

export function holdFor(s: Shot, ctx: HoldContext = {}): Hold {
  const R = { ...HOLD_DEFAULT, ...ctx.ranges };
  const pace = ctx.pace ?? 1;
  const balloons = s.balloons?.length ?? 0;
  const text = (s.text ?? '').replace(/\s+/g, ' ').trim();
  const reading = (text ? text.length / CPS : balloons * 1.1) * (ctx.narrated ? 0.35 : 1);
  const busy = (ctx.density ?? 0.5) > 0.75 ? 1 : 0;
  const details = balloons + busy + (s.chars?.length ?? 0);
  const kind: HoldKind = s.layout === 'page' || s.zone === 'zones' ? 'page'
    : s.zone === 'splash' || ctx.seq === 'revelation' ? 'reveal'
    : balloons >= 2 || reading > 2.5 ? 'panel' : 'simple';
  const [lo, hi] = R[kind];
  // the text decides the floor when it needs more time than the range gives
  const min = Math.max(lo * pace, Math.min(reading * 0.8, hi * 1.5));
  const max = Math.max(min + 0.5, hi * pace * (1 + 0.12 * Math.min(4, details)));
  const ideal = Math.min(max, Math.max(min, (lo + hi) / 2 * pace + reading * 0.25));
  // one framing holds ~3–4 s; each extra point of interest is worth another stage
  const stages = Math.max(1, Math.min(4, Math.round(Math.min(max, ideal * 1.4) / 3.2), 1 + details));
  const parts = [HOLD_KIND_FR[kind], balloons ? `${balloons} bulle${balloons > 1 ? 's' : ''}` : '', busy ? 'dessin chargé' : '', reading > 1 ? `${reading.toFixed(1)} s de lecture` : ''].filter(Boolean);
  return { kind, details, reading: +reading.toFixed(2), min: +min.toFixed(2), ideal: +ideal.toFixed(2), max: +max.toFixed(2), stages, why: parts.join(', ') };
}

/** an image worth keeping on screen rather than replacing (story-mode decision) */
export const important = (h: Hold) => h.kind === 'reveal' || h.kind === 'page' || h.details >= 3;
