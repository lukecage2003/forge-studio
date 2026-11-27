import type { Motion, Project, Shot } from '../types';
import type { Sentence } from './narration';
import type { StoryPlan } from './story';

/**
 * STORYBOARD — the plan of the video, sentence by sentence, made before the
 * auto edit and edited by the user: which picture (a panel, the face cam, or
 * Forge's choice), which camera move, how long, how the subtitles cut, which
 * sound, and what is missing. The auto edit then follows it as written
 * (`boardToPlan`); what the user set is never replaced by a new suggestion.
 * Pure module: built from the story match (engine/story) and the narration.
 */

export type BoardMode = 'auto' | 'panel' | 'face';
export type BoardCamera = 'auto' | Extract<Motion, 'static' | 'zoom-in' | 'zoom-out' | 'read' | 'tour' | 'page-glide' | 'panel-nav' | 'reveal'>;
export type BoardSound = 'auto' | 'none' | 'impact' | 'whoosh';
export interface BoardRow {
  text: string; s: number; e: number;
  shotId: string | null;
  conf: number;
  alts: string[];
  mode: BoardMode;
  camera: BoardCamera;
  sound: BoardSound;
  /** what the user set by hand (kept when the storyboard is computed again) */
  edited?: ('shot' | 'mode' | 'camera' | 'sound')[];
  /** why Forge proposes this row */
  why: string;
}
export interface Board { at: string; engine: string; /** fingerprint of the sentences: a changed script makes the board stale */ key: string; rows: BoardRow[] }
export interface BoardIssue { row: number; level: 'error' | 'warn'; text: string }

export const sentenceKey = (sents: { text: string }[]) => {
  const s = sents.map((x) => x.text.trim().toLowerCase()).join('|');
  let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${sents.length}:${(h >>> 0).toString(36)}`;
};

/** the camera that suits a panel: balloons are read, a splash is revealed, a big busy image is explored */
export function suggestCamera(s: Shot | undefined, bubbles: number, len: number): { camera: BoardCamera; why: string } {
  if (!s) return { camera: 'auto', why: '' };
  if (s.zone === 'splash') return { camera: len > 3 ? 'reveal' : 'zoom-in', why: 'pleine page : révélée' };
  if (bubbles >= 2 && len > 2.2) return { camera: 'read', why: `${bubbles} bulles à lire` };
  if (len > 4.5) return { camera: 'tour', why: 'phrase longue : l’image est explorée' };
  return { camera: 'auto', why: '' };
}

/** build the board from the story match; rows the user edited in `prev` keep the user's choices */
export function buildBoard(p: Project, sents: Sentence[], plan: StoryPlan, o: { hasFace: boolean; bubblesOf?: (shotId: string) => number; prev?: Board | null }): Board {
  const byId = new Map(p.shots.map((s) => [s.id, s]));
  const prevRows = o.prev && o.prev.key === sentenceKey(sents) ? o.prev.rows : null;
  let lastPage: string | null = null;
  const rows = sents.map((se, i): BoardRow => {
    const a = plan.assign.find((x) => x.sentence === i);
    const len = Math.max(0.3, (i + 1 < sents.length ? sents[i + 1].s : se.e + 0.6) - se.s);
    const shot = a?.shotId ? byId.get(a.shotId) : undefined;
    const sure = !!shot && (a?.conf ?? 0) >= 0.35;
    // unsure over a face cam: the speaker is the honest picture
    const mode: BoardMode = shot ? (sure || !o.hasFace ? 'panel' : 'face') : o.hasFace ? 'face' : 'auto';
    const cam = suggestCamera(shot, shot ? o.bubblesOf?.(shot.id) ?? 0 : 0, len);
    const pageChange = !!shot?.pageId && shot.pageId !== lastPage && lastPage != null;
    if (shot?.pageId) lastPage = shot.pageId;
    const sound: BoardSound = /!|\b(boum|bam|explos|frapp|impact|crash)/i.test(se.text) || shot?.zone === 'splash' ? 'impact' : pageChange ? 'whoosh' : 'auto';
    const why = [
      shot ? `case trouvée (${Math.round((a?.conf ?? 0) * 100)} %)` : 'aucune case ne correspond',
      mode === 'face' && shot ? 'correspondance incertaine : visage à l’écran' : '',
      cam.why, sound === 'impact' ? 'temps fort : impact' : sound === 'whoosh' ? 'nouvelle page : souffle' : '',
    ].filter(Boolean).join(' · ');
    const row: BoardRow = { text: se.text, s: se.s, e: se.e, shotId: shot?.id ?? null, conf: a?.conf ?? 0, alts: a?.alts ?? [], mode, camera: cam.camera, sound, why };
    // the user's choices survive a new computation
    const old = prevRows?.[i];
    if (old?.edited?.length) {
      for (const f of old.edited) {
        if (f === 'shot') { row.shotId = old.shotId; row.conf = 1; }
        if (f === 'mode') row.mode = old.mode;
        if (f === 'camera') row.camera = old.camera;
        if (f === 'sound') row.sound = old.sound;
      }
      row.edited = [...old.edited];
    }
    return row;
  });
  return { at: new Date().toISOString(), engine: plan.engine, key: sentenceKey(sents), rows };
}

/** the plan the auto edit follows; null when the narration changed since the board was made */
export function boardToPlan(b: Board, sents: { text: string }[]): StoryPlan | null {
  if (b.key !== sentenceKey(sents)) return null;
  return {
    engine: b.engine === 'google' ? 'google' : 'local',
    schemas: [],
    assign: b.rows.map((r, i) => ({
      sentence: i,
      // face: no panel on this sentence, the speaker stays on screen
      shotId: r.mode === 'face' ? null : r.shotId,
      // a panel chosen by the user is certain
      conf: r.edited?.includes('shot') || r.mode === 'panel' ? Math.max(r.conf, r.edited?.includes('shot') ? 1 : 0.5) : r.conf,
      alts: r.alts, more: [],
    })),
  };
}

/** after the auto edit: camera and sound chosen in the board are applied to the shots of each sentence */
export function applyBoardChoices(shots: Shot[], b: Board): Shot[] {
  return shots.map((s) => {
    const r = s.match ? b.rows.find((x) => x.text === s.match!.sentence) : undefined;
    if (!r) return s;
    let next = s;
    if (r.camera !== 'auto') next = { ...next, motion: r.camera, why: `${r.edited?.includes('camera') ? 'mouvement choisi' : 'mouvement proposé'} dans le storyboard` };
    if (r.sound !== 'auto') next = { ...next, sfx: r.sound };
    return next;
  });
}

/** what to fix before editing: missing pictures, doubtful matches, long stills */
export function boardIssues(b: Board, p: Project): BoardIssue[] {
  const out: BoardIssue[] = [];
  const ids = new Set(p.shots.map((s) => s.id));
  b.rows.forEach((r, i) => {
    const len = (b.rows[i + 1]?.s ?? r.e + 0.6) - r.s;
    if (r.mode !== 'face' && !r.shotId) out.push({ row: i, level: p.aroll ? 'warn' : 'error', text: `Aucune illustration pour « ${r.text.slice(0, 50)}… » : choisis une case${p.aroll ? ' ou garde le visage' : ' ou importe la page qui manque'}.` });
    else if (r.shotId && !ids.has(r.shotId)) out.push({ row: i, level: 'error', text: 'La case choisie n’existe plus (page retirée ou redécoupée) : choisis-en une autre.' });
    else if (r.mode !== 'face' && r.conf < 0.35 && !r.edited?.includes('shot')) out.push({ row: i, level: 'warn', text: `Case incertaine (${Math.round(r.conf * 100)} %) : vérifie-la.` });
    if (len > 9 && r.camera === 'static') out.push({ row: i, level: 'warn', text: `${len.toFixed(0)} s sur une image fixe : un mouvement aiderait.` });
  });
  // the same panel on many sentences in a row
  let run = 1;
  for (let i = 1; i < b.rows.length; i++) {
    run = b.rows[i].shotId && b.rows[i].shotId === b.rows[i - 1].shotId ? run + 1 : 1;
    if (run === 3) out.push({ row: i, level: 'warn', text: 'La même case sur trois phrases de suite.' });
  }
  return out;
}

/** how long, how many shots, how much face, how many panels */
export function boardSummary(b: Board) {
  const end = b.rows.length ? b.rows[b.rows.length - 1].e : 0;
  const face = b.rows.filter((r) => r.mode === 'face').reduce((a, r, i) => a + ((b.rows[b.rows.indexOf(r) + 1]?.s ?? r.e) - r.s) * (i >= 0 ? 1 : 0), 0);
  return { duration: end, rows: b.rows.length, panels: new Set(b.rows.filter((r) => r.mode !== 'face' && r.shotId).map((r) => r.shotId)).size, faceShare: end ? face / end : 0, edited: b.rows.filter((r) => r.edited?.length).length };
}

/** subtitles the sentence will show, cut like the auto edit does (maxWords a card) */
export function captionChunks(text: string, maxWords: number): string[] {
  const w = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < w.length; i += Math.max(1, maxWords)) out.push(w.slice(i, i + maxWords).join(' '));
  return out;
}
