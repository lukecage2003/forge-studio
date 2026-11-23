import type { AudioKind, Page, Project, Rect } from './types';
import { getState, newShot, setUI, update } from './store';
import { getImage, importAudio, importImage } from './engine/media';
import { detectPanels } from './engine/detect';
import { uid } from './lib/util';
import { toast } from './components/Toast';

const natural = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

export async function importPages(files: File[], opts: { autoCut?: boolean } = { autoCut: true }) {
  const imgs = files.filter((f) => f.type.startsWith('image/')).sort((a, b) => natural.compare(a.name, b.name));
  if (!imgs.length) return;
  const pages: Page[] = [];
  for (const f of imgs) {
    const { id, asset } = await importImage(f);
    pages.push({ id: uid('pg_'), name: f.name.replace(/\.[^.]+$/, ''), mediaId: id, width: asset.width, height: asset.height });
  }
  update((p) => {
    let next: Project = { ...p, pages: [...p.pages, ...pages] };
    if (opts.autoCut) {
      for (const pg of pages) {
        const a = getImage(pg.mediaId)!;
        const rects = detectPanels(a.img, a.width, a.height, p.readingOrder === 'rtl');
        const shots = rects.map((rect) => newShot(next, { pageId: pg.id, rect }));
        next = { ...next, shots: [...next.shots, ...shots] };
      }
    }
    return next;
  });
  const n = getState().project.shots.length;
  setUI({ activePageId: pages[0].id, selection: { kind: 'page', id: pages[0].id } });
  toast(`${pages.length} planche${pages.length > 1 ? 's' : ''} importée${pages.length > 1 ? 's' : ''} · ${n} case${n > 1 ? 's' : ''} au total`);
}

export function redetect(pageId: string) {
  const { project } = getState();
  const pg = project.pages.find((p) => p.id === pageId);
  const a = pg && getImage(pg.mediaId);
  if (!pg || !a) return;
  const rects = detectPanels(a.img, a.width, a.height, project.readingOrder === 'rtl');
  replacePageShots(pageId, rects);
  toast(`${rects.length} case${rects.length > 1 ? 's' : ''} détectée${rects.length > 1 ? 's' : ''}`);
}

export function wholePage(pageId: string) {
  const pg = getState().project.pages.find((p) => p.id === pageId);
  if (!pg) return;
  replacePageShots(pageId, [{ x: 0, y: 0, w: pg.width, h: pg.height }]);
}

function replacePageShots(pageId: string, rects: Rect[]) {
  update((p) => {
    const idx = p.shots.findIndex((s) => s.pageId === pageId);
    const others = p.shots.filter((s) => s.pageId !== pageId);
    const created = rects.map((rect) => newShot(p, { pageId, rect }));
    const at = idx < 0 ? others.length : Math.min(idx, others.length);
    return { ...p, shots: [...others.slice(0, at), ...created, ...others.slice(at)] };
  });
}

export function clearPage(pageId: string) {
  update((p) => ({ ...p, shots: p.shots.filter((s) => s.pageId !== pageId) }));
}

export function addShotRect(pageId: string, rect: Rect) {
  const p0 = getState().project;
  const shot = newShot(p0, { pageId, rect });
  update((p) => {
    let last = -1;
    p.shots.forEach((s, i) => { if (s.pageId === pageId) last = i; });
    const at = last < 0 ? p.shots.length : last + 1;
    return { ...p, shots: [...p.shots.slice(0, at), shot, ...p.shots.slice(at)] };
  });
  setUI({ selection: { kind: 'shot', id: shot.id } });
}

export function addTitleCard(text = 'TITRE DE L’ÉPISODE') {
  const p0 = getState().project;
  const shot = newShot(p0, {
    pageId: null, duration: 2.5, transition: 'fade',
    caption: { ...p0.defaultCaption, text, preset: 'impact', anim: 'pop' },
    titleBg: '#0E0E11',
  });
  const sel = getState().ui.selection;
  update((p) => {
    const i = sel?.kind === 'shot' ? p.shots.findIndex((s) => s.id === sel.id) + 1 : 0;
    return { ...p, shots: [...p.shots.slice(0, i), shot, ...p.shots.slice(i)] };
  });
  setUI({ selection: { kind: 'shot', id: shot.id } });
}

export function removePage(pageId: string) {
  update((p) => ({ ...p, pages: p.pages.filter((x) => x.id !== pageId), shots: p.shots.filter((s) => s.pageId !== pageId) }));
  const { project } = getState();
  setUI({ activePageId: project.pages[0]?.id ?? null, selection: null });
}

export function moveShot(from: number, to: number) {
  update((p) => {
    const s = [...p.shots];
    const [m] = s.splice(from, 1);
    s.splice(to > from ? to - 1 : to, 0, m);
    return { ...p, shots: s };
  });
}

export function duplicateShot(id: string) {
  update((p) => {
    const i = p.shots.findIndex((s) => s.id === id);
    if (i < 0) return p;
    const c = { ...p.shots[i], id: uid('s_'), caption: { ...p.shots[i].caption } };
    return { ...p, shots: [...p.shots.slice(0, i + 1), c, ...p.shots.slice(i + 1)] };
  });
}

export function deleteSelection() {
  const { ui } = getState();
  const sel = ui.selection;
  if (!sel) return;
  if (sel.kind === 'shot') update((p) => ({ ...p, shots: p.shots.filter((s) => s.id !== sel.id) }));
  if (sel.kind === 'audio') update((p) => ({ ...p, audio: p.audio.filter((s) => s.id !== sel.id) }));
  if (sel.kind === 'page') return removePage(sel.id);
  setUI({ selection: null });
}

export async function importAudioFiles(kind: AudioKind, files: File[] | Blob[], names?: string[]) {
  let at = getState().ui.playhead;
  if (kind === 'music') at = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const { id, buffer } = await importAudio(f);
    const name = names?.[i] ?? ((f as File).name?.replace(/\.[^.]+$/, '') || (kind === 'voice' ? 'Voix off' : 'Audio'));
    const clip = {
      id: uid('a_'), kind, name, mediaId: id, start: at, offset: 0,
      duration: buffer.duration, sourceDuration: buffer.duration,
      volume: kind === 'music' ? 0.7 : 1, fadeIn: kind === 'music' ? 0.5 : 0, fadeOut: kind === 'music' ? 1.5 : 0,
    };
    update((p) => ({ ...p, audio: [...p.audio, clip] }));
    setUI({ selection: { kind: 'audio', id: clip.id } });
    at += buffer.duration;
  }
}

/** Fit the music to the video length: trims to the video and adds a fade. */
export function fitMusicToVideo(id: string, videoLen: number) {
  update((p) => ({
    ...p,
    audio: p.audio.map((c) => (c.id === id ? { ...c, start: 0, duration: Math.min(c.sourceDuration - c.offset, videoLen), fadeOut: 1.5 } : c)),
  }));
}

export function applyDefaultCaptionToAll() {
  update((p) => ({ ...p, shots: p.shots.map((s) => (s.pageId == null ? s : { ...s, caption: { ...s.caption, ...p.defaultCaption } })) }));
  toast('Style appliqué à tous les sous-titres');
}
