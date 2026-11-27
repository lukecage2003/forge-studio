import type { Project, Rect, Shot } from '../types';
import { getImage } from './media';
import { comicNames } from './lexicon';
import { narrationWords } from './narration';
import { layoutShots } from './timeline';

/**
 * ZOOM ON THE NAMED CHARACTER (experimental) — when the voice names a character
 * over a panel, the picture ↔ words model (CLIP, local) looks for the part of the
 * panel that best matches « a comic book drawing of <name> »; the camera ends on
 * it. Only when one part clearly stands out (else nothing changes), only on shots
 * the auto edit made and the user never touched, always marked « à vérifier »:
 * CLIP knows famous characters, not every one. Views only: the drawing is intact.
 */
export interface FocusPlan { shotId: string; name: string; crop: Rect; margin: number }

/** pure: overlapping windows of a panel (half its size, quarter steps) plus the whole panel */
export function windowsOf(r: Rect): Rect[] {
  const out: Rect[] = [];
  const w = r.w * 0.5, h = r.h * 0.5;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) out.push({ x: r.x + (i * (r.w - w)) / 2, y: r.y + (j * (r.h - h)) / 2, w, h });
  return out;
}

/** pure: the shots whose spoken sentence names a known character (auto shots, no manual camera) */
export function namedShots(p: Project): { shot: Shot; name: string }[] {
  const names = comicNames(p).filter((n) => n.strong);
  if (!names.length) return [];
  const words = narrationWords(p);
  const out: { shot: Shot; name: string }[] = [];
  for (const t of layoutShots(p)) {
    const s = t.shot;
    if (!s.pageId || !s.auto || s.path?.length || s.diagram) continue;
    const said = (s.match?.sentence ?? '') + ' ' + words.filter((w) => w.s >= t.start && w.s < t.end).map((w) => w.w).join(' ');
    const n = names.find((x) => [x.name, ...x.aliases].some((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(said)));
    if (n) out.push({ shot: s, name: n.name });
  }
  return out;
}

/** pure: the decision from the similarities (one per window, then the whole panel): the best window if it stands out */
export function pickWindow(scores: number[], margin = 0.012): number | null {
  if (scores.length < 3) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const best = scores.indexOf(sorted[sorted.length - 1]);
  return sorted[sorted.length - 1] - median >= margin ? best : null;
}

async function cropBlob(img: CanvasImageSource, r: Rect): Promise<Blob> {
  const k = Math.min(1, 336 / Math.max(r.w, r.h));
  const c = document.createElement('canvas'); c.width = Math.max(8, Math.round(r.w * k)); c.height = Math.max(8, Math.round(r.h * k));
  c.getContext('2d')!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.9));
}

export async function planNameFocus(p: Project, step?: (i: number, n: number) => Promise<void>): Promise<FocusPlan[]> {
  const todo = namedShots(p);
  if (!todo.length) return [];
  const { embedImages, embedTexts, dot } = await import('./clip');
  const names = [...new Set(todo.map((t) => t.name))];
  const tv = await embedTexts([...names.map((n) => `a comic book drawing of ${n}`), 'a comic book panel']);
  const generic = tv[tv.length - 1];
  const plans: FocusPlan[] = [];
  for (let i = 0; i < todo.length; i++) {
    const { shot, name } = todo[i];
    const page = p.pages.find((x) => x.id === shot.pageId); const a = page && getImage(page.mediaId);
    if (a) {
      const wins = windowsOf(shot.rect);
      const iv = await embedImages(await Promise.all(wins.map((w) => cropBlob(a.img, w))));
      const nv = tv[names.indexOf(name)];
      // how much more each window looks like the character than like any panel
      const scores = iv.map((v) => dot(v, nv) - dot(v, generic));
      const k = pickWindow(scores);
      if (k != null) { const s = [...scores].sort((x, y) => x - y); plans.push({ shotId: shot.id, name, crop: wins[k], margin: +(s[s.length - 1] - s[Math.floor(s.length / 2)]).toFixed(3) }); }
    }
    await step?.(i + 1, todo.length);
  }
  return plans;
}

/** pure: the camera of a shot ending on the character: from the whole panel to the window, a slow push-in */
export function focusPath(shot: Shot, crop: Rect): Shot['path'] {
  const r = shot.rect;
  return [
    { t: 0, cx: r.x + r.w / 2, cy: r.y + r.h / 2, vw: r.w, ease: 'smooth' },
    { t: 1, cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2, vw: Math.max(crop.w, r.w * 0.55), ease: 'smooth' },
  ];
}
