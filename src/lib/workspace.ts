import type { Project } from '../types';
import { mediaRefs } from './projectFile';
import { uid } from './util';

/**
 * PROJECT WORKSPACE — where projects live.
 *
 * A folder on the user's disk (File System Access API, Chrome / Edge) or, when
 * no folder was chosen, the browser's private file system (OPFS). Both are the
 * same directory API, so one code path serves both:
 *
 *   forge-workspace.json             marker + layout version
 *   projects/<id>/project.json       { schema, savedAt, project }
 *   projects/<id>/meta.json          what the project list shows (fast listing)
 *   projects/<id>/versions/*.json    snapshots (automatic and named)
 *   media/<mediaId> + <mediaId>.json media bytes, shared by every project; never deleted automatically
 *   proxies/<mediaId>.mp4            light copies of large rushes for the preview (made again on demand)
 *   corbeille/<mediaId>             media no project nor version used, moved here on request; restorable
 *   templates/<id>.json              project templates (settings only, no media)
 *
 * The functions here are pure storage: no React, no store. Writes go through
 * createWritable, which the browser swaps in atomically on close.
 */

/* ---------------------------------------------------------------- directory API (the subset used) */

export interface FileLike { getFile(): Promise<Blob>; createWritable(): Promise<{ write(d: Blob | string | BufferSource): Promise<void>; close(): Promise<void> }> }
export interface DirLike {
  name: string;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirLike>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileLike>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterable<string>;
}

export const SCHEMA = 2;
const LAYOUT = 1;
export type ProdStatus = NonNullable<Project['production']>['status'];

export interface ProjectMeta {
  id: string; name: string; format: Project['format']; status: ProdStatus;
  createdAt: string; updatedAt: string;
  pages: number; shots: number; hasRush: boolean; tasksOpen: number; tasksDone: number;
  template?: string;
}
export interface VersionInfo { file: string; at: string; label: string; auto: boolean; shots: number }
export interface Template { id: string; name: string; createdAt: string; settings: Partial<Project> }

const exists = async (d: DirLike, name: string) => { try { await d.getFileHandle(name); return true; } catch { return false; } };
const sub = (d: DirLike, name: string, create = true) => d.getDirectoryHandle(name, { create });
async function writeFile(d: DirLike, name: string, data: Blob | string) {
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(data);
  await w.close();
}
const readText = async (d: DirLike, name: string) => (await (await d.getFileHandle(name)).getFile()).text();
async function readJson<T>(d: DirLike, name: string): Promise<T | null> { try { return JSON.parse(await readText(d, name)) as T; } catch { return null; } }
async function names(d: DirLike) { const out: string[] = []; for await (const k of d.keys()) out.push(k); return out; }
const TRASH = 'corbeille';
export interface DiskUsage { used: { count: number; bytes: number }; unused: { id: string; bytes: number; name?: string }[]; versions: { count: number; bytes: number }; exports: { count: number; bytes: number }; proxies: { count: number; bytes: number }; trash: { count: number; bytes: number } }
const safeId = (id: string) => id.replace(/[^\w.-]/g, '_');

/* ---------------------------------------------------------------- workspace */

export class Workspace {
  /** media already on disk: avoids re-checking on every save */
  private known = new Set<string>();
  readonly root: DirLike;
  readonly kind: 'folder' | 'browser';
  constructor(root: DirLike, kind: 'folder' | 'browser') { this.root = root; this.kind = kind; }

  async init() {
    if (!(await exists(this.root, 'forge-workspace.json'))) await writeFile(this.root, 'forge-workspace.json', JSON.stringify({ app: 'Forge', layout: LAYOUT, created: new Date().toISOString() }));
    await sub(this.root, 'projects'); await sub(this.root, 'media'); await sub(this.root, 'templates');
    return this;
  }

  /* -------- media */
  async hasMedia(id: string) {
    if (this.known.has(id)) return true;
    const ok = await exists(await sub(this.root, 'media'), safeId(id));
    if (ok) this.known.add(id);
    return ok;
  }
  async putMedia(id: string, blob: Blob, info: { name?: string; source?: string } = {}) {
    const m = await sub(this.root, 'media');
    await writeFile(m, safeId(id), blob);
    await writeFile(m, `${safeId(id)}.json`, JSON.stringify({ id, type: blob.type, size: blob.size, addedAt: new Date().toISOString(), ...info }));
    this.known.add(id);
  }
  async getMedia(id: string): Promise<Blob | null> {
    try {
      const m = await sub(this.root, 'media');
      const info = await readJson<{ type?: string }>(m, `${safeId(id)}.json`);
      const b = await (await m.getFileHandle(safeId(id))).getFile();
      return info?.type && b.type !== info.type ? new Blob([b], { type: info.type }) : b;
    } catch { return null; }
  }

  /* -------- projects */
  /** write the project and any media it references that the workspace does not have yet */
  async saveProject(p: Project, getBlob: (id: string) => Promise<Blob | undefined | null>): Promise<{ savedAt: string; mediaWritten: number }> {
    let mediaWritten = 0;
    for (const { id } of mediaRefs(p)) {
      if (await this.hasMedia(id)) continue;
      const b = await getBlob(id);
      if (b) { await this.putMedia(id, b); mediaWritten++; }
    }
    const dir = await sub(await sub(this.root, 'projects'), safeId(p.id));
    const savedAt = new Date().toISOString();
    await writeFile(dir, 'project.json', JSON.stringify({ schema: SCHEMA, savedAt, project: p }));
    await writeFile(dir, 'meta.json', JSON.stringify(metaOf(p, savedAt)));
    return { savedAt, mediaWritten };
  }
  async readProject(id: string): Promise<{ project: Project; savedAt: string } | null> {
    try {
      const dir = await sub(await sub(this.root, 'projects'), safeId(id), false);
      const d = await readJson<{ savedAt: string; project: Project }>(dir, 'project.json');
      return d?.project ? { project: d.project, savedAt: d.savedAt } : null;
    } catch { return null; }
  }
  async listProjects(): Promise<ProjectMeta[]> {
    const ps = await sub(this.root, 'projects');
    const out: ProjectMeta[] = [];
    for (const n of await names(ps)) {
      try {
        const dir = await sub(ps, n, false);
        const m = (await readJson<ProjectMeta>(dir, 'meta.json')) ?? (await readJson<{ savedAt: string; project: Project }>(dir, 'project.json').then((d) => (d ? metaOf(d.project, d.savedAt) : null)));
        if (m) out.push(m);
      } catch { /* not a project folder */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async deleteProject(id: string) { await (await sub(this.root, 'projects')).removeEntry(safeId(id), { recursive: true }); }

  /* -------- versions */
  async snapshot(p: Project, label: string, auto: boolean, keepAuto = 30): Promise<VersionInfo> {
    const dir = await sub(await sub(await sub(this.root, 'projects'), safeId(p.id)), 'versions');
    const at = new Date().toISOString();
    const file = `${at.replace(/[:.]/g, '-')}${auto ? '-auto' : ''}.json`;
    await writeFile(dir, file, JSON.stringify({ schema: SCHEMA, at, label, auto, project: p }));
    // only automatic versions are pruned; named ones stay until the user removes them
    const autos = (await names(dir)).filter((n) => n.endsWith('-auto.json')).sort();
    for (const old of autos.slice(0, Math.max(0, autos.length - keepAuto))) await dir.removeEntry(old);
    return { file, at, label, auto, shots: p.shots.length };
  }
  async listVersions(id: string): Promise<VersionInfo[]> {
    try {
      const dir = await sub(await sub(await sub(this.root, 'projects'), safeId(id), false), 'versions', false);
      const out: VersionInfo[] = [];
      for (const n of await names(dir)) {
        const d = await readJson<{ at: string; label: string; auto: boolean; project: Project }>(dir, n);
        if (d) out.push({ file: n, at: d.at, label: d.label, auto: d.auto, shots: d.project?.shots?.length ?? 0 });
      }
      return out.sort((a, b) => b.at.localeCompare(a.at));
    } catch { return []; }
  }
  async readVersion(id: string, file: string): Promise<Project | null> {
    try {
      const dir = await sub(await sub(await sub(this.root, 'projects'), safeId(id), false), 'versions', false);
      return (await readJson<{ project: Project }>(dir, file))?.project ?? null;
    } catch { return null; }
  }
  /** a version file as written (exported in .forge files) */
  async readVersionText(id: string, file: string): Promise<string | null> {
    try { return await readText(await sub(await sub(await sub(this.root, 'projects'), safeId(id), false), 'versions', false), file); } catch { return null; }
  }
  /** bring a version back from a .forge file; an existing version of the same name is kept */
  async writeVersionText(id: string, file: string, text: string): Promise<boolean> {
    const dir = await sub(await sub(await sub(this.root, 'projects'), safeId(id)), 'versions');
    const name = safeId(file.replace(/\.json$/, '')) + '.json';
    if (await exists(dir, name)) return false;
    await writeFile(dir, name, text);
    return true;
  }
  async deleteVersion(id: string, file: string) {
    const dir = await sub(await sub(await sub(this.root, 'projects'), safeId(id), false), 'versions', false);
    await dir.removeEntry(file);
  }

  /* -------- templates */
  async saveTemplate(t: Template) { await writeFile(await sub(this.root, 'templates'), `${safeId(t.id)}.json`, JSON.stringify(t)); }
  async listTemplates(): Promise<Template[]> {
    const d = await sub(this.root, 'templates');
    const out: Template[] = [];
    for (const n of await names(d)) { const t = await readJson<Template>(d, n); if (t?.settings) out.push(t); }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async deleteTemplate(id: string) { await (await sub(this.root, 'templates')).removeEntry(`${safeId(id)}.json`); }

  /* -------- shared data files (media library index) */
  async readData(name: string): Promise<string | null> { try { return await readText(await sub(this.root, 'library'), name); } catch { return null; } }
  async writeData(name: string, text: string) { await writeFile(await sub(this.root, 'library'), name, text); }
  async mediaInfo(id: string): Promise<{ type?: string; size?: number; addedAt?: string; name?: string; source?: string } | null> { return readJson(await sub(this.root, 'media'), `${safeId(id)}.json`); }

  /* -------- proxies: light copies for the preview, always made again from the original */
  async putProxy(id: string, blob: Blob) { await writeFile(await sub(this.root, 'proxies'), `${safeId(id)}.mp4`, blob); }
  async getProxy(id: string): Promise<Blob | null> {
    try { const b = await (await (await sub(this.root, 'proxies', false)).getFileHandle(`${safeId(id)}.mp4`)).getFile(); return new Blob([b], { type: 'video/mp4' }); } catch { return null; }
  }
  /** proxies are never originals: removing them all is safe, they are made again on demand */
  async removeProxies(): Promise<number> {
    try { const d = await sub(this.root, 'proxies', false); const all = await names(d); for (const f of all) await d.removeEntry(f); return all.length; } catch { return 0; }
  }

  /* -------- disk space and safe cleanup */
  /** every media id that a project or one of its versions points to: these are never cleaned */
  async usedMedia(): Promise<Set<string>> {
    const used = new Set<string>();
    const ps = await sub(this.root, 'projects');
    for (const n of await names(ps)) {
      let dir: DirLike;
      try { dir = await sub(ps, n, false); } catch { continue; }
      const d = await readJson<{ project: Project }>(dir, 'project.json');
      if (d?.project) for (const m of mediaRefs(d.project)) used.add(m.id);
      try {
        const vd = await sub(dir, 'versions', false);
        for (const f of await names(vd)) { const v = await readJson<{ project: Project }>(vd, f); if (v?.project) for (const m of mediaRefs(v.project)) used.add(m.id); }
      } catch { /* no versions */ }
    }
    return used;
  }
  /** what takes room, by kind: original media (used / no longer used), versions, exports, trash */
  async usage(): Promise<DiskUsage> {
    const used = await this.usedMedia();
    const size = async (d: DirLike, n: string) => { try { return (await (await d.getFileHandle(n)).getFile()).size; } catch { return 0; } };
    const media = await sub(this.root, 'media');
    const out: DiskUsage = { used: { count: 0, bytes: 0 }, unused: [], versions: { count: 0, bytes: 0 }, exports: { count: 0, bytes: 0 }, proxies: { count: 0, bytes: 0 }, trash: { count: 0, bytes: 0 } };
    for (const n of await names(media)) {
      if (n.endsWith('.json')) continue;
      const info = await readJson<{ id?: string; name?: string; size?: number }>(media, `${n}.json`);
      const id = info?.id ?? n;
      const bytes = info?.size ?? (await size(media, n));
      if (used.has(id) || used.has(n)) { out.used.count++; out.used.bytes += bytes; } else out.unused.push({ id, bytes, name: info?.name });
    }
    const ps = await sub(this.root, 'projects');
    for (const n of await names(ps)) {
      try { const vd = await sub(await sub(ps, n, false), 'versions', false); for (const f of await names(vd)) { out.versions.count++; out.versions.bytes += await size(vd, f); } } catch { /* none */ }
    }
    for (const [key, dirName] of [['exports', 'exports'], ['proxies', 'proxies'], ['trash', TRASH]] as const) {
      try { const d = await sub(this.root, dirName, false); for (const f of await names(d)) { if (key === 'trash' && f.endsWith('.json')) continue; out[key].count++; out[key].bytes += await size(d, f); } } catch { /* none */ }
    }
    return out;
  }
  /**
   * move media nobody uses any more to the trash folder (recoverable). Usage is
   * checked again here, at the moment of moving: a media used by a project or a
   * version is never moved, whatever the caller asked.
   */
  async trashUnused(ids: string[]): Promise<{ moved: number; bytes: number; refused: number }> {
    const used = await this.usedMedia();
    const media = await sub(this.root, 'media'), trash = await sub(this.root, TRASH);
    let moved = 0, bytes = 0, refused = 0;
    for (const id of ids) {
      if (used.has(id)) { refused++; continue; }
      const n = safeId(id);
      try {
        const b = await (await media.getFileHandle(n)).getFile();
        await writeFile(trash, n, b);
        const info = await readJson<Record<string, unknown>>(media, `${n}.json`);
        await writeFile(trash, `${n}.json`, JSON.stringify({ ...(info ?? { id }), trashedAt: new Date().toISOString() }));
        await media.removeEntry(n);
        try { await media.removeEntry(`${n}.json`); } catch { /* no info file */ }
        this.known.delete(id);
        moved++; bytes += b.size;
      } catch { refused++; }
    }
    return { moved, bytes, refused };
  }
  /** put everything in the trash back where it was */
  async restoreTrash(): Promise<number> {
    let trash: DirLike;
    try { trash = await sub(this.root, TRASH, false); } catch { return 0; }
    const media = await sub(this.root, 'media');
    let n = 0;
    for (const f of await names(trash)) {
      if (f.endsWith('.json')) continue;
      const b = await (await trash.getFileHandle(f)).getFile();
      if (!(await exists(media, f))) await writeFile(media, f, b);
      const info = await readJson<Record<string, unknown>>(trash, `${f}.json`);
      if (info && !(await exists(media, `${f}.json`))) { delete info.trashedAt; await writeFile(media, `${f}.json`, JSON.stringify(info)); }
      await trash.removeEntry(f);
      try { await trash.removeEntry(`${f}.json`); } catch { /* none */ }
      n++;
    }
    return n;
  }
  /** the only permanent deletion: what the user put in the trash, on their explicit confirmation */
  async emptyTrash(): Promise<number> {
    try { const t = await sub(this.root, TRASH, false); const all = await names(t); for (const f of all) await t.removeEntry(f); return all.filter((f) => !f.endsWith('.json')).length; } catch { return 0; }
  }

  /* -------- exports (finished videos): written straight into the workspace, so into the user's folder */
  async putExport(name: string, blob: Blob) { await writeFile(await sub(this.root, 'exports'), name.replace(/[\\/:*?"<>|]/g, '_'), blob); }
  async getExport(name: string): Promise<Blob | null> {
    try { return await (await (await sub(this.root, 'exports', false)).getFileHandle(name.replace(/[\\/:*?"<>|]/g, '_'))).getFile(); } catch { return null; }
  }

  /** copy every project (and its media) into another workspace: moving from the browser to a folder */
  async copyAllTo(dest: Workspace, onStep?: (done: number, total: number) => void) {
    const list = await this.listProjects();
    let i = 0;
    for (const m of list) {
      const r = await this.readProject(m.id);
      if (r && !(await dest.readProject(m.id))) await dest.saveProject(r.project, (id) => this.getMedia(id));
      onStep?.(++i, list.length);
    }
    for (const t of await this.listTemplates()) await dest.saveTemplate(t);
    return list.length;
  }
}

/* ---------------------------------------------------------------- pure helpers (tested) */

export function metaOf(p: Project, savedAt: string): ProjectMeta {
  const tasks = p.production?.tasks ?? [];
  return {
    id: p.id, name: p.name || 'Sans titre', format: p.format, status: p.production?.status ?? 'idee',
    createdAt: p.production?.createdAt ?? savedAt, updatedAt: savedAt,
    pages: p.pages?.length ?? 0, shots: p.shots?.length ?? 0, hasRush: !!p.aroll,
    tasksOpen: tasks.filter((t) => !t.done).length, tasksDone: tasks.filter((t) => t.done).length,
    template: p.production?.template,
  };
}

/** the settings a template keeps: look and sound, never the content (pages, shots, rush, script) */
const TEMPLATE_KEYS = ['format', 'fps', 'background', 'bgColor', 'readingOrder', 'ducking', 'duckLevel', 'subtitleStyle', 'defaultCaption', 'watermark', 'progressBar', 'accent', 'art', 'titleStyle', 'diagramStyle', 'look', 'brand', 'autoSfx', 'mix', 'holds'] as const;
export function templateFrom(p: Project): Partial<Project> {
  const out: Record<string, unknown> = {};
  for (const k of TEMPLATE_KEYS) if (p[k] !== undefined) out[k] = structuredClone(p[k]);
  out.production = { status: 'idee', tasks: (p.production?.tasks ?? []).map((t) => ({ ...t, done: false })), createdAt: '' };
  return out as Partial<Project>;
}

/** the default checklist of a short comic video, from idea to publication */
export function defaultTasks(): NonNullable<Project['production']>['tasks'] {
  const t = (text: string, phase: ProdStatus) => ({ id: uid('t_'), text, done: false, phase });
  return [
    t('Choisir le sujet et les numéros de comics', 'idee'),
    t('Écrire le script', 'script'),
    t('Importer les pages de comics', 'script'),
    t('Enregistrer le face caméra', 'tournage'),
    t('Montage automatique puis corrections', 'montage'),
    t('Vérifier les associations phrase → case', 'montage'),
    t('Contrôle qualité et son', 'finition'),
    t('Exporter TikTok, Shorts et Reels', 'finition'),
  ];
}

/* ---------------------------------------------------------------- opening the workspace in the browser */

type Perm = 'granted' | 'denied' | 'prompt';
type FsHandle = DirLike & { queryPermission?(o: { mode: string }): Promise<Perm>; requestPermission?(o: { mode: string }): Promise<Perm> };

export const folderPickerAvailable = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** the browser's private file system, under a « forge » folder */
export async function browserWorkspace(): Promise<Workspace | null> {
  try {
    const root = (await navigator.storage.getDirectory()) as unknown as DirLike;
    try { await navigator.storage.persist?.(); } catch { /* best effort */ }
    return await new Workspace(await root.getDirectoryHandle('forge', { create: true }), 'browser').init();
  } catch { return null; }
}

/** a folder the user chose earlier: usable now, or needs a click to grant access again */
export async function folderState(h: FsHandle | null | undefined): Promise<'none' | 'granted' | 'prompt' | 'denied'> {
  if (!h) return 'none';
  try { return (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'; } catch { return 'denied'; }
}
export async function requestFolder(h: FsHandle): Promise<boolean> {
  try { return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted'; } catch { return false; }
}
export async function pickFolder(): Promise<FsHandle | null> {
  try {
    return (await (window as unknown as { showDirectoryPicker(o: object): Promise<FsHandle> }).showDirectoryPicker({ id: 'forge-projects', mode: 'readwrite', startIn: 'documents' }));
  } catch { return null; } // cancelled
}
