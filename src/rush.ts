import { transcriptQuality } from './engine/transcriptCheck';
import type { ARoll, Cut, Word } from './types';
import { getState, setUI, update } from './store';
import { getAudio, importVideo, ensureVideo } from './engine/media';
import { analyse, defaultRoughCut, pausesOf, proposeCuts, toMono16k, keepSegments, segsDuration, voicedSeconds, type Analysis } from './engine/speech';
import { hesitationBias, observeCutToggle, observeManualCut, retakeBias, tuneRoughCut } from './engine/brain';
import { whisperTranscribe, type WhisperModel } from './engine/whisper';
import { geminiTranscribe, getGoogle } from './engine/google';
import { buildSubtitles, timelineWords, STYLES } from './engine/auto';
import { toast } from './components/Toast';
import { comicNames, correctNames } from './engine/lexicon';
import { ensureMedia } from './engine/media';

const cache = new Map<string, { pcm: Float32Array; a: Analysis }>();

export async function analysisOf(ar: ARoll) {
  let c = cache.get(ar.mediaId);
  if (c) return c;
  await ensureVideo(ar.mediaId);
  const buf = getAudio(ar.mediaId);
  if (!buf) throw new Error("Ce rush n'a pas de piste audio lisible.");
  const pcm = await toMono16k(buf);
  c = { pcm, a: analyse(pcm) };
  cache.set(ar.mediaId, c);
  return c;
}
export const cachedAnalysis = (mediaId: string) => cache.get(mediaId)?.a;

const setAroll = (fn: (a: ARoll) => ARoll, key?: string) =>
  update((p) => (p.aroll ? { ...p, aroll: fn(p.aroll) } : p), key);

export async function importRush(file: File) {
  setUI({ busy: 'Import du rush…' });
  try {
    const { id, asset } = await importVideo(file);
    const ar: ARoll = {
      mediaId: id, name: file.name.replace(/\.[^.]+$/, ''), duration: asset.duration, width: asset.width, height: asset.height,
      focus: { x: 0.5, y: 0.4 }, cuts: [], words: [], punchIn: 0.7, drift: 0.4, volume: 1, settings: defaultRoughCut(),
    };
    update((p) => ({ ...p, aroll: ar, shots: p.shots.map((s, i, arr) => ({ ...s, start: s.start ?? arr.slice(0, i).reduce((a, b) => a + b.duration, 0) })) }));
    setUI({ mode: 'rush', selection: { kind: 'aroll' } });
    // voice analysis and face tracking run as tasks (production orchestrator): resumable, cancellable
    const { analyseRush } = await import('./production/kinds');
    await analyseRush(id);
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setUI({ busy: null });
  }
}

/** (Re)compute the proposed cuts, keeping manual ones. */
export async function roughCut(silent = false) {
  const ar = getState().project.aroll;
  if (!ar) return;
  setUI({ busy: 'Analyse de la voix…' });
  try {
    const { a } = await analysisOf(ar);
    // a transcript is used for cuts (fillers, retakes) only when it passes the reliability check
    const check = ar.words.length ? transcriptQuality(ar.words, voicedSeconds(a, ar.settings)) : null;
    const words = check && !check.ok ? [] : ar.words;
    if (check) setAroll((x) => ({ ...x, transcriptCheck: { ok: check.ok, reason: check.reason } }));
    if (check && !check.ok) toast(`Transcription peu fiable (${check.reason}) : aucune coupe faite d’après le texte. Essaie le modèle « Précis » ou colle ton script.`, 'error');
    const auto = proposeCuts(a, words, tuneRoughCut(ar.settings), { hesitation: hesitationBias(), retake: retakeBias() });
    const manual = ar.cuts.filter((c) => c.reason === 'manual');
    setAroll((x) => ({ ...x, cuts: [...auto, ...manual].sort((p, q) => p.s - q.s), pauses: pausesOf(a, x.settings.threshold) }));
    const nx = getState().project.aroll!;
    const kept = segsDuration(keepSegments(nx));
    const count = (r: Cut['reason']) => nx.cuts.filter((c) => c.reason === r && c.on).length;
    const review = nx.cuts.filter((c) => !c.on).length;
    if (!silent) {
      toast(`Rush : ${fmt(nx.duration)} → ${fmt(kept)} · ${count('silence')} silences, ${count('hesitation') + count('filler')} hésitations, ${count('retake')} reprises${review ? ` · ${review} à vérifier` : ''}`);
    }
    rebuildSubtitles();
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setUI({ busy: null });
  }
}

/** transcribe the rush as a task chain: transcription → cuts → subtitles (production orchestrator) */
export async function transcribe(engine: 'whisper' | 'gemini' | 'ai', model: WhisperModel = 'base') {
  if (!getState().project.aroll) return;
  const { transcribeRush } = await import('./production/kinds');
  await transcribeRush(engine, model);
  toast('Transcription ajoutée à la file de tâches');
}

/** the transcription itself, without touching the project (the task applies it if nothing changed meanwhile) */
export async function computeTranscript(engine: 'whisper' | 'gemini' | 'ai', model: WhisperModel, onProgress: (label: string, p: number) => void, signal?: AbortSignal): Promise<{ words: Word[]; via: string }> {
  const ar = getState().project.aroll;
  if (!ar) throw Object.assign(new Error('Pas de rush dans le projet'), { kind: 'input' });
  const { pcm } = await analysisOf(ar);
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  const lang = getGoogle().language === 'en' ? 'en' : 'fr';
  if (engine === 'ai') {
    // orchestrator: fast remote Whisper (Groq, Gemini…) when allowed, else Whisper in this browser
    onProgress('Transcription IA…', 0);
    const { aiTranscribe } = await import('./ai/tasks');
    const r = await aiTranscribe(pcm, lang, () => whisperTranscribe(pcm, model, lang, (label, p) => onProgress(label, p)));
    return { words: r.words, via: r.via.provider === 'local' ? 'Whisper (sur ton ordinateur)' : `${r.via.provider} · ${r.via.model}` };
  }
  if (engine === 'gemini') return { words: await geminiTranscribe(pcm, (p) => onProgress('Transcription Google…', p)), via: 'Google' };
  onProgress('Chargement de Whisper…', -1);
  return { words: await whisperTranscribe(pcm, model, lang, (label, p) => onProgress(label, p)), via: 'Whisper (sur ton ordinateur)' };
}

export function applyTranscript(words: Word[], engine: 'whisper' | 'gemini' | 'ai', via: string) {
  const fix = correctNames(words, comicNames(getState().project));
  setAroll((x) => ({ ...x, words: fix.words, transcriptSource: engine }));
  toast(`${words.length} mots transcrits par ${via}${fix.fixed ? ` · ${fix.fixed} noms corrigés d’après les comics` : ''}`);
}

export function toggleCut(index: number) {
  const ar = getState().project.aroll;
  if (!ar) return;
  const c = ar.cuts[index];
  if (!c) return;
  if (c.reason === 'manual') {
    setAroll((x) => ({ ...x, cuts: x.cuts.filter((_, i) => i !== index) }));
  } else {
    observeCutToggle(c, !c.on);
    setAroll((x) => ({ ...x, cuts: x.cuts.map((k, i) => (i === index ? { ...k, on: !k.on } : k)) }));
  }
  rebuildSubtitles();
}

export function setAllCuts(reason: Cut['reason'] | 'all', on: boolean) {
  setAroll((x) => ({ ...x, cuts: x.cuts.map((k) => (reason === 'all' || k.reason === reason ? { ...k, on } : k)) }));
  rebuildSubtitles();
}

export function addManualCut(s: number, e: number, label?: string) {
  if (e - s < 0.04) return;
  observeManualCut(e - s);
  setAroll((x) => ({ ...x, cuts: [...x.cuts, { s, e, reason: 'manual' as const, on: true, label }].sort((p, q) => p.s - q.s) }));
  rebuildSubtitles();
}

/** cut or restore a run of transcript words */
export function toggleWords(words: Word[]) {
  const ar = getState().project.aroll;
  if (!ar || !words.length) return;
  const s = words[0].s, e = words[words.length - 1].e;
  const covering = ar.cuts.findIndex((c) => c.on && c.s <= s + 0.02 && c.e >= e - 0.02);
  if (covering >= 0) toggleCut(covering);
  else addManualCut(Math.max(0, s - 0.02), Math.min(ar.duration, e + 0.02), words.map((w) => w.w).join(' '));
}

export const setFocus = (x: number, y: number) => setAroll((a) => ({ ...a, focus: { x, y } }), 'focus');
export const patchAroll = (patch: Partial<ARoll>, key?: string) => setAroll((a) => ({ ...a, ...patch }), key);
export const patchRoughSettings = (patch: Partial<ARoll['settings']>) =>
  setAroll((a) => ({ ...a, settings: { ...a.settings, ...patch } }), 'rough-' + Object.keys(patch).join());

export function rebuildSubtitles() {
  const p = getState().project;
  if (!p.aroll?.words.length) return;
  const max = p.subtitleStyle.maxWords || (p.format === '16:9' ? STYLES.explainer.maxWords : 3);
  update((x) => ({ ...x, subtitles: buildSubtitles(timelineWords(x), max) }), 'subs');
}

export function removeRush() {
  update((p) => ({ ...p, aroll: null, subtitles: [] }));
  setUI({ mode: 'cut', selection: null });
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** find and follow the speaker's face; the framing and the zooms use it */
/** find and follow the speaker's face (a production task); the framing and the zooms use it */
export async function detectFace(quiet = false) {
  if (!getState().project.aroll) return;
  const { trackFace } = await import('./production/kinds');
  await trackFace();
  if (!quiet) toast('Suivi du visage ajouté à la file de tâches');
}

/** transcribe a voice-over clip so the edit can follow it (and subtitle it) */
/** transcribe a voice-over clip so the edit can follow it (and subtitle it): a production task */
export async function transcribeClip(id: string, engine: 'whisper' | 'gemini', model: WhisperModel = 'base') {
  const c = getState().project.audio.find((x) => x.id === id);
  if (!c) return;
  const { startOrchestrator, enqueue } = await import('./production/orchestrator');
  await startOrchestrator();
  enqueue('clip.transcribe', { clipId: id, mediaId: c.mediaId, engine, model }, { force: true });
  toast('Transcription de la voix off ajoutée à la file de tâches');
}
export async function computeClipTranscript(id: string, engine: 'whisper' | 'gemini', model: WhisperModel, onProgress: (label: string, p: number) => void): Promise<Word[]> {
  const c = getState().project.audio.find((x) => x.id === id);
  if (c) await ensureMedia(c.mediaId, 'audio');
  const buf = c && getAudio(c.mediaId);
  if (!c || !buf) throw Object.assign(new Error('Clip audio introuvable'), { kind: 'input' });
  onProgress('Préparation de la voix…', 0);
  const pcm = await toMono16k(buf);
  const lang = getGoogle().language === 'en' ? 'en' : 'fr';
  return engine === 'gemini' ? geminiTranscribe(pcm, (p) => onProgress('Transcription Google…', p)) : whisperTranscribe(pcm, model, lang, (label, p) => onProgress(label, p));
}
export function applyClipTranscript(id: string, words: Word[]) {
  const fix = correctNames(words, comicNames(getState().project));
  update((p) => ({ ...p, audio: p.audio.map((x) => (x.id === id ? { ...x, words: fix.words } : x)) }));
  toast(`Voix off transcrite : ${words.length} mots${fix.fixed ? ` · ${fix.fixed} noms corrigés` : ''}`);
}
