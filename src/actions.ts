import type { DiagramKind, FxItem, FxKind } from './types';
import type { AudioKind, Page, Project, Rect } from './types';
import { getState, newShot, setUI, update } from './store';
import { getImage, importAudio, importImage } from './engine/media';
import { cutPage } from './engine/detect';
import { filesToPages } from './engine/importers';
import { uid } from './lib/util';
import { toast } from './components/Toast';


/** Pages from images, PDF or CBZ files; panels are cut right away (with a safe fallback). */
export async function importPages(files: File[], opts: { autoCut?: boolean } = { autoCut: true }) {
  if (!files.length) return;
  setUI({ busy: 'Lecture des fichiers…' });
  try {
    const { pages: imgs, errors } = await filesToPages(files, (label) => setUI({ busy: label }));
    errors.forEach((e) => toast(e, 'error'));
    if (!imgs.length) return;
    const pages: Page[] = [];
    for (let i = 0; i < imgs.length; i++) {
      setUI({ busy: `Préparation des pages ${i + 1}/${imgs.length}…` });
      try {
        const { id, asset } = await importImage(imgs[i].blob);
        pages.push({ id: uid('pg_'), name: imgs[i].name, mediaId: id, width: asset.width, height: asset.height });
      } catch {
        toast(`${imgs[i].name} : image illisible, ignorée.`, 'error');
      }
    }
    let zones = 0;
    update((p) => {
      let next: Project = { ...p, pages: [...p.pages, ...pages] };
      if (opts.autoCut) {
        for (const pg of pages) {
          const a = getImage(pg.mediaId)!;
          const cut = cutPage(a.img, a.width, a.height, p.readingOrder === 'rtl');
          pg.cut = cut.kind;
          if (cut.kind === 'zones') zones++;
          const shots = cut.rects.map((rect) => newShot(next, { pageId: pg.id, rect, zone: cut.kind === 'panels' ? undefined : cut.kind }));
          next = { ...next, shots: [...next.shots, ...shots] };
        }
      }
      return next;
    });
    const n = getState().project.shots.length;
    setUI({ activePageId: pages[0]?.id ?? null, selection: pages[0] ? { kind: 'page', id: pages[0].id } : null });
    toast(`${pages.length} page${pages.length > 1 ? 's' : ''} importée${pages.length > 1 ? 's' : ''} · ${n} plans${zones ? ` · ${zones} page${zones > 1 ? 's' : ''} animée${zones > 1 ? 's' : ''} par zones` : ''}`);
  } finally {
    setUI({ busy: null });
  }
}

export function redetect(pageId: string) {
  const { project } = getState();
  const pg = project.pages.find((p) => p.id === pageId);
  const a = pg && getImage(pg.mediaId);
  if (!pg || !a) return;
  const cut = cutPage(a.img, a.width, a.height, project.readingOrder === 'rtl');
  update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === pageId ? { ...x, cut: cut.kind } : x)) }));
  replacePageShots(pageId, cut.rects, cut.kind === 'panels' ? undefined : cut.kind);
  toast(cut.kind === 'panels' ? `${cut.rects.length} cases détectées` : `Cases non fiables : page animée par zones (${cut.rects.length})`);
}

export function wholePage(pageId: string) {
  const pg = getState().project.pages.find((p) => p.id === pageId);
  if (!pg) return;
  replacePageShots(pageId, [{ x: 0, y: 0, w: pg.width, h: pg.height }]);
}

function replacePageShots(pageId: string, rects: Rect[], zone?: 'zones' | 'splash') {
  update((p) => {
    const idx = p.shots.findIndex((s) => s.pageId === pageId);
    const others = p.shots.filter((s) => s.pageId !== pageId);
    const created = rects.map((rect) => newShot(p, { pageId, rect, zone }));
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
  if (sel.kind === 'fx') update((p) => ({ ...p, fx: p.fx.filter((f) => f.id !== sel.id) }));
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

/* ------------------------------------------------------- effects & schemas */


export function addFx(kind: FxKind, extra: Partial<FxItem> = {}) {
  const t = getState().ui.playhead;
  const fx: FxItem = {
    id: uid('fx_'), kind, start: t, duration: kind === 'callout' ? 1.2 : 2.5,
    text: kind === 'textBehind' ? 'BATMAN' : kind === 'callout' ? 'BOUM !' : undefined, ...extra,
  };
  if (kind === 'panelBehind' && !fx.pageId) {
    const first = getState().project.shots.find((s) => s.pageId);
    if (first) { fx.pageId = first.pageId!; fx.rect = first.rect; }
  }
  update((p) => ({ ...p, fx: [...(p.fx ?? []), fx] }));
  setUI({ selection: { kind: 'fx', id: fx.id } });
}

export const patchFx = (id: string, patch: Partial<FxItem>, key?: string) =>
  update((p) => ({ ...p, fx: p.fx.map((f) => (f.id === id ? { ...f, ...patch } : f)) }), key);

export function addDiagram(kind: DiagramKind = 'timeline') {
  const p0 = getState().project;
  const panels = p0.shots.filter((s) => s.pageId).slice(0, kind === 'versus' ? 2 : 4);
  const items = panels.map((s, i) => ({ id: uid('di_'), label: kind === 'timeline' ? `Étape ${i + 1}` : `Personnage ${i + 1}`, sub: '', pageId: s.pageId!, rect: s.rect }));
  const titles: Record<DiagramKind, string> = { timeline: 'La chronologie', network: 'Qui est lié à qui', versus: 'Le duel', ranking: 'Le top' };
  const shot = newShot(p0, {
    pageId: null, duration: 6, transition: 'fade', transitionDur: 0.4, layout: 'full',
    start: p0.aroll ? getState().ui.playhead : undefined,
    caption: { ...p0.defaultCaption, text: '' },
    diagram: { kind, title: titles[kind], items, links: [] },
  });
  const sel = getState().ui.selection;
  update((p) => {
    const i = sel?.kind === 'shot' ? p.shots.findIndex((s) => s.id === sel.id) + 1 : p.shots.length;
    return { ...p, shots: [...p.shots.slice(0, i), shot, ...p.shots.slice(i)] };
  });
  setUI({ selection: { kind: 'shot', id: shot.id }, mode: 'preview' });
}

export const togglePageSkip = (id: string) =>
  update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === id ? { ...x, skip: !x.skip } : x)) }));
