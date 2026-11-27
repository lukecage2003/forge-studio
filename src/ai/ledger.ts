/**
 * Quotas, costs, history, cache and concurrency, in one place.
 * Free quotas change: nothing here assumes a number. Forge counts what it
 * sends, obeys the provider's own answers (429 + Retry-After) and the user's
 * monthly budget, and never retries around a limit.
 */
import type { AttemptLog, ErrorClass, ProviderId, TaskKind } from './types';

/* ------------------------------------------------------------- storage */
const load = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } };
const month = () => new Date().toISOString().slice(0, 7);
const day = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------- usage & cost */
interface Usage { day: string; month: string; calls: Record<string, number>; monthCalls: Record<string, number>; tokens: Record<string, number>; cost: number }
let usage = load<Usage>('forge.ai.usage', { day: day(), month: month(), calls: {}, monthCalls: {}, tokens: {}, cost: 0 });
function roll() {
  if (usage.month !== month()) usage = { day: day(), month: month(), calls: {}, monthCalls: {}, tokens: {}, cost: 0 };
  if (usage.day !== day()) usage = { ...usage, day: day(), calls: {} };
}
export function recordUse(p: ProviderId, tokens: number, cost: number) {
  roll();
  usage.calls[p] = (usage.calls[p] ?? 0) + 1;
  usage.monthCalls[p] = (usage.monthCalls[p] ?? 0) + 1;
  usage.tokens[p] = (usage.tokens[p] ?? 0) + tokens;
  usage.cost += cost;
  save('forge.ai.usage', usage);
}
export function usageNow() { roll(); return usage; }
export const monthCost = () => { roll(); return usage.cost; };

/* ------------------------------------------------------------- cooldowns */
/** provider → time until which it must not be called (quota) or is disabled (bad key) */
const cool = new Map<ProviderId, { until: number; why: ErrorClass; message: string }>();
export function coolDown(p: ProviderId, why: ErrorClass, seconds: number, message: string) {
  cool.set(p, { until: Date.now() + seconds * 1000, why, message });
}
export function cooling(p: ProviderId) {
  const c = cool.get(p);
  if (!c) return null;
  if (Date.now() > c.until) { cool.delete(p); return null; }
  return c;
}
export const clearCool = (p: ProviderId) => cool.delete(p);

/* ------------------------------------------------------------- history */
export interface HistoryEntry extends AttemptLog { t: string; task: TaskKind; sent: string[]; tokens?: number; cost?: number }
let history = load<HistoryEntry[]>('forge.ai.history', []);
const hsubs = new Set<() => void>();
export function logAttempt(e: HistoryEntry) {
  history = [e, ...history].slice(0, 300);
  save('forge.ai.history', history);
  hsubs.forEach((f) => f());
}
export const getHistory = () => history;
export const onHistory = (f: () => void) => (hsubs.add(f), () => { hsubs.delete(f); });
export function clearHistory() { history = []; save('forge.ai.history', history); hsubs.forEach((f) => f()); }

/* ------------------------------------------------------------- cache */
interface CacheEntry { k: string; v: string; t: number }
let cache = load<CacheEntry[]>('forge.ai.cache', []);
export async function hashOf(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function cacheGet(k: string, maxAgeH = 24 * 7): string | null {
  const e = cache.find((x) => x.k === k);
  return e && Date.now() - e.t < maxAgeH * 3600e3 ? e.v : null;
}
export function cachePut(k: string, v: string) {
  if (v.length > 200_000) return;
  // up to 200 answers, within 1.5 MB of browser storage (oldest dropped first)
  let next = [{ k, v, t: Date.now() }, ...cache.filter((x) => x.k !== k)].slice(0, 200);
  let size = 0;
  next = next.filter((e) => (size += e.v.length) <= 1_500_000);
  cache = next;
  save('forge.ai.cache', cache);
}
export function clearCache() { cache = []; save('forge.ai.cache', cache); }

/* ------------------------------------------------------------- concurrency */
const running = new Map<ProviderId, number>();
const waiting = new Map<ProviderId, (() => void)[]>();
export const MAX_PARALLEL = 2;
export async function slot<T>(p: ProviderId, fn: () => Promise<T>): Promise<T> {
  while ((running.get(p) ?? 0) >= MAX_PARALLEL) await new Promise<void>((r) => waiting.set(p, [...(waiting.get(p) ?? []), r]));
  running.set(p, (running.get(p) ?? 0) + 1);
  try { return await fn(); } finally {
    running.set(p, (running.get(p) ?? 1) - 1);
    const q = waiting.get(p);
    q?.shift()?.();
  }
}
/** tests */
export function resetLedger() { usage = { day: day(), month: month(), calls: {}, monthCalls: {}, tokens: {}, cost: 0 }; history = []; cache = []; cool.clear(); running.clear(); waiting.clear(); }
