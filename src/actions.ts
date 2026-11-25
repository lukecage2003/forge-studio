import type { DiagramKind, FxItem, FxKind } from './types';
import type { AudioKind, Page, Project, Rect } from './types';
import { getState, newShot, setUI, update } from './store';
import { getImage, importAudio, importImage } from './engine/media';
import { cutPage } from './engine/detect';
import { filesToPages } from './engine/importers';
import { classifyPage, medianAspect } from './engine/classify';
import { PAGE_KINDS, type PageKind } from './types';
import { uid } from './lib/util';
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
    let zones = 0;
    const kinds: Partial<Record<PageKind, number>> = {};
    update((p) => {
      let next: Project = { ...p, pages: [...p.pages, ...pages] };
      if (opts.autoCut) {
        const aspects = new Map<string, number>();
        for (const src of new Set(pages.map((x) => x.source ?? ''))) aspects.set(src, medianAspect(pages.filter((x) => x.source === src)));
        let prev: { source?: string; kind?: PageKind } = {};
        for (const pg of pages) {
          const a = getImage(pg.mediaId)!;
          const cut = cutPage(a.img, a.width, a.height, p.readingOrder === 'rtl');
          const cls = classifyPage(a.img, a.width, a.height, cut, {
            srcIndex: pg.srcIndex ?? 0, srcCount: pg.srcCount ?? 1, medianAspect: aspects.get(pg.source ?? '') ?? 0.65,
            hint: pg.kindWhy, prevKind: prev.source === pg.source ? prev.kind : undefined,
          });
          prev = { source: pg.source, kind: cls.kind };
          pg.kind = cls.kind;
          pg.kindWhy = cls.why;
          pg.skip = PAGE_KINDS[cls.kind].skip;
          pg.cut = cut.kind;
          kinds[cls.kind] = (kinds[cls.kind] ?? 0) + 1;
          const whole = cls.kind === 'cover' || cls.kind === 'variant' || cls.kind === 'splash' || cls.kind === 'text' || cls.kind === 'ad' || cls.kind === 'blank';
          if (!whole && cut.kind === 'zones') zones++;
          const rects = whole ? [{ x: 0, y: 0, w: a.width, h: a.height }] : cut.rects;
          const shots = rects.map((rect) => newShot(next, { pageId: pg.id, rect, zone: whole ? 'splash' : cut.kind === 'panels' ? undefined : cut.kind }));
          next = { ...next, shots: [...next.shots, ...shots] };
        }
      }
      return next;
    });
    const n = getState().project.shots.length;
    setUI({ activePageId: pages[0]?.id ?? null, selection: pages[0] ? { kind: 'page', id: pages[0].id } : null });
    toast(`${pages.length} page${pages.length > 1 ? 's' : ''} importée${pages.length > 1 ? 's' : ''} · ${n} plans${zones ? ` · ${zones} page${zones > 1 ? 's' : ''} animée${zones > 1 ? 's' : ''} par bandes` : ''}`);
    const skipped = Object.entries(kinds).filter(([k]) => PAGE_KINDS[k as PageKind].skip).map(([k, v]) => `${v} ${PAGE_KINDS[k as PageKind].label.toLowerCase()}`);
    const covers = kinds.cover ?? 0;
    toast(`Pages reconnues : ${covers} couverture${covers > 1 ? 's' : ''}, ${kinds.story ?? 0} planches${kinds.splash ? `, ${kinds.splash} pleines pages` : ''}${kinds.spread ? `, ${kinds.spread} doubles pages` : ''}${skipped.length ? ` · exclues : ${skipped.join(', ')}` : ''}`);
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
  const panels = p0.shots.filter((s) => s.pageId).slice(0, kind === 'versus' ? 2 : kind === 'orbit' ? 6 : 4);
  const items = panels.map((s, i) => ({ id: uid('di_'), label: kind === 'timeline' ? `Étape ${i + 1}` : `Personnage ${i + 1}`, sub: kind === 'scale' || kind === 'tiers' ? String((i + 1) * 10) : '', pageId: s.pageId!, rect: s.rect }));
  const titles: Record<DiagramKind, string> = { timeline: 'La chronologie', network: 'Qui est lié à qui', versus: 'Le duel', ranking: 'Le top', scale: 'Échelle de puissance', orbit: 'Les personnages', cosmos: 'Au-delà', tiers: 'Du plus faible au plus fort', quote: 'Citation' };
  const shot = newShot(p0, {
    pageId: null, duration: kind === 'orbit' || kind === 'cosmos' || kind === 'tiers' ? 8 : 6, transition: 'fade', transitionDur: 0.4, layout: 'full',
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
      const { ocrPages } = await import('./engine/understand');
      const texts = await ocrPages(p0, (i, n) => setUI({ busy: i < 0 ? 'Chargement du lecteur de bulles…' : `Lecture des bulles ${Math.min(i + 1, n)}/${n}…` }));
      const { tagCharacters } = await import('./engine/lexicon');
      update((p) => tagCharacters({ ...p, shots: p.shots.map((s) => (texts.has(s.id) ? { ...s, text: texts.get(s.id) } : s)) }));
      toast(`Bulles lues sur ${texts.size} cases`);
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
export async function prepareMotion(opts: { quiet?: boolean } = {}) {
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
    if (!balloonCache.has(pg.id)) balloonCache.set(pg.id, findBalloons(a.img, a.width, a.height));
    const inside = balloonCache.get(pg.id)!.filter((b) => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      return cx > s.rect.x && cx < s.rect.x + s.rect.w && cy > s.rect.y && cy < s.rect.y + s.rect.h;
    }).slice(0, 5);
    withBalloons.set(s.id, inside);
  }
  update((x) => ({ ...x, shots: x.shots.map((s) => (withBalloons.has(s.id) ? { ...s, balloons: withBalloons.get(s.id) } : s)) }), 'balloons');
  if (p.look?.parallax === false) return;
  const todo = getState().project.shots.filter((s) => s.pageId && !s.zone && s.layout === 'full').slice(0, 120);
  for (let i = 0; i < todo.length; i++) {
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
