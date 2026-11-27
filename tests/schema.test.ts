import { describe, expect, it, vi } from 'vitest';

// media live in IndexedDB in the browser; here a map stands in for the cache
const cache = new Map<string, Blob>([['img1', new Blob(['page-1'], { type: 'image/jpeg' })], ['old', new Blob(['ancienne-page'], { type: 'image/png' })]]);
vi.mock('../src/engine/media', () => ({
  mediaBlob: async (id: string) => cache.get(id) ?? null,
  putMediaBlob: async (id: string, b: Blob) => { cache.set(id, b); },
  ensureMedia: async () => null, ensureVideo: async () => null,
}));

// the store schedules its journal with window timers
(globalThis as { window?: unknown }).window ??= globalThis;
const { upgrade, SCHEMA_VERSION, MIGRATIONS, onSchemaNotice } = await import('../src/lib/schema');
const { newProject, loadProject, getState } = await import('../src/store');
const { saveProjectFile, readProjectFile } = await import('../src/lib/projectFile');
import type { Project } from '../src/types';

describe('schéma des projets', () => {
  it('un projet sans numéro (avant le schéma) passe par toutes les étapes et reçoit le numéro actuel', () => {
    const old = { ...newProject(), name: 'Ancien' } as Project;
    delete old.schemaVersion;
    const r = upgrade(old);
    expect(r.from).toBe(1);
    expect(r.newer).toBe(false);
    expect(r.steps).toHaveLength(MIGRATIONS.length);
    expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.project.name).toBe('Ancien');
  });
  it('un projet déjà à jour ne repasse par aucune étape', () => {
    expect(upgrade(newProject()).steps).toEqual([]);
  });
  it('un projet d’une version plus récente garde son numéro et ses réglages inconnus, et l’utilisateur est prévenu', () => {
    const msgs: string[] = [];
    const off = onSchemaNotice((m) => msgs.push(m));
    const future = { ...newProject(), name: 'Futur', schemaVersion: SCHEMA_VERSION + 3, reglageFutur: { a: 1 } } as unknown as Project;
    loadProject(future);
    off();
    const p = getState().project as unknown as Record<string, unknown>;
    expect(p.schemaVersion).toBe(SCHEMA_VERSION + 3);
    expect(p.reglageFutur).toEqual({ a: 1 });
    expect(msgs[0]).toMatch(/version plus récente de Forge/);
  });
});

describe('fichier .forge avec manifeste et versions', () => {
  it('emporte le manifeste, les versions et les médias qu’elles utilisent, puis relit le tout', async () => {
    const p: Project = { ...newProject(), name: 'Galactus', pages: [{ id: 'pg', mediaId: 'img1' } as never] };
    const oldVersion: Project = { ...p, pages: [{ id: 'pg0', mediaId: 'old' } as never] };
    const versions = [{ file: '2026-11-01T10-00-00-000Z.json', text: JSON.stringify({ schema: 2, at: '2026-11-01', label: 'Première idée', auto: false, project: oldVersion }) }];
    const blob = await saveProjectFile(p, { versions });
    const r = await readProjectFile(blob);
    expect(r.project.name).toBe('Galactus');
    expect(r.manifest?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.manifest?.engineVersions.render).toBeGreaterThan(0);
    expect(r.manifest?.versions).toBe(1);
    expect(r.manifest?.missing).toEqual([]);
    expect(r.versions[0].file).toBe(versions[0].file);
    expect(JSON.parse(r.versions[0].text).label).toBe('Première idée');
    // the page used only by the old version travels too: restoring it works on another PC
    expect(await r.media.get('old')?.text()).toBe('ancienne-page');
    expect(await r.media.get('img1')?.text()).toBe('page-1');
  });
  it('signale un média introuvable au lieu d’écrire un fichier incomplet en silence', async () => {
    const p: Project = { ...newProject(), pages: [{ id: 'pg', mediaId: 'disparu' } as never] };
    const r = await readProjectFile(await saveProjectFile(p));
    expect(r.manifest?.missing).toEqual(['disparu']);
  });
});

describe('historique d’annulation dans le .forge', () => {
  it('emporte l’historique et les médias qu’il utilise, puis le relit', async () => {
    const p: Project = { ...newProject(), name: 'Après', pages: [{ id: 'pg', mediaId: 'img1' } as never] };
    const before: Project = { ...p, name: 'Avant', pages: [{ id: 'pg0', mediaId: 'old' } as never] };
    const r = await readProjectFile(await saveProjectFile(p, { history: { past: [before], future: [] } }));
    expect(r.history?.past[0].name).toBe('Avant');
    expect(await r.media.get('old')?.text()).toBe('ancienne-page');
  });
  it('un fichier sans historique s’ouvre comme avant', async () => {
    const r = await readProjectFile(await saveProjectFile({ ...newProject() }));
    expect(r.history).toBeNull();
  });
  it('l’historique remis en place permet Ctrl+Z', async () => {
    const st = await import('../src/store');
    st.loadProject({ ...newProject(), name: 'Maintenant' });
    st.setHistory([{ ...newProject(), name: 'Hier' }]);
    st.undo();
    expect(st.getState().project.name).toBe('Hier');
  });
});
