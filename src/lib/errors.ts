/**
 * Error journal: every unexpected error is caught, kept (last 50, in this
 * browser) and shown as a short notice instead of breaking the app.
 */
export interface ErrorEntry { t: string; where: string; message: string; stack?: string }
const KEY = 'forge.errors';

export function journal(): ErrorEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function logError(where: string, e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  const entry = { t: new Date().toISOString(), where, message: err.message, stack: err.stack?.split('\n').slice(0, 6).join('\n') };
  try { localStorage.setItem(KEY, JSON.stringify([entry, ...journal()].slice(0, 50))); } catch { /* storage blocked */ }
  return entry;
}
export function clearJournal() { try { localStorage.removeItem(KEY); } catch { /* */ } }

let installed = false;
export function installGlobalHandlers(notify: (msg: string) => void) {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (ev) => {
    if (!ev.error) return; // resource load errors are handled where they happen
    logError('global', ev.error);
    notify('Un problème a été évité et noté dans le journal (Réglages).');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    if (r?.name === 'AbortError') return;
    // a module file of an older publication: handled by the reload proposal (lib/staleVersion)
    if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(r?.message ?? r))) return;
    logError('async', r);
    notify(`Action interrompue : ${r?.message ?? r}. Ton projet est intact.`);
  });
}
