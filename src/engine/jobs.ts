/**
 * Resource manager for the heavy local models (Whisper, depth, cut-out, voice
 * clean-up). One heavy job at a time, in order; when the next job needs a
 * different model family, the previous one is unloaded first so two large
 * models never sit in memory together. The light work (preview, UI) is never queued.
 */
type Family = 'whisper' | 'vision' | 'audio' | 'llm' | 'panels' | 'ocr' | 'clip';
const releases = new Map<Family, () => void>();
let chain: Promise<unknown> = Promise.resolve();
let current: Family | null = null;
let pending = 0;
const listeners = new Set<(n: number, f: Family | null) => void>();

/** a model family tells how to free its memory */
export function onRelease(f: Family, fn: () => void) { releases.set(f, fn); }
export function onJobs(fn: (n: number, f: Family | null) => void) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((l) => l(pending, current));

export function heavy<T>(family: Family, fn: () => Promise<T>): Promise<T> {
  pending++;
  emit();
  const run = chain.then(async () => {
    if (current && current !== family) releases.get(current)?.();
    current = family;
    emit();
    try { return await fn(); } finally { pending--; emit(); }
  });
  chain = run.catch(() => {});
  return run;
}
export const jobsPending = () => pending;
/** model family currently in memory (the task queue groups heavy work by it) */
export const loadedFamily = () => current;
