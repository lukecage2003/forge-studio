export type Format = '9:16' | '16:9' | '1:1' | '4:5';

export const FORMATS: Record<Format, { w: number; h: number; label: string; hint: string }> = {
  '9:16': { w: 1080, h: 1920, label: '9:16', hint: 'TikTok · Shorts · Reels' },
  '16:9': { w: 1920, h: 1080, label: '16:9', hint: 'YouTube' },
  '1:1': { w: 1080, h: 1080, label: '1:1', hint: 'Carré' },
  '4:5': { w: 1080, h: 1350, label: '4:5', hint: 'Instagram feed' },
};

export interface Rect { x: number; y: number; w: number; h: number }

export interface Page {
  id: string;
  name: string;
  mediaId: string;
  width: number;
  height: number;
  /** excluded from the auto edit (ads, credits…) */
  skip?: boolean;
  /** what the page is: story page, cover, ad… (auto-classified, editable) */
  kind?: PageKind;
  kindWhy?: string;
  /** file it came from (PDF/CBZ), its position and page count there */
  source?: string;
  srcIndex?: number;
  srcCount?: number;
  /** AI reading of the page (Gemini) */
  summary?: string;
  /** how the page was cut: real panels, a full-page splash, or reading-order zones */
  cut?: 'panels' | 'splash' | 'zones';
  /** who cut it: the local AI detector or the classic gutter algorithm */
  cutBy?: 'ia' | 'algo';
  /** speech balloons and captions found on the page (-1 = unknown) */
  bubbles?: number;
  /** same picture as an earlier page (scan duplicate) */
  dupOf?: string;
  /** the user locked the page: automatic edits never change its shots */
  locked?: boolean;
  /** why its reading order may be wrong (to be checked by the user) */
  orderDoubt?: string;
  /** reading and classification still running (production orchestrator) */
  analysing?: boolean;
}

export type PageKind = 'story' | 'cover' | 'variant' | 'title' | 'splash' | 'spread' | 'text' | 'ad' | 'blank';
export const PAGE_KINDS: Record<PageKind, { label: string; skip: boolean }> = {
  story: { label: 'Planche', skip: false },
  cover: { label: 'Couverture', skip: false },
  variant: { label: 'Couverture variante', skip: true },
  title: { label: 'Titre / crédits', skip: true },
  splash: { label: 'Pleine page', skip: false },
  spread: { label: 'Double page', skip: false },
  text: { label: 'Texte / crédits', skip: true },
  ad: { label: 'Publicité', skip: true },
  blank: { label: 'Page vide', skip: true },
};

export type Motion =
  | 'auto' | 'static' | 'zoom-in' | 'zoom-out'
  | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down'
  /** the camera reads the balloons of the panel one after the other */
  | 'read'
  /** one image explored in stages: wide, push to a detail, pan to another, back to wide */
  | 'tour'
  /** page-level camera paths (comic camera engine): glide across the page, panel to panel, reveal from a detail */
  | 'page-glide' | 'panel-nav' | 'reveal';

export type Framing = 'fit' | 'fill';

export type Transition = 'cut' | 'glide' | 'fade' | 'slide' | 'zoom' | 'whip' | 'flash' | 'slash' | 'iris' | 'glitch' | 'dip' | 'blur' | 'burn'
  // GPU transitions (gl-transitions)
  | 'crosszoom' | 'warp' | 'defocus' | 'halftone' | 'inkbleed' | 'warpspeed' | 'gravitylens' | 'glitchdisplace' | 'wipe'
  // motion-design transitions
  | 'smear' | 'impact' | 'inkframe';

/**
 * How a comic shot is composed on screen.
 * - full    : the panel fills the frame (camera moves on it)
 * - split   : face cam + panel, stacked (vertical) or side by side (horizontal)
 * - pip     : panel full frame, face cam in a bubble
 * - grid    : several panels shown together (see Shot.group)
 * - page    : the whole page, spotlight + camera on the panel
 */
export type Layout = 'full' | 'split' | 'pip' | 'grid' | 'page';

export type CaptionPreset = 'tiktok' | 'comic' | 'clean' | 'impact' | 'cinema' | 'neon' | 'editorial';
export type CaptionAnim = 'none' | 'pop' | 'type' | 'words' | 'slide';

export interface Caption {
  text: string;
  preset: CaptionPreset;
  anim: CaptionAnim;
  /** 0 = top, 1 = bottom */
  y: number;
  size: number; // 0.5 – 2 multiplier
}

export interface Shot {
  id: string;
  /** null = title card */
  pageId: string | null;
  rect: Rect; // page pixels
  /** extra panels shown together with this one (grid layout) */
  group?: { pageId: string; rect: Rect }[];
  layout: Layout;
  /** cut from reading-order zones (unreliable panels) or a full-page splash */
  zone?: 'zones' | 'splash';
  /** timeline start, used when the project has a face-cam rush (overlay mode) */
  start?: number;
  duration: number;
  framing: Framing;
  motion: Motion;
  intensity: number; // 0..1
  transition: Transition; // transition INTO this shot
  transitionDur: number;
  /** settings of the transition (see engine/effects), defaults when absent */
  tp?: Record<string, number>;
  shake: number; // 0..1 impact shake at start
  caption: Caption;
  nameTag?: string; // e.g. character name, shown as a lower third
  /** schema / timeline built from comic panels (title-card shots only) */
  diagram?: Diagram;
  titleBg?: string;
  /** what the panel shows/says: OCR of its balloons, AI description, characters */
  text?: string;
  desc?: string;
  chars?: string[];
  /** placed by the story matcher: the sentence it illustrates, confidence, alternatives (shot ids) */
  match?: { sentence: string; conf: number; alts: string[]; source: 'local' | 'google'; /** other candidate panels, kept as page + frame (the panel shots themselves may not be in the edit) */ altPanels?: { pageId: string; rect: Rect; why: string }[] };
  /** speech balloons inside the panel (page px), for the pop-in animation */
  balloons?: Rect[];
  /** camera path in page pixels (engine/camerapath): when set, it drives the camera */
  path?: { t: number; cx: number; cy: number; vw: number; hold?: number; ease?: 'smooth' | 'linear' | 'in' | 'out' }[];
  /** filmed inside the whole page (overlapping or irregular panels): no cut-out, the neighbours stay */
  shared?: boolean;
  /** real outline of the panel (slanted gutters), page px: a non-destructive mask */
  shape?: { x: number; y: number }[];
  /** point of interest inside the panel (0..1 of rect): zooms aim here instead of the centre */
  focus?: { x: number; y: number };
  /** why the auto editor made this shot like this (shown in the live view) */
  why?: string;
  /** set by the auto editor; used by Forge Brain to learn from corrections */
  auto?: { duration: number; layout: Layout; motion: Motion; style: string };
  /** sound of this shot: automatic (transitions, impacts), none, or forced (storyboard / by hand) */
  sfx?: 'auto' | 'none' | 'impact' | 'whoosh';
}

export type DiagramKind = 'timeline' | 'network' | 'versus' | 'ranking'
  // manim-style chart, and 3D scenes built from comic panels (three.js)
  | 'scale' | 'orbit' | 'cosmos' | 'tiers'
  // a quotation from the comics, with its source
  | 'quote'
  // an animated map: the camera travels from place to place, pins drop, the route draws
  | 'map';
export const DIAGRAM_3D: DiagramKind[] = ['orbit', 'cosmos', 'tiers'];
export interface DiagramItem { id: string; label: string; sub?: string; pageId?: string; rect?: Rect; /** position on the map (0..1 of the map image), for map diagrams */ x?: number; y?: number }
/** how sure a relation is: shown differently so viewers can tell facts from opinions */
export type Certainty = 'source' | 'interpretation' | 'hypothese';
export type LinkKind = 'allie' | 'ennemi' | 'famille' | 'autre';
export interface DiagramLink { a: number; b: number; label?: string; status?: Certainty; kind?: LinkKind }
export interface Diagram { kind: DiagramKind; title: string; items: DiagramItem[]; links: DiagramLink[]; /** the map image (a page or a part of one), for map diagrams */ map?: { pageId: string; rect: Rect } }

/** Effects on the face cam (need the person cut-out for the "behind me" ones). */
export type FxKind = 'textBehind' | 'panelBehind' | 'callout' | 'bgBlur' | 'bgHalftone';
export interface FxItem {
  id: string; kind: FxKind; start: number; duration: number;
  text?: string; color?: string; y?: number; size?: number;
  pageId?: string; rect?: Rect;
}

export type Grade = 'natural' | 'cinema' | 'warm' | 'punch' | 'noir';
export interface Look { grade: Grade; vignette: number; grain: number; cutout: boolean; handheld?: number; speedLines?: boolean; motionBlur?: boolean; chroma?: boolean; paper?: number; parallax?: boolean; balloonPop?: boolean; /** contrast-adaptive sharpening of comic frames, 0..1 (default 0.45) */ sharpen?: number }

export type AudioKind = 'music' | 'voice' | 'sfx';

export interface AudioClip {
  id: string;
  kind: AudioKind;
  name: string;
  mediaId: string;
  start: number; // timeline seconds
  offset: number; // seconds into source
  duration: number; // seconds used
  sourceDuration: number;
  volume: number; // 0..1.5
  fadeIn: number;
  fadeOut: number;
  /** transcript of a voice-over clip, times relative to the source file */
  words?: Word[];
}

/* ------------------------------------------------------- face-cam rush */

export interface Word { w: string; s: number; e: number; filler?: boolean; conf?: number }

export type CutReason = 'silence' | 'hesitation' | 'filler' | 'retake' | 'manual';

export interface Cut { s: number; e: number; reason: CutReason; on: boolean; label?: string }

/** face position in the rush at a source time: centre (eyes) and width, normalised */
export interface FaceKey { t: number; x: number; y: number; s: number; /** a change of shot happens at this key: the framing jumps */ cut?: boolean }

export interface ARoll {
  mediaId: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  /** focus point of the face, normalised 0..1, used for framing and zooms */
  focus: { x: number; y: number };
  /** detected face track (automatic framing); manual focus is used when absent */
  faceTrack?: FaceKey[];
  /** proposed cuts on the source (toggle `on` to apply) */
  cuts: Cut[];
  words: Word[];
  /** breaths in the voice (source seconds, length): where script sentences end when there is no transcript */
  pauses?: { t: number; d: number }[];
  transcriptSource?: 'whisper' | 'gemini' | 'manual' | 'ai';
  /** result of the reliability check (engine/transcriptCheck): an unreliable transcript is never used to cut */
  transcriptCheck?: { ok: boolean; reason?: string };
  /** jump-cut punch-in zooms */
  punchIn: number; // 0..1 strength (0 = off)
  /** slow push-in on long takes */
  drift: number; // 0..1
  volume: number;
  settings: RoughCutSettings;
}

export interface RoughCutSettings {
  threshold: number; // dB above noise floor treated as voice
  minSilence: number; // seconds
  padding: number; // seconds kept before/after speech
  hesitations: boolean;
  fillers: boolean;
  retakes: boolean;
}

export interface Subtitle { s: number; e: number; text: string; words: { w: string; s: number; e: number }[] }

export type Background = 'blur' | 'color' | 'page' | 'halftone' | 'paper';

export interface Project {
  id: string;
  /** rendering engine version the project was made with (reproducibility) */
  engine?: number;
  name: string;
  format: Format;
  fps: number;
  background: Background;
  bgColor: string;
  readingOrder: 'ltr' | 'rtl';
  ducking: boolean;
  duckLevel: number; // 0..1 gain for music under voice
  pages: Page[];
  shots: Shot[];
  audio: AudioClip[];
  aroll: ARoll | null;
  subtitles: Subtitle[];
  subtitleStyle: Omit<Caption, 'text'> & { on: boolean; maxWords: number; /** names, concepts and figures in the accent colour */ keywords?: boolean };
  defaultCaption: Omit<Caption, 'text'>;
  watermark: string;
  progressBar: boolean;
  accent: string;
  /** art direction (engine/styles): base direction, components borrowed from others, overrides */
  art?: { base: string; from?: Record<string, string>; accent?: string };
  /** look of title cards (engine/styles TitleStyle) */
  titleStyle?: string;
  /** look of diagrams and maps: 'encre' = printed comic (ink, halftone, captions), 'neon' = the earlier dark cards */
  diagramStyle?: 'encre' | 'neon';
  fx: FxItem[];
  look: Look;
  /** background research on the comics (Google search grounding) */
  research?: { title: string; summary: string; characters: { name: string; aliases?: string[]; role?: string }[]; facts: string[]; sources?: string[] };
  /** optional script pasted by the user (narration text) */
  script?: string;
  /** channel identity (colours, logo, intro/outro) */
  brand?: { bg?: string; ink?: string; logo?: string; intro?: boolean; outro?: boolean };
  /** stressed moments of the voice (timeline seconds): slight punch-ins */
  emphasis?: number[];
  /** automatic sound design: whooshes on transitions, impacts on splashes */
  autoSfx?: { on: boolean; volume: number; /** whooshes allowed per minute (creative profile) */ perMin?: number };
  /** sound engine: voice clean-up and loudness target of the export (LUFS, null = untouched) */
  mix?: { voiceClean: boolean; target: number | null; /** adaptive noise reduction of the voice (engine/denoise) */ denoise?: 'off' | 'auto' | 'light' | 'strong'; /** radio = broadcast chain computed on the take; natural = light live chain */ voice?: 'radio' | 'natural' | 'off' };
  /** creative direction profile used by the last auto edit */
  /** display time ranges by kind of image (seconds), used by the review: simple, panel, page, reveal */
  holds?: { simple: readonly [number, number]; panel: readonly [number, number]; page: readonly [number, number]; reveal: readonly [number, number] };
  /** storyboard: the plan of the video sentence by sentence, edited before the auto edit (engine/storyboard) */
  storyboard?: import('./engine/storyboard').Board;
  /** production management (studio): where the video stands, its checklist, notes */
  production?: {
    status: 'idee' | 'script' | 'tournage' | 'montage' | 'finition' | 'publie';
    tasks: { id: string; text: string; done: boolean; phase?: 'idee' | 'script' | 'tournage' | 'montage' | 'finition' | 'publie' }[];
    notes?: string;
    createdAt: string;
    /** template the project was created from */
    template?: string;
  };
  direction?: { profile: string; /** editorial sequences chosen by the creative director (engine/director) */ sequences?: { type: string; treatment: string; label: string; from: number; to: number; start: number }[] };
}

export type Selection =
  | { kind: 'shot'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'page'; id: string }
  | { kind: 'aroll' }
  | { kind: 'fx'; id: string }
  | null;
