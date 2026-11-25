import { useSyncExternalStore } from 'react';
import type { Caption, Project, Selection, Shot } from './types';
import { observeShotDeleted, observeShotEdit } from './engine/brain';
import { uid } from './lib/util';
import { idb } from './lib/db';

export type Mode = 'rush' | 'cut' | 'preview';

export interface UIState {
  selection: Selection;
  activePageId: string | null;
  playhead: number;
  playing: boolean;
  mode: Mode;
  pxPerSec: number;
  safeZones: boolean;
  exportOpen: boolean;
  autoOpen: boolean;
  settingsOpen: boolean;
  busy: string | null;
  saved: 'saved' | 'saving' | 'dirty';
}

export const defaultCaption = (): Omit<Caption, 'text'> => ({ preset: 'tiktok', anim: 'pop', y: 0.78, size: 1 });

export function newProject(): Project {
  return {
    id: uid('p_'),
    name: 'Sans titre',
    format: '9:16',
    fps: 30,
    background: 'blur',
    bgColor: '#0B0B0D',
    readingOrder: 'ltr',
    ducking: true,
    duckLevel: 0.25,
    pages: [],
    shots: [],
    audio: [],
    defaultCaption: defaultCaption(),
    watermark: '',
    aroll: null,
    subtitles: [],
    subtitleStyle: { ...defaultCaption(), anim: 'words', y: 0.72, on: true, maxWords: 3 },
    progressBar: false,
    accent: '#FF5A1F',
  };
}

/** bring projects saved by older versions up to date */
export function migrate(p: Project): Project {
  const base = newProject();
  return {
    ...base,
    ...p,
    subtitleStyle: { ...base.subtitleStyle, ...(p.subtitleStyle ?? {}) },
    shots: (p.shots ?? []).map((s) => ({ ...s, layout: s.layout ?? 'full' })),
    aroll: p.aroll ?? null,
    subtitles: p.subtitles ?? [],
  };
}

export function newShot(p: Project, partial: Partial<Shot>): Shot {
  return {
    id: uid('s_'),
    pageId: null,
    rect: { x: 0, y: 0, w: 100, h: 100 },
    duration: 2.5,
    framing: 'fit',
    motion: 'auto',
    intensity: 0.6,
    transition: p.shots.length ? 'glide' : 'cut',
    transitionDur: 0.5,
    shake: 0,
    layout: 'full',
    caption: { text: '', ...p.defaultCaption },
    ...partial,
  };
}

/* ----------------------------------------------------------- the store */

interface State { project: Project; ui: UIState; past: Project[]; future: Project[] }

let state: State = {
  project: newProject(),
  ui: {
    selection: null, activePageId: null, playhead: 0, playing: false, mode: 'cut',
    pxPerSec: 60, safeZones: true, exportOpen: false, autoOpen: false, settingsOpen: false, busy: null, saved: 'saved',
  },
  past: [],
  future: [],
};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f));

let lastKey = '';
let lastAt = 0;
let saveTimer: number | undefined;

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    setUI({ saved: 'saving' });
    await idb.put('projects', 'current', state.project);
    setUI({ saved: 'saved' });
  }, 600);
}

/** Mutate the project. `key` coalesces rapid edits (sliders, drags) into a single undo step. */
export function update(fn: (p: Project) => Project, key?: string) {
  const now = performance.now();
  const coalesce = key && key === lastKey && now - lastAt < 800;
  lastKey = key ?? '';
  lastAt = now;
  const next = fn(state.project);
  if (next === state.project) return;
  state = {
    ...state,
    project: next,
    past: coalesce ? state.past : [...state.past.slice(-80), state.project],
    future: [],
    ui: { ...state.ui, saved: 'dirty' },
  };
  emit();
  scheduleSave();
}

export function setUI(patch: Partial<UIState>) {
  state = { ...state, ui: { ...state.ui, ...patch } };
  emit();
}

export function undo() {
  const prev = state.past[state.past.length - 1];
  if (!prev) return;
  state = { ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
  lastKey = '';
  emit();
  scheduleSave();
}
export function redo() {
  const nxt = state.future[0];
  if (!nxt) return;
  state = { ...state, project: nxt, future: state.future.slice(1), past: [...state.past, state.project] };
  lastKey = '';
  emit();
  scheduleSave();
}

export function loadProject(p: Project) {
  p = migrate(p);
  state = { ...state, project: p, past: [], future: [], ui: { ...state.ui, selection: null, playhead: 0, activePageId: p.pages[0]?.id ?? null } };
  emit();
  scheduleSave();
}

export const getState = () => state;
export const useStore = <T,>(sel: (s: State) => T) => useSyncExternalStore(subscribe, () => sel(state));
export const useProject = () => useStore((s) => s.project);
export const useUI = () => useStore((s) => s.ui);
export const useHistory = () => ({
  canUndo: useStore((s) => s.past.length > 0),
  canRedo: useStore((s) => s.future.length > 0),
});

/* ------------------------------------------------------------- helpers */

// learn from corrections once per gesture: a drag or a slider sends many edits,
// Forge Brain sees the original value and the final one.
let pendingObs: { id: string; key: string; orig: Shot; patch: Partial<Shot>; timer: number } | null = null;
function flushObs() {
  if (!pendingObs) return;
  window.clearTimeout(pendingObs.timer);
  observeShotEdit(pendingObs.orig, pendingObs.patch);
  pendingObs = null;
}

export const patchShot = (id: string, patch: Partial<Shot>, key?: string) => {
  const cur = state.project.shots.find((s) => s.id === id);
  if (cur?.auto) {
    const k = key ?? '';
    if (pendingObs && (pendingObs.id !== id || pendingObs.key !== k || !k)) flushObs();
    if (!pendingObs) pendingObs = { id, key: k, orig: cur, patch: {}, timer: 0 };
    pendingObs.patch = { ...pendingObs.patch, ...patch };
    window.clearTimeout(pendingObs.timer);
    pendingObs.timer = window.setTimeout(flushObs, k ? 900 : 0);
  }
  update((p) => ({ ...p, shots: p.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), key);
};

export const shotDeleted = (s: Shot) => observeShotDeleted(s);

export const patchCaption = (id: string, patch: Partial<Caption>, key?: string) =>
  update((p) => ({ ...p, shots: p.shots.map((s) => (s.id === id ? { ...s, caption: { ...s.caption, ...patch } } : s)) }), key);
