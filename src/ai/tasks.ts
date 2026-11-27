/**
 * The AI at work in the edit. Each task: what is sent (shown to the user),
 * the remote route, and the same job done by Forge itself offline. Results
 * are proposals; nothing is applied without the user.
 */
import { suggestOverlays } from '../engine/overlaySuggest';
import type { Project, Word } from '../types';
import { run, extractJson, type RunResult } from './orchestrator';
import { SYSTEM, analysePrompt, assistantPrompt, punctuatePrompt, reviewPrompt } from './prompts';
import { wav } from './providers/http';
import { analyseScript, ROLE_FR, type Role } from '../engine/scriptIntel';
import { layoutShots, videoDuration } from '../engine/timeline';

export interface AiAnalysis {
  passages: { i: number; role: string; illustration?: string; raison?: string }[];
  entites: { nom: string; type: string }[];
  sequences: { de: number; a: number; titre: string }[];
  visuels: { type: string; de: number; titre: string; elements: { label: string; detail?: string }[]; raison?: string }[];
  rythme: { i: number; note: string }[];
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** script analysis: remote model if allowed, else Forge's own rules (same shape) */
export async function aiAnalyseScript(p: Project): Promise<{ data: AiAnalysis; via: RunResult }> {
  const script = p.script ?? '';
  const via = await run({
    kind: 'script.analyse', system: SYSTEM.analyse, prompt: analysePrompt(script), json: true, needs: ['text', 'json', ...(script.length > 40_000 ? ['long' as const] : [])], data: ['texte'], size: script.length,
    local: async () => {
      const a = analyseScript(p);
      const toType: Record<string, string> = { chronologie: 'chronologie', reseau: 'reseau', versus: 'versus', echelle: 'echelle', citation: 'citation', titre: 'titre', carte: 'reseau' };
      const out: AiAnalysis = {
        passages: a.passages.map((x) => ({ i: x.i, role: x.role })),
        entites: a.entities.map((e) => ({ nom: e.name, type: e.kind })),
        sequences: [],
        visuels: a.suggestions.map((g) => ({ type: toType[g.kind], de: g.passages[0] ?? 0, titre: g.title, elements: g.items.map((it) => ({ label: it.label, detail: it.sub })), raison: g.detail })),
        rythme: a.passages.filter((x) => x.text.split(' ').length > 35).map((x) => ({ i: x.i, note: 'Phrase longue : à couper en deux à l’oral ?' })),
      };
      return { text: JSON.stringify(out) };
    },
  });
  const raw = JSON.parse(extractJson(via.answer.text));
  const data: AiAnalysis = { passages: asArray(raw.passages), entites: asArray(raw.entites), sequences: asArray(raw.sequences), visuels: asArray(raw.visuels), rythme: asArray(raw.rythme) };
  data.passages = data.passages.filter((x) => Number.isInteger(x.i) && typeof x.role === 'string' && x.role in ROLE_FR) as AiAnalysis['passages'];
  return { data, via };
}

export interface ReviewNote { i: number; type: string; constat: string; conseil: string }
/** a second editorial reading (another model when possible) */
export async function aiReviewScript(p: Project): Promise<{ notes: ReviewNote[]; verdict: string; via: RunResult }> {
  const script = p.script ?? '';
  const via = await run({
    kind: 'script.review', system: SYSTEM.review, prompt: reviewPrompt(script), json: true, needs: ['text', 'json'], data: ['texte'], size: script.length,
    local: async () => {
      const a = analyseScript(p);
      const notes: ReviewNote[] = [];
      const first = a.passages[0];
      if (first && first.text.split(' ').length > 22) notes.push({ i: 0, type: 'accroche', constat: 'L’accroche est longue.', conseil: 'Une accroche tient en une phrase courte, idéalement une question ou un fait surprenant.' });
      for (const x of a.passages) if (x.text.split(' ').length > 35) notes.push({ i: x.i, type: 'longueur', constat: 'Phrase très longue à dire.', conseil: 'La couper en deux respire mieux à l’oral.' });
      for (const x of a.passages) if (x.role === 'revelation' && !a.passages.some((y) => y.role === 'preuve')) { notes.push({ i: x.i, type: 'source', constat: 'Révélation sans preuve citée dans le script.', conseil: 'Cite le numéro du comics où on le voit.' }); break; }
      if (!a.passages.some((x) => x.role === 'conclusion')) notes.push({ i: -1, type: 'conclusion', constat: 'Pas de conclusion nette.', conseil: 'Termine sur une phrase qui répond à l’accroche.' });
      return { text: JSON.stringify({ notes, verdict: notes.length ? `${notes.length} point(s) à regarder.` : 'Rien de bloquant repéré par l’analyse locale.' }) };
    },
  });
  const raw = JSON.parse(extractJson(via.answer.text));
  return { notes: asArray<ReviewNote>(raw.notes).filter((n) => n && typeof n.constat === 'string'), verdict: String(raw.verdict ?? ''), via };
}

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const sameWords = (a: string, b: string) => a.split(/\s+/).map(norm).filter(Boolean).join(' ') === b.split(/\s+/).map(norm).filter(Boolean).join(' ');

/** punctuation and capitals of subtitle lines; a line whose words changed is refused */
export async function aiPunctuate(lines: string[]): Promise<{ lines: string[]; changed: number; refused: number; via: RunResult }> {
  const via = await run({ kind: 'captions.punctuate', system: SYSTEM.punctuate, prompt: punctuatePrompt(lines), json: true, needs: ['text', 'json'], data: ['texte'], size: lines.join(' ').length, local: async () => ({ text: JSON.stringify({ lignes: lines }) }) });
  const got = asArray<string>(JSON.parse(extractJson(via.answer.text)).lignes);
  let changed = 0, refused = 0;
  const out = lines.map((l, i) => {
    const g = typeof got[i] === 'string' ? got[i].trim() : l;
    if (g === l) return l;
    if (!sameWords(l, g)) { refused++; return l; }
    changed++;
    return g;
  });
  return { lines: out, changed, refused, via };
}

/** transcription: fast remote Whisper when allowed, else Whisper in the browser */
export async function aiTranscribe(pcm: Float32Array, language: string, localWhisper: () => Promise<Word[]>): Promise<{ words: Word[]; via: RunResult }> {
  // remote Whisper APIs accept ~25 MB: 10-minute chunks of 16 kHz WAV stay well under it
  const chunk = 16000 * 600;
  const words: Word[] = [];
  let via: RunResult | null = null;
  let localUsed = false;
  for (let off = 0; off < pcm.length; off += chunk) {
    const part = pcm.subarray(off, Math.min(pcm.length, off + chunk));
    const r = await run({
      kind: 'audio.transcribe', audio: wav(part), language, needs: ['transcribe'], data: ['audio'], fresh: true,
      local: async () => { localUsed = true; return { text: '', words: (await localWhisper()).map((w) => ({ w: w.w, s: w.s, e: w.e })) }; },
    });
    via = r;
    if (r.provider === 'local') return { words: r.answer.words ?? [], via: r }; // local Whisper already did the whole take
    const t0 = off / 16000;
    for (const w of r.answer.words ?? []) words.push({ w: w.w, s: w.s + t0, e: w.e + t0 });
  }
  void localUsed;
  return { words, via: via! };
}

/* -------------------------------------------------------------- assistant */

export type Proposal =
  | { type: 'shot.duration'; shotId: string; seconds: number; raison?: string }
  | { type: 'shot.transition'; shotId: string; transition: string; raison?: string }
  | { type: 'title.add'; at: number; text: string; raison?: string }
  | { type: 'visual.suggest'; at: number; kind: string; title: string; items: { label: string; sub?: string }[]; raison?: string }
  | { type: 'rush.cut'; s: number; e: number; raison?: string }
  | { type: 'note'; text: string }
  | import('../engine/overlaySuggest').OverlayProposal;

/** what the assistant sees of the edit: compact, no media */
export function editContext(p: Project): string {
  const timed = layoutShots(p);
  const shots = timed.slice(0, 120).map((t) => `${t.shot.id} | ${t.start.toFixed(1)}-${t.end.toFixed(1)} s | ${t.shot.pageId ? 'case' : t.shot.diagram ? 'schéma ' + t.shot.diagram.kind : 'carton'} | transition ${t.shot.transition}${t.shot.caption.text ? ' | texte « ' + t.shot.caption.text.slice(0, 60) + ' »' : ''}`).join('\n');
  const subs = p.subtitles.slice(0, 200).map((s) => `${s.s.toFixed(1)} ${s.text}`).join('\n');
  const rush = p.aroll ? `Rush ${p.aroll.duration.toFixed(1)} s, coupes actives : ${p.aroll.cuts.filter((c) => c.on).length}` : 'Pas de rush face caméra';
  return `Durée ${videoDuration(p).toFixed(1)} s, format ${p.format}. ${rush}.
Plans :
${shots || '(aucun)'}
Sous-titres :
${subs || '(aucun)'}
Script :
${(p.script ?? '').slice(0, 6000) || '(aucun)'}`;
}

/**
 * CONTEXT ENGINE — what the assistant needs for THIS request, not the whole
 * project: the time window the request names (« entre 10 et 20 s », « au
 * début », « à la fin ») and the parts it is about (plans, sous-titres, rush,
 * script). A request that names nothing gets everything, as before. The
 * result says what was kept, so the interface can show it.
 */
export interface TaskContext { text: string; kept: string[]; window: [number, number] | null; chars: number; fullChars: number }
const num = (s: string) => parseFloat(s.replace(',', '.'));
export function requestWindow(command: string, total: number): [number, number] | null {
  const c = command.toLowerCase();
  const range = c.match(/(?:entre|de)\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec\w*)?\s+(?:et|à|a)\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec)/);
  if (range) { const a = num(range[1]), b = num(range[2]); return [Math.max(0, Math.min(a, b)), Math.min(total, Math.max(a, b))]; }
  const at = c.match(/(?:à|a|vers)\s+(\d+(?:[.,]\d+)?)\s*(?:s\b|sec)/);
  if (at) { const t = num(at[1]); return [Math.max(0, t - 8), Math.min(total, t + 8)]; }
  if (/\b(début|debut|accroche|intro|premières secondes|hook)\b/.test(c)) return [0, Math.min(total, 15)];
  if (/\b(fin|conclusion|outro|dernières secondes)\b/.test(c)) return [Math.max(0, total - 15), total];
  return null;
}
export function contextFor(command: string, p: Project): TaskContext {
  const c = command.toLowerCase();
  const total = videoDuration(p);
  const win = requestWindow(command, total);
  const inWin = (s: number, e: number) => !win || (e >= win[0] && s <= win[1]);
  const wants = {
    shots: /plan|transition|image|case|carton|(?<!sous-|sous )titre|visuel|illustr|montrer|schéma|chapitre/.test(c)
      // vague pace words are about shots unless the request names another part
      || (/durée|duree|rythme|long|lent|dynamique/.test(c) && !/sous-titre|sous titre|rush|coupe|silence/.test(c)),
    subs: /sous-titre|sous titre|texte à l|lisib|mot/.test(c),
    rush: /rush|coupe|silence|hésit|hesit|euh|blanc|visage|face/.test(c),
    script: /script|accroche|phrase|intro|début|illustr|image|visuel|montrer|schéma|explication|chapitre|fin/.test(c),
  };
  if (!Object.values(wants).some(Boolean)) Object.keys(wants).forEach((k) => (wants[k as keyof typeof wants] = true));
  const kept: string[] = [];
  const parts = [`Durée ${total.toFixed(1)} s, format ${p.format}.${win ? ` Passage concerné : ${win[0].toFixed(0)}–${win[1].toFixed(0)} s.` : ''}`];
  if (wants.shots) {
    const shots = layoutShots(p).filter((t) => inWin(t.start, t.end)).slice(0, 120).map((t) => `${t.shot.id} | ${t.start.toFixed(1)}-${t.end.toFixed(1)} s | ${t.shot.pageId ? 'case' : t.shot.diagram ? 'schéma ' + t.shot.diagram.kind : 'carton'} | transition ${t.shot.transition}${t.shot.caption.text ? ' | texte « ' + t.shot.caption.text.slice(0, 60) + ' »' : ''}`);
    parts.push(`Plans :\n${shots.join('\n') || '(aucun)'}`); kept.push(`plans (${shots.length})`);
  }
  if (wants.subs) {
    const subs = p.subtitles.filter((s) => inWin(s.s, s.e ?? s.s)).slice(0, 200).map((s) => `${s.s.toFixed(1)} ${s.text}`);
    parts.push(`Sous-titres :\n${subs.join('\n') || '(aucun)'}`); kept.push(`sous-titres (${subs.length})`);
  }
  if (wants.rush) {
    parts.push(p.aroll ? `Rush ${p.aroll.duration.toFixed(1)} s, coupes actives : ${p.aroll.cuts.filter((x) => x.on).length}` : 'Pas de rush face caméra'); kept.push('rush');
  }
  if (wants.script && p.script) {
    // a window keeps only the matching share of the script (its timing follows the voice roughly linearly)
    let text = p.script;
    if (win && total > 0) { const a = Math.floor((win[0] / total) * text.length), b = Math.ceil((win[1] / total) * text.length); text = text.slice(Math.max(0, a - 200), Math.min(text.length, b + 200)); }
    parts.push(`Script${win ? ' (extrait)' : ''} :\n${text.slice(0, 6000)}`); kept.push(win ? 'extrait du script' : 'script');
  }
  const out = parts.join('\n');
  return { text: out, kept, window: win, chars: out.length, fullChars: editContext(p).length };
}

/** checks every proposal against the real project: unknown ids, impossible times and unknown actions are dropped */
export function validProposals(raw: unknown, p: Project): Proposal[] {
  const ids = new Set(p.shots.map((s) => s.id));
  const T = videoDuration(p);
  const R = p.aroll?.duration ?? 0;
  const ok: Proposal[] = [];
  for (const x of asArray<Record<string, unknown>>(raw)) {
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    switch (x.type) {
      case 'shot.duration': if (ids.has(String(x.shotId)) && n(x.seconds) >= 0.8 && n(x.seconds) <= 30) ok.push({ type: 'shot.duration', shotId: String(x.shotId), seconds: n(x.seconds), raison: String(x.raison ?? '') }); break;
      case 'shot.transition': if (ids.has(String(x.shotId)) && ['cut', 'fade', 'slide', 'zoom', 'whip', 'wipe', 'defocus', 'halftone'].includes(String(x.transition))) ok.push({ type: 'shot.transition', shotId: String(x.shotId), transition: String(x.transition), raison: String(x.raison ?? '') }); break;
      case 'title.add': if (n(x.at) >= 0 && n(x.at) <= T && typeof x.text === 'string' && x.text.trim()) ok.push({ type: 'title.add', at: n(x.at), text: x.text.trim().slice(0, 40), raison: String(x.raison ?? '') }); break;
      case 'visual.suggest': if (n(x.at) >= 0 && n(x.at) <= T && ['chronologie', 'reseau', 'versus', 'echelle', 'citation'].includes(String(x.kind))) ok.push({ type: 'visual.suggest', at: n(x.at), kind: String(x.kind), title: String(x.title ?? ''), items: asArray<{ label: string; sub?: string }>(x.items).filter((i) => i && typeof i.label === 'string').slice(0, 8), raison: String(x.raison ?? '') }); break;
      case 'rush.cut': if (R && n(x.s) >= 0 && n(x.e) > n(x.s) && n(x.e) <= R && n(x.e) - n(x.s) < 20) ok.push({ type: 'rush.cut', s: n(x.s), e: n(x.e), raison: String(x.raison ?? '') }); break;
      case 'note': if (typeof x.text === 'string') ok.push({ type: 'note', text: x.text }); break;
    }
  }
  return ok.slice(0, 12);
}

/** the assistant offline: rules for the common requests */
export function localAssistant(command: string, p: Project): { resume: string; propositions: Proposal[] } {
  const c = command.toLowerCase();
  const timed = layoutShots(p);
  const out: Proposal[] = [];
  if (/long|lent|dynamique|rythme/.test(c)) {
    for (const t of timed) if (t.shot.pageId && t.shot.duration > 6) out.push({ type: 'shot.duration', shotId: t.shot.id, seconds: Math.max(3, +(t.shot.duration * 0.7).toFixed(1)), raison: `Plan de ${t.shot.duration.toFixed(1)} s : l’attention baisse au-delà de 6 s.` });
  }
  if (/image|illustr|visuel|montrer/.test(c) && p.script) {
    for (const g of analyseScript(p).suggestions.filter((x) => x.kind !== 'titre' && x.kind !== 'carte')) out.push({ type: 'visual.suggest', at: g.at, kind: g.kind, title: g.title, items: g.items, raison: g.detail });
  }
  if (/intro|accroche|début/.test(c)) {
    const a = p.script ? analyseScript(p) : null;
    const first = a?.passages[0];
    out.push({ type: 'note', text: first ? `Ton accroche : « ${first.text} ». ${first.text.split(' ').length > 18 ? 'Elle est longue : vise une phrase de moins de 15 mots, une question ou un chiffre fort.' : 'Elle est courte : garde un visuel fort dès la première seconde.'}` : 'Colle ton script pour que je juge l’accroche.' });
  }
  if (/sous-titre/.test(c)) out.push({ type: 'note', text: p.subtitles.length ? `${p.subtitles.length} lignes de sous-titres. Utilise « Corriger la ponctuation » dans l’inspecteur pour les relire.` : 'Transcris le rush (onglet Rush) pour générer les sous-titres.' });
  if (/calque|superpos|incrust|partag|côte à côte|split/.test(c)) { /* added by aiAssistant from suggestOverlays */ }
  else if (!out.length) out.push({ type: 'note', text: 'L’assistant hors ligne comprend : passages trop longs, rythme, images à afficher, accroche, sous-titres, calques d’après le script. Branche une IA dans le centre de contrôle pour les autres demandes.' });
  return { resume: `${out.length} proposition(s) de l’assistant hors ligne.`, propositions: out };
}

export async function aiAssistant(command: string, p: Project): Promise<{ resume: string; proposals: Proposal[]; via: RunResult; context: TaskContext }> {
  const context = contextFor(command, p);
  const via = await run({
    kind: 'assistant', system: SYSTEM.assistant, prompt: assistantPrompt(command, context.text), json: true, needs: ['text', 'json'], data: ['texte'], fresh: true,
    local: async () => ({ text: JSON.stringify(localAssistant(command, p)) }),
  });
  const raw = JSON.parse(extractJson(via.answer.text));
  // overlays are proposed by the local reading of the script (deterministic, the user's own panels)
  const ov = /calque|superpos|incrust|partag|côte à côte|split/i.test(command) ? suggestOverlays(p) : [];
  const props = validProposals(raw.propositions, p);
  const resume = ov.length ? `${ov.length} calque${ov.length > 1 ? 's' : ''} proposé${ov.length > 1 ? 's' : ''} d’après le script${props.length ? `, et ${String(raw.resume ?? '').toLowerCase()}` : '.'}` : /calque|superpos|incrust|partag/i.test(command) ? 'Aucun passage du script n’appelle un calque (comparaison, « pendant ce temps », rappel), ou un calque y est déjà.' : String(raw.resume ?? '');
  return { resume, proposals: [...props, ...ov], via, context };
}
export const roleLabel = (r: string) => ROLE_FR[r as Role] ?? r;
