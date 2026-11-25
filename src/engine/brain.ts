import type { Cut, Layout, Motion, RoughCutSettings, Shot } from '../types';

/**
 * Forge Brain — learns the editor's taste from their corrections.
 *
 * Every time an automatic decision is changed by hand (a duration, a layout,
 * a camera move, a cut that is restored or added), the preference is updated
 * with an exponential moving average. The next auto edit starts from these
 * learned preferences. Everything stays in this browser.
 */

export interface BrainState {
  v: 1;
  edits: number; // corrections observed
  montages: number; // auto edits generated
  pace: Record<string, { mult: number; n: number }>; // duration multiplier per style
  layouts: Record<Layout, number>; // relative preference
  motions: Record<string, number>;
  intensity: { mult: number; n: number };
  silence: { minSilenceBias: number; paddingBias: number; n: number };
  hesitation: { bias: number; n: number }; // >0 = cut more, <0 = cut less
  retake: { bias: number; n: number };
  facePresence: { mult: number; n: number }; // >1 = more face time
}

const KEY = 'forge.brain';
const fresh = (): BrainState => ({
  v: 1, edits: 0, montages: 0, pace: {},
  layouts: { full: 1, split: 1, pip: 1, grid: 1, page: 1 },
  motions: {}, intensity: { mult: 1, n: 0 },
  silence: { minSilenceBias: 0, paddingBias: 0, n: 0 },
  hesitation: { bias: 0, n: 0 }, retake: { bias: 0, n: 0 },
  facePresence: { mult: 1, n: 0 },
});

let state: BrainState = load();
const subs = new Set<() => void>();

function load(): BrainState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s?.v === 1 ? { ...fresh(), ...s } : fresh();
  } catch {
    return fresh();
  }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}
export const onBrain = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const brain = () => state;
export function resetBrain() { state = fresh(); save(); }

const ema = (old: number, val: number, n: number) => {
  const a = Math.max(0.12, 1 / (n + 2)); // learns fast at first, then stabilises
  return old * (1 - a) + val * a;
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------- observe */

export function observeShotEdit(shot: Shot, patch: Partial<Shot>) {
  const a = shot.auto;
  if (!a) return;
  let changed = false;
  if (patch.duration != null && a.duration > 0) {
    const p = (state.pace[a.style] ??= { mult: 1, n: 0 });
    p.mult = clamp(ema(p.mult, clamp(patch.duration / a.duration, 0.4, 2.5) * p.mult, p.n), 0.5, 2);
    p.n++;
    changed = true;
  }
  if (patch.layout && patch.layout !== shot.layout) {
    state.layouts[shot.layout] = clamp(state.layouts[shot.layout] * 0.88, 0.15, 4);
    state.layouts[patch.layout] = clamp(state.layouts[patch.layout] * 1.15, 0.15, 4);
    changed = true;
  }
  if (patch.motion && patch.motion !== shot.motion) {
    state.motions[shot.motion] = clamp((state.motions[shot.motion] ?? 1) * 0.9, 0.2, 3);
    state.motions[patch.motion] = clamp((state.motions[patch.motion] ?? 1) * 1.12, 0.2, 3);
    changed = true;
  }
  if (patch.intensity != null) {
    state.intensity.mult = clamp(ema(state.intensity.mult, state.intensity.mult * (patch.intensity / Math.max(0.05, shot.intensity)), state.intensity.n), 0.3, 1.6);
    state.intensity.n++;
    changed = true;
  }
  if (changed) { state.edits++; save(); }
}

export function observeShotDeleted(shot: Shot) {
  if (!shot.auto) return;
  // deleting comic shots over the face = wants more face time
  state.facePresence.mult = clamp(state.facePresence.mult * 1.04, 0.5, 2);
  state.facePresence.n++;
  state.edits++;
  save();
}

export function observeCutToggle(cut: Cut, on: boolean) {
  if (cut.reason === 'manual') return;
  const dir = on ? 1 : -1; // +1 user wants this cut, -1 user restored the audio
  if (cut.reason === 'silence') {
    if (!on) {
      state.silence.minSilenceBias = clamp(state.silence.minSilenceBias + 0.04, -0.2, 0.5);
      state.silence.paddingBias = clamp(state.silence.paddingBias + 0.01, -0.05, 0.12);
    } else {
      state.silence.minSilenceBias = clamp(state.silence.minSilenceBias - 0.02, -0.2, 0.5);
    }
    state.silence.n++;
  } else if (cut.reason === 'hesitation' || cut.reason === 'filler') {
    state.hesitation.bias = clamp(state.hesitation.bias + dir * 0.05, -0.3, 0.3);
    state.hesitation.n++;
  } else if (cut.reason === 'retake') {
    state.retake.bias = clamp(state.retake.bias + dir * 0.1, -0.5, 0.5);
    state.retake.n++;
  }
  state.edits++;
  save();
}

export function observeManualCut(len: number) {
  // a hand-made cut on a short pause: the editor likes it tighter
  if (len < 0.8) {
    state.silence.minSilenceBias = clamp(state.silence.minSilenceBias - 0.03, -0.2, 0.5);
    state.silence.paddingBias = clamp(state.silence.paddingBias - 0.005, -0.05, 0.12);
  }
  state.edits++;
  save();
}

export function noteMontage() { state.montages++; save(); }

/* ------------------------------------------------------------ apply */

export const paceMult = (style: string) => state.pace[style]?.mult ?? 1;
export const intensityMult = () => state.intensity.mult;
export const faceMult = () => state.facePresence.mult;
export const hesitationBias = () => state.hesitation.bias;
export const retakeBias = () => state.retake.bias;

export function tuneRoughCut(s: RoughCutSettings): RoughCutSettings {
  return {
    ...s,
    minSilence: clamp(s.minSilence + state.silence.minSilenceBias, 0.15, 1.5),
    padding: clamp(s.padding + state.silence.paddingBias, 0.02, 0.3),
  };
}

/** pick among allowed layouts, weighted by base weights × learned preference */
export function pickLayout(options: [Layout, number][], rnd: number): Layout {
  const w = options.map(([l, b]) => [l, b * (state.layouts[l] ?? 1)] as const);
  const sum = w.reduce((a, [, v]) => a + v, 0);
  let r = rnd * sum;
  for (const [l, v] of w) { r -= v; if (r <= 0) return l; }
  return w[w.length - 1][0];
}

export function preferredMotion(m: Motion): Motion {
  // if the editor keeps replacing a move, prefer the one they use instead
  const own = state.motions[m] ?? 1;
  if (own >= 0.6) return m;
  const best = Object.entries(state.motions).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 1.1 ? (best[0] as Motion) : m;
}

/** human-readable summary for the settings panel */
export function brainSummary(): string[] {
  const s = state, out: string[] = [];
  for (const [k, v] of Object.entries(s.pace)) {
    if (Math.abs(v.mult - 1) > 0.05) out.push(`Style ${k} : plans ${v.mult > 1 ? 'plus longs' : 'plus courts'} de ${Math.round(Math.abs(v.mult - 1) * 100)} %`);
  }
  const lay = Object.entries(s.layouts).sort((a, b) => b[1] - a[1]);
  if (lay[0][1] > 1.1) out.push(`Mise en page préférée : ${LAYOUT_FR[lay[0][0] as Layout]}`);
  if (lay[lay.length - 1][1] < 0.85) out.push(`Mise en page évitée : ${LAYOUT_FR[lay[lay.length - 1][0] as Layout]}`);
  if (Math.abs(s.silence.minSilenceBias) > 0.02) out.push(`Silences : coupe à partir de ${s.silence.minSilenceBias > 0 ? '+' : ''}${Math.round(s.silence.minSilenceBias * 1000)} ms par rapport au réglage`);
  if (Math.abs(s.hesitation.bias) > 0.04) out.push(`Hésitations : coupe ${s.hesitation.bias > 0 ? 'plus' : 'moins'} agressive`);
  if (Math.abs(s.retake.bias) > 0.05) out.push(`Reprises : ${s.retake.bias > 0 ? 'coupées plus souvent' : 'gardées plus souvent'}`);
  if (Math.abs(s.intensity.mult - 1) > 0.08) out.push(`Mouvements de caméra ${s.intensity.mult > 1 ? 'plus marqués' : 'plus doux'}`);
  if (Math.abs(s.facePresence.mult - 1) > 0.05) out.push(`${s.facePresence.mult > 1 ? 'Plus' : 'Moins'} de temps face caméra`);
  return out;
}

export const LAYOUT_FR: Record<Layout, string> = {
  full: 'Plein écran', split: 'Écran partagé', pip: 'Bulle visage', grid: 'Multi-cases', page: 'Page entière',
};
