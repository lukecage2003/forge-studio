import type { Project } from '../types';
import { flushSave, getState, loadProject, newProject, onSaved, setUI } from '../store';
import { idb } from './db';
import { mediaBlob, putMediaBlob } from '../engine/media';
import { loadMediaOf, mediaRefs } from './projectFile';
import { uid } from './util';
import {
  Workspace, browserWorkspace, defaultTasks, folderPickerAvailable, folderState, pickFolder, requestFolder, templateFrom,
  type DirLike, type ProjectMeta, type Template, type VersionInfo,
} from './workspace';

/**
 * PRODUCTION STUDIO — the session side of the project workspace.
 * Keeps the open project written to the workspace (folder or browser),
 * recovers the last state after a crash, takes versions, and opens, creates,
 * duplicates or removes projects. All edits still go through the store, so
 * they stay undoable; switching project saves the current one first.
 */

let ws: Workspace | null = null;
let folderHandle: (DirLike & { name: string }) | null = null;
let writeTimer: number | undefined;
let lastSnapAt = 0;
let dirtySinceSnap = false;
const SNAP_EVERY = 10 * 60 * 1000;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
export const onStudio = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const workspace = () => ws;

function writeSoon(p: Project) {
  window.clearTimeout(writeTimer);
  dirtySinceSnap = true;
  writeTimer = window.setTimeout(() => void writeNow(p), 2000);
}
async function writeNow(p: Project) {
  window.clearTimeout(writeTimer);
  if (!ws) return;
  try {
    await ws.saveProject(p, (id) => mediaBlob(id));
    if (dirtySinceSnap && Date.now() - lastSnapAt > SNAP_EVERY) { await ws.snapshot(p, 'Sauvegarde automatique', true); lastSnapAt = Date.now(); dirtySinceSnap = false; }
    changed();
  } catch (e) {
    console.warn('Écriture du projet impossible :', e);
    // a folder can lose its permission: keep journaling in the browser and ask for access again
    if (ws.kind === 'folder') { ws = null; setUI({ where: 'reconnect' }); changed(); }
  }
}

/** start: open the workspace, then reconcile it with the journal (crash recovery) */
let started: Promise<{ recovered: boolean; loadedFromDisk: boolean }> | null = null;
/** idempotent: React may run the start effect twice */
export function initStudio() { return (started ??= start()); }
async function start(): Promise<{ recovered: boolean; loadedFromDisk: boolean }> {
  onSaved((p) => writeSoon(p));
  const saved = await idb.get<DirLike & { name: string }>('projects', '__folder').catch(() => undefined);
  const st = await folderState(saved as never);
  if (saved && st === 'granted') { folderHandle = saved; ws = await new Workspace(saved, 'folder').init(); setUI({ where: 'folder', whereName: saved.name }); }
  else if (saved && st === 'prompt') { folderHandle = saved; setUI({ where: 'reconnect', whereName: saved.name }); changed(); return { recovered: false, loadedFromDisk: false }; }
  else { ws = await browserWorkspace(); setUI({ where: ws ? 'browser' : 'none' }); }
  changed();
  return reconcile();
}

async function reconcile(): Promise<{ recovered: boolean; loadedFromDisk: boolean }> {
  if (!ws) return { recovered: false, loadedFromDisk: false };
  const p = getState().project;
  const j = await idb.get<{ id: string; savedAt: string }>('projects', '__journal').catch(() => undefined);
  const disk = await ws.readProject(p.id);
  // the workspace has a newer state of this project (edited from this folder elsewhere): open it
  if (disk && j && j.id === p.id && disk.savedAt > j.savedAt) {
    await bringMedia(disk.project);
    loadProject(disk.project);
    return { recovered: false, loadedFromDisk: true };
  }
  const isEmpty = !p.pages.length && !p.shots.length && !p.aroll && !p.audio.length && !p.script;
  if (isEmpty && !disk) return { recovered: false, loadedFromDisk: false };
  // journal newer than the workspace (closed before the last write): write it now
  const recovered = !!disk && !!j && j.id === p.id && j.savedAt > disk.savedAt;
  if (!disk || recovered) await writeNow(p);
  return { recovered, loadedFromDisk: false };
}

/** media the workspace holds but this browser does not (project opened on another PC) */
async function bringMedia(p: Project) {
  if (!ws) return;
  for (const { id } of mediaRefs(p)) {
    if (await mediaBlob(id)) continue;
    const b = await ws.getMedia(id);
    if (b) await putMediaBlob(id, b);
  }
  await loadMediaOf(p);
}

/* ---------------------------------------------------------------- where projects live */

export const canPickFolder = folderPickerAvailable;

/** choose a folder on disk; the browser's projects are copied there (never moved) */
export async function chooseFolder(onStep?: (d: number, n: number) => void): Promise<{ copied: number } | null> {
  const h = await pickFolder();
  if (!h) return null;
  const dest = await new Workspace(h, 'folder').init();
  const from = ws?.kind === 'browser' ? ws : await browserWorkspace();
  const copied = from ? await from.copyAllTo(dest, onStep) : 0;
  await idb.put('projects', '__folder', h);
  folderHandle = h; ws = dest;
  setUI({ where: 'folder', whereName: h.name });
  await flushSave();
  await writeNow(getState().project);
  return { copied };
}
/** a click is needed after a restart to use the folder again (browser rule) */
export async function reconnectFolder(): Promise<boolean> {
  if (!folderHandle || !(await requestFolder(folderHandle as never))) return false;
  ws = await new Workspace(folderHandle, 'folder').init();
  setUI({ where: 'folder', whereName: folderHandle.name });
  await reconcile();
  changed();
  return true;
}
/** stop using the folder (its files stay on disk); projects go back to the browser */
export async function forgetFolder() {
  await idb.del('projects', '__folder');
  folderHandle = null;
  ws = await browserWorkspace();
  setUI({ where: ws ? 'browser' : 'none', whereName: undefined });
  await writeNow(getState().project);
  changed();
}

/* ---------------------------------------------------------------- projects */

export const listProjects = (): Promise<ProjectMeta[]> => ws?.listProjects() ?? Promise.resolve([]);

async function saveCurrent() {
  await flushSave();
  await writeNow(getState().project);
}

export async function openProject(id: string): Promise<boolean> {
  if (!ws) return false;
  await saveCurrent();
  const r = await ws.readProject(id);
  if (!r) return false;
  await bringMedia(r.project);
  loadProject(r.project);
  lastSnapAt = Date.now(); dirtySinceSnap = false;
  return true;
}

export function freshProject(name = 'Nouveau projet', template?: Template): Project {
  const base = newProject();
  return {
    ...base,
    ...(template ? structuredClone(template.settings) : {}),
    id: base.id, name,
    pages: [], shots: [], audio: [], aroll: null, subtitles: [], fx: [],
    production: { status: 'idee', tasks: template?.settings.production?.tasks.length ? template.settings.production.tasks.map((t) => ({ ...t, id: uid('t_'), done: false })) : defaultTasks(), createdAt: new Date().toISOString(), template: template?.name },
  };
}

export async function createProject(name: string, template?: Template) {
  await saveCurrent();
  const p = freshProject(name, template);
  loadProject(p);
  await flushSave();
  await writeNow(p);
  return p;
}

export async function duplicateProject(id: string): Promise<string | null> {
  if (!ws) return null;
  await saveCurrent();
  const r = await ws.readProject(id);
  if (!r) return null;
  const copy: Project = { ...structuredClone(r.project), id: uid('p_'), name: `${r.project.name} (copie)`, production: { ...(r.project.production ?? { status: 'idee', tasks: [] }), createdAt: new Date().toISOString() } };
  await ws.saveProject(copy, (m) => mediaBlob(m));
  changed();
  return copy.id;
}

/** the open project can't be removed (open another first): avoids losing the work in progress */
export async function deleteProject(id: string): Promise<boolean> {
  if (!ws || id === getState().project.id) return false;
  await ws.deleteProject(id);
  changed();
  return true;
}

/* ---------------------------------------------------------------- versions */

export async function takeVersion(label: string, auto = false): Promise<VersionInfo | null> {
  if (!ws) return null;
  await saveCurrent();
  const v = await ws.snapshot(getState().project, label, auto);
  if (auto) { lastSnapAt = Date.now(); dirtySinceSnap = false; }
  changed();
  return v;
}
export const listVersions = (id = getState().project.id) => ws?.listVersions(id) ?? Promise.resolve([]);
export async function restoreVersion(file: string): Promise<boolean> {
  if (!ws) return false;
  const cur = getState().project;
  const v = await ws.readVersion(cur.id, file);
  if (!v) return false;
  // the state being replaced is kept as a version first: restoring can always be undone
  await ws.snapshot(cur, 'Avant restauration', true);
  await bringMedia(v);
  loadProject({ ...v, id: cur.id });
  await saveCurrent();
  changed();
  return true;
}
export const deleteVersion = async (file: string) => { await ws?.deleteVersion(getState().project.id, file); changed(); };

/* ---------------------------------------------------------------- templates */

export const listTemplates = () => ws?.listTemplates() ?? Promise.resolve([]);
export async function saveAsTemplate(name: string) {
  if (!ws) return null;
  const t: Template = { id: uid('tp_'), name, createdAt: new Date().toISOString(), settings: templateFrom(getState().project) };
  await ws.saveTemplate(t);
  changed();
  return t;
}
export const deleteTemplate = async (id: string) => { await ws?.deleteTemplate(id); changed(); };
