/** Returns an in-memory Storage implementation paired with the backing Map.
 *  `storage` satisfies the Storage API; `store` lets tests inspect / mutate
 *  entries directly (`.has`, `.set`, `.get`, `.clear`) without going through
 *  the Storage methods. Has no imports, so tests can use this fixture without
 *  transitively loading simulation modules. */
export function createMapBackedStorage(): { storage: Storage; store: Map<string, string> } {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
  return { storage, store };
}
