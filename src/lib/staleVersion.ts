/**
 * STALE VERSION — when Forge is published again while a tab is open, that tab
 * still runs the previous JavaScript. Its windows (AI Center, assistant…) are
 * separate files loaded on demand; if the new publication no longer has the
 * previous files, opening one fails with « Failed to fetch dynamically imported
 * module ». The publication now keeps previous files for 30 days
 * (scripts/keep-old-assets.mjs), so this should be rare; when it happens
 * anyway, the user is offered a controlled reload after the project is saved.
 * Never an automatic reload, so never a loop: after a reload that did not help
 * (the file is missing on the server too), the message says so instead.
 */

/** the errors browsers give when a module file can't be loaded */
export function isChunkLoadError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(m);
}
/** the file named in the error, to tell the user (and to know whether a reload already happened for it) */
export const chunkOf = (e: unknown) => String((e as { message?: string })?.message ?? e ?? '').match(/[\w.-]+\.(?:m?js|css)/)?.[0] ?? '';

export interface StaleState { file: string; afterReload: boolean }
const KEY = 'forge.staleReload';
const WINDOW = 3 * 60 * 1000;

/**
 * pure: did a reload for a missing file already happen a moment ago? (tested)
 * Any file counts, not only the same one: after a reload the page is the new version,
 * whose files have other names; one of them missing means the publication itself is incomplete.
 */
export function decide(file: string, last: { at: number; file: string } | null, now: number): StaleState {
  return { file, afterReload: !!last && now - last.at >= 0 && now - last.at < WINDOW };
}

/* ---------------------------------------------------------------- browser side */
let current: StaleState | null = null;
const subs = new Set<() => void>();
export const staleState = () => current;
export const onStale = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

function lastReload(): { at: number; file: string } | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}

/** a module could not be loaded: show the reload proposal (once per problem) */
export function reportStale(e: unknown) {
  if (current) return;
  current = decide(chunkOf(e), lastReload(), Date.now());
  subs.forEach((f) => f());
}
export function dismissStale() { current = null; subs.forEach((f) => f()); }

/** save the work, remember why we reload, then reload: the new page loads the new version */
export async function reloadNow(file = current?.file ?? '') {
  try { const { saveNow } = await import('./studio'); await saveNow(); } catch { /* the journal is written on every change anyway */ }
  try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), file })); } catch { /* private mode */ }
  location.reload();
}

/** the build this page runs (set at build time) and the one the server has now */
export const BUILD = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_FORGE_BUILD ?? 'dev';
let newer: string | null = null;
let lastCheck = 0;
export const newerBuild = () => newer;
export async function checkForUpdate(force = false): Promise<string | null> {
  if (BUILD === 'dev' || (!force && Date.now() - lastCheck < 2 * 60 * 1000)) return newer;
  lastCheck = Date.now();
  try {
    const r = await fetch(new URL('version.json', document.baseURI).href, { cache: 'no-store' });
    if (!r.ok) return newer;
    const v = (await r.json()) as { build?: string };
    if (v.build && v.build !== BUILD && v.build !== newer) { newer = v.build; subs.forEach((f) => f()); }
  } catch { /* offline: nothing to say */ }
  return newer;
}

let installed = false;
/** listen for module load failures and look for a new version when the user comes back to the tab */
export function installStaleHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Vite's own event when a preloaded dependency of a lazy file fails
  window.addEventListener('vite:preloadError', (ev) => { (ev as Event).preventDefault(); reportStale((ev as unknown as { payload?: unknown }).payload ?? ev); });
  window.addEventListener('unhandledrejection', (ev) => { if (isChunkLoadError(ev.reason)) { ev.preventDefault(); reportStale(ev.reason); } });
  const look = () => { if (document.visibilityState === 'visible') void checkForUpdate(); };
  document.addEventListener('visibilitychange', look);
  window.addEventListener('focus', look);
  setInterval(() => void checkForUpdate(), 15 * 60 * 1000);
  void checkForUpdate(true);
}
