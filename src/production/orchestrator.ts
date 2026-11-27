import { TaskQueue, type TaskRecord } from '../engine/queue';
import { budget, startGovernor, setProfile } from '../engine/resources';
import { loadedFamily } from '../engine/jobs';
import { detectHardware } from '../engine/hardware';
import { idb } from '../lib/db';
import { uid } from '../lib/util';
import { getState } from '../store';

/**
 * The production orchestrator of this session: one task queue for the app,
 * stored in IndexedDB (tasks of every project, so a project opened later
 * finds its unfinished work), fed by the resource governor, and grouping
 * heavy work by the model family already loaded (engine/jobs).
 */
export const queue = new TaskQueue({
  now: () => Date.now(),
  uid: () => uid('job_'),
  load: async () => (await idb.get<TaskRecord[]>('projects', '__tasks')) ?? [],
  save: async (t) => { await idb.put('projects', '__tasks', t); },
  slots: () => budget().slots,
  // a task works on the open project only: its media are loaded and its result lands in the right place
  canRun: (t) => t.projectId === getState().project.id,
  loadedFamily,
  coolDownMs: (e) => {
    const r = (e as { retryAfter?: number })?.retryAfter;
    return r != null ? Math.max(1000, r * 1000) : 30_000;
  },
});

let ready: Promise<void> | null = null;
/** start once: hardware profile, live signals, then resume what a previous session left */
export function startOrchestrator() {
  return (ready ??= (async () => {
    startGovernor();
    void detectHardware().then((h) => setProfile({ cores: h.cores, memoryGb: h.memoryGb, webgpu: h.webgpu, tier: h.tier })).catch(() => {});
    const { registerKinds } = await import('./kinds');
    registerKinds(queue);
    await queue.restore();
    // the governor's view changes with what the user does: re-check slots regularly
    setInterval(() => queue.pump(), 1500);
  })());
}

export const projectId = () => getState().project.id;
export const enqueue = (kind: string, params: Record<string, unknown>, o: { after?: string[]; priority?: number; group?: string; force?: boolean } = {}) =>
  queue.enqueue(kind, params, { projectId: projectId(), ...o });

/* for tests and power users */
(globalThis as unknown as { __forgeQueue?: TaskQueue }).__forgeQueue = queue;
