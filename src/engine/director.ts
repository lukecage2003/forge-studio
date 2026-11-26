import type { Motion, Shot, Transition } from '../types';
import { beatOf, type Beat } from './narrative';
import { roleOf, type Role } from './scriptIntel';
import { TRANSITION } from './effects';
import { hashSeed } from './rng';
import { holdFor, important } from './hold';
import { executeCamera, type PageInfo } from './comicCamera';
import { syncPath } from './camerapath';

/* ------------------------------------------------------------ motion matching */

const LATERAL: Transition[] = ['whip', 'slide', 'smear', 'warp'];
const LOUD: Transition[] = ['impact', 'flash', 'whip', 'smear', 'glitch', 'glitchdisplace', 'warpspeed', 'gravitylens', 'crosszoom'];
const panSign = (m: Motion) => (m === 'pan-right' ? 1 : m === 'pan-left' ? -1 : 0);
const still = (m: Motion) => m === 'static';

/**
 * Does this transition fight the movement around it? Returns the reason, or null.
 * Movement cuts read best when the motion carries through the cut; a lateral
 * whip between two pans going opposite ways, a whoosh between two still
 * images, a zoom transition out of a pull-back, a loud effect between two
 * calm shots outside a fight: the eye feels the jolt without a reason.
 */
export function motionClash(prev: Shot, next: Shot, tr: Transition, seq?: SeqType): string | null {
  if (tr === 'cut' || tr === 'glide') return null;
  const a = prev.motion, b = next.motion;
  if (LATERAL.includes(tr) && panSign(a) && panSign(b) && panSign(a) !== panSign(b)) return 'panoramiques en sens contraire de part et d’autre';
  if (LATERAL.includes(tr) && still(a) && still(b) && seq !== 'confrontation') return 'effet de vitesse entre deux images immobiles';
  if ((tr === 'zoom' || tr === 'crosszoom') && a === 'zoom-out') return 'zoom avant juste après un recul';
  if (LOUD.includes(tr) && prev.intensity < 0.4 && next.intensity < 0.4 && seq !== 'confrontation' && seq !== 'revelation') return 'effet spectaculaire entre deux plans calmes';
  return null;
}

/**
 * FORGE CREATIVE DIRECTOR
 *
 * Thinks in sequences, not effects. The edit is split into editorial
 * sequences (introduction, character, context, explanation, demonstration,
 * comparison, confrontation, revelation, conclusion) from what is SAID. Each
 * sequence gets a visual treatment chosen for its content (wide panels, talky
 * panels, splash pages…) and different from the treatment just used, then:
 *  - a camera grammar: how the camera moves shot after shot in that sequence;
 *  - a transition diversity manager: entries of sequences are marked, inside
 *    a sequence cuts and camera glides carry the flow, no transition is
 *    reused within a short window, no zoom-into-zoom, a cut when a
 *    transition adds nothing.
 * Every decision is written in `shot.why` (live view, report). Nothing is
 * random: choices follow the content, then the memory of what was used.
 * Only shots the auto editor made (`shot.auto`) and never edited by hand are
 * touched; the user's own choices always win.
 */

export type SeqType = 'introduction' | 'personnage' | 'contexte' | 'explication' | 'demonstration' | 'comparaison' | 'confrontation' | 'revelation' | 'conclusion';
export const SEQ_FR: Record<SeqType, string> = {
  introduction: 'Introduction', personnage: 'Présentation de personnage', contexte: 'Contexte historique', explication: 'Explication',
  demonstration: 'Démonstration', comparaison: 'Comparaison', confrontation: 'Confrontation', revelation: 'Révélation', conclusion: 'Conclusion',
};

export type CameraGrammar =
  | 'push' // slow push-ins toward the point of interest
  | 'pullback' // start close, open up (context, aftermath)
  | 'counterpoint' // push-in / pull-out alternated: a dialogue between images
  | 'reading' // follow the reading: balloons, then along wide panels
  | 'hold' // cinematic hold: still, or the slowest drift
  | 'tracking'; // lateral travel along the art

export interface Treatment {
  id: string;
  label: string;
  /** what it is good at, to choose it for the right content */
  fits: { wide?: number; talky?: number; splash?: number; many?: number; few?: number };
  camera: CameraGrammar;
  /** camera strength (0..1) */
  intensity: number;
  /** how a sequence with this treatment starts, by preference (first that fits and is not worn out) */
  enter: Transition[];
  /** inside the sequence: cuts and same-page glides, rarely more */
  inside: Transition[];
}

const T = (t: Treatment) => t;
export const TREATMENTS: Record<SeqType, Treatment[]> = {
  introduction: [
    T({ id: 'intro-reveal', label: 'Révélation progressive', fits: { splash: 2, few: 1 }, camera: 'pullback', intensity: 0.6, enter: ['cut'], inside: ['cut', 'glide'] }),
    T({ id: 'intro-punch', label: 'Entrée directe', fits: { many: 1, talky: 1 }, camera: 'push', intensity: 0.75, enter: ['cut'], inside: ['cut', 'glide', 'smear'] }),
  ],
  personnage: [
    T({ id: 'char-portrait', label: 'Portrait', fits: { few: 2, splash: 1 }, camera: 'push', intensity: 0.55, enter: ['inkframe', 'fade', 'iris'], inside: ['cut'] }),
    T({ id: 'char-voice', label: 'Le personnage parle', fits: { talky: 2 }, camera: 'reading', intensity: 0.5, enter: ['slash', 'wipe', 'cut'], inside: ['cut', 'glide'] }),
  ],
  contexte: [
    T({ id: 'ctx-pan', label: 'Travelling d’époque', fits: { wide: 2 }, camera: 'tracking', intensity: 0.5, enter: ['fade', 'dip', 'cut'], inside: ['cut', 'glide'] }),
    T({ id: 'ctx-open', label: 'Plan qui s’ouvre', fits: { few: 1, splash: 1 }, camera: 'pullback', intensity: 0.45, enter: ['defocus', 'fade', 'cut'], inside: ['cut'] }),
  ],
  explication: [
    T({ id: 'exp-read', label: 'Lecture guidée', fits: { talky: 2, wide: 1 }, camera: 'reading', intensity: 0.5, enter: ['cut', 'wipe'], inside: ['cut', 'glide'] }),
    T({ id: 'exp-steady', label: 'Explication posée', fits: { few: 1 }, camera: 'push', intensity: 0.35, enter: ['cut'], inside: ['cut'] }),
  ],
  demonstration: [
    T({ id: 'demo-detail', label: 'Chasse au détail', fits: { talky: 1, many: 1 }, camera: 'counterpoint', intensity: 0.6, enter: ['cut', 'slide'], inside: ['cut', 'glide'] }),
    T({ id: 'demo-sweep', label: 'Balayage', fits: { wide: 2 }, camera: 'tracking', intensity: 0.6, enter: ['wipe', 'cut'], inside: ['cut', 'glide'] }),
  ],
  comparaison: [
    T({ id: 'cmp-counter', label: 'Contrepoint', fits: { many: 1 }, camera: 'counterpoint', intensity: 0.55, enter: ['slash', 'slide', 'cut'], inside: ['cut'] }),
    T({ id: 'cmp-match', label: 'Raccord de mouvement', fits: { wide: 1, few: 1 }, camera: 'tracking', intensity: 0.5, enter: ['whip', 'cut'], inside: ['cut'] }),
  ],
  confrontation: [
    T({ id: 'fight-impact', label: 'Impacts', fits: { splash: 1, many: 1 }, camera: 'push', intensity: 0.9, enter: ['impact', 'flash', 'smear', 'whip'], inside: ['cut', 'smear', 'whip'] }),
    T({ id: 'fight-tension', label: 'Tension montante', fits: { talky: 1, few: 1 }, camera: 'counterpoint', intensity: 0.75, enter: ['slash', 'cut'], inside: ['cut'] }),
  ],
  revelation: [
    T({ id: 'rev-hold', label: 'Plan tenu', fits: { splash: 2, few: 1 }, camera: 'hold', intensity: 0.25, enter: ['dip', 'flash', 'impact', 'cut'], inside: ['cut'] }),
    T({ id: 'rev-push', label: 'Lente poussée', fits: { few: 1, talky: 1 }, camera: 'push', intensity: 0.45, enter: ['blur', 'defocus', 'zoom', 'cut'], inside: ['cut'] }),
  ],
  conclusion: [
    T({ id: 'end-open', label: 'On prend du recul', fits: { splash: 1, few: 1 }, camera: 'pullback', intensity: 0.4, enter: ['fade', 'dip', 'cut'], inside: ['cut'] }),
    T({ id: 'end-echo', label: 'Écho du début', fits: { many: 1 }, camera: 'push', intensity: 0.45, enter: ['cut', 'inkframe'], inside: ['cut', 'glide'] }),
  ],
};

/** the editorial sequence a sentence belongs to */
export function seqTypeOf(text: string, i: number, n: number): SeqType {
  const beat: Beat = beatOf(text, i);
  const role: Role = roleOf(text, i, n, beat);
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (role === 'accroche') return 'introduction';
  if (role === 'conclusion') return 'conclusion';
  if (/\b(contre|affronte|combat|bataille|se bat|guerre|attaque|duel|face a)\b/.test(t) || beat === 'action') return 'confrontation';
  if (role === 'comparaison') return 'comparaison';
  if (role === 'revelation') return 'revelation';
  if (/\b(s'appelle|c'est|voici|il est|elle est|ne sous le nom|alias|de son vrai nom)\b/.test(t) && /\p{Lu}\p{L}+/u.test(text.slice(1))) return 'personnage';
  if (role === 'exemple' || role === 'preuve') return 'demonstration';
  if (role === 'argument') return 'explication';
  if (beat === 'date' || /\b(en|depuis|annees?)\s+\d{2,4}\b|\bsiecle\b|\bguerre mondiale\b/.test(t)) return 'contexte';
  return 'explication';
}

export interface DirectorOptions { transitions: boolean; camera: boolean; sequences: boolean }
export const DIRECTOR_DEFAULT: DirectorOptions = { transitions: true, camera: true, sequences: true };

export interface SequencePlan { type: SeqType; treatment: string; label: string; from: number; to: number; start: number }
export interface DirectorReport { sequences: SequencePlan[]; changedTransitions: number; changedMotions: number; notes: string[] }

const visible = (tr: Transition) => tr !== 'cut' && tr !== 'glide';
const isZoomTr = (tr: Transition) => tr === 'zoom' || tr === 'crosszoom';
/** a shot the auto editor made and the user never changed */
const ours = (s: Shot) => !!s.auto && s.motion === s.auto.motion;

/** content of a sequence, to pick the treatment that suits it */
function profileOf(shots: Shot[], aspect: number) {
  const panels = shots.filter((s) => s.pageId);
  const n = Math.max(1, panels.length);
  const wide = panels.filter((s) => s.rect.w / s.rect.h / aspect > 1.35).length / n;
  const talky = panels.filter((s) => (s.balloons?.length ?? 0) >= 2).length / n;
  const splash = panels.filter((s) => s.zone === 'splash').length / n;
  return { wide, talky, splash, many: shots.length >= 4 ? 1 : 0, few: shots.length <= 2 ? 1 : 0 };
}

function fitScore(t: Treatment, pr: ReturnType<typeof profileOf>) {
  return (t.fits.wide ?? 0) * pr.wide + (t.fits.talky ?? 0) * pr.talky + (t.fits.splash ?? 0) * pr.splash + (t.fits.many ?? 0) * pr.many + (t.fits.few ?? 0) * pr.few;
}

/** camera move for the k-th shot of a sequence, following its grammar */
function cameraFor(g: CameraGrammar, s: Shot, k: number, prev: Motion | null, aspect: number, rtl: boolean): Motion {
  const ratio = s.rect.w / s.rect.h / aspect;
  const wide = ratio > 1.35, tall = ratio < 1 / 1.35;
  const along: Motion = wide ? (rtl ? 'pan-left' : 'pan-right') : tall ? 'pan-down' : 'zoom-in';
  const b = s.balloons ?? [];
  // worth a balloon-by-balloon read: many balloons, or balloons far apart in the panel
  const spread = b.length >= 2 ? Math.max(...b.map((q) => q.x + q.w / 2)) - Math.min(...b.map((q) => q.x + q.w / 2)) + Math.max(...b.map((q) => q.y + q.h / 2)) - Math.min(...b.map((q) => q.y + q.h / 2)) : 0;
  const readWorthy = b.length >= 3 || spread > (s.rect.w + s.rect.h) * 0.45;
  switch (g) {
    case 'reading': return readWorthy && prev !== 'read' ? 'read' : readWorthy ? 'tour' : wide || tall ? along : prev === 'zoom-in' ? 'zoom-out' : 'zoom-in';
    case 'tracking': return wide || tall ? along : k % 2 ? 'zoom-out' : 'zoom-in';
    case 'hold': return 'static';
    case 'pullback': return wide && k > 0 ? along : 'zoom-out';
    case 'counterpoint': return prev === 'zoom-in' ? 'zoom-out' : 'zoom-in';
    case 'push': default: return wide && prev === 'zoom-in' ? along : 'zoom-in';
  }
}

/**
 * Direct an edit. `shots` in timeline order (the auto editor's output).
 * Returns new shots (inputs untouched) and what was decided.
 */
export function directSequences(shots: Shot[], aspect: number, opt: DirectorOptions = DIRECTOR_DEFAULT, rtl = false, pages?: Map<string, PageInfo>, events: number[] = []): { shots: Shot[]; report: DirectorReport } {
  const out = shots.map((s) => ({ ...s }));
  // a locked page is the user's: nothing automatic touches its shots
  const lockedShot = (s: Shot) => !!(s.pageId && pages?.get(s.pageId)?.locked);
  for (const s of out) if (lockedShot(s)) s.auto = undefined;
  const report: DirectorReport = { sequences: [], changedTransitions: 0, changedMotions: 0, notes: [] };
  if (!out.length) return { shots: out, report };
  const text = (s: Shot) => s.match?.sentence || s.caption.text || s.text || '';

  /* 1. sequences: consecutive shots of the same editorial type (a lone shot joins its neighbour, except a revelation) */
  const n = out.length;
  const types = out.map((s, i) => seqTypeOf(text(s), i, n));
  // a lone soft sentence joins its neighbours; a lone strong one (revelation, fight, character) stays its own sequence
  const soft: SeqType[] = ['explication', 'contexte', 'demonstration'];
  for (let i = 1; i < n - 1; i++) if (types[i] !== types[i - 1] && types[i] !== types[i + 1] && types[i - 1] === types[i + 1] && soft.includes(types[i])) types[i] = types[i - 1];
  const seqs: { type: SeqType; from: number; to: number }[] = [];
  types.forEach((t, i) => { const last = seqs[seqs.length - 1]; if (last && last.type === t) last.to = i; else seqs.push({ type: t, from: i, to: i }); });

  /* 2. a treatment per sequence: the best fit for its content, never the one just used,
        and not the same as the last sequence of the same type (variation memory) */
  const memory = new Map<SeqType, string>();
  const useCount = new Map<string, number>();
  let prevTreatment = '';
  let t0 = 0;
  const starts = out.map((s) => { const st = s.start ?? t0; t0 = st + s.duration; return st; });
  const chosen = seqs.map((q) => {
    const pr = profileOf(out.slice(q.from, q.to + 1), aspect);
    const cands = [...TREATMENTS[q.type]].sort((a, b) =>
      (fitScore(b, pr) - (useCount.get(b.id) ?? 0) * 0.6 - (b.id === memory.get(q.type) ? 1.5 : 0) - (b.id === prevTreatment ? 3 : 0))
      - (fitScore(a, pr) - (useCount.get(a.id) ?? 0) * 0.6 - (a.id === memory.get(q.type) ? 1.5 : 0) - (a.id === prevTreatment ? 3 : 0))
      // equal scores: the content decides (stable hash of the sequence's text), not chance
      || (hashSeed(text(out[q.from]) + a.id) % 7) - (hashSeed(text(out[q.from]) + b.id) % 7));
    const tr = cands[0];
    memory.set(q.type, tr.id);
    useCount.set(tr.id, (useCount.get(tr.id) ?? 0) + 1);
    prevTreatment = tr.id;
    report.sequences.push({ type: q.type, treatment: tr.id, label: tr.label, from: q.from, to: q.to, start: +starts[q.from].toFixed(2) });
    return tr;
  });

  // without words to read (no script, no narration), sequences are guesses: the director keeps the
  // per-shot transitions it was given and only applies its camera grammar and diversity rules
  const worded = out.filter((s) => text(s).trim().length > 12).length / n;
  const bySequence = worded >= 0.3;
  if (!bySequence) report.notes.push('Pas de texte à analyser : séquences non utilisées pour les transitions (seules la diversité et la caméra sont gérées).');

  /* 3. camera grammar and entry transitions, sequence by sequence */
  const pageModes: Motion[] = [];
  let prevMotion: Motion | null = null;
  const window: Transition[] = []; // last visible transitions, newest last
  seqs.forEach((q, si) => {
    const tr = chosen[si];
    for (let i = q.from; i <= q.to; i++) {
      const s = out[i], k = i - q.from;
      const tag = `${SEQ_FR[q.type]} · ${tr.label}`;
      // a long shot on a rich image: explore it in stages rather than one long push
      if (opt.camera && ours(s) && s.pageId && !s.diagram && s.layout === 'full' && s.motion !== 'tour' && s.duration > 4.2 && important(holdFor(s, { seq: q.type }))) {
        s.motion = 'tour'; s.auto = { ...s.auto!, motion: 'tour' }; report.changedMotions++;
        s.why = `${s.why ? s.why + ' · ' : ''}image riche tenue ${s.duration.toFixed(1)} s → explorée en étapes`;
      }
      if (opt.camera && opt.sequences && ours(s) && s.pageId && !s.diagram && s.motion !== 'tour') {
        const m = cameraFor(tr.camera, s, k, prevMotion, aspect, rtl);
        if (m !== s.motion) { s.motion = m; report.changedMotions++; }
        s.intensity = +Math.min(1, Math.max(0.15, (s.intensity + tr.intensity) / 2)).toFixed(2);
        s.auto = { ...s.auto!, motion: m };
        // the director said what; the comic camera engine decides how, from the page's geometry
        const pinfo = s.pageId ? pages?.get(s.pageId) : undefined;
        const ex = pinfo && executeCamera(s, pinfo, tr.camera, aspect, prevMotion, pageModes);
        if (ex) {
          // the camera goes where the voice goes: arrivals on sentence starts and breaths of this shot
          const local = events.map((e) => e - starts[i]).filter((e) => e > 0 && e < s.duration);
          const path = ex.path && syncPath(ex.path, s.duration, local, Math.hypot(pinfo.w, pinfo.h));
          s.motion = ex.motion; s.path = path; s.shared = ex.shared; s.auto = { ...s.auto!, motion: ex.motion };
          if (ex.path) pageModes.push(ex.motion);
          s.why = `${s.why ? s.why + ' · ' : ''}${ex.why}${path && local.length ? ' · calée sur la voix' : ''}${path && ex.path && path.length < ex.path.length ? ` (${ex.path.length - path.length} arrêt(s) retiré(s) pour ne pas courir)` : ''}`;
        }
        // an action that runs across neighbouring panels of the same page: the camera follows it
        const pv = i > 0 ? out[i - 1] : null;
        if (q.type === 'confrontation' && pv?.pageId && pv.pageId === s.pageId && s.layout === 'full' && pv.layout === 'full' && opt.transitions && visible(s.transition) === false && s.transition !== 'glide') {
          s.transition = 'glide'; s.transitionDur = +Math.min(0.5, s.duration * 0.3).toFixed(3);
          s.why = `${s.why ?? ''} · l’action continue sur la case voisine → la caméra glisse`;
        }
      }
      let decided = '';
      if (opt.transitions && opt.sequences && bySequence && s.auto && i > 0 && s.transition !== 'glide') {
        const was = s.transition;
        const level = visible(was) ? (TRANSITION[was]?.category === 'action' || TRANSITION[was]?.category === 'cosmic' ? 2 : 1) : 0;
        if (k === 0) {
          // entering a sequence: a mark that suits it, unless the budget said "plain cut" and the content agrees
          const fitsDur = (x: Transition) => (TRANSITION[x]?.minDur ?? 0) <= s.duration * 0.45 + 1e-6;
          const pick = tr.enter.find((x) => fitsDur(x) && (x === 'cut' || !window.slice(-3).includes(x)));
          if (pick && (level > 0 || q.type === 'revelation' || q.type === 'personnage' || q.type === 'confrontation')) { s.transition = pick; decided = `entrée de séquence → « ${TRANSITION[pick]?.label ?? pick} »`; }
        } else if (visible(was) && !tr.inside.includes(was)) {
          // inside a sequence the story flows: a mark here adds nothing
          s.transition = 'cut';
          decided = 'dans la séquence, le récit coule → coupe franche';
        }
        if (s.transition !== was) {
          report.changedTransitions++;
          if (s.transition === 'cut') s.transitionDur = 0;
          else s.transitionDur = +Math.min(s.duration * 0.45, Math.max(s.transitionDur || 0.4, TRANSITION[s.transition]?.minDur ?? 0)).toFixed(3);
        }
      }
      // the reason shown is the final decision; the first idea stays in brackets when it was overruled
      if (s.auto) s.why = `${tag}${decided ? ' · ' + decided + (s.why ? ` (idée de départ : ${s.why.replace(/^.*?→\s*/, '')})` : '') : s.why ? ' — ' + s.why : ''}`;
      prevMotion = s.motion;
      if (visible(s.transition)) window.push(s.transition);
    }
  });

  /* 4. diversity manager over the whole edit */
  if (opt.transitions) {
    const recent: Transition[] = [];
    for (let i = 1; i < n; i++) {
      const s = out[i];
      if (!s.auto || !visible(s.transition)) continue;
      // the same mark again within the last three: worn out → a cut (or a different mark for a real entry)
      if (recent.slice(-3).includes(s.transition)) {
        s.transition = 'cut'; s.transitionDur = 0; report.changedTransitions++;
        s.why = `${s.why ?? ''} · transition déjà vue juste avant → coupe franche`;
        continue;
      }
      // the transition must go with the movement around it, not against it
      const clash = motionClash(out[i - 1], s, s.transition, types[i]);
      if (clash) {
        s.transition = 'cut'; s.transitionDur = 0; report.changedTransitions++;
        s.why = `${s.why ?? ''} · ${clash} → coupe franche (raccord dans le mouvement)`;
        continue;
      }
      // zoom into a push-in into a push-in: one movement too many
      if (isZoomTr(s.transition) && out[i - 1].motion === 'zoom-in' && s.motion === 'zoom-in') {
        s.transition = 'cut'; s.transitionDur = 0; report.changedTransitions++;
        s.why = `${s.why ?? ''} · zoom sur zoom évité → coupe franche`;
        continue;
      }
      recent.push(s.transition);
    }
  }

  /* 5. camera monotony: never the same move three times in a row when another one suits */
  if (opt.camera) {
    for (let i = 2; i < n; i++) {
      const s = out[i];
      if (!ours(s) || !s.pageId || s.diagram || s.path?.length) continue;
      if (s.motion === out[i - 1].motion && s.motion === out[i - 2].motion && s.motion !== 'tour') {
        // reading balloons a third time in a row: explore the panel instead (it still visits the balloons)
        const alt: Motion = s.motion === 'read' ? 'tour' : s.motion === 'zoom-in' ? 'zoom-out' : s.motion === 'zoom-out' ? 'zoom-in' : s.motion.startsWith('pan') ? 'static' : 'zoom-in';
        s.motion = alt; s.auto = { ...s.auto!, motion: alt }; report.changedMotions++;
        s.why = `${s.why ?? ''} · troisième mouvement identique évité`;
      }
    }
  }
  /* 6. shakes are for real impacts: at most ~6 a minute, the strongest moments keep theirs */
  {
    const total = out.reduce((a, s) => a + s.duration, 0);
    const budget = Math.max(1, Math.round((total / 60) * 6));
    const shaky = out.map((s, i) => ({ s, i, w: s.shake * (types[i] === 'confrontation' || s.zone === 'splash' ? 2 : 1) })).filter((x) => x.s.shake > 0.2 && x.s.auto);
    if (shaky.length > budget) {
      for (const x of shaky.sort((a, b) => b.w - a.w).slice(budget)) { x.s.shake = 0; x.s.why = `${x.s.why ?? ''} · secousse retirée (réservée aux vrais impacts)`; }
      report.notes.push(`${shaky.length - budget} secousse(s) retirée(s) : ${budget} gardée(s) pour les vrais impacts.`);
    }
  }
  const kinds = [...new Set(report.sequences.map((q) => SEQ_FR[q.type]))];
  report.notes.push(`Directeur créatif : ${report.sequences.length} séquences (${kinds.slice(0, 5).join(', ')}${kinds.length > 5 ? '…' : ''}), ${report.changedTransitions} transition(s) et ${report.changedMotions} mouvement(s) ajustés.`);
  return { shots: out, report };
}

/** monotony measures of an edit (variation memory, shown in the report) */
export function variety(shots: Shot[]) {
  let maxMotionRun = 1, run = 1;
  for (let i = 1; i < shots.length; i++) {
    run = shots[i].motion === shots[i - 1].motion && shots[i].pageId ? run + 1 : 1;
    maxMotionRun = Math.max(maxMotionRun, run);
  }
  const vis = shots.map((s) => s.transition).filter(visible);
  let closeRepeats = 0;
  vis.forEach((t, i) => { if (vis.slice(Math.max(0, i - 3), i).includes(t)) closeRepeats++; });
  let zoomChains = 0;
  for (let i = 2; i < shots.length; i++) if ([0, 1, 2].every((d) => shots[i - d].motion === 'zoom-in')) zoomChains++;
  return { maxMotionRun, closeRepeats, zoomChains, motions: new Set(shots.filter((s) => s.pageId).map((s) => s.motion)).size, transitions: new Set(vis).size };
}
