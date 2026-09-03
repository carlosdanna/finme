/**
 * The only persistence seam in the project.
 *
 * No file outside an adapter implementation may reference `indexedDB`,
 * `localStorage`, or `window`. The engine talks to this interface, the web app
 * supplies `WebStorageAdapter`, and a future native shell supplies its own
 * without touching the persistence logic in TDD §14.
 *
 * Keys are opaque strings. Values are strings — callers serialize. Keeping the
 * surface this narrow is what makes the adapter portable.
 */
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** All keys currently held, in unspecified order. */
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * In-memory adapter. Used by the balance harness and by tests, where persistence
 * has to work but nothing should touch a real store.
 */
export class MemoryStorageAdapter implements StorageAdapter {
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
