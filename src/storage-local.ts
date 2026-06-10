// localStorage can throw merely on access (Safari private mode, privacy or
// enterprise blocking), not only on write. These guarded wrappers let reads
// fall back to null and writes quietly do nothing when storage is blocked,
// instead of crashing the caller. The storage-* modules build on them.

/** Read a localStorage key — null when the key is absent or storage is blocked. */
export function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Run localStorage writes, silently skipping them when storage is blocked. */
export function tryWriteLocalStorage(writes: () => void): void {
  try {
    writes();
  } catch {
    // Storage blocked or full: skip the write rather than break the caller.
  }
}
