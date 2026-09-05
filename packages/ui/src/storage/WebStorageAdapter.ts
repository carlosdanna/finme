/**
 * The web `StorageAdapter` — IndexedDB with a localStorage fallback.
 *
 * **This is the only file in the project permitted to reference `indexedDB`,
 * `localStorage` or `window`.** A test asserts that no other file does. That is
 * what makes a future `CapacitorStorageAdapter` a drop-in replacement with no
 * change to the persistence logic in TDD §14.
 */
import type { StorageAdapter } from '@finme/engine';

const DB_NAME = 'finme';
const STORE_NAME = 'runs';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('indexedDB request failed'));
  });
}

/** IndexedDB, when it is available and working. */
class IndexedDbAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    const db = await openDatabase();
    const value = await request<string | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key),
    );
    return value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const db = await openDatabase();
    await request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key));
  }

  async remove(key: string): Promise<void> {
    const db = await openDatabase();
    await request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key));
  }

  async keys(): Promise<string[]> {
    const db = await openDatabase();
    const found = await request<IDBValidKey[]>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys(),
    );
    return found.map(String);
  }

  async clear(): Promise<void> {
    const db = await openDatabase();
    await request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear());
  }
}

/**
 * localStorage, for private windows and browsers where IndexedDB is blocked.
 *
 * Every access is wrapped: some contexts throw on the accessor itself rather
 * than merely returning nothing, and losing a save is better than crashing the
 * game on a read.
 */
class LocalStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or storage blocked. The run continues in memory.
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to do.
    }
  }

  async keys(): Promise<string[]> {
    try {
      return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
        (key): key is string => key !== null,
      );
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.clear();
    } catch {
      // Nothing to do.
    }
  }
}

/** In-memory, when neither store is reachable. The run still plays. */
class MemoryFallback implements StorageAdapter {
  readonly #store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.#store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.#store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.#store.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.#store.keys()];
  }
  async clear(): Promise<void> {
    this.#store.clear();
  }
}

/**
 * Pick the best available store.
 *
 * Probes IndexedDB with a real round-trip rather than a feature check: Safari in
 * a private window exposes the global and then fails on use.
 */
export async function createWebStorageAdapter(): Promise<StorageAdapter> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const adapter = new IndexedDbAdapter();
      await adapter.set('finme:probe', '1');
      await adapter.remove('finme:probe');
      return adapter;
    } catch {
      // Fall through to localStorage.
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('finme:probe', '1');
      localStorage.removeItem('finme:probe');
      return new LocalStorageAdapter();
    } catch {
      // Fall through to memory.
    }
  }

  return new MemoryFallback();
}

export { IndexedDbAdapter, LocalStorageAdapter, MemoryFallback };
