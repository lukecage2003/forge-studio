import type { Background, CaptionAnim, CaptionPreset, Grade, Layout, Project, Transition } from '../types';
import type { Profile, ProfileId } from './direction';

/**
 * CREATIVE STYLE LIBRARY — art directions, not colour swaps.
 * Each direction is nine coherent components. Components can be mixed
 * (typography of one, transitions of another) and overridden one by one;
 * the mix is stored in the project (`project.art`) and read by the auto
 * editor (transitions, rhythm, composition) and the renderer (titles,
 * illustration treatment, subtitles).
 */

export type StyleId = 'cinematic' | 'editorial' | 'comic' | 'cosmic' | 'tactical' | 'news' | 'historical' | 'minimal';
export type TitleStyle = 'encre' | 'neon' | 'news' | 'minimal' | 'cinema' | 'cosmic' | 'tactical' | 'archive';
export type Component = 'typography' | 'palette' | 'animation' | 'transitions' | 'composition' | 'illustration' | 'subtitles' | 'titles' | 'sound';
export const COMPONENT_FR: Record<Component, string> = {
  typography: 'Typographie', palette: 'Palette', animation: 'Animations', transitions: 'Transitions', composition: 'Composition',
  illustration: 'Traitement des illustrations', subtitles: 'Sous-titres', titles: 'Titres', sound: 'Sound design',
};

export interface ArtDirection {
  id: StyleId;
  label: string;
  desc: string;
  /** rhythm and beat logic come from this creative profile */
  profile: ProfileId;
  typography: { caption: CaptionPreset; keywords: boolean };
  palette: { accent: string; grade: Grade; bg: string };
  animation: { caption: CaptionAnim; intensity: number; handheld: number; balloonPop: boolean; parallax: boolean; chroma: boolean; speedLines: boolean };
  transitions: { calm: Transition[]; accent: Transition[]; strong: Transition[]; budget: { accent: number; strong: number } };
  composition: { layouts: [Layout, number][]; background: Background };
  illustration: { sharpen: number; paper: number; vignette: number; grain: number; diagram: 'encre' | 'neon' };
  subtitles: { preset: CaptionPreset; anim: CaptionAnim; y: number; size: number; maxWords: number };
  titles: TitleStyle;
  sound: { volume: number; perMin: number };
}

const S = (a: ArtDirection) => a;
export const STYLES: ArtDirection[] = [
  S({ id: 'cinematic', label: 'Documentaire cinématique', desc: 'Images tenues, lumière, fondus et mises au point ; texte discret qui s’écrit.', profile: 'premium',
    typography: { caption: 'cinema', keywords: false }, palette: { accent: '#E8B04B', grade: 'cinema', bg: '#0b0b0d' },
    animation: { caption: 'type', intensity: 0.4, handheld: 0.25, balloonPop: false, parallax: true, chroma: false, speedLines: false },
    transitions: { calm: ['cut', 'cut', 'fade'], accent: ['defocus', 'dip', 'blur'], strong: ['burn', 'inkbleed'], budget: { accent: 3, strong: 1 } },
    composition: { layouts: [['full', 7], ['page', 0.8]], background: 'blur' },
    illustration: { sharpen: 0.4, paper: 0, vignette: 0.45, grain: 0.3, diagram: 'neon' },
    subtitles: { preset: 'cinema', anim: 'words', y: 0.76, size: 0.9, maxWords: 6 }, titles: 'cinema', sound: { volume: 0.45, perMin: 3 } }),
  S({ id: 'editorial', label: 'Éditorial premium', desc: 'Magazine : papier, filets fins, cases posées et encadrées, sous-titres nets.', profile: 'premium',
    typography: { caption: 'clean', keywords: true }, palette: { accent: '#C8102E', grade: 'natural', bg: '#f4f2ee' },
    animation: { caption: 'words', intensity: 0.4, handheld: 0.1, balloonPop: true, parallax: false, chroma: false, speedLines: false },
    transitions: { calm: ['cut', 'cut', 'cut', 'wipe'], accent: ['wipe', 'slide', 'inkframe'], strong: ['inkframe'], budget: { accent: 3, strong: 0.8 } },
    composition: { layouts: [['full', 5], ['grid', 1.4], ['page', 0.8]], background: 'paper' },
    illustration: { sharpen: 0.5, paper: 0.2, vignette: 0.1, grain: 0, diagram: 'encre' },
    subtitles: { preset: 'clean', anim: 'words', y: 0.74, size: 0.85, maxWords: 5 }, titles: 'minimal', sound: { volume: 0.35, perMin: 2 } }),
  S({ id: 'comic', label: 'Analyse comics', desc: 'La BD imprimée : encre, trame, encarts jaunes, bulles qui apparaissent, case qui se trace.', profile: 'character',
    typography: { caption: 'comic', keywords: true }, palette: { accent: '#E8452C', grade: 'natural', bg: '#efe5cf' },
    animation: { caption: 'pop', intensity: 0.55, handheld: 0.2, balloonPop: true, parallax: true, chroma: false, speedLines: false },
    transitions: { calm: ['cut', 'cut', 'glide'], accent: ['inkframe', 'slash', 'iris'], strong: ['halftone', 'inkbleed'], budget: { accent: 5, strong: 1.5 } },
    composition: { layouts: [['full', 5], ['grid', 1.6], ['page', 1.2]], background: 'paper' },
    illustration: { sharpen: 0.45, paper: 0.5, vignette: 0.15, grain: 0.1, diagram: 'encre' },
    subtitles: { preset: 'comic', anim: 'words', y: 0.72, size: 0.95, maxWords: 4 }, titles: 'encre', sound: { volume: 0.5, perMin: 4 } }),
  S({ id: 'cosmic', label: 'Épopée cosmique', desc: 'Ample et lent : étoiles, profondeur, vitesse lumière et trou noir pour les révélations.', profile: 'cosmic',
    typography: { caption: 'cinema', keywords: true }, palette: { accent: '#7B5CFF', grade: 'cinema', bg: '#05040c' },
    animation: { caption: 'type', intensity: 0.45, handheld: 0.25, balloonPop: true, parallax: true, chroma: true, speedLines: false },
    transitions: { calm: ['fade', 'cut', 'defocus'], accent: ['warp', 'blur', 'crosszoom'], strong: ['warpspeed', 'crosszoom'], budget: { accent: 4, strong: 1.5 } },
    composition: { layouts: [['full', 7], ['page', 0.6]], background: 'blur' },
    illustration: { sharpen: 0.4, paper: 0, vignette: 0.55, grain: 0.25, diagram: 'neon' },
    subtitles: { preset: 'cinema', anim: 'words', y: 0.76, size: 0.95, maxWords: 6 }, titles: 'cosmic', sound: { volume: 0.6, perMin: 4 } }),
  S({ id: 'tactical', label: 'Analyse tactique', desc: 'Tableau de bord : grille, repères, cartes et schémas précis, coupes nettes.', profile: 'science',
    typography: { caption: 'clean', keywords: true }, palette: { accent: '#00D1B2', grade: 'natural', bg: '#0a1418' },
    animation: { caption: 'words', intensity: 0.5, handheld: 0.05, balloonPop: false, parallax: false, chroma: false, speedLines: false },
    transitions: { calm: ['cut', 'cut', 'cut'], accent: ['wipe', 'slide'], strong: ['glitchdisplace'], budget: { accent: 4, strong: 1 } },
    composition: { layouts: [['full', 5], ['grid', 2], ['page', 0.6]], background: 'color' },
    illustration: { sharpen: 0.5, paper: 0, vignette: 0.1, grain: 0, diagram: 'neon' },
    subtitles: { preset: 'clean', anim: 'words', y: 0.74, size: 0.85, maxWords: 5 }, titles: 'tactical', sound: { volume: 0.4, perMin: 3 } }),
  S({ id: 'news', label: 'Flash actu', desc: 'Bandeau, rouge d’alerte, rythme serré, informations qui tombent l’une après l’autre.', profile: 'editorial',
    typography: { caption: 'clean', keywords: true }, palette: { accent: '#E10600', grade: 'punch', bg: '#0b1630' },
    animation: { caption: 'slide', intensity: 0.6, handheld: 0.1, balloonPop: false, parallax: false, chroma: false, speedLines: false },
    transitions: { calm: ['cut', 'cut'], accent: ['slide', 'wipe'], strong: ['flash'], budget: { accent: 6, strong: 2 } },
    composition: { layouts: [['full', 5], ['grid', 1.5]], background: 'blur' },
    illustration: { sharpen: 0.5, paper: 0, vignette: 0.15, grain: 0, diagram: 'neon' },
    subtitles: { preset: 'clean', anim: 'words', y: 0.7, size: 0.9, maxWords: 4 }, titles: 'news', sound: { volume: 0.5, perMin: 5 } }),
  S({ id: 'historical', label: 'Documentaire historique', desc: 'Archives : papier vieilli, sépia, lents travellings, passages au noir entre les époques.', profile: 'timeline',
    typography: { caption: 'cinema', keywords: true }, palette: { accent: '#B5651D', grade: 'warm', bg: '#e9dcc0' },
    animation: { caption: 'type', intensity: 0.35, handheld: 0.15, balloonPop: true, parallax: true, chroma: false, speedLines: false },
    transitions: { calm: ['cut', 'fade', 'dip'], accent: ['dip', 'burn', 'fade'], strong: ['burn', 'inkbleed'], budget: { accent: 3, strong: 1 } },
    composition: { layouts: [['full', 6], ['page', 1.2]], background: 'paper' },
    illustration: { sharpen: 0.35, paper: 0.45, vignette: 0.4, grain: 0.35, diagram: 'encre' },
    subtitles: { preset: 'clean', anim: 'words', y: 0.76, size: 0.88, maxWords: 6 }, titles: 'archive', sound: { volume: 0.4, perMin: 2 } }),
  S({ id: 'minimal', label: 'Explication minimaliste', desc: 'Rien que l’essentiel : fond clair, coupes franches, peu de mouvement, texte très lisible.', profile: 'science',
    typography: { caption: 'clean', keywords: false }, palette: { accent: '#111111', grade: 'natural', bg: '#f4f2ee' },
    animation: { caption: 'words', intensity: 0.3, handheld: 0, balloonPop: false, parallax: false, chroma: false, speedLines: false },
    transitions: { calm: ['cut', 'cut', 'cut', 'cut'], accent: ['wipe'], strong: ['wipe'], budget: { accent: 2, strong: 0 } },
    composition: { layouts: [['full', 6], ['grid', 1]], background: 'color' },
    illustration: { sharpen: 0.45, paper: 0, vignette: 0, grain: 0, diagram: 'encre' },
    subtitles: { preset: 'clean', anim: 'words', y: 0.74, size: 0.85, maxWords: 5 }, titles: 'minimal', sound: { volume: 0.25, perMin: 1 } }),
];
export const STYLE: Record<StyleId, ArtDirection> = Object.fromEntries(STYLES.map((s) => [s.id, s])) as Record<StyleId, ArtDirection>;
export const COMPONENTS: Component[] = ['typography', 'palette', 'animation', 'transitions', 'composition', 'illustration', 'subtitles', 'titles', 'sound'];

/** a mix: which direction each component comes from, plus single-value overrides (accent colour…) */
export interface ArtMix { base: StyleId; from?: Partial<Record<Component, StyleId>>; accent?: string }

/** the art direction a mix stands for, component by component */
export function resolveArt(m: ArtMix): ArtDirection {
  const base = STYLE[m.base] ?? STYLE.comic;
  const pick = <K extends Component>(k: K): ArtDirection[K] => STYLE[m.from?.[k] ?? base.id][k];
  const out: ArtDirection = { ...base };
  for (const k of COMPONENTS) (out as unknown as Record<Component, unknown>)[k] = pick(k);
  if (m.accent) out.palette = { ...out.palette, accent: m.accent };
  const mixed = Object.entries(m.from ?? {}).filter(([, v]) => v && v !== base.id);
  if (mixed.length) out.label = `${base.label} + ${mixed.map(([k, v]) => `${COMPONENT_FR[k as Component].toLowerCase()} ${STYLE[v as StyleId].label.toLowerCase()}`).join(', ')}`;
  return out;
}

/** put an art direction on a project (undoable through update()) */
export function applyArt(p: Project, m: ArtMix): Project {
  const a = resolveArt(m);
  return {
    ...p,
    art: m,
    accent: a.palette.accent,
    bgColor: a.palette.bg,
    background: a.composition.background,
    diagramStyle: a.illustration.diagram,
    titleStyle: a.titles,
    look: {
      ...p.look, grade: a.palette.grade, vignette: a.illustration.vignette, grain: a.illustration.grain, paper: a.illustration.paper, sharpen: a.illustration.sharpen,
      handheld: a.animation.handheld, balloonPop: a.animation.balloonPop, parallax: a.animation.parallax, chroma: a.animation.chroma, speedLines: a.animation.speedLines,
    },
    defaultCaption: { ...p.defaultCaption, preset: a.typography.caption, anim: a.animation.caption },
    subtitleStyle: { ...p.subtitleStyle, preset: a.subtitles.preset, anim: a.subtitles.anim, y: a.subtitles.y, size: a.subtitles.size, maxWords: a.subtitles.maxWords, keywords: a.typography.keywords },
    autoSfx: { on: p.autoSfx?.on ?? true, volume: a.sound.volume, perMin: a.sound.perMin },
  };
}

/** the creative profile the auto editor works with, dressed by the art direction */
export function artProfile(prof: Profile, a: ArtDirection): Profile {
  return {
    ...prof,
    type: { preset: a.typography.caption, anim: a.animation.caption },
    palette: { calm: a.transitions.calm, accent: a.transitions.accent, strong: a.transitions.strong },
    budget: a.transitions.budget,
    rhythm: { ...prof.rhythm, intensity: a.animation.intensity, maxWords: a.subtitles.maxWords },
    look: { ...prof.look, grade: a.palette.grade, vignette: a.illustration.vignette, grain: a.illustration.grain, paper: a.illustration.paper, chroma: a.animation.chroma, speedLines: a.animation.speedLines, balloonPop: a.animation.balloonPop, parallax: a.animation.parallax },
    camera: { ...prof.camera, handheld: a.animation.handheld },
    sound: a.sound,
    layouts: a.composition.layouts,
  };
}
