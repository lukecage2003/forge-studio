/**
 * Effects catalogue: every transition and look effect Forge can draw, with
 * its category, its settings and what it implies (motion blur, sound).
 * The inspector builds its controls from here, the renderer reads the
 * settings from here, and the creative profiles pick from here.
 */
import type { Look, Shot, Transition } from '../types';
import type { EaseName } from './motion';

export type Category = 'comic' | 'cinematic' | 'cosmic' | 'action' | 'info';
export const CATEGORIES: Record<Category, string> = {
  comic: 'Comics',
  cinematic: 'Cinéma',
  cosmic: 'Cosmique / SF',
  action: 'Action',
  info: 'Information',
};

export interface Param { key: string; label: string; min: number; max: number; step: number; def: number; fmt?: (v: number) => string }

export interface TransitionDef {
  id: Transition;
  label: string;
  category: Category;
  desc: string;
  params: Param[];
  /** the frame moves fast: export adds motion blur */
  moves: boolean;
  /** automatic whoosh gain (0 = silent) */
  sfx: number;
  ease: EaseName;
  /** GPU shader (gl-transitions); falls back to a fade without WebGL */
  gl?: string;
  /** shortest duration that still reads well, seconds */
  minDur?: number;
}

const pct = (v: number) => Math.round(v * 100) + ' %';
const amount = (label = 'Intensité', max = 2): Param => ({ key: 'amount', label, min: 0, max, step: 0.05, def: 1, fmt: pct });

export const TRANSITIONS: TransitionDef[] = [
  { id: 'cut', label: 'Cut', category: 'info', desc: 'Coupe franche. Le choix par défaut d’un monteur.', params: [], moves: false, sfx: 0, ease: 'linear' },
  { id: 'glide', label: 'Glisse caméra', category: 'comic', desc: 'La caméra glisse d’une case à l’autre sur la même page.', params: [], moves: true, sfx: 0, ease: 'standard' },
  { id: 'fade', label: 'Fondu', category: 'cinematic', desc: 'Fondu enchaîné doux.', params: [], moves: false, sfx: 0, ease: 'soft' },
  { id: 'slide', label: 'Poussée', category: 'info', desc: 'La nouvelle image pousse l’ancienne.', params: [], moves: true, sfx: 0.6, ease: 'standard' },
  { id: 'whip', label: 'Whip', category: 'action', desc: 'Panoramique filé très rapide.', moves: true, sfx: 0.9, ease: 'standard',
    params: [{ key: 'trails', label: 'Traînées', min: 2, max: 10, step: 1, def: 6 }, { key: 'spread', label: 'Étalement', min: 0, max: 2, step: 0.05, def: 1, fmt: pct }] },
  { id: 'zoom', label: 'Zoom', category: 'action', desc: 'On plonge dans l’image suivante.', moves: true, sfx: 0.6, ease: 'standard', params: [amount('Profondeur')] },
  { id: 'flash', label: 'Flash', category: 'action', desc: 'Éclair blanc au moment du changement.', moves: false, sfx: 0, ease: 'linear', params: [amount('Éclat', 1)] },
  { id: 'slash', label: 'Coupe BD (diagonale)', category: 'comic', desc: 'Volet diagonal avec un trait de couleur, comme une gouttière.', moves: true, sfx: 0.6, ease: 'standard',
    params: [{ key: 'angle', label: 'Inclinaison', min: 0, max: 1, step: 0.05, def: 0.3, fmt: pct }, { key: 'edge', label: 'Trait', min: 0, max: 2, step: 0.05, def: 1, fmt: pct }] },
  { id: 'iris', label: 'Iris', category: 'comic', desc: 'Ouverture en cercle, façon vieux dessin animé.', moves: false, sfx: 0.6, ease: 'standard', minDur: 0.45,
    params: [{ key: 'edge', label: 'Trait', min: 0, max: 2, step: 0.05, def: 1, fmt: pct }] },
  { id: 'glitch', label: 'Glitch', category: 'cosmic', desc: 'Bandes décalées et aberration, signal perturbé.', moves: false, sfx: 0.6, ease: 'linear', params: [amount()] },
  { id: 'dip', label: 'Passage au noir', category: 'cinematic', desc: 'Respiration : l’image s’éteint puis revient.', moves: false, sfx: 0, ease: 'linear',
    params: [{ key: 'amount', label: 'Noirceur', min: 0, max: 1, step: 0.05, def: 1, fmt: pct }] },
  { id: 'blur', label: 'Fondu flou', category: 'cinematic', desc: 'Fondu qui passe par un flou de mise au point.', moves: false, sfx: 0, ease: 'soft', minDur: 0.45, params: [amount('Flou')] },
  { id: 'burn', label: 'Brûlure pellicule', category: 'cinematic', desc: 'Lumière chaude qui traverse l’image.', moves: false, sfx: 0.6, ease: 'standard', params: [amount('Lumière', 1.5)] },

  // GPU transitions from gl-transitions (MIT), see engine/gl
  { id: 'crosszoom', label: 'Zoom flou', category: 'action', desc: 'Fondu à travers un flou de zoom puissant.', moves: true, sfx: 0.6, ease: 'linear', gl: 'CrossZoom',
    params: [{ key: 'strength', label: 'Flou', min: 0, max: 1, step: 0.05, def: 0.4, fmt: pct }] },
  { id: 'warp', label: 'Volet déformé', category: 'cinematic', desc: 'Volet diagonal dont le bord étire l’image.', moves: true, sfx: 0.5, ease: 'linear', gl: 'DirectionalWarp',
    params: [{ key: 'smoothness', label: 'Douceur du bord', min: 0.02, max: 0.5, step: 0.01, def: 0.1 }] },
  { id: 'defocus', label: 'Mise au point', category: 'cinematic', desc: 'Fondu à travers un flou d’objectif.', moves: false, sfx: 0, ease: 'linear', gl: 'DefocusBlur',
    params: [{ key: 'blurSize', label: 'Flou', min: 0.005, max: 0.08, step: 0.005, def: 0.02 }] },
  { id: 'halftone', label: 'Trame BD', category: 'comic', desc: 'L’image se décompose en points de trame imprimée, puis se recompose.', moves: false, sfx: 0, ease: 'linear', gl: 'Halftone', minDur: 0.6,
    params: [{ key: 'dots', label: 'Points', min: 8, max: 80, step: 1, def: 28 }, { key: 'angle', label: 'Angle de trame', min: 0, max: 90, step: 1, def: 45, fmt: (v) => v + '°' }] },
  { id: 'inkbleed', label: 'Encre', category: 'comic', desc: 'La case suivante se répand comme de l’encre dans l’eau.', moves: false, sfx: 0, ease: 'linear', gl: 'InkBleed', minDur: 0.7,
    params: [{ key: 'drops', label: 'Gouttes', min: 1, max: 8, step: 1, def: 4 }, { key: 'tendrils', label: 'Filaments', min: 0, max: 1, step: 0.05, def: 0.7, fmt: pct }] },
  { id: 'warpspeed', label: 'Vitesse lumière', category: 'cosmic', desc: 'Saut en hyperespace : traînées d’étoiles et éclair.', moves: true, sfx: 0.8, ease: 'linear', gl: 'WarpSpeed', minDur: 0.7,
    params: [{ key: 'strength', label: 'Traînées', min: 0, max: 1, step: 0.05, def: 0.6, fmt: pct }, { key: 'flash', label: 'Éclair', min: 0, max: 1, step: 0.05, def: 0.5, fmt: pct }] },
  { id: 'gravitylens', label: 'Trou noir', category: 'cosmic', desc: 'Un disque noir courbe la lumière, avale l’image et rend la suivante.', moves: false, sfx: 0.5, ease: 'linear', gl: 'GravityLens', minDur: 0.8,
    params: [{ key: 'strength', label: 'Courbure', min: 0, max: 1.5, step: 0.05, def: 0.6, fmt: pct }, { key: 'glow', label: 'Anneau lumineux', min: 0, max: 1, step: 0.05, def: 0.6, fmt: pct }] },
  { id: 'glitchdisplace', label: 'Glitch numérique', category: 'cosmic', desc: 'Blocs déplacés puis éclair vers l’image suivante.', moves: false, sfx: 0.5, ease: 'linear', gl: 'GlitchDisplace', params: [] },
  { id: 'wipe', label: 'Volet doux', category: 'info', desc: 'Volet diagonal au bord adouci, sobre.', moves: false, sfx: 0, ease: 'linear', gl: 'DirectionalWipe',
    params: [{ key: 'smoothness', label: 'Douceur du bord', min: 0, max: 1, step: 0.05, def: 0.5, fmt: pct }] },
];

TRANSITIONS.push(
  { id: 'smear', label: 'Étirement cartoon', category: 'action', desc: 'L’image part en s’étirant comme dans un dessin animé, la suivante arrive étirée et se pose avec un rebond.', moves: true, sfx: 0.8, ease: 'linear', params: [amount('Étirement')], minDur: 0.3 },
  { id: 'impact', label: 'Image d’impact', category: 'action', desc: 'Deux images en noir et blanc inversé avec lignes de vitesse (manga), puis l’image arrive en tremblant.', moves: false, sfx: 1, ease: 'linear', params: [amount('Secousse')], minDur: 0.3 },
  { id: 'inkframe', label: 'Tracé de case', category: 'comic', desc: 'Une case se trace à l’encre sur le papier, l’image la remplit, puis la case s’ouvre en plein écran.', moves: false, sfx: 0.4, ease: 'linear', params: [], minDur: 0.6 },
);

export const TRANSITION: Record<Transition, TransitionDef> = Object.fromEntries(TRANSITIONS.map((t) => [t.id, t])) as Record<Transition, TransitionDef>;

/** a transition setting of a shot, falling back to the catalogue default */
export function tp(shot: Shot, key: string): number {
  const v = shot.tp?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return TRANSITION[shot.transition]?.params.find((p) => p.key === key)?.def ?? 1;
}

/** look and camera effects (project-wide), mapped to their Look setting */
export interface LookDef { key: keyof Look; label: string; category: Category; desc: string; kind: 'amount' | 'toggle'; /** value when the project has none */ def?: number }
export const LOOK_EFFECTS: LookDef[] = [
  { key: 'sharpen', label: 'Netteté des traits', category: 'comic', desc: 'Raffermit l’encre des scans agrandis, sans halo. Seulement avec une vraie carte graphique (sinon désactivée pour garder l’export rapide).', kind: 'amount', def: 0.45 },
  { key: 'paper', label: 'Papier imprimé', category: 'comic', desc: 'Fibres et trame d’un comics papier.', kind: 'amount' },
  { key: 'balloonPop', label: 'Bulles animées', category: 'comic', desc: 'Les bulles apparaissent l’une après l’autre.', kind: 'toggle' },
  { key: 'parallax', label: 'Relief 2.5D', category: 'comic', desc: 'Les personnages se détachent du décor.', kind: 'toggle' },
  { key: 'vignette', label: 'Vignette', category: 'cinematic', desc: 'Bords assombris qui guident le regard.', kind: 'amount' },
  { key: 'grain', label: 'Grain', category: 'cinematic', desc: 'Grain de pellicule, stable d’une exportation à l’autre.', kind: 'amount' },
  { key: 'handheld', label: 'Caméra à l’épaule', category: 'cinematic', desc: 'Léger flottement de caméra.', kind: 'amount' },
  { key: 'motionBlur', label: 'Flou de mouvement', category: 'cinematic', desc: 'À l’export, sur les mouvements rapides.', kind: 'toggle' },
  { key: 'chroma', label: 'Aberration à l’impact', category: 'cosmic', desc: 'Franges rouge et bleu sur les chocs.', kind: 'toggle' },
  { key: 'speedLines', label: 'Lignes de vitesse', category: 'action', desc: 'Sur les impacts et les tremblements.', kind: 'toggle' },
];
