import type { TaskQueue, TaskCtx } from '../engine/queue';
import type { ARoll, FaceKey, Project, Word } from '../types';
import type { PageCut } from '../engine/detect';
import type { PageText } from '../engine/classify';
import { getState, update } from '../store';
import { ensureMedia, getImage, getVideo, ensureVideo } from '../engine/media';
import { cutPageSmart } from '../engine/panelAI';
import { classifyError } from '../engine/queue';
import { yieldToUI } from '../engine/resources';
import { toast } from '../components/Toast';
import { enqueue, startOrchestrator, queue } from './orchestrator';

/**
 * The production tasks. Each one calls the engine that already does the work
 * (panel AI, OCR, Whisper or the AI orchestrator, face tracking, depth model,
 * MP4 export, quality review); the queue adds order, retries, persistence and
 * the protection of manual edits.
 *
 * Every guard starts with the project id: a result never lands in another
 * project, and a result computed before a manual change waits for the user.
 */
type Cut = PageCut & { by: 'ia' | 'algo'; bubbles: number };
const pid = () => getState().project.id;
const hashOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const aroll = (mediaId: unknown): ARoll | null => { const a = getState().project.aroll; return a && a.mediaId === mediaId ? a : null; };
const wordsPrint = (w: Word[] | undefined) => hashOf((w ?? []).map((x) => `${x.w}@${x.s.toFixed(2)}`).join(' '));
/** finished renders of this session (the file also goes to the workspace's exports) */
export const renders = new Map<string, Blob>();
/** extra reports of a render the export window shows while open (encoder, sync check, loudness) */
export const renderHooks = new Map<string, { onCheck?: (c: import('../engine/export').SyncCheck) => void; onEncoder?: (e: { codec: string; mbps: number; hardware: boolean; audio: string | null }) => void; onMix?: (m: import('../engine/audio').MixInfo) => void }>();

export function registerKinds(q: TaskQueue) {
  /* ---------------------------------------------------- comics pages */
  q.register<{ pageId: string; mediaId: string; name: string; rtl: boolean }, { pageId: string; cut: Cut }>({
    kind: 'pages.detect', lane: 'heavy', family: 'panels', keepResult: true, priority: 60,
    label: (p) => `Lecture des cases · ${p.name}`,
    key: (p) => `${p.mediaId}|${p.rtl}`,
    guard: (p) => `${pid()}|${p.pageId}`,
    run: async (ctx, p) => {
      await ensureMedia(p.mediaId, 'image');
      const a = getImage(p.mediaId);
      if (!a) throw Object.assign(new Error('Image de la page introuvable'), { kind: 'input' });
      ctx.progress(0.2);
      return { pageId: p.pageId, cut: await cutPageSmart(p.mediaId, a.img, a.width, a.height, p.rtl) };
    },
  });

  // pages that may not be story pages (few balloons, first or last pages of a file): their text says what they are
  q.register<{ pageId: string; mediaId: string; srcIndex: number; srcCount: number }, { pageId: string; text: PageText | null; note?: string }>({
    kind: 'pages.text', lane: 'heavy', family: 'tesseract', keepResult: true, priority: 55, maxAttempts: 2,
    label: () => 'Lecture du texte de la page',
    key: (p) => p.mediaId,
    guard: (p) => `${pid()}|${p.pageId}`,
    run: async (ctx, p) => {
      const det = ctx.input<{ cut: Cut }>('pages.detect')[0];
      const suspect = (det?.cut.bubbles ?? -1) <= 2 || p.srcIndex < 6 || p.srcIndex >= p.srcCount - 4;
      if (!suspect) return { pageId: p.pageId, text: null, note: 'page de récit : pas besoin' };
      await ensureMedia(p.mediaId, 'image');
      const a = getImage(p.mediaId);
      if (!a) return { pageId: p.pageId, text: null };
      try {
        const { pageText } = await import('../engine/understand');
        const { readPageText } = await import('../engine/classify');
        const r = await pageText(a.img, a.width, a.height);
        return { pageId: p.pageId, text: readPageText(r.text, r.words) };
      } catch (e) {
        // the text only refines the page kind: after one retry, classify from the picture alone
        if (classifyError(e) === 'network' && ctx.task.attempts < 2) throw e;
        return { pageId: p.pageId, text: null, note: 'lecture du texte indisponible : classement par l’image' };
      }
    },
  });

  q.register<{ pageIds: string[] }, { cuts: [string, Cut][]; texts: [string, PageText][] }>({
    kind: 'pages.classify', lane: 'light', priority: 58,
    label: (p) => `Classement et découpe de ${p.pageIds.length} page${p.pageIds.length > 1 ? 's' : ''}`,
    key: (p) => p.pageIds.join(','),
    guard: () => pid(),
    run: async (ctx) => ({
      cuts: ctx.input<{ pageId: string; cut: Cut }>('pages.detect').map((d) => [d.pageId, d.cut]),
      texts: ctx.input<{ pageId: string; text: PageText | null }>('pages.text').filter((t) => t.text).map((t) => [t.pageId, t.text!]),
    }),
    // per page, pages the user already cut by hand are left alone (actions.applyPageAnalysis)
    commit: (r, p) => { void import('../actions').then((A) => A.applyPageAnalysis(p.pageIds, new Map(r.cuts), new Map(r.texts))); },
  });

  /* ---------------------------------------------------- face-cam rush */
  q.register<{ mediaId: string }, { ok: true }>({
    kind: 'rush.analyse', lane: 'light', priority: 70,
    label: () => 'Analyse de la voix et coupes du rush',
    key: (p) => p.mediaId,
    guard: (p) => `${pid()}|${p.mediaId}|${aroll(p.mediaId) ? 1 : 0}`,
    run: async (_ctx, p) => {
      const ar = aroll(p.mediaId);
      if (!ar) throw Object.assign(new Error('Rush retiré du projet'), { kind: 'input' });
      const { analysisOf } = await import('../rush');
      await analysisOf(ar);
      return { ok: true };
    },
    // roughCut keeps the manual cuts and recomputes the automatic ones from the current settings
    commit: () => { void import('../rush').then((R) => R.roughCut()); },
  });

  q.register<{ mediaId: string }, FaceKey[]>({
    kind: 'rush.face', lane: 'heavy', family: 'faces', keepResult: true, priority: 40,
    label: () => 'Suivi du visage dans le rush',
    key: (p) => p.mediaId,
    // centring on the face by hand meanwhile wins over the automatic track
    guard: (p) => { const a = aroll(p.mediaId); return `${pid()}|${p.mediaId}|${a ? `${a.focus.x},${a.focus.y}|${a.faceTrack?.length ?? 0}` : 'x'}`; },
    run: async (ctx, p) => {
      await ensureVideo(p.mediaId);
      const v = getVideo(p.mediaId), ar = aroll(p.mediaId);
      if (!v || !ar) throw Object.assign(new Error('Rush introuvable'), { kind: 'input' });
      const { trackFaces } = await import('../engine/faces');
      return trackFaces(v.url, ar.duration, (x) => ctx.progress(x));
    },
    commit: (track, p) => {
      if (!track.length) { toast('Aucun visage trouvé : clique sur ton visage avec « Centrer sur le visage ».', 'error'); return; }
      const xs = track.map((k) => k.x).sort((a, b) => a - b), ys = track.map((k) => k.y).sort((a, b) => a - b);
      update((pr) => (pr.aroll?.mediaId === p.mediaId ? { ...pr, aroll: { ...pr.aroll, faceTrack: track, focus: { x: xs[xs.length >> 1], y: ys[ys.length >> 1] } } } : pr));
      toast(`Visage suivi automatiquement (${track.length} repères)`);
    },
  });

  q.register<{ mediaId: string; engine: 'whisper' | 'gemini' | 'ai'; model: string }, { words: Word[]; via: string }>({
    kind: 'rush.transcribe', lane: 'heavy', family: 'whisper', keepResult: true, priority: 75, maxAttempts: 4,
    label: (p) => `Transcription du rush (${p.engine === 'gemini' ? 'Google' : p.engine === 'ai' ? 'IA' : `Whisper ${p.model}`})`,
    key: (p) => `${p.mediaId}|${p.engine}|${p.model}`,
    // words corrected by hand during the transcription are never overwritten silently
    guard: (p) => { const a = aroll(p.mediaId); return `${pid()}|${p.mediaId}|${a ? wordsPrint(a.words) : 'x'}`; },
    run: async (ctx, p) => {
      const { computeTranscript } = await import('../rush');
      return computeTranscript(p.engine, p.model as never, (label, x) => ctx.progress(x < 0 ? 0 : x, label), ctx.signal);
    },
    commit: (r, p) => { void import('../rush').then((R) => R.applyTranscript(r.words, p.engine, r.via)); },
  });

  q.register<{ mediaId: string }, { ok: true }>({
    kind: 'subtitles.build', lane: 'light', priority: 65,
    label: () => 'Sous-titres mot à mot',
    key: (p) => `${p.mediaId}|${wordsPrint(aroll(p.mediaId)?.words)}`,
    guard: (p) => `${pid()}|${p.mediaId}`,
    run: async () => ({ ok: true }),
    commit: () => { void import('../rush').then((R) => R.rebuildSubtitles()); },
  });

  /* ---------------------------------------------------- script */
  q.register<{ hash: string }, { data: unknown; via: { provider: string; model: string } }>({
    kind: 'script.analyse', lane: 'network', keepResult: true, priority: 50,
    label: () => 'Analyse du script',
    key: (p) => p.hash,
    run: async () => {
      const { aiAnalyseScript } = await import('../ai/tasks');
      const r = await aiAnalyseScript(getState().project);
      return { data: r.data, via: { provider: r.via.provider, model: r.via.model } };
    },
  });

  /* ---------------------------------------------------- animation */
  q.register<{ shots: number }, { ok: true }>({
    kind: 'motion.prepare', lane: 'heavy', family: 'vision', priority: 30,
    label: () => 'Préparation des animations (bulles, relief 2.5D)',
    key: (p) => `${pid()}|${p.shots}`,
    run: async (ctx) => {
      const { prepareMotion } = await import('../actions');
      await prepareMotion({ quiet: true, step: async (i, n) => { ctx.progress(i / Math.max(1, n), `Plan ${i + 1} / ${n}`); await ctx.checkpoint(); } });
      return { ok: true };
    },
  });

  /* ---------------------------------------------------- render */
  q.register<{ name: string; quality: 'high' | 'max'; fps: number; scale: 1 | 2; burn: boolean; format: Project['format'] }, { file: string; size: number; sec: number; saved: boolean }>({
    kind: 'render', lane: 'render', keepResult: true, priority: 45, maxAttempts: 1,
    label: (p) => `Rendu ${p.format} · ${p.name}`,
    key: (p) => `${pid()}|${p.name}|${Date.now()}`,
    run: async (ctx, p) => {
      const { exportMp4 } = await import('../engine/export');
      const t0 = performance.now();
      // the project as it is when the render starts: later edits don't change a render in progress
      const snapshot = structuredClone(getState().project);
      const blob = await exportMp4({ ...snapshot, format: p.format }, {
        quality: p.quality, fps: p.fps, scale: p.scale, burnSubtitles: p.burn, signal: ctx.signal, ...renderHooks.get(ctx.task.id),
        onProgress: (x, label) => ctx.progress(x, label),
        // between frames: pause point, then a turn for the interface
        step: async () => { await ctx.checkpoint(); await yieldToUI(); },
      });
      renders.set(ctx.task.id, blob);
      let saved = false;
      try { const { workspace } = await import('../lib/studio'); const ws = workspace(); if (ws) { await ws.putExport(p.name, blob); saved = true; } } catch { /* download stays possible */ }
      return { file: p.name, size: blob.size, sec: (performance.now() - t0) / 1000, saved };
    },
  });

  /* ---------------------------------------------------- quality control */
  q.register<{ at: number }, { issues: { level: string; text: string }[] }>({
    kind: 'qc', lane: 'light', keepResult: true, priority: 35,
    label: () => 'Contrôle qualité',
    key: (p) => `${pid()}|${p.at}`,
    run: async (ctx) => {
      const { checkProject } = await import('../engine/qc');
      const issues = checkProject(getState().project).map((i) => ({ level: i.level, text: i.text }));
      const err = issues.filter((i) => i.level === 'error').length, warn = issues.length - err;
      ctx.progress(1, issues.length ? `${err} problème${err > 1 ? 's' : ''}, ${warn} alerte${warn > 1 ? 's' : ''}${issues[0] ? ` · ${issues[0].text}` : ''}` : 'Aucun problème détecté');
      return { issues };
    },
  });
}

/* ---------------------------------------------------- entry points used by the app */

/** read and classify pages: one task per page (resumable), then the issue */
export async function analysePages(pageIds: string[]) {
  await startOrchestrator();
  const p = getState().project, rtl = p.readingOrder === 'rtl';
  const ids: string[] = [];
  for (const id of pageIds) {
    const pg = p.pages.find((x) => x.id === id);
    if (!pg) continue;
    const d = enqueue('pages.detect', { pageId: pg.id, mediaId: pg.mediaId, name: pg.name, rtl }, { group: 'import' });
    const t = enqueue('pages.text', { pageId: pg.id, mediaId: pg.mediaId, srcIndex: pg.srcIndex ?? 0, srcCount: pg.srcCount ?? 1 }, { after: [d.id], group: 'import' });
    ids.push(d.id, t.id);
  }
  return enqueue('pages.classify', { pageIds }, { after: ids, group: 'import', force: true });
}

export async function analyseRush(mediaId: string) {
  await startOrchestrator();
  const a = enqueue('rush.analyse', { mediaId }, { group: 'rush', force: true });
  enqueue('rush.face', { mediaId }, { group: 'rush' });
  return a;
}

export async function transcribeRush(engine: 'whisper' | 'gemini' | 'ai', model = 'base') {
  await startOrchestrator();
  const ar = getState().project.aroll;
  if (!ar) return null;
  const t = enqueue('rush.transcribe', { mediaId: ar.mediaId, engine, model }, { group: 'rush', force: true });
  const a = enqueue('rush.analyse', { mediaId: ar.mediaId }, { after: [t.id], group: 'rush', force: true });
  enqueue('subtitles.build', { mediaId: ar.mediaId }, { after: [a.id], group: 'rush', force: true });
  return t;
}

export async function renderVideo(o: { name: string; quality: 'high' | 'max'; fps: number; scale: 1 | 2; burn: boolean; format?: Project['format'] }) {
  await startOrchestrator();
  // the quality review of the project as it is rendered, kept with the render in the queue
  const qc = enqueue('qc', { at: Date.now() }, { group: 'render', priority: 90 });
  return enqueue('render', { ...o, format: o.format ?? getState().project.format }, { group: 'render', after: [qc.id] });
}

export const scriptHash = () => hashOf(getState().project.script ?? '');

export async function runTask(kind: string, params: Record<string, unknown>, force = true) {
  await startOrchestrator();
  const t = enqueue(kind, params, { force });
  await queue.idle([t.id]);
  return queue.get(t.id)!;
}

export type { TaskCtx };
