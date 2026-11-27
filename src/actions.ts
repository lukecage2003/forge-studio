import type { DiagramKind, FxItem, FxKind } from './types';
import type { AudioClip, AudioKind, Overlay, OverlaySource, Page, Project, Rect, Shot } from './types';
import { FORMATS } from './types';
import { getState, newShot, setUI, update } from './store';
import { getAudio, getImage, importAudio, importImage, importVideo } from './engine/media';
import { bestPlace, chooseCorner, detailOf } from './engine/overlays';
import { cameraAt, createRenderer } from './engine/render';
import { cachedLines, readLines } from './engine/paddleOcr';
import { cutPage } from './engine/detect';
import { filesToPages } from './engine/importers';
import { classifyPage, hashDistance, kindFromText, medianAspect, pageHash, trimBottomToArt, type PageText } from './engine/classify';
import { comicOrder, cutPageSmart, detectWithAI } from './engine/panelAI';
import { panelShape } from './engine/comicCamera';
import type { PageCut } from './engine/detect';
import { PAGE_KINDS, type PageKind } from './types';
import { uid } from './lib/util';
import { informative } from './lib/mediaLibrary';
import { layoutShots } from './engine/timeline';
import { fixRepeats, insertAtTime, suggestionElement } from './engine/suggest';
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
        pages.push({ id: uid('pg_'), name: imgs[i].name, mediaId: id, width: asset.width, height: asset.height, source: imgs[i].source, srcIndex: imgs[i].srcIndex, srcCount: imgs[i].srcCount, kindWhy: imgs[i].hint });
      } catch {
        toast(`${imgs[i].name} : image illisible, ignorée.`, 'error');
      }
    }
    // the pages are in the project at once: an interruption never loses an import
    for (const pg of pages) if (opts.autoCut) pg.analysing = true;
    update((p) => ({ ...p, pages: [...p.pages, ...pages] }));
    setUI({ activePageId: pages[0]?.id ?? null, selection: pages[0] ? { kind: 'page', id: pages[0].id } : null });
    if (!opts.autoCut) { toast(`${pages.length} page${pages.length > 1 ? 's' : ''} importée${pages.length > 1 ? 's' : ''}`); return; }
    // reading and classifying run as resumable tasks (production orchestrator): one per page, then the issue
    const { analysePages } = await import('./production/kinds');
    await analysePages(pages.map((x) => x.id));
    toast(`${pages.length} page${pages.length > 1 ? 's' : ''} ajoutée${pages.length > 1 ? 's' : ''} : lecture des cases en cours (file de tâches)`);
  } finally {
    setUI({ busy: null });
  }
}

/**
 * Classify the pages of an import with the context of the whole issue and cut
 * them into shots, from the panel readings and page texts of the tasks.
 * Pages the user already cut by hand meanwhile (or removed) are left alone.
 */
export function applyPageAnalysis(pageIds: string[], cuts: Map<string, PageCut & { by: 'ia' | 'algo'; bubbles: number }>, texts: Map<string, PageText>) {
  let zones = 0, byAI = 0, dups = 0, done = 0;
  const kinds: Partial<Record<PageKind, number>> = {};
  update((p) => {
    const ids = new Set(pageIds);
    const pages = p.pages.filter((pg) => ids.has(pg.id) && !p.shots.some((s) => s.pageId === pg.id)).map((pg) => ({ ...pg }));
    if (!pages.length) return { ...p, pages: p.pages.map((pg) => (ids.has(pg.id) ? { ...pg, analysing: undefined } : pg)) };
    // scan duplicates: same picture as an earlier page of the project
    const seen = p.pages.map((pg) => {
      const a = getImage(pg.mediaId);
      return { id: pg.id, w: pg.width, h: pg.height, hash: a ? pageHash(a.img, a.width, a.height) : '' };
    });
    for (const pg of pages) {
      const i = seen.findIndex((o) => o.id === pg.id);
      if (i < 0 || !seen[i].hash) continue;
      // a nearly flat page has a fingerprint that tells nothing: never a duplicate on that basis
      const twin = informative(seen[i].hash) ? seen.slice(0, i).find((o) => o.hash && informative(o.hash) && hashDistance(o.hash, seen[i].hash) <= 4 && Math.abs(o.w / o.h - pg.width / pg.height) < 0.02) : undefined;
      pg.hash = seen[i].hash;
      if (twin) { pg.dupOf = twin.id; dups++; }
    }
    let next: Project = p;
    const aspects = new Map<string, number>();
    for (const src of new Set(pages.map((x) => x.source ?? ''))) aspects.set(src, medianAspect(pages.filter((x) => x.source === src)));
    let prev: { source?: string; kind?: PageKind } = {};
    const newShots: Shot[] = [];
    for (const pg of pages) {
      const a = getImage(pg.mediaId);
      if (!a) continue;
      const cut = cuts.get(pg.id) ?? { ...cutPage(a.img, a.width, a.height, p.readingOrder === 'rtl'), by: 'algo' as const, bubbles: -1 };
      if (cut.by === 'ia') byAI++;
      const cls = classifyPage(a.img, a.width, a.height, cut, {
        srcIndex: pg.srcIndex ?? 0, srcCount: pg.srcCount ?? 1, medianAspect: aspects.get(pg.source ?? '') ?? 0.65,
        hint: pg.kindWhy, prevKind: prev.source === pg.source ? prev.kind : undefined, bubbles: cut.bubbles,
      });
      const pt = texts.get(pg.id);
      const byText = pt && !(pg.kindWhy && cls.why === 'ComicInfo.xml') ? kindFromText(pt, cut.bubbles, cut.diag?.biggest ?? (cut.kind === 'splash' ? 1 : 0), cut.kind === 'panels' ? cut.rects.length : 0) : null;
      // the first page of a file stays its cover even when it names its authors
      if (byText && !(cls.kind === 'cover' && pg.srcIndex === 0)) { cls.kind = byText.kind; cls.why = byText.why; }
      // front matter with names and no balloons: the cast / team roster page, not story
      else if (!byText && pt && (pg.srcIndex ?? 9) <= 5 && cut.bubbles === 0 && pt.words >= 20 && cls.kind === 'story') { cls.kind = 'text'; cls.why = `page de présentation (${pt.words} mots, aucune bulle, début du numéro)`; }
      // opening page: panels that sit on the credits block are not story
      if (byText?.dropCredits) cut.rects = cut.rects.map((r) => trimBottomToArt(a.img, a.width, a.height, r));
      if (byText?.dropCredits && pt?.creditsBox) {
        const cb = pt.creditsBox;
        const over = (r: Rect) => { const w = Math.min(r.x + r.w, cb.x + cb.w) - Math.max(r.x, cb.x), h = Math.min(r.y + r.h, cb.y + cb.h) - Math.max(r.y, cb.y); return w > 0 && h > 0 ? (w * h) / (r.w * r.h) : 0; };
        // a panel that runs into the block from above stops where the block starts;
        // a panel inside the block goes
        cut.rects = cut.rects
          .map((r) => (over(r) > 0 && cb.y > r.y + r.h * 0.25 ? { ...r, h: Math.round(cb.y - r.y) } : r))
          .filter((r) => over(r) < 0.4);
      }
      prev = { source: pg.source, kind: cls.kind };
      pg.kind = cls.kind;
      pg.kindWhy = cls.why;
      pg.skip = PAGE_KINDS[cls.kind].skip;
      if (pg.dupOf && cls.kind !== 'cover') { pg.skip = true; pg.kindWhy = `${cls.why} · doublon d'une page précédente`; }
      pg.cut = cut.kind;
      pg.cutBy = cut.by;
      if (cut.doubt && cut.rects.length > 2) pg.orderDoubt = cut.doubt;
      pg.bubbles = cut.bubbles;
      pg.analysing = undefined;
      kinds[cls.kind] = (kinds[cls.kind] ?? 0) + 1;
      const whole = cls.kind === 'cover' || cls.kind === 'variant' || cls.kind === 'title' || cls.kind === 'splash' || cls.kind === 'text' || cls.kind === 'ad' || cls.kind === 'blank';
      if (!whole && cut.kind === 'zones') zones++;
      const rects = whole ? [{ x: 0, y: 0, w: a.width, h: a.height }] : cut.rects;
      // the real outline of each panel (slanted gutters): a mask, never a crop of the neighbour
      for (const rect of rects) {
        const shape = !whole && cut.kind === 'panels' ? panelShape(a.img, a.width, a.height, rect) : null;
        newShots.push(newShot(next, { pageId: pg.id, rect, zone: whole ? 'splash' : cut.kind === 'panels' ? undefined : cut.kind, ...(shape ? { shape } : {}) }));
      }
      done++;
    }
    const byId = new Map(pages.map((x) => [x.id, x]));
    // shots keep the page order of the project
    const order = new Map(p.pages.map((pg, i) => [pg.id, i]));
    newShots.sort((x, y) => (order.get(x.pageId!) ?? 0) - (order.get(y.pageId!) ?? 0));
    next = { ...p, pages: p.pages.map((pg) => byId.get(pg.id) ?? (ids.has(pg.id) ? { ...pg, analysing: undefined } : pg)), shots: [...p.shots, ...newShots] };
    return next;
  });
  if (!done) return;
  const n = getState().project.shots.length;
  toast(`${done} page${done > 1 ? 's' : ''} analysée${done > 1 ? 's' : ''} · ${n} plans${zones ? ` · ${zones} page${zones > 1 ? 's' : ''} animée${zones > 1 ? 's' : ''} par bandes` : ''}`);
  const skipped = Object.entries(kinds).filter(([k]) => PAGE_KINDS[k as PageKind].skip).map(([k, v]) => `${v} ${PAGE_KINDS[k as PageKind].label.toLowerCase()}`);
  const covers = kinds.cover ?? 0;
  toast(`Pages reconnues : ${covers} couverture${covers > 1 ? 's' : ''}, ${kinds.story ?? 0} planches${kinds.splash ? `, ${kinds.splash} pleines pages` : ''}${kinds.spread ? `, ${kinds.spread} doubles pages` : ''}${kinds.title ? `, ${kinds.title} page${kinds.title > 1 ? 's' : ''} de titre` : ''}${dups ? ` · ${dups} doublon${dups > 1 ? 's' : ''} écarté${dups > 1 ? 's' : ''}` : ''}${byAI ? ` · cases lues par l'IA locale sur ${byAI}/${done} pages` : ''}${skipped.length ? ` · exclues : ${skipped.join(', ')}` : ''}`);
}

export async function redetect(pageId: string) {
  const { project } = getState();
  const pg = project.pages.find((p) => p.id === pageId);
  const a = pg && getImage(pg.mediaId);
  if (!pg || !a) return;
  if (pg.locked) { toast('Page verrouillée : déverrouille-la pour relancer la détection.', 'error'); return; }
  setUI({ busy: 'Lecture des cases…' });
  const cut = await cutPageSmart(pg.mediaId, a.img, a.width, a.height, project.readingOrder === 'rtl').finally(() => setUI({ busy: null }));
  update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === pageId ? { ...x, cut: cut.kind, cutBy: cut.by, bubbles: cut.bubbles } : x)) }));
  replacePageShots(pageId, cut.rects, cut.kind === 'panels' ? undefined : cut.kind);
  const who = cut.by === 'ia' ? ' (IA locale)' : '';
  toast(cut.kind === 'panels' ? `${cut.rects.length} cases détectées${who}` : cut.kind === 'splash' ? `Pleine page${who}` : `Cases non fiables : page animée par zones (${cut.rects.length})`);
}

/** classic gutter algorithm only, for comparison or when the AI cut is wrong */
export function redetectClassic(pageId: string) {
  const { project } = getState();
  const pg = project.pages.find((p) => p.id === pageId);
  const a = pg && getImage(pg.mediaId);
  if (!pg || !a) return;
  const cut = cutPage(a.img, a.width, a.height, project.readingOrder === 'rtl');
  update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === pageId ? { ...x, cut: cut.kind, cutBy: 'algo' } : x)) }));
  replacePageShots(pageId, cut.rects, cut.kind === 'panels' ? undefined : cut.kind);
  toast(cut.kind === 'panels' ? `${cut.rects.length} cases (algorithme classique)` : `Algorithme classique : zones (${cut.rects.length})`);
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
  if (sel.kind === 'overlay') update((p) => { const o = p.overlays?.find((x) => x.id === sel.id); return { ...p, overlays: (p.overlays ?? []).filter((x) => x.id !== sel.id), audio: o?.soundClip ? p.audio.filter((c) => c.id !== o.soundClip) : p.audio }; });
  setUI({ selection: null });
}

/* ---------------------------------------------------------------- overlay tracks (B-roll) */

export const OVERLAY_TRACKS = 3;
/** pure: the lowest track free over [start, start + duration), else the top one */
export function freeTrack(p: Project, start: number, duration: number): number {
  for (let k = 1; k <= OVERLAY_TRACKS; k++) {
    if (!(p.overlays ?? []).some((o) => o.track === k && o.start < start + duration && start < o.start + o.duration)) return k;
  }
  return OVERLAY_TRACKS;
}
/** the place that cuts the least of this picture in the project's format (a video fills the screen) */
function defaultPlace(src: OverlaySource): Overlay['place'] {
  const { w, h } = FORMATS[getState().project.format];
  if (src.kind === 'panel') return bestPlace(src.rect.w, src.rect.h, w, h);
  if (src.kind === 'image') { const a = getImage(src.mediaId); return a ? bestPlace(a.width, a.height, w, h) : 'full'; }
  return 'full';
}
/** width / height of an overlay's picture */
function sourceAspect(src: OverlaySource): number {
  if (src.kind === 'panel') return src.rect.w / Math.max(1, src.rect.h);
  if (src.kind === 'video') return src.width / Math.max(1, src.height);
  const a = getImage(src.mediaId); return a ? a.width / a.height : 0.8;
}
/** the corner where a picture-in-picture hides the least of the frame at t (drawn small, without overlays) */
export function quietCorner(p: Project, t0: number, aspect = 0.8, dur = 1): Overlay['corner'] {
  if (typeof document === 'undefined') return 'tr';
  try {
    const { w, h } = FORMATS[p.format];
    const k = 360 / w, W = Math.round(w * k), H = Math.round(h * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const rd = createRenderer(W, H);
    const bare: Project = { ...p, overlays: [], subtitleStyle: { ...p.subtitleStyle, on: false } };
    // the main track can change shot, and its camera move, while the overlay is on screen:
    // measured every 0.4 s over its whole life (at most 12 frames)
    const n = Math.max(1, Math.min(12, Math.round(dur / 0.4)));
    const times = Array.from({ length: n }, (_, i) => t0 + ((i + 0.5) / n) * dur);
    const frames = times.map((t) => {
      rd.draw(ctx, bare, t);
      const data = ctx.getImageData(0, 0, W, H).data;
      // the balloons and lettering of the main panel, where the camera shows them at t: covering text always costs
      // more than covering drawing (a caption is a flat box: its drawing score alone would look « calm »)
      const texts: { x: number; y: number; w: number; h: number }[] = [];
      const ts = layoutShots(p).find((x) => t >= x.start && t < x.end);
      if (ts?.shot.pageId && (ts.shot.layout ?? 'full') === 'full') {
        const pg = p.pages.find((x) => x.id === ts.shot.pageId);
        // balloons (local detector) and every text line read on the page (PaddleOCR, when already read)
        const rects = [...(ts.shot.balloons ?? []), ...((pg && cachedLines(pg.mediaId)) ?? [])];
        if (rects.length) {
          const v = cameraAt(ts.shot, (t - ts.start) / Math.max(0.01, ts.shot.duration), W / H, p.readingOrder === 'rtl');
          const sc = W / v.vw;
          for (const b of rects) texts.push({ x: (b.x - v.cx) * sc + W / 2, y: (b.y - v.cy) * sc + H / 2, w: b.w * sc, h: b.h * sc });
        }
      }
      return { data, texts };
    });
    const overlap = (b: { x: number; y: number; w: number; h: number }, texts: { x: number; y: number; w: number; h: number }[]) => texts.reduce((a, r) => a + Math.max(0, Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x)) * Math.max(0, Math.min(b.y + b.h, r.y + r.h) - Math.max(b.y, r.y)), 0) / Math.max(1, b.w * b.h);
    return chooseCorner(W, H, (b) => frames.reduce((a, f) => a + detailOf(f.data, W, b) + 80 * overlap(b, f.texts), 0), !!p.subtitleStyle.on && p.subtitles.length > 0, aspect);
  } catch (e) { console.warn('Coin de l’incrustation : mesure impossible, haut droite par défaut', e); return 'tr'; }
}
/** place a picture on an overlay track at the playhead; undoable, selected for editing */
export function addOverlay(source: OverlaySource, opts: Partial<Overlay> = {}) {
  const start = opts.start ?? getState().ui.playhead;
  const duration = opts.duration ?? (source.kind === 'video' ? Math.min(5, Math.max(0.5, source.sourceDuration - source.offset)) : 3);
  const place = opts.place ?? defaultPlace(source);
  const o: Overlay = {
    corner: place === 'pip' && !opts.corner ? quietCorner(getState().project, start, sourceAspect(source), duration) : opts.corner,
    id: uid('ov_'), start, duration, source,
    track: opts.track ?? freeTrack(getState().project, start, duration),
    place,
    zoom: opts.zoom ?? (source.kind === 'video' ? 0 : 1),
    fade: opts.fade ?? 0.25,
  };
  update((p) => ({ ...p, overlays: [...(p.overlays ?? []), o] }));
  setUI({ selection: { kind: 'overlay', id: o.id } });
  return o;
}
export function patchOverlay(id: string, patch: Partial<Overlay>, key?: string) {
  update((p) => {
    const overlays = (p.overlays ?? []).map((o) => (o.id === id ? { ...o, auto: false, ...patch } : o));
    const o = overlays.find((x) => x.id === id);
    // the video's own sound follows its picture (same start, length and place in the file)
    const audio = o?.soundClip && o.source.kind === 'video'
      ? p.audio.map((c) => (c.id === o.soundClip ? { ...c, start: o.start, duration: o.duration, offset: (o.source as { offset: number }).offset } : c))
      : p.audio;
    return { ...p, overlays, audio };
  }, key);
}
/** keep or drop the sound of a video overlay: it becomes a sound-effects clip on the timeline, kept in step */
export function setOverlaySound(id: string, on: boolean) {
  const o = getState().project.overlays?.find((x) => x.id === id);
  if (!o || o.source.kind !== 'video') return;
  if (!on) { update((p) => ({ ...p, audio: p.audio.filter((c) => c.id !== o.soundClip), overlays: (p.overlays ?? []).map((x) => (x.id === id ? { ...x, soundClip: undefined } : x)) })); return; }
  if (!getAudio(o.source.mediaId)) { toast('Cette vidéo n’a pas de son lisible.', 'error'); return; }
  const clip: AudioClip = { id: uid('a_'), kind: 'sfx', name: `Son : ${o.source.name ?? 'vidéo en calque'}`, mediaId: o.source.mediaId, start: o.start, offset: o.source.offset, duration: o.duration, sourceDuration: o.source.sourceDuration, volume: 1, fadeIn: 0.1, fadeOut: 0.2 };
  update((p) => ({ ...p, audio: [...p.audio, clip], overlays: (p.overlays ?? []).map((x) => (x.id === id ? { ...x, soundClip: clip.id } : x)) }));
}
/** the selected panel, on an overlay track (its page stays where it is) */
export function overlaySelectedPanel(): boolean {
  const { ui, project } = getState();
  const sh = ui.selection?.kind === 'shot' ? project.shots.find((x) => x.id === (ui.selection as { id: string }).id) : null;
  if (!sh?.pageId) { toast('Sélectionne d’abord une case dans la timeline.', 'error'); return false; }
  addOverlay({ kind: 'panel', pageId: sh.pageId, rect: sh.rect });
  return true;
}
/** pictures and videos from files, each on an overlay track at the playhead (one after the other) */
export async function importOverlayFiles(files: File[]) {
  let at = getState().ui.playhead;
  for (const f of files) {
    try {
      if (f.type.startsWith('video/')) {
        const { id, asset } = await importVideo(f);
        const o = addOverlay({ kind: 'video', mediaId: id, name: f.name, offset: 0, sourceDuration: asset.duration, width: asset.width, height: asset.height }, { start: at });
        at += o.duration;
        // a large video gets a light copy for a fluid preview, like the rush
        const { needsProxy } = await import('./engine/proxy');
        if (needsProxy(asset.width, asset.height)) void import('./production/kinds').then((K) => K.proxyMedia(id, asset.width, asset.height));
      } else if (f.type.startsWith('image/')) {
        const { id } = await importImage(f);
        const o = addOverlay({ kind: 'image', mediaId: id, name: f.name }, { start: at });
        at += o.duration;
      } else toast(`${f.name} : seulement des images ou des vidéos en superposition.`, 'error');
    } catch (e) { toast(`${f.name} : ${(e as Error).message}`, 'error'); }
  }
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
  const panels = p0.shots.filter((s) => s.pageId).slice(0, kind === 'versus' ? 2 : kind === 'orbit' ? 6 : 4);
  const items = kind === 'map' ? [1, 2, 3].map((i) => ({ id: uid('di_'), label: `Lieu ${i}`, sub: '' })) : panels.map((s, i) => ({ id: uid('di_'), label: kind === 'timeline' ? `Étape ${i + 1}` : `Personnage ${i + 1}`, sub: kind === 'scale' || kind === 'tiers' ? String((i + 1) * 10) : '', pageId: s.pageId!, rect: s.rect }));
  const titles: Record<DiagramKind, string> = { timeline: 'La chronologie', network: 'Qui est lié à qui', versus: 'Le duel', ranking: 'Le top', scale: 'Échelle de puissance', orbit: 'Les personnages', cosmos: 'Au-delà', tiers: 'Du plus faible au plus fort', quote: 'Citation', map: 'La carte' };
  const shot = newShot(p0, {
    pageId: null, duration: kind === 'map' ? 10 : kind === 'orbit' || kind === 'cosmos' || kind === 'tiers' ? 8 : 6, transition: 'fade', transitionDur: 0.4, layout: 'full',
    start: p0.aroll ? getState().ui.playhead : undefined,
    caption: { ...p0.defaultCaption, text: '' },
    diagram: { kind, title: titles[kind], items, links: [] },
  });
  const sel = getState().ui.selection;
  update((p) => {
    const i = sel?.kind === 'shot' ? p.shots.findIndex((s) => s.id === sel.id) + 1 : p.shots.length;
    return { ...p, shots: [...p.shots.slice(0, i), shot, ...p.shots.slice(i)] };
  });
  // show the new diagram right away
  const at = layoutShots(getState().project).find((t) => t.shot.id === shot.id);
  setUI({ selection: { kind: 'shot', id: shot.id }, mode: 'preview', ...(at ? { playhead: at.start + Math.min(1.5, at.shot.duration * 0.4) } : {}) });
}

export const togglePageSkip = (id: string) =>
  update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === id ? { ...x, skip: !x.skip } : x)) }));

/** Re-cut pages with Google Gemini (precise boxes); pages animated by zones by default. */
export async function aiRecut(pageIds?: string[]) {
  const { geminiPanels, hasGoogle } = await import('./engine/google');
  if (!hasGoogle()) { setUI({ settingsOpen: true }); toast('Ajoute ta clé Google dans les réglages pour la détection IA.', 'error'); return 0; }
  const p0 = getState().project;
  const ids = pageIds ?? p0.pages.filter((pg) => pg.cut === 'zones' && !pg.skip).map((pg) => pg.id);
  let done = 0;
  for (const [k, id] of ids.entries()) {
    const pg = getState().project.pages.find((x) => x.id === id);
    const a = pg && getImage(pg.mediaId);
    if (!pg || !a) continue;
    setUI({ busy: `Détection IA des cases ${k + 1}/${ids.length}…` });
    try {
      const c = document.createElement('canvas');
      const s = Math.min(1, 1400 / Math.max(a.width, a.height));
      c.width = Math.round(a.width * s); c.height = Math.round(a.height * s);
      c.getContext('2d')!.drawImage(a.img, 0, 0, c.width, c.height);
      const boxes = await geminiPanels(c.toDataURL('image/jpeg', 0.85).split(',')[1], getState().project.readingOrder === 'rtl');
      if (!boxes.length) continue;
      const rects = boxes.map((b) => ({ x: Math.round(b.x0 * a.width), y: Math.round(b.y0 * a.height), w: Math.round((b.x1 - b.x0) * a.width), h: Math.round((b.y1 - b.y0) * a.height) }));
      const kind = rects.length === 1 && rects[0].w * rects[0].h > a.width * a.height * 0.7 ? 'splash' : 'panels';
      update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === id ? { ...x, cut: kind } : x)) }));
      replacePageShots(id, rects, kind === 'splash' ? 'splash' : undefined);
      done++;
    } catch (e) {
      toast((e as Error).message, 'error');
      break;
    }
  }
  setUI({ busy: null });
  if (done) toast(`${done} page${done > 1 ? 's' : ''} recoupée${done > 1 ? 's' : ''} par l’IA Google`);
  return done;
}

/** change what a page is; covers/splashes/text become one whole-page shot, story pages are cut again */
export function setPageKind(id: string, kind: PageKind) {
  const pg = getState().project.pages.find((x) => x.id === id);
  const a = pg && getImage(pg.mediaId);
  if (!pg || !a) return;
  update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === id ? { ...x, kind, kindWhy: 'choisi à la main', skip: PAGE_KINDS[kind].skip } : x)) }));
  if (kind === 'story' || kind === 'spread') redetect(id);
  else replacePageShots(id, [{ x: 0, y: 0, w: a.width, h: a.height }], 'splash');
}

/** Classify every page with Google Gemini in one request per 40 pages. */
export async function classifyWithGoogle() {
  const { geminiClassify, hasGoogle } = await import('./engine/google');
  if (!hasGoogle()) { setUI({ settingsOpen: true }); return; }
  const pages = getState().project.pages;
  try {
    for (let k = 0; k < pages.length; k += 40) {
      setUI({ busy: `Google classe les pages ${k + 1}–${Math.min(pages.length, k + 40)}…` });
      const batch = pages.slice(k, k + 40);
      const thumbs = batch.map((pg) => {
        const a = getImage(pg.mediaId)!;
        const c = document.createElement('canvas');
        const s = 320 / Math.max(a.width, a.height);
        c.width = Math.round(a.width * s); c.height = Math.round(a.height * s);
        c.getContext('2d')!.drawImage(a.img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.75).split(',')[1];
      });
      const kinds = await geminiClassify(thumbs);
      batch.forEach((pg, i) => { const kd = kinds[i]; if (kd && kd !== pg.kind) setPageKind(pg.id, kd); });
    }
    toast('Pages classées par Google');
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setUI({ busy: null });
  }
}

/* --------------------------------------------- reading the comics (AI) */

/** Read every page: local OCR of the balloons, or Google (summary + panel descriptions + characters). */
export async function analyzeComics(engine: 'local' | 'google') {
  const p0 = getState().project;
  try {
    if (engine === 'local') {
      // a production task: resumable, and panels whose text was typed by hand meanwhile are left alone
      const { runTask } = await import('./production/kinds');
      toast('Lecture des bulles ajoutée à la file de tâches');
      void runTask('comics.read', { n: p0.pages.filter((pg) => !pg.skip).length });
      return;
    }
    const { geminiReadPages, hasGoogle } = await import('./engine/google');
    if (!hasGoogle()) { setUI({ settingsOpen: true }); toast('Ajoute ta clé Google dans les réglages.', 'error'); return; }
    const pages = p0.pages.filter((pg) => !pg.skip);
    for (let k = 0; k < pages.length; k += 4) {
      setUI({ busy: `Google lit les pages ${k + 1}–${Math.min(pages.length, k + 4)} / ${pages.length}…` });
      const batch = pages.slice(k, k + 4);
      const jpegs = batch.map((pg) => {
        const a = getImage(pg.mediaId)!;
        const c = document.createElement('canvas');
        const s = Math.min(1, 1100 / Math.max(a.width, a.height));
        c.width = Math.round(a.width * s); c.height = Math.round(a.height * s);
        c.getContext('2d')!.drawImage(a.img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.82).split(',')[1];
      });
      const reads = await geminiReadPages(jpegs);
      batch.forEach((pg, i) => {
        const r = reads[i];
        const a = getImage(pg.mediaId)!;
        const boxes = r.panels.map((q) => ({ ...q, rect: { x: Math.round(q.box.x0 * a.width), y: Math.round(q.box.y0 * a.height), w: Math.round((q.box.x1 - q.box.x0) * a.width), h: Math.round((q.box.y1 - q.box.y0) * a.height) } }))
          .filter((q) => q.rect.w > 20 && q.rect.h > 20);
        const iou = (x: Rect, y: Rect) => { const w = Math.min(x.x + x.w, y.x + y.w) - Math.max(x.x, y.x), h = Math.min(x.y + x.h, y.y + y.h) - Math.max(x.y, y.y); const i2 = w > 0 && h > 0 ? w * h : 0; return i2 / (x.w * x.h + y.w * y.h - i2); };
        update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === pg.id ? { ...x, summary: r.summary } : x)) }));
        const page = getState().project.pages.find((x) => x.id === pg.id)!;
        // uncertain pages take Google's panels; good pages keep their cut and get the descriptions
        if ((page.cut === 'zones' || !getState().project.shots.some((s) => s.pageId === pg.id)) && page.kind !== 'cover' && boxes.length) {
          replacePageShots(pg.id, boxes.map((b) => b.rect));
          update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === pg.id ? { ...x, cut: 'panels' } : x)) }));
          const created = getState().project.shots.filter((s) => s.pageId === pg.id);
          update((p) => ({ ...p, shots: p.shots.map((s) => { const k2 = created.findIndex((c) => c.id === s.id); return k2 >= 0 && boxes[k2] ? { ...s, desc: boxes[k2].desc, text: boxes[k2].dialogue, chars: boxes[k2].characters } : s; }) }));
        } else {
          update((p) => ({
            ...p,
            shots: p.shots.map((s) => {
              if (s.pageId !== pg.id) return s;
              let best = -1, bv = 0.2;
              boxes.forEach((b, j) => { const v = iou(s.rect, b.rect); if (v > bv) { bv = v; best = j; } });
              if (best < 0) return { ...s, desc: s.desc ?? r.summary };
              const b = boxes[best];
              return { ...s, desc: b.desc, text: b.dialogue || s.text, chars: b.characters };
            }),
          }));
        }
      });
    }
    toast(`Google a lu ${pages.length} pages`);
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setUI({ busy: null });
  }
}

/** pick another panel for a placed shot (keeps its timing) */
export function swapPanel(shotId: string, pageId: string, rect: Rect) {
  update((p) => ({ ...p, shots: p.shots.map((s) => (s.id === shotId ? { ...s, pageId, rect, focus: undefined, zone: undefined, match: s.match ? { ...s.match, conf: 1 } : undefined } : s)) }));
}
export const confirmMatch = (shotId: string) =>
  update((p) => ({ ...p, shots: p.shots.map((s) => (s.id === shotId && s.match ? { ...s, match: { ...s.match, conf: 1 } } : s)) }));

/** Google search in the background: identify the comics, cast, summary, key facts */
export async function researchComics() {
  const { geminiResearch, hasGoogle } = await import('./engine/google');
  if (!hasGoogle()) { setUI({ settingsOpen: true }); return; }
  const p = getState().project;
  const titles = [...new Set(p.pages.map((pg) => (pg.source ?? pg.name).replace(/^[0-9a-f]{6,}-/i, '').replace(/_/g, ' ')))].slice(0, 6);
  const hints = p.shots.map((s) => s.text).filter(Boolean).join(' ').slice(0, 1500);
  setUI({ busy: 'Recherche Google sur les comics…' });
  try {
    const r = await geminiResearch(titles, hints);
    const { tagCharacters } = await import('./engine/lexicon');
    update((x) => tagCharacters({ ...x, research: r }));
    toast(`Recherche : ${r.title} · ${r.characters.length} personnages`);
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setUI({ busy: null });
  }
}

/* ------------------------------------------------ 2.5D + balloon prep */

const balloonCache = new Map<string, Rect[]>();

/** balloons per panel (for the pop-in) and depth layers (for the 2.5D parallax) of the edit's shots */
export async function prepareMotion(opts: { quiet?: boolean; step?: (i: number, n: number) => Promise<void> } = {}) {
  const { findBalloons } = await import('./engine/understand');
  const { ensureLayers } = await import('./engine/layers');
  const p = getState().project;
  // balloons: one detection per page
  const withBalloons = new Map<string, Rect[]>();
  for (const s of p.shots) {
    if (!s.pageId || s.zone) continue;
    const pg = p.pages.find((x) => x.id === s.pageId);
    const a = pg && getImage(pg.mediaId);
    if (!pg || !a) continue;
    if (!balloonCache.has(pg.id)) {
      // the local AI detector knows real balloons and captions; the heuristic is the fallback
      const det = await detectWithAI(pg.mediaId, a.img, a.width, a.height).catch(() => null);
      balloonCache.set(pg.id, det ? det.bubbles.filter((b) => b.s >= 0.35).map(({ x, y, w, h }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })) : findBalloons(a.img, a.width, a.height));
    }
    const inside = comicOrder(balloonCache.get(pg.id)!.filter((b) => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      return cx > s.rect.x && cx < s.rect.x + s.rect.w && cy > s.rect.y && cy < s.rect.y + s.rect.h;
    }), getState().project.readingOrder === 'rtl').slice(0, 6);
    withBalloons.set(s.id, inside);
  }
  update((x) => ({ ...x, shots: x.shots.map((s) => (withBalloons.has(s.id) ? { ...s, balloons: withBalloons.get(s.id) } : s)) }), 'balloons');
  if (p.look?.parallax === false) return;
  const todo = getState().project.shots.filter((s) => s.pageId && !s.zone && s.layout === 'full').slice(0, 120);
  for (let i = 0; i < todo.length; i++) {
    await opts.step?.(i, todo.length);
    if (!opts.quiet) setUI({ busy: `Relief 2.5D ${i + 1}/${todo.length}…` });
    await ensureLayers(getState().project, todo[i], (pr) => !opts.quiet && setUI({ busy: `Modèle de profondeur… ${Math.round(pr * 100)} %` }));
  }
  if (!opts.quiet) setUI({ busy: null });
}

/* ------------------------------------------------- script suggestions */

export function acceptSuggestion(sg: import('./engine/scriptIntel').Suggestion, passageText = '') {
  const p0 = getState().project;
  const el = suggestionElement(p0, sg, passageText);
  if (el.fx) { addFx('callout', el.fx); return; }
  const shot = el.shot!;
  update((p) => { const q = { ...p, shots: insertAtTime(p, shot, sg.at) }; return { ...q, shots: fixRepeats(q) }; }, 'accept-' + sg.id);
  const at = layoutShots(getState().project).find((t) => t.shot.id === shot.id);
  setUI({ selection: { kind: 'shot', id: shot.id }, ...(at ? { playhead: at.start + Math.min(1.2, at.shot.duration * 0.4) } : {}) });
}

/** the user locks a page: automatic edits (director, re-detection) leave its shots alone */
export function togglePageLock(pageId: string) {
  update((p) => ({ ...p, pages: p.pages.map((x) => (x.id === pageId ? { ...x, locked: !x.locked } : x)) }), 'lock');
  const pg = getState().project.pages.find((x) => x.id === pageId);
  toast(pg?.locked ? 'Page verrouillée : le montage automatique ne touchera plus ses cases.' : 'Page déverrouillée.');
}

/** reading order by hand: the panel swaps with the previous / next panel of the same page */
export function movePanel(shotId: string, dir: -1 | 1) {
  update((p) => {
    const i = p.shots.findIndex((s) => s.id === shotId);
    if (i < 0) return p;
    const pageId = p.shots[i].pageId;
    let j = i + dir;
    while (j >= 0 && j < p.shots.length && p.shots[j].pageId !== pageId) j += dir;
    if (j < 0 || j >= p.shots.length) return p;
    const shots = [...p.shots];
    [shots[i], shots[j]] = [shots[j], shots[i]];
    // the order is now the user's: no more doubt on this page
    return { ...p, shots, pages: p.pages.map((x) => (x.id === pageId ? { ...x, orderDoubt: undefined } : x)) };
  }, 'order');
}

/**
 * The user picks a camera move. Page-level moves (glide, panel to panel,
 * reveal) get their path built from the page's geometry; any other move
 * clears the path and the shared composition, so the panel is framed again.
 */
export async function setCameraMode(shotId: string, motion: import('./types').Motion) {
  const { pageGlide, panelNavigation, reveal } = await import('./engine/comicCamera');
  const { cachedDetection } = await import('./engine/panelAI');
  const p = getState().project;
  const s = p.shots.find((x) => x.id === shotId);
  const pg = s?.pageId ? p.pages.find((x) => x.id === s.pageId) : null;
  if (!s) return;
  const pageLevel = motion === 'page-glide' || motion === 'panel-nav' || motion === 'reveal';
  if (!pageLevel || !pg) {
    update((x) => ({ ...x, shots: x.shots.map((q) => (q.id === shotId ? { ...q, motion, path: undefined, shared: undefined, auto: undefined } : q)) }), 'motion');
    return;
  }
  const { w: W, h: H } = (await import('./types')).FORMATS[p.format];
  const det = cachedDetection(pg.mediaId);
  const info = {
    w: pg.width, h: pg.height, kind: pg.kind,
    panels: p.shots.filter((x) => x.pageId === pg.id && x.id !== shotId).map((x) => x.rect).concat(s.rect.w < pg.width * 0.95 ? [s.rect] : []),
    balloons: det ? comicOrder(det.bubbles.filter((b) => b.s >= 0.35).map(({ x, y, w, h }) => ({ x, y, w, h })), p.readingOrder === 'rtl') : (s.balloons ?? []),
  };
  info.panels = comicOrder(info.panels, p.readingOrder === 'rtl');
  const aspect = W / H;
  const focus = info.balloons[0] ?? s.rect;
  const path = motion === 'page-glide' ? pageGlide(info, aspect) : motion === 'panel-nav' ? panelNavigation(info, aspect) : reveal(info, focus, aspect);
  update((x) => ({ ...x, shots: x.shots.map((q) => (q.id === shotId ? { ...q, motion, path, shared: true, auto: undefined } : q)) }), 'motion');
}

/** pages of other projects (media library) added to this one: the same file is referenced, never copied */
export async function addFromLibrary(items: { id: string; name: string; width?: number; height?: number; source?: string; srcIndex?: number; srcCount?: number }[]) {
  const have = new Set(getState().project.pages.map((pg) => pg.mediaId));
  const todo = items.filter((x) => !have.has(x.id));
  if (!todo.length) { toast('Ces pages sont déjà dans le projet'); return 0; }
  const { ensureMedia } = await import('./engine/media');
  const pages: Page[] = [];
  for (const x of todo) {
    try {
      await ensureMedia(x.id, 'image');
      const a = getImage(x.id);
      pages.push({ id: uid('pg_'), name: x.name, mediaId: x.id, width: a?.width ?? x.width ?? 1000, height: a?.height ?? x.height ?? 1500, source: x.source, srcIndex: x.srcIndex, srcCount: x.srcCount, analysing: true });
    } catch { toast(`${x.name} : image introuvable dans l’espace de projets`, 'error'); }
  }
  if (!pages.length) return 0;
  update((p) => ({ ...p, pages: [...p.pages, ...pages] }));
  const { analysePages } = await import('./production/kinds');
  await analysePages(pages.map((pg) => pg.id));
  toast(`${pages.length} page${pages.length > 1 ? 's' : ''} ajoutée${pages.length > 1 ? 's' : ''} depuis la médiathèque (lecture des cases en cours)`);
  return pages.length;
}


/* ---------------------------------------------------------------- precise editing at the playhead */

/** S: cut the selected shot, overlay, sound clip or effect in two at the playhead (one undo step) */
export function splitAtPlayhead(): boolean {
  const { ui, project } = getState();
  const t = ui.playhead, sel = ui.selection;
  if (!sel || !('id' in sel)) { toast('Sélectionne un plan, un calque, un son ou un effet à couper.', 'error'); return false; }
  const inside = (s: number, d: number) => t > s + 0.05 && t < s + d - 0.05;
  if (sel.kind === 'shot') {
    const ts = layoutShots(project).find((x) => x.shot.id === sel.id);
    if (!ts || !inside(ts.start, ts.shot.duration)) { toast('Place le curseur dans le plan à couper.', 'error'); return false; }
    const a = t - ts.start;
    const second: Shot = { ...ts.shot, id: uid('s_'), duration: ts.shot.duration - a, transition: 'cut', ...(ts.shot.start != null ? { start: ts.shot.start + a } : {}) };
    update((p) => { const i = p.shots.findIndex((x) => x.id === sel.id); const shots = [...p.shots]; shots.splice(i, 1, { ...p.shots[i], duration: a }, second); return { ...p, shots }; });
    return true;
  }
  if (sel.kind === 'overlay') {
    const o = project.overlays?.find((x) => x.id === sel.id);
    if (!o || !inside(o.start, o.duration)) { toast('Place le curseur dans le calque à couper.', 'error'); return false; }
    const a = t - o.start;
    const src = o.source.kind === 'video' ? { ...o.source, offset: o.source.offset + a } : o.source;
    const second: Overlay = { ...o, id: uid('ov_'), start: t, duration: o.duration - a, source: src, soundClip: undefined, box: o.boxEnd ?? o.box, boxEnd: undefined };
    update((p) => ({ ...p, overlays: (p.overlays ?? []).flatMap((x) => (x.id === o.id ? [{ ...x, duration: a }, second] : [x])) }));
    return true;
  }
  if (sel.kind === 'audio') {
    const c = project.audio.find((x) => x.id === sel.id);
    if (!c || !inside(c.start, c.duration)) { toast('Place le curseur dans le son à couper.', 'error'); return false; }
    const a = t - c.start;
    update((p) => ({ ...p, audio: p.audio.flatMap((x) => (x.id === c.id ? [{ ...x, duration: a, fadeOut: 0.05 }, { ...x, id: uid('a_'), start: t, offset: x.offset + a, duration: x.duration - a, fadeIn: 0.05, words: x.words }] : [x])) }));
    return true;
  }
  if (sel.kind === 'fx') {
    const f = project.fx.find((x) => x.id === sel.id);
    if (!f || !inside(f.start, f.duration)) { toast('Place le curseur dans l’effet à couper.', 'error'); return false; }
    const a = t - f.start;
    update((p) => ({ ...p, fx: p.fx.flatMap((x) => (x.id === f.id ? [{ ...x, duration: a }, { ...x, id: uid('fx_'), start: t, duration: x.duration - a }] : [x])) }));
    return true;
  }
  return false;
}

/** [ and ]: the selected element starts (or ends) at the playhead */
export function trimToPlayhead(side: 'start' | 'end'): boolean {
  const { ui, project } = getState();
  const t = ui.playhead, sel = ui.selection;
  if (!sel || !('id' in sel)) return false;
  const trim = (s: number, d: number) => {
    const end = s + d;
    if (side === 'start') return t < end - 0.1 ? { start: Math.max(0, t), duration: end - Math.max(0, t), cut: Math.max(0, t) - s } : null;
    return t > s + 0.1 ? { start: s, duration: t - s, cut: 0 } : null;
  };
  if (sel.kind === 'overlay') {
    const o = project.overlays?.find((x) => x.id === sel.id); const r = o && trim(o.start, o.duration);
    if (!o || !r) return false;
    const src = o.source.kind === 'video' ? { ...o.source, offset: Math.max(0, o.source.offset + r.cut) } : o.source;
    patchOverlay(o.id, { start: r.start, duration: r.duration, source: src });
    return true;
  }
  if (sel.kind === 'audio') {
    const c = project.audio.find((x) => x.id === sel.id); const r = c && trim(c.start, c.duration);
    if (!c || !r) return false;
    update((p) => ({ ...p, audio: p.audio.map((x) => (x.id === c.id ? { ...x, start: r.start, duration: r.duration, offset: Math.max(0, x.offset + r.cut) } : x)) }));
    return true;
  }
  if (sel.kind === 'fx') {
    const f = project.fx.find((x) => x.id === sel.id); const r = f && trim(f.start, f.duration);
    if (!f || !r) return false;
    update((p) => ({ ...p, fx: p.fx.map((x) => (x.id === f.id ? { ...x, start: r.start, duration: r.duration } : x)) }));
    return true;
  }
  if (sel.kind === 'shot' && side === 'end') {
    const ts = layoutShots(project).find((x) => x.shot.id === sel.id);
    if (!ts || t <= ts.start + 0.3) return false;
    update((p) => ({ ...p, shots: p.shots.map((x) => (x.id === sel.id ? { ...x, duration: t - ts.start } : x)) }));
    return true;
  }
  return false;
}


/**
 * Overlays the auto edit places from the script (comparison, « meanwhile », reminder),
 * each explained. The ones the user placed or changed are kept; the previous automatic
 * ones are replaced. A picture-in-picture goes where it hides the least drawing.
 */
export async function withAutoOverlays(p: Project): Promise<Project> {
  const { suggestOverlays } = await import('./engine/overlaySuggest');
  let cur: Project = { ...p, overlays: (p.overlays ?? []).filter((o) => !o.auto) };
  const props = suggestOverlays(cur);
  // a picture-in-picture must not hide text: the lettering of the pages under them is read first (local, cached)
  if (props.some((x) => x.place === 'pip')) {
    const used = new Set(layoutShots(cur).filter((t) => props.some((x) => t.start < x.at + x.duration && x.at < t.end)).map((t) => t.shot.pageId).filter(Boolean) as string[]);
    for (const pg of cur.pages.filter((x) => used.has(x.id))) { const a = getImage(pg.mediaId); if (a) await readLines(pg.mediaId, a.img, a.width, a.height).catch(() => null); }
  }
  for (const s of props) {
    const o: Overlay = {
      id: uid('ov_'), start: s.at, duration: s.duration, track: freeTrack(cur, s.at, s.duration),
      source: { kind: 'panel', pageId: s.pageId, rect: s.rect }, place: s.place, zoom: 1, fade: 0.35,
      enter: s.place === 'pip' ? 'pop' : 'slide', corner: s.place === 'pip' ? quietCorner(cur, s.at, s.rect.w / Math.max(1, s.rect.h), s.duration) : undefined,
      auto: true, why: s.raison,
    };
    cur = { ...cur, overlays: [...(cur.overlays ?? []), o] };
  }
  return cur;
}


/* ---------------------------------------------------------------- music, series, short version */

/**
 * a voice-led edit keeps its cuts on the voice; the music is moved instead so a bar
 * starts on the revelation of the creative director (the strongest moment lands on a beat)
 */
export async function alignMusicOnReveal(p: Project): Promise<{ project: Project; shift: number } | null> {
  const rev = p.direction?.sequences?.find((q) => q.type === 'revelation');
  const music = p.audio.find((c) => c.kind === 'music');
  const buf = music && getAudio(music.mediaId);
  if (!rev || !music || !buf || rev.start < music.start || rev.start > music.start + music.duration) return null;
  const { detectBeats } = await import('./engine/beats');
  const g = detectBeats(buf, music.offset, Math.min(buf.duration, music.offset + 600));
  if (!g || g.confidence <= 1.15) return null;
  let step = 60 / g.bpm; while (step < 0.3) step *= 2;
  const bar = step * 4;
  const src = music.offset + (rev.start - music.start);
  const target = g.offset + Math.round((src - g.offset) / bar) * bar;
  let off = music.offset + (target - src);
  if (off < 0) off += bar;
  if (off + music.duration > buf.duration || Math.abs(off - music.offset) < 0.02) return null;
  return { project: { ...p, audio: p.audio.map((c) => (c.id === music.id ? { ...c, offset: off } : c)) }, shift: off - music.offset };
}

/** the look of a series (art direction, subtitles, colours), kept in this browser and given back to its next videos */
const THEMES = 'forge.seriesThemes';
type SeriesTheme = Pick<Project, 'art' | 'accent' | 'diagramStyle' | 'titleStyle'> & { subtitleStyle: Project['subtitleStyle']; look: Project['look']; profile?: string; savedAt: string };
const readThemes = (): Record<string, SeriesTheme> => { try { return JSON.parse(localStorage.getItem(THEMES) || '{}'); } catch { return {}; } };
export async function seriesName(p: Project): Promise<string> {
  const { seriesOf } = await import('./engine/publish');
  return seriesOf(p)[0] ?? p.name.replace(/\s*[—-]\s*épisode\s*\d+\s*$/i, '').trim();
}
export async function saveSeriesTheme(): Promise<string> {
  const p = getState().project; const name = await seriesName(p);
  const all = readThemes();
  all[name] = { art: p.art, accent: p.accent, diagramStyle: p.diagramStyle, titleStyle: p.titleStyle, subtitleStyle: p.subtitleStyle, look: p.look, profile: p.direction?.profile, savedAt: new Date().toISOString() };
  try { localStorage.setItem(THEMES, JSON.stringify(all)); } catch { /* storage blocked */ }
  toast(`Thème de la série « ${name} » enregistré : il sera proposé pour ses prochaines vidéos.`);
  return name;
}
export async function applySeriesTheme(): Promise<boolean> {
  const p = getState().project; const name = await seriesName(p); const th = readThemes()[name];
  if (!th) { toast(`Aucun thème enregistré pour « ${name} » : règle une vidéo de la série puis « Enregistrer le thème de la série ».`, 'error'); return false; }
  update((x) => ({ ...x, art: th.art ?? x.art, accent: th.accent ?? x.accent, diagramStyle: th.diagramStyle ?? x.diagramStyle, titleStyle: th.titleStyle ?? x.titleStyle, subtitleStyle: { ...x.subtitleStyle, ...th.subtitleStyle }, look: { ...x.look, ...th.look }, direction: th.profile ? { ...(x.direction ?? { profile: th.profile }), profile: th.profile } : x.direction }));
  toast(`Thème « ${name} » appliqué (annulable avec Ctrl+Z).`);
  return true;
}
export const hasSeriesTheme = async () => !!readThemes()[await seriesName(getState().project)];

/** series mode: a new project for the next episode, with this one's settings and look, numbered */
export async function nextEpisode(): Promise<void> {
  const p = getState().project; const name = await seriesName(p);
  const n = (p.episode ?? 1) + 1;
  const { freshProject, openAsNewProject } = await import('./lib/studio');
  const { templateFrom } = await import('./lib/workspace');
  const next: Project = { ...freshProject(`${name} — épisode ${n}`, { id: 'ep', name, createdAt: new Date().toISOString(), settings: templateFrom(p) }), episode: n };
  if (!p.episode) update((x) => ({ ...x, episode: 1 }));
  await openAsNewProject(next);
  toast(`Épisode ${n} de « ${name} » créé, avec le style de l’épisode précédent.`);
}

/**
 * a Short (≤ 45 s) from a long voice-over video: the hook, the revelation, the
 * named characters and the conclusion, in their order, as a new project (the long
 * one is untouched). Pictures, voice, subtitles and overlays follow the cut.
 */
export async function makeShortVersion(target = 45): Promise<boolean> {
  const p = getState().project;
  if (p.aroll) { toast('Version courte : pour l’instant, les vidéos en voix off seulement (pas encore avec un rush face caméra).', 'error'); return false; }
  const { shortRanges } = await import('./engine/polish');
  const ranges = shortRanges(p, target);
  if (!ranges.length) { toast('Version courte : il faut une voix off transcrite ou un script calé sur la voix.', 'error'); return false; }
  const timed = layoutShots(p);
  const shots: Shot[] = [], audio: AudioClip[] = [], subtitles: typeof p.subtitles = [], overlays: Overlay[] = [];
  let at = 0;
  for (const r of ranges) {
    const map = (t: number) => at + (t - r.s);
    for (const ts of timed) {
      const s0 = Math.max(ts.start, r.s), e0 = Math.min(ts.end, r.e);
      if (e0 - s0 > 0.25) shots.push({ ...ts.shot, id: uid('s_'), start: undefined, duration: e0 - s0, transition: shots.length ? ts.shot.transition : 'cut' });
    }
    for (const c of p.audio.filter((x) => x.kind === 'voice' || x.kind === 'sfx')) {
      const s0 = Math.max(c.start, r.s), e0 = Math.min(c.start + c.duration, r.e);
      if (e0 - s0 > 0.05) audio.push({ ...c, id: uid('a_'), start: map(s0), offset: c.offset + (s0 - c.start), duration: e0 - s0, fadeIn: 0.03, fadeOut: 0.05 });
    }
    for (const sb of p.subtitles) if (sb.s >= r.s - 0.05 && sb.e <= r.e + 0.05) subtitles.push({ ...sb, s: map(sb.s), e: map(sb.e), words: sb.words.map((w) => ({ ...w, s: map(w.s), e: map(w.e) })) });
    for (const o of p.overlays ?? []) { const s0 = Math.max(o.start, r.s), e0 = Math.min(o.start + o.duration, r.e); if (e0 - s0 > 0.3) overlays.push({ ...o, id: uid('ov_'), start: map(s0), duration: e0 - s0, soundClip: undefined }); }
    at += r.e - r.s;
  }
  const music = p.audio.find((c) => c.kind === 'music');
  if (music) audio.push({ ...music, id: uid('a_'), start: 0, duration: Math.min(at, music.sourceDuration - music.offset), fadeOut: 1.5 });
  const { openAsNewProject } = await import('./lib/studio');
  await openAsNewProject({ ...p, name: `${p.name} (version courte)`, shots, audio, subtitles, overlays, fx: [], storyboard: undefined, format: '9:16' });
  toast(`Version courte : ${at.toFixed(0)} s, ${ranges.length} passages (${[...new Set(ranges.map((r) => r.why))].join(', ')}). La version longue n’est pas modifiée.`);
  return true;
}
