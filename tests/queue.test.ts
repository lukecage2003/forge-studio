import { describe, expect, it } from 'vitest';
import { TaskQueue, classifyError, type QueueEnv, type TaskRecord, type TaskCtx } from '../src/engine/queue';
import { computeBudget } from '../src/engine/resources';
import { AiError } from '../src/ai/types';

/** queue on a fake environment: storage in memory, time controllable, generous slots */
function setup(slots = { light: 2, heavy: 1, network: 3, render: 1 }) {
  let n = 0; let saved: TaskRecord[] = [];
  const env: QueueEnv = {
    now: () => Date.now(), uid: () => `t${++n}`,
    load: async () => structuredClone(saved), save: async (t) => { saved = structuredClone(t); },
    slots: () => slots, loadedFamily: () => null, coolDownMs: () => 30,
  };
  return { q: new TaskQueue(env), env, saved: () => saved };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** a controllable job: resolves when told, records the order runs start */
function gate() { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; }

describe('orchestrateur de production : file de tâches', () => {
  it('respecte les dépendances et transmet les résultats', async () => {
    const { q } = setup();
    const order: string[] = [];
    q.register({ kind: 'a', lane: 'light', label: () => 'A', key: (p) => String(p.v), run: async (_c, p) => { order.push('a'); return (p.v as number) * 2; } });
    q.register({ kind: 'b', lane: 'light', label: () => 'B', key: () => 'b', run: async (c: TaskCtx) => { order.push('b'); return c.input<number>('a').reduce((s, x) => s + x, 0); } });
    const a1 = q.enqueue('a', { v: 1 }, { projectId: 'p' }), a2 = q.enqueue('a', { v: 2 }, { projectId: 'p' });
    const b = q.enqueue('b', {}, { projectId: 'p', after: [a1.id, a2.id] });
    expect(b.state).toBe('waiting');
    await q.idle([b.id]);
    expect(order.at(-1)).toBe('b');
    expect(q.get(b.id)?.state).toBe('done');
  });

  it('ne refait pas un travail déjà fait sur la même entrée, sauf demande', async () => {
    const { q } = setup();
    let runs = 0;
    q.register({ kind: 'ocr', lane: 'heavy', label: () => 'OCR', key: (p) => String(p.page), run: async () => { runs++; return 'texte'; } });
    const t1 = q.enqueue('ocr', { page: 'p1' }, { projectId: 'p' });
    const t2 = q.enqueue('ocr', { page: 'p1' }, { projectId: 'p' });
    expect(t2.id).toBe(t1.id);
    await q.idle();
    q.enqueue('ocr', { page: 'p1' }, { projectId: 'p' });
    await q.idle();
    expect(runs).toBe(1);
    q.enqueue('ocr', { page: 'p1' }, { projectId: 'p', force: true });
    await q.idle();
    expect(runs).toBe(2);
  });

  it('limite les tâches simultanées par voie et passe les priorités hautes d’abord', async () => {
    const { q } = setup({ light: 1, heavy: 1, network: 3, render: 1 });
    const started: string[] = []; const g = gate();
    q.register({ kind: 'w', lane: 'light', label: (p) => String(p.n), key: (p) => String(p.n), run: async (_c, p) => { started.push(String(p.n)); if (p.n === 'first') await g.p; } });
    q.enqueue('w', { n: 'first' }, { projectId: 'p' });
    q.enqueue('w', { n: 'low' }, { projectId: 'p', priority: 10 });
    q.enqueue('w', { n: 'high' }, { projectId: 'p', priority: 90 });
    await tick(5);
    expect(started).toEqual(['first']); // one light slot
    g.open();
    await q.idle();
    expect(started).toEqual(['first', 'high', 'low']);
  });

  it('met en pause à un point d’arrêt, reprend, et annule proprement avec ses dépendants', async () => {
    const { q } = setup();
    let steps = 0;
    q.register({ kind: 'long', lane: 'render', label: () => 'Rendu', key: () => 'r', run: async (c) => { for (let i = 0; i < 50; i++) { await c.checkpoint(); steps++; await tick(2); } return 'ok'; } });
    q.register({ kind: 'after', lane: 'light', label: () => 'Après', key: () => 'x', run: async () => 'x' });
    const t = q.enqueue('long', {}, { projectId: 'p' });
    const d = q.enqueue('after', {}, { projectId: 'p', after: [t.id] });
    await tick(20);
    q.pause(t.id);
    await tick(10);
    const frozen = steps;
    await tick(30);
    expect(steps).toBeLessThanOrEqual(frozen + 1);
    q.resume(t.id);
    await tick(15);
    expect(steps).toBeGreaterThan(frozen + 1);
    q.cancel(t.id);
    await tick(10);
    expect(q.get(t.id)?.state).toBe('cancelled');
    expect(q.get(d.id)?.state).toBe('cancelled');
    const at = steps; await tick(20);
    expect(steps).toBe(at); // nothing runs after cancel
  });

  it('erreur réseau : nouvel essai automatique ; quota : attend le délai demandé ; clé refusée : échec net', async () => {
    const { q } = setup();
    let calls = 0;
    q.register({ kind: 'net', lane: 'network', label: () => 'Réseau', key: () => 'n', maxAttempts: 3, run: async () => { calls++; if (calls < 2) throw new TypeError('Failed to fetch'); return 'ok'; } });
    let qc = 0;
    q.register({ kind: 'quota', lane: 'network', label: () => 'Quota', key: () => 'q', run: async () => { qc++; if (qc < 2) throw new AiError('quota', '429 trop de requêtes', { retryAfter: 0.03 }); return 'ok'; } });
    q.register({ kind: 'auth', lane: 'network', label: () => 'Clé', key: () => 'a', run: async () => { throw new AiError('auth', 'clé invalide'); } });
    const n = q.enqueue('net', {}, { projectId: 'p' });
    await tick(5);
    expect(q.get(n.id)?.state).toBe('retrying');
    const qt = q.enqueue('quota', {}, { projectId: 'p' });
    const a = q.enqueue('auth', {}, { projectId: 'p' });
    await tick(50);
    expect(q.get(a.id)?.state).toBe('failed');
    expect(q.get(a.id)?.error?.kind).toBe('auth');
    await q.idle([qt.id]);
    expect(q.get(qt.id)?.state).toBe('done');
    await new Promise((r) => setTimeout(r, 2100));
    expect(q.get(n.id)?.state).toBe('done');
    expect(calls).toBe(2);
  });

  it('relance uniquement l’étape échouée ; la suite repart après elle', async () => {
    const { q } = setup();
    let fail = true; const ran: string[] = [];
    q.register({ kind: 's1', lane: 'light', label: () => '1', key: () => '1', run: async () => { ran.push('s1'); return 1; } });
    q.register({ kind: 's2', lane: 'light', label: () => '2', key: () => '2', maxAttempts: 1, run: async () => { ran.push('s2'); if (fail) throw new Error('cassé'); return 2; } });
    q.register({ kind: 's3', lane: 'light', label: () => '3', key: () => '3', run: async () => { ran.push('s3'); return 3; } });
    const a = q.enqueue('s1', {}, { projectId: 'p' }); const b = q.enqueue('s2', {}, { projectId: 'p', after: [a.id] }); const c = q.enqueue('s3', {}, { projectId: 'p', after: [b.id] });
    await tick(20);
    expect(q.get(b.id)?.state).toBe('failed');
    expect(q.get(c.id)?.state).toBe('waiting');
    fail = false; q.retry(b.id);
    await q.idle([c.id]);
    expect(ran).toEqual(['s1', 's2', 's2', 's3']); // s1 not run again
  });

  it('protège les modifications manuelles : un résultat calculé sur un état changé n’est pas appliqué', async () => {
    const { q } = setup();
    const project = { words: 'original', edits: 0 };
    const g = gate();
    q.register({
      kind: 'tr', lane: 'heavy', label: () => 'Transcription', key: () => 'k', keepResult: true,
      guard: () => `${project.words}`, run: async () => { await g.p; return 'texte IA'; }, commit: (r: string) => { project.words = r; },
    });
    const t = q.enqueue('tr', {}, { projectId: 'p' });
    await tick(2);
    project.words = 'corrigé à la main'; // the user edits while the AI works
    g.open();
    await tick(5);
    expect(q.get(t.id)?.state).toBe('stale');
    expect(project.words).toBe('corrigé à la main');
    expect(q.applyStale(t.id)).toBe(true); // the user decides
    expect(project.words).toBe('texte IA');
  });

  it('après un redémarrage, reprend les tâches interrompues sans refaire celles finies', async () => {
    const a = setup();
    const g = gate(); let runs = 0;
    const kind = { kind: 'page', lane: 'heavy' as const, label: (p: Record<string, unknown>) => String(p.n), key: (p: Record<string, unknown>) => String(p.n), keepResult: true, run: async (_c: TaskCtx, p: Record<string, unknown>) => { runs++; if (p.n === 2) await g.p; return p.n; } };
    a.q.register(kind);
    a.q.enqueue('page', { n: 1 }, { projectId: 'p' });
    const t2 = a.q.enqueue('page', { n: 2 }, { projectId: 'p' });
    await tick(10);
    await a.q.flush();
    expect(a.saved().find((t) => t.id === t2.id)?.state).toBe('running');
    // "crash": a new queue reads the same storage
    const b = new TaskQueue({ ...a.env });
    b.register({ ...kind, run: async (_c: TaskCtx, p: Record<string, unknown>) => { runs++; return p.n; } });
    await b.restore();
    await b.idle();
    expect(b.get(t2.id)?.state).toBe('done');
    expect(b.get(t2.id)?.interrupted).toBe(true); // marked as resumed
    expect(b.get(t2.id)?.attempts).toBe(2);
    expect(runs).toBe(3); // page 1 once, page 2 twice (interrupted, then resumed)
  });

  it('lit les erreurs comme l’orchestrateur IA et le navigateur les rapportent', () => {
    expect(classifyError(new AiError('quota', 'x'))).toBe('quota');
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyError(new DOMException('stop', 'AbortError'))).toBe('cancelled');
    expect(classifyError(new Error('HTTP 429 resource exhausted'))).toBe('quota');
    expect(classifyError(new Error('bug'))).toBe('other');
  });
});

describe('gouverneur de ressources', () => {
  const pc = { cores: 8, memoryGb: 16, webgpu: true, tier: 'high' as const };
  const calm = { heap: 0.2, lagMs: 0, idleMs: 60_000, hidden: false, battery: null };
  it('laisse travailler en parallèle quand le PC est libre', () => {
    const b = computeBudget(pc, calm);
    expect(b.mode).toBe('normal'); expect(b.slots.light).toBe(2); expect(b.slots.heavy).toBe(1); expect(b.yieldMs).toBe(0);
  });
  it('cède la place quand tu travailles dans Forge', () => {
    const b = computeBudget(pc, { ...calm, idleMs: 300 });
    expect(b.mode).toBe('interface'); expect(b.slots.light).toBe(1); expect(b.yieldMs).toBeGreaterThan(0);
  });
  it('mémoire presque pleine : plus de nouveau traitement lourd', () => {
    const b = computeBudget(pc, { ...calm, heap: 0.92 });
    expect(b.mode).toBe('memoire'); expect(b.slots.heavy).toBe(0); expect(b.slots.render).toBe(0);
  });
  it('petit portable (4 Go) ou batterie faible : une tâche à la fois', () => {
    expect(computeBudget({ cores: 4, memoryGb: 4, webgpu: false, tier: 'low' }, calm).slots.light).toBe(1);
    expect(computeBudget(pc, { ...calm, battery: { charging: false, level: 0.1 } }).mode).toBe('economie');
  });
  it('fenêtre en arrière-plan : aucun temps cédé à l’interface', () => {
    expect(computeBudget(pc, { ...calm, idleMs: 100, hidden: true }).yieldMs).toBe(0);
  });
});
