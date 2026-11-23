// Minimal IndexedDB wrapper: one store for media blobs, one for project docs.
const DB_NAME = 'forge-studio';
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media');
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const idb = {
  put: (store: 'media' | 'projects', key: string, val: unknown) => tx(store, 'readwrite', (s) => s.put(val, key)),
  get: <T>(store: 'media' | 'projects', key: string) => tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  del: (store: 'media' | 'projects', key: string) => tx(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: 'media' | 'projects') => tx(store, 'readonly', (s) => s.getAllKeys()) as Promise<string[]>,
};
