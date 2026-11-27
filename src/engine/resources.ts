import type { Lane } from './queue';

/**
 * RESOURCE GOVERNOR — how much background work this computer can take now.
 *
 * Built from what the browser tells (processor cores, memory class, graphics
 * card through `hardware.ts`) and from live signals: memory used by the page,
 * how late the interface answers (event-loop lag), whether the user is
 * working in the window, whether the laptop runs on a low battery. The task
 * queue asks it how many tasks of each lane may run, and long loops (render)
 * call `yieldToUI()` between steps so the interface keeps answering.
 */

export interface Profile { cores: number; memoryGb: number | null; webgpu: boolean; tier: 'low' | 'mid' | 'high' }
export interface Signals {
  /** share of the JavaScript memory limit in use (Chrome), null when unknown */
  heap: number | null;
  /** recent interface delay, 90th percentile, ms */
  lagMs: number;
  /** ms since the last key press, click or scroll in the window */
  idleMs: number;
  hidden: boolean;
  battery: { charging: boolean; level: number } | null;
}
export type Mode = 'normal' | 'interface' | 'economie' | 'memoire';
export interface Budget { slots: Record<Lane, number>; mode: Mode; /** pause added between render steps while the user works, ms */ yieldMs: number; reason: string }

/** pure: the budget for a profile and the live signals (tested) */
export function computeBudget(pf: Profile, s: Signals): Budget {
  const base = Math.max(1, Math.min(3, Math.floor(pf.cores / 4)));
  const slots: Record<Lane, number> = { light: base, heavy: 1, network: 3, render: 1 };
  let mode: Mode = 'normal';
  const why: string[] = [`${pf.cores} cœurs`];
  // memory first: a laptop with little RAM or a page close to its limit runs one thing at a time
  if ((pf.memoryGb ?? 8) <= 4 || (s.heap ?? 0) > 0.7) {
    mode = 'memoire'; slots.light = 1; slots.network = 2;
    why.push((s.heap ?? 0) > 0.7 ? `mémoire de la page à ${Math.round((s.heap ?? 0) * 100)} %` : 'peu de mémoire');
    // nearly full: no new heavy model until memory comes back
    if ((s.heap ?? 0) > 0.88) { slots.heavy = 0; slots.render = 0; why.push('nouveaux traitements lourds suspendus'); }
  }
  if (s.battery && !s.battery.charging && s.battery.level < 0.2) {
    if (mode === 'normal') mode = 'economie';
    slots.light = 1; why.push(`batterie ${Math.round(s.battery.level * 100)} %`);
  }
  // the user is working in the window: background work gives way
  const working = !s.hidden && s.idleMs < 2000;
  if (working) {
    if (mode === 'normal') mode = 'interface';
    slots.light = Math.min(slots.light, 1); why.push('tu travailles dans Forge');
  }
  if (!s.hidden && s.lagMs > 120) { slots.light = Math.min(slots.light, 1); why.push(`interface en retard (${Math.round(s.lagMs)} ms)`); }
  const yieldMs = s.hidden ? 0 : working ? Math.min(60, 16 + s.lagMs / 3) : s.lagMs > 120 ? 16 : 0;
  return { slots, mode, yieldMs, reason: why.join(' · ') };
}

/* ---------------------------------------------------------------- live signals (browser) */

let lastInput = 0;
let lags: number[] = [];
let battery: Signals['battery'] = null;
let profile: Profile = { cores: 4, memoryGb: null, webgpu: false, tier: 'mid' };
let started = false;

export function startGovernor(pf?: Profile) {
  if (pf) profile = pf;
  if (started || typeof window === 'undefined') return;
  started = true;
  const mark = () => { lastInput = performance.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, mark, { passive: true, capture: true });
  // event-loop lag: a 100 ms timer that fires late means the interface is busy
  let last = performance.now();
  setInterval(() => { const now = performance.now(); lags.push(Math.max(0, now - last - 100)); last = now; if (lags.length > 40) lags = lags.slice(-40); }, 100);
  void (navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number; addEventListener(t: string, f: () => void): void }> }).getBattery?.().then((b) => {
    const read = () => { battery = { charging: b.charging, level: b.level }; };
    read(); b.addEventListener('levelchange', read); b.addEventListener('chargingchange', read);
  }).catch(() => {});
}
export const setProfile = (pf: Profile) => { profile = pf; };

export function signals(): Signals {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const sorted = [...lags].sort((a, b) => a - b);
  return {
    heap: mem ? mem.usedJSHeapSize / mem.jsHeapSizeLimit : null,
    lagMs: sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0,
    idleMs: lastInput ? performance.now() - lastInput : Infinity,
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    battery,
  };
}
export const budget = () => computeBudget(profile, signals());

/**
 * Give the interface a turn: the browser handles clicks and paints before the
 * loop continues. While the user works in the window, wait a little longer.
 */
let lastMacro = 0;
export async function yieldToUI() {
  const wait = budget().yieldMs;
  const now = performance.now();
  // a real turn for the page's timers at least every 100 ms (scheduler.yield alone lets input through
  // but makes timers wait: progress, notifications, autosave)
  if (wait > 0 || now - lastMacro > 100) {
    await new Promise((r) => setTimeout(r, wait));
    lastMacro = performance.now();
    return;
  }
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) await s.yield();
  else await new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
}
