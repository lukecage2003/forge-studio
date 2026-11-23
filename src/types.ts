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
}

export type Motion =
  | 'auto' | 'static' | 'zoom-in' | 'zoom-out'
  | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';

export type Framing = 'fit' | 'fill';

export type Transition = 'cut' | 'glide' | 'fade' | 'slide' | 'zoom' | 'whip' | 'flash';

export type CaptionPreset = 'tiktok' | 'comic' | 'clean' | 'impact' | 'cinema';
export type CaptionAnim = 'none' | 'pop' | 'type' | 'words';

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
  duration: number;
  framing: Framing;
  motion: Motion;
  intensity: number; // 0..1
  transition: Transition; // transition INTO this shot
  transitionDur: number;
  shake: number; // 0..1 impact shake at start
  caption: Caption;
  titleBg?: string;
}

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
}

export type Background = 'blur' | 'color' | 'page';

export interface Project {
  id: string;
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
  defaultCaption: Omit<Caption, 'text'>;
  watermark: string;
}

export type Selection =
  | { kind: 'shot'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'page'; id: string }
  | null;
