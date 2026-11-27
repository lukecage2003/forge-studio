/**
 * FORGE PRODUCTION ORCHESTRATOR — the task queue.
 *
 * One queue for the long work of a production (transcription, panel reading,
 * text reading, subtitles, animation preparation, render, quality control).
 * It does not replace the two engines that already exist, it drives them:
 *  - local models still go through `jobs.heavy()` (one model family in memory
 *    at a time); the queue only orders the work so families are not swapped
 *    back and forth, and runs at most one heavy task at a time;
 *  - AI providers still go through the AI orchestrator (`ai/orchestrator.run`:
 *    routing, Zéro coût, quotas, consent, cache); the queue reads its errors to
 *    decide when to retry.
 *
 * What the queue adds: dependencies, priorities, pause / resume / cancel,
 * retry of one failed step, persistence (a reload resumes what was running),
 * skipping work already done on the same input, and protection of manual
 * edits: a result computed on a state the user has changed since is not
 * applied ("obsolète"), it waits for the user's decision.
 *
 * Pure module: the store, storage and resources come in through `QueueEnv`.
 */

export type TaskState = 'waiting' | 'queued' | 'running' | 'paused' | 'retrying' | 'done' | 'failed' | 'cancelled' | 'stale';
export type Lane = 'light' | 'heavy' | 'network' | 'render';
export type ErrorKind = 'network' | 'quota' | 'auth' | 'cancelled' | 'input' | 'other';

export interface TaskRecord {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  label: string;
  projectId: string;
  priority: number;
  state: TaskState;
  progress: number;
  note?: string;
  deps: string[];
  /** fingerprint of the inputs: same kind + same key = same work */
  key: string;
  lane: Lane;
  /** model family the task loads (jobs.ts), to group heavy work */
  family?: string;
  attempts: number;
  error?: { kind: ErrorKind; message: string };
  retryAt?: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  ms?: number;
  /** fingerprint of the part of the project the result will change, taken at start */
  guard?: string;
  result?: unknown;
  /** a reload stopped it while it ran */
  interrupted?: boolean;
  group?: string;
}

export interface TaskCtx {
  signal: AbortSignal;
  task: Readonly<TaskRecord>;
  progress(p: number, note?: string): void;
  /** await here between steps: holds while paused, throws when cancelled */
  checkpoint(): Promise<void>;
  /** results of the tasks this one depends on, by kind */
  input<T = unknown>(kind: string): T[];
}

export interface TaskKind<P extends Record<string, unknown> = Record<string, unknown>, R = unknown> {
  kind: string;
  lane: Lane;
  family?: string;
  label(p: P): string;
  /** fingerprint of the inputs (media id, settings…) */
  key(p: P): string;
  run(ctx: TaskCtx, p: P): Promise<R>;
  /** fingerprint of what the commit will change; compared again before applying */
  guard?(p: P): string;
  /** apply the result to the project; called only when the guard still matches (or the user forces it) */
  commit?(r: R, p: P): void;
  /** keep the result in storage (small JSON only): resumable dependents, stale decisions after a reload */
  keepResult?: boolean;
  maxAttempts?: number;
  priority?: number;
}

export interface QueueEnv {
  now(): number;
  load(): Promise<TaskRecord[]>;
  save(tasks: TaskRecord[]): Promise<void>;
  /** how many tasks of each lane may run now (resource governor) */
  slots(): Record<Lane, number>;
  /** model family currently in memory (jobs.ts), to avoid swapping */
  loadedFamily(): string | null;
  /** AI provider cool-down, ms left, when a quota was hit */
  coolDownMs?(err: unknown): number | null;
  uid(): string;
  /** whether a task may start now (the app runs only the open project's tasks) */
  canRun?(t: TaskRecord): boolean;
  log?(msg: string): void;
}

const ACTIVE: TaskState[] = ['waiting', 'queued', 'running', 'paused', 'retrying'];
export const isActive = (t: TaskRecord) => ACTIVE.includes(t.state);
const FINISHED: TaskState[] = ['done', 'failed', 'cancelled', 'stale'];

/** read an error the way the AI orchestrator and the browser report them */
export function classifyError(e: unknown): ErrorKind {
  const err = e as { name?: string; kind?: string; message?: string };
  if (err?.name === 'AbortError') return 'cancelled';
  const k = err?.kind;
  if (k === 'quota' || k === 'rate') return 'quota';
  if (k === 'auth') return 'auth';
  if (k === 'network' || k === 'server' || k === 'timeout') return 'network';
  if (k === 'bad-request' || k === 'input') return 'input';
  const m = String(err?.message ?? e);
  if (/failed to fetch|networkerror|network error|load failed|timeout|ECONN|503|502|504/i.test(m)) return 'network';
  if (/429|quota|rate limit|resource.?exhausted/i.test(m)) return 'quota';
  return 'other';
}

export class TaskQueue {
  tasks: TaskRecord[] = [];
  private kinds = new Map<string, TaskKind<never, unknown>>();
  private ctl = new Map<string, AbortController>();
  private resumeWait = new Map<string, () => void>();
  private memResults = new Map<string, unknown>();
  private subs = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  pausedAll = false;
  readonly env: QueueEnv;
  constructor(env: QueueEnv) { this.env = env; }

  register<P extends Record<string, unknown>, R>(k: TaskKind<P, R>) { this.kinds.set(k.kind, k as unknown as TaskKind<never, unknown>); }
  subscribe(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }
  private emit() { this.subs.forEach((f) => f()); }
  get(id: string) { return this.tasks.find((t) => t.id === id); }

  /** load what a previous session left: running tasks were interrupted and run again */
  async restore() {
    const saved = await this.env.load().catch(() => [] as TaskRecord[]);
    for (const t of saved) {
      if (t.state === 'running' || t.state === 'retrying') { t.state = 'queued'; t.interrupted = true; t.progress = 0; t.note = 'Reprise après interruption'; }
      if (t.state === 'stale' && !this.kinds.get(t.kind)?.keepResult) { t.state = 'failed'; t.error = { kind: 'other', message: 'Résultat obsolète perdu au redémarrage : relance l’étape' }; }
    }
    this.tasks = saved.filter((t) => this.kinds.has(t.kind));
    this.persist(); this.emit(); this.pump();
  }

  private persist() {
    const snapshot = this.tasks.map((t) => {
      const keep = this.kinds.get(t.kind)?.keepResult;
      return keep ? t : { ...t, result: undefined };
    });
    this.saving = this.saving.then(() => this.env.save(snapshot)).catch(() => {});
  }
  /** wait until storage has the latest state (tests, before closing) */
  flush() { return this.saving; }

  /**
   * Add a task. Same kind + same key in the same project: the existing task is
   * returned (no duplicate work); a finished task with the same key is reused
   * unless `force`.
   */
  enqueue(kind: string, params: Record<string, unknown>, o: { projectId: string; after?: string[]; priority?: number; group?: string; force?: boolean }): TaskRecord {
    const k = this.kinds.get(kind);
    if (!k) throw new Error(`Tâche inconnue : ${kind}`);
    const key = k.key(params as never);
    const same = this.tasks.find((t) => t.kind === kind && t.key === key && t.projectId === o.projectId && (isActive(t) || (!o.force && t.state === 'done')));
    if (same) {
      if (o.priority != null && isActive(same) && o.priority > same.priority) { same.priority = o.priority; this.persist(); this.emit(); }
      return same;
    }
    const t: TaskRecord = {
      id: this.env.uid(), kind, params, label: k.label(params as never), projectId: o.projectId,
      priority: o.priority ?? k.priority ?? 50, state: (o.after?.length ? 'waiting' : 'queued'), progress: 0,
      deps: o.after ?? [], key, lane: k.lane, family: k.family, attempts: 0, createdAt: this.env.now(), group: o.group,
    };
    this.tasks.push(t);
    this.persist(); this.emit(); this.pump();
    return t;
  }

  /* -------------------------------------------------- user controls */
  pause(id: string) {
    const t = this.get(id);
    if (!t || !isActive(t) || t.state === 'paused') return;
    t.state = 'paused'; t.note = 'En pause';
    this.persist(); this.emit();
  }
  resume(id: string) {
    const t = this.get(id);
    if (!t || t.state !== 'paused') return;
    // a task paused while running continues at its checkpoint; one paused in the queue goes back to it
    if (this.resumeWait.has(id)) { t.state = 'running'; t.note = undefined; this.resumeWait.get(id)!(); this.resumeWait.delete(id); }
    else t.state = this.depsDone(t) ? 'queued' : 'waiting';
    this.persist(); this.emit(); this.pump();
  }
  cancel(id: string) {
    const t = this.get(id);
    if (!t || (!isActive(t) && t.state !== 'stale')) return;
    this.ctl.get(id)?.abort();
    this.resumeWait.get(id)?.();
    this.finish(t, 'cancelled', 'Annulée');
    // what depended on it can't run
    for (const d of this.tasks) if (isActive(d) && d.deps.includes(id)) this.cancel(d.id);
  }
  /** run one failed (or cancelled, or obsolete) step again; its dependents continue after it */
  retry(id: string) {
    const t = this.get(id);
    if (!t || !['failed', 'cancelled', 'stale'].includes(t.state)) return;
    Object.assign(t, { state: this.depsDone(t) ? 'queued' : 'waiting', error: undefined, note: undefined, progress: 0, retryAt: undefined, result: undefined, guard: undefined, endedAt: undefined });
    this.memResults.delete(id);
    for (const d of this.tasks) if (d.state === 'cancelled' && d.deps.includes(id)) this.retry(d.id);
    this.persist(); this.emit(); this.pump();
  }
  setPriority(id: string, priority: number) { const t = this.get(id); if (t) { t.priority = priority; this.persist(); this.emit(); this.pump(); } }
  pauseAll(on: boolean) { this.pausedAll = on; this.emit(); if (!on) this.pump(); }
  /** apply an obsolete result anyway (the user chose it) */
  applyStale(id: string) {
    const t = this.get(id);
    const k = t && this.kinds.get(t.kind);
    if (!t || !k || t.state !== 'stale') return false;
    const r = this.memResults.get(id) ?? t.result;
    k.commit?.(r as never, t.params as never);
    t.note = 'Appliqué à ta demande';
    this.finish(t, 'done');
    return true;
  }
  /** forget finished tasks (keeps the queue short) */
  clearFinished(projectId?: string) {
    this.tasks = this.tasks.filter((t) => isActive(t) || t.state === 'stale' || (projectId && t.projectId !== projectId));
    this.persist(); this.emit();
  }

  /* -------------------------------------------------- scheduling */
  private depsDone(t: TaskRecord) { return t.deps.every((d) => this.get(d)?.state === 'done'); }

  /** start whatever may start now; called after every change and on a timer for delayed retries */
  pump() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const now = this.env.now();
    for (const t of this.tasks) {
      if (t.state === 'waiting' && this.depsDone(t)) t.state = 'queued';
      if (t.state === 'waiting' && t.deps.some((d) => { const s = this.get(d)?.state; return s === 'failed' || s === 'cancelled' || s === 'stale' || !s; })) { t.note = 'En attente d’une étape à relancer'; }
      if (t.state === 'retrying' && (t.retryAt ?? 0) <= now) t.state = 'queued';
    }
    if (!this.pausedAll) {
      const slots = this.env.slots();
      const running = (lane: Lane) => this.tasks.filter((t) => (t.state === 'running' || (t.state === 'paused' && this.ctl.has(t.id))) && t.lane === lane).length;
      const loaded = this.env.loadedFamily();
      const ready = this.tasks.filter((t) => t.state === 'queued' && (this.env.canRun?.(t) ?? true))
        .sort((a, b) => b.priority - a.priority
          // heavy work: keep using the model already in memory before switching family
          || Number(b.lane === 'heavy' && b.family === loaded) - Number(a.lane === 'heavy' && a.family === loaded)
          || a.createdAt - b.createdAt);
      for (const t of ready) {
        if (running(t.lane) >= (slots[t.lane] ?? 1)) continue;
        void this.start(t);
      }
    }
    const next = this.tasks.filter((t) => t.state === 'retrying').map((t) => t.retryAt ?? now).sort((a, b) => a - b)[0];
    if (next != null) this.timer = setTimeout(() => this.pump(), Math.max(50, next - now));
    this.emit();
  }

  private async start(t: TaskRecord) {
    const k = this.kinds.get(t.kind)!;
    const ac = new AbortController();
    this.ctl.set(t.id, ac);
    t.state = 'running'; t.startedAt = this.env.now(); t.attempts++; t.note = t.interrupted ? 'Reprise après interruption' : undefined; t.error = undefined;
    t.guard = k.guard?.(t.params as never);
    this.persist(); this.emit();
    const ctx: TaskCtx = {
      signal: ac.signal,
      task: t,
      progress: (p, note) => { t.progress = Math.max(0, Math.min(1, p)); if (note) t.note = note; this.emit(); },
      checkpoint: async () => {
        if (ac.signal.aborted) throw new DOMException('Tâche annulée', 'AbortError');
        if (t.state === 'paused') await new Promise<void>((res) => this.resumeWait.set(t.id, res));
        if (ac.signal.aborted) throw new DOMException('Tâche annulée', 'AbortError');
      },
      input: <T,>(kind: string) => t.deps.map((d) => this.get(d)).filter((d): d is TaskRecord => !!d && d.kind === kind).map((d) => (this.memResults.get(d.id) ?? d.result) as T),
    };
    try {
      const r = await k.run(ctx, t.params as never);
      if (ac.signal.aborted || (t.state as TaskState) === 'cancelled') return;
      t.ms = this.env.now() - (t.startedAt ?? this.env.now());
      this.memResults.set(t.id, r);
      if (k.keepResult) t.result = r;
      // the project changed under the task: keep the result, let the user decide
      if (k.commit && k.guard && k.guard(t.params as never) !== t.guard) {
        t.state = 'stale'; t.endedAt = this.env.now(); t.note = 'Le projet a changé pendant le calcul : résultat non appliqué';
        this.ctl.delete(t.id); this.persist(); this.emit(); this.pump();
        return;
      }
      k.commit?.(r as never, t.params as never);
      this.finish(t, 'done');
    } catch (e) {
      if ((t.state as TaskState) === 'cancelled') return;
      const kind = classifyError(e);
      if (kind === 'cancelled') { this.finish(t, 'cancelled', 'Annulée'); return; }
      const message = String((e as Error)?.message ?? e).slice(0, 300);
      const max = k.maxAttempts ?? 3;
      // quotas: wait what the provider asked; network: back off and try again; the rest fails at once
      if ((kind === 'quota' || kind === 'network') && t.attempts < max) {
        const wait = kind === 'quota' ? (this.env.coolDownMs?.(e) ?? 30_000) : 2000 * 2 ** (t.attempts - 1);
        t.state = 'retrying'; t.retryAt = this.env.now() + wait; t.error = { kind, message };
        t.note = kind === 'quota' ? `Quota atteint : nouvel essai dans ${Math.ceil(wait / 1000)} s` : `Réseau indisponible : nouvel essai dans ${Math.ceil(wait / 1000)} s`;
        this.ctl.delete(t.id); this.persist(); this.emit(); this.pump();
        return;
      }
      t.error = { kind, message };
      this.finish(t, 'failed', kind === 'auth' ? 'Clé refusée' : kind === 'network' ? 'Réseau indisponible' : kind === 'quota' ? 'Quota épuisé' : 'Échec');
    }
  }

  private finish(t: TaskRecord, state: TaskState, note?: string) {
    t.state = state; t.endedAt = this.env.now();
    if (state === 'done') t.progress = 1;
    if (note) t.note = note;
    this.ctl.delete(t.id);
    this.persist(); this.emit(); this.pump();
  }

  /* -------------------------------------------------- reading */
  active(projectId?: string) { return this.tasks.filter((t) => isActive(t) && (!projectId || t.projectId === projectId)); }
  finished() { return this.tasks.filter((t) => FINISHED.includes(t.state)); }
  /** settles when the given tasks (or every active task) are finished */
  idle(ids?: string[]): Promise<void> {
    const pending = () => (ids ? ids.map((i) => this.get(i)).filter((t) => t && (isActive(t) && t.state !== 'paused')) : this.tasks.filter((t) => isActive(t) && t.state !== 'paused')).length;
    if (!pending()) return Promise.resolve();
    return new Promise((res) => { const off = this.subscribe(() => { if (!pending()) { off(); res(); } }); });
  }
}
