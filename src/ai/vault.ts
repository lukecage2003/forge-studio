/**
 * Key vault. API keys are encrypted (AES-GCM) with a device key that cannot be
 * read back (a non-extractable WebCrypto key kept in IndexedDB). They are
 * never written in clear to storage, logs, history or .forge exports, and are
 * only ever shown masked. With Forge Bridge, keys can live in the system's
 * own vault instead (Windows Credential Manager, Secret Service on Linux).
 */
import type { ProviderId } from './types';

const DB = 'forge-vault', STORE = 'v';
const mem = new Map<ProviderId, string>();
let ready: Promise<void> | null = null;

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function get<T>(k: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); });
}
async function put(k: string, v: unknown) {
  const db = await idb();
  return new Promise<void>((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
async function del(k: string) {
  const db = await idb();
  return new Promise<void>((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

async function deviceKey(): Promise<CryptoKey> {
  const k = await get<CryptoKey>('device');
  if (k) return k;
  const nk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await put('device', nk);
  return nk;
}

/** decrypt all keys into memory once (at start) */
export function loadVault(): Promise<void> {
  ready ??= (async () => {
    try {
      const key = await deviceKey();
      const list = (await get<ProviderId[]>('list')) ?? [];
      for (const id of list) {
        const box = await get<{ iv: Uint8Array; data: ArrayBuffer }>('k:' + id);
        if (!box) continue;
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv as BufferSource }, key, box.data);
        mem.set(id, new TextDecoder().decode(plain));
      }
    } catch { /* storage blocked: keys work for this session only */ }
  })();
  return ready;
}

export async function setKey(id: ProviderId, value: string) {
  const v = value.trim();
  if (!v) return removeKey(id);
  mem.set(id, v);
  try {
    const key = await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(v));
    await put('k:' + id, { iv, data });
    const list = new Set((await get<ProviderId[]>('list')) ?? []);
    list.add(id);
    await put('list', [...list]);
  } catch { /* kept in memory for this session */ }
}

export async function removeKey(id: ProviderId) {
  mem.delete(id);
  try {
    await del('k:' + id);
    const list = new Set((await get<ProviderId[]>('list')) ?? []);
    list.delete(id);
    await put('list', [...list]);
  } catch { /* nothing stored */ }
}

/** for the adapters only: never display or log this */
export const keyOf = (id: ProviderId) => mem.get(id) ?? null;
export const hasKey = (id: ProviderId) => mem.has(id);

/** « gsk_…a1b2 » : enough to recognise the key, never enough to use it */
export function masked(id: ProviderId): string {
  const k = mem.get(id);
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/** remove anything that looks like a secret from a text (error messages, logs) */
export function scrub(text: string): string {
  let t = text;
  for (const k of mem.values()) if (k.length >= 8) t = t.split(k).join('••••');
  return t.replace(/(sk|gsk|sk-or|nvapi|AIza)[-_A-Za-z0-9]{12,}/g, '••••');
}
