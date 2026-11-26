import type { Caption, Motion, Project, Shot, Transition } from '../types';
import type { ArtMix } from './styles';

/**
 * CREATIVE FAVORITES — the user's own presets, saved on purpose and reused in
 * any project (this browser; export/import as a file for another computer).
 * Distinct from Forge Brain, which only *learns* from corrections.
 */
export type FavKind = 'art' | 'subtitles' | 'animation' | 'transition' | 'camera';
export const FAV_FR: Record<FavKind, string> = { art: 'Combinaison visuelle', subtitles: 'Style de sous-titres', animation: 'Animation', transition: 'Transition', camera: 'Trajectoire de caméra' };

export interface FavData {
  art: ArtMix;
  subtitles: Pick<Project['subtitleStyle'], 'preset' | 'anim' | 'y' | 'size' | 'maxWords' | 'keywords'>;
  animation: { motion: Motion; intensity: number; captionAnim: Caption['anim']; shake: number };
  transition: { transition: Transition; transitionDur: number; tp?: Record<string, number> };
  /** camera path relative to its frame (panel box, or the page when shared): reusable on any panel */
  camera: { motion: Motion; intensity: number; shared: boolean; path?: { t: number; x: number; y: number; w: number; hold?: number }[] };
}
export interface Favorite<K extends FavKind = FavKind> { id: string; kind: K; name: string; created: string; data: FavData[K] }

const KEY = 'forge-favorites';
let mem: Favorite[] | null = null;
const subs = new Set<() => void>();
export const onFavorites = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function favorites(kind?: FavKind): Favorite[] {
  if (!mem) { try { mem = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { mem = []; } }
  return kind ? mem!.filter((f) => f.kind === kind) : mem!;
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* private mode: kept for the session */ } subs.forEach((f) => f()); }

export function saveFavorite<K extends FavKind>(kind: K, name: string, data: FavData[K]): Favorite<K> {
  const f: Favorite<K> = { id: 'fav_' + Date.now().toString(36) + Math.floor(performance.now() % 1000), kind, name: name.trim() || FAV_FR[kind], created: new Date().toISOString(), data };
  favorites();
  mem = [...mem!.filter((x) => !(x.kind === kind && x.name === f.name)), f];
  persist();
  return f;
}
export function removeFavorite(id: string) { favorites(); mem = mem!.filter((f) => f.id !== id); persist(); }

/** what to save, read from the current project / shot */
export const capture = {
  art: (p: Project): ArtMix | null => (p.art as ArtMix | undefined) ?? null,
  subtitles: (p: Project): FavData['subtitles'] => { const s = p.subtitleStyle; return { preset: s.preset, anim: s.anim, y: s.y, size: s.size, maxWords: s.maxWords, keywords: s.keywords }; },
  animation: (s: Shot): FavData['animation'] => ({ motion: s.motion, intensity: s.intensity, captionAnim: s.caption.anim, shake: s.shake }),
  transition: (s: Shot): FavData['transition'] => ({ transition: s.transition, transitionDur: s.transitionDur, tp: s.tp }),
  camera: (s: Shot, page?: { width: number; height: number }): FavData['camera'] => {
    const R = s.shared && page ? { x: 0, y: 0, w: page.width, h: page.height } : s.rect;
    return { motion: s.motion, intensity: s.intensity, shared: !!s.shared, path: s.path?.map((k) => ({ t: k.t, x: (k.cx - R.x) / R.w, y: (k.cy - R.y) / R.h, w: k.vw / R.w, hold: k.hold })) };
  },
};

/** applying a favorite to a shot marks it as the user's choice (the director leaves it alone) */
export function applyToShot(s: Shot, f: Favorite, page?: { width: number; height: number }): Shot {
  if (f.kind === 'camera') {
    const d = f.data as FavData['camera'];
    const R = d.shared && page ? { x: 0, y: 0, w: page.width, h: page.height } : s.rect;
    const path = d.path?.map((k) => ({ t: k.t, cx: R.x + k.x * R.w, cy: R.y + k.y * R.h, vw: k.w * R.w, hold: k.hold }));
    return { ...s, motion: d.motion, intensity: d.intensity, shared: d.shared || undefined, path, auto: undefined, why: `trajectoire favorite « ${f.name} »` };
  }
  if (f.kind === 'animation') { const d = f.data as FavData['animation']; return { ...s, motion: d.motion, intensity: d.intensity, shake: d.shake, caption: { ...s.caption, anim: d.captionAnim }, auto: undefined, why: `favori « ${f.name} »` }; }
  if (f.kind === 'transition') { const d = f.data as FavData['transition']; return { ...s, transition: d.transition, transitionDur: d.transitionDur, tp: d.tp, auto: undefined, why: `favori « ${f.name} »` }; }
  return s;
}
export function applySubtitles(p: Project, f: Favorite<'subtitles'>): Project { return { ...p, subtitleStyle: { ...p.subtitleStyle, ...f.data } }; }

/** one file to carry the presets to another computer */
export const exportFavorites = () => new Blob([JSON.stringify({ forge: 'favorites', v: 1, items: favorites() }, null, 1)], { type: 'application/json' });
export async function importFavorites(file: Blob): Promise<number> {
  const j = JSON.parse(await file.text());
  const items: Favorite[] = Array.isArray(j?.items) ? j.items.filter((f: Favorite) => f && f.kind in FAV_FR && f.name && f.data) : [];
  favorites();
  for (const f of items) mem = [...mem!.filter((x) => !(x.kind === f.kind && x.name === f.name)), f];
  persist();
  return items.length;
}
