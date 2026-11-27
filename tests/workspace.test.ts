import { describe, expect, it } from 'vitest';
import { Workspace, metaOf, templateFrom, defaultTasks, type DirLike, type FileLike } from '../src/lib/workspace';
import { newProject } from '../src/store';
import type { Project } from '../src/types';

/** in-memory directory with the File System Access API subset Forge uses (writes land on close, like the browser) */
class MemDir implements DirLike {
  dirs = new Map<string, MemDir>();
  files = new Map<string, Blob>();
  writes = 0;
  constructor(public name = 'root') {}
  async getDirectoryHandle(n: string, o?: { create?: boolean }) {
    if (!this.dirs.has(n)) { if (!o?.create) throw new DOMException('absent', 'NotFoundError'); this.dirs.set(n, new MemDir(n)); }
    return this.dirs.get(n)!;
  }
  async getFileHandle(n: string, o?: { create?: boolean }): Promise<FileLike> {
    if (!this.files.has(n) && !o?.create) throw new DOMException('absent', 'NotFoundError');
    return {
      getFile: async () => this.files.get(n) ?? new Blob([]),
      createWritable: async () => {
        let buf: Blob | null = null;
        return { write: async (d: Blob | string | BufferSource) => { buf = new Blob([d as BlobPart]); }, close: async () => { this.files.set(n, buf ?? new Blob([])); this.writes++; } };
      },
    };
  }
  async removeEntry(n: string) { if (!this.files.delete(n) && !this.dirs.delete(n)) throw new DOMException('absent', 'NotFoundError'); }
  async *keys() { yield* this.dirs.keys(); yield* this.files.keys(); }
}

const proj = (over: Partial<Project> = {}): Project => ({ ...newProject(), name: 'Galactus', ...over });
const blobs = new Map<string, Blob>([['img1', new Blob(['page'], { type: 'image/jpeg' })], ['vid1', new Blob(['rush-bytes'], { type: 'video/mp4' })]]);
const getBlob = async (id: string) => blobs.get(id) ?? null;

describe('espace de projets', () => {
  it('enregistre un projet avec ses médias, le relit, et ne réécrit pas un média déjà présent', async () => {
    const ws = await new Workspace(new MemDir(), 'folder').init();
    const p = proj({ pages: [{ id: 'pg', mediaId: 'img1' } as never], aroll: { mediaId: 'vid1' } as never });
    const r1 = await ws.saveProject(p, getBlob);
    expect(r1.mediaWritten).toBe(2);
    const r2 = await ws.saveProject({ ...p, name: 'Galactus 2' }, getBlob);
    expect(r2.mediaWritten).toBe(0);
    const back = await ws.readProject(p.id);
    expect(back?.project.name).toBe('Galactus 2');
    const rush = await ws.getMedia('vid1');
    expect(rush?.type).toBe('video/mp4');
    expect(await rush?.text()).toBe('rush-bytes');
  });

  it('liste plusieurs projets, du plus récent au plus ancien, et en supprime un', async () => {
    const ws = await new Workspace(new MemDir(), 'browser').init();
    const a = proj({ name: 'A' }), b = proj({ name: 'B' });
    await ws.saveProject(a, getBlob);
    await new Promise((r) => setTimeout(r, 5));
    await ws.saveProject(b, getBlob);
    expect((await ws.listProjects()).map((m) => m.name)).toEqual(['B', 'A']);
    await ws.deleteProject(a.id);
    expect((await ws.listProjects()).map((m) => m.name)).toEqual(['B']);
  });

  it('garde les 30 dernières versions automatiques et toutes les versions nommées', async () => {
    const ws = await new Workspace(new MemDir(), 'folder').init();
    const p = proj();
    await ws.snapshot(p, 'Avant le montage auto', false);
    for (let i = 0; i < 33; i++) { await ws.snapshot({ ...p, name: `v${i}` }, 'Automatique', true); await new Promise((r) => setTimeout(r, 2)); }
    const vs = await ws.listVersions(p.id);
    expect(vs.filter((v) => v.auto)).toHaveLength(30);
    expect(vs.filter((v) => !v.auto)).toHaveLength(1);
    const newest = await ws.readVersion(p.id, vs[0].file);
    expect(newest?.name).toBe('v32');
  });

  it('copie tous les projets du navigateur vers un dossier, médias compris, sans écraser', async () => {
    const from = await new Workspace(new MemDir(), 'browser').init();
    const to = await new Workspace(new MemDir(), 'folder').init();
    const p = proj({ aroll: { mediaId: 'vid1' } as never });
    await from.saveProject(p, getBlob);
    await from.saveTemplate({ id: 'tp', name: 'Mon style', createdAt: '', settings: templateFrom(p) });
    expect(await from.copyAllTo(to)).toBe(1);
    expect((await to.readProject(p.id))?.project.name).toBe('Galactus');
    expect(await (await to.getMedia('vid1'))?.text()).toBe('rush-bytes');
    expect((await to.listTemplates()).map((t) => t.name)).toEqual(['Mon style']);
  });

  it('un modèle garde le style et le son, jamais le contenu', () => {
    const p = proj({ accent: '#123456', script: 'secret', pages: [{ id: 'x' } as never], production: { status: 'montage', tasks: [{ id: 't', text: 'Exporter', done: true }], createdAt: 'x' } });
    const t = templateFrom(p);
    expect(t.accent).toBe('#123456');
    expect(t.mix).toBeDefined();
    expect(t).not.toHaveProperty('script');
    expect(t).not.toHaveProperty('pages');
    expect(t.production?.tasks[0].done).toBe(false);
  });

  it('résume un projet pour la liste (statut, tâches, rush)', () => {
    const p = proj({ aroll: { mediaId: 'v' } as never, production: { status: 'script', tasks: defaultTasks(), createdAt: '2026-11-01' } });
    p.production!.tasks[0].done = true;
    const m = metaOf(p, '2026-11-26T10:00:00Z');
    expect(m).toMatchObject({ status: 'script', hasRush: true, tasksDone: 1, tasksOpen: 7, createdAt: '2026-11-01' });
  });
});

describe('espace disque et nettoyage sûr', () => {
  it('compte les médias utilisés, y compris par une version seulement, et ne propose que les autres', async () => {
    const ws = await new Workspace(new MemDir(), 'folder').init();
    const all = new Map<string, Blob>([['a', new Blob(['aaaa'])], ['b', new Blob(['bb'])], ['orphelin', new Blob(['xxxxxx'])]]);
    const get = async (id: string) => all.get(id) ?? null;
    const p = proj({ pages: [{ id: 'p1', mediaId: 'a' } as never, { id: 'p2', mediaId: 'b' } as never] });
    await ws.saveProject(p, get);
    await ws.snapshot(p, 'avec b', false);
    // b is removed from the project but a version still uses it
    await ws.saveProject({ ...p, pages: [p.pages[0]] }, get);
    await ws.putMedia('orphelin', all.get('orphelin')!, { name: 'scan-oublie.jpg' });
    const u = await ws.usage();
    expect(u.used.count).toBe(2);
    expect(u.unused.map((m) => m.id)).toEqual(['orphelin']);
    expect(u.unused[0].bytes).toBe(6);
    expect(u.versions.count).toBe(1);
  });
  it('un média utilisé n’est jamais mis à la corbeille, même demandé ; la corbeille se restaure', async () => {
    const ws = await new Workspace(new MemDir(), 'folder').init();
    const p = proj({ pages: [{ id: 'p1', mediaId: 'img1' } as never] });
    await ws.saveProject(p, getBlob);
    await ws.putMedia('vieux', new Blob(['123']));
    const r = await ws.trashUnused(['img1', 'vieux']);
    expect(r).toEqual({ moved: 1, bytes: 3, refused: 1 });
    expect(await ws.getMedia('img1')).not.toBeNull();
    expect(await ws.getMedia('vieux')).toBeNull();
    expect((await ws.usage()).trash).toEqual({ count: 1, bytes: 3 });
    expect(await ws.restoreTrash()).toBe(1);
    expect(await (await ws.getMedia('vieux'))!.text()).toBe('123');
    expect((await ws.usage()).trash.count).toBe(0);
  });
  it('vider la corbeille ne touche que la corbeille', async () => {
    const ws = await new Workspace(new MemDir(), 'folder').init();
    await ws.saveProject(proj({ pages: [{ id: 'p1', mediaId: 'img1' } as never] }), getBlob);
    await ws.putMedia('vieux', new Blob(['123']));
    await ws.trashUnused(['vieux']);
    expect(await ws.emptyTrash()).toBe(1);
    expect(await ws.getMedia('img1')).not.toBeNull();
  });
});
