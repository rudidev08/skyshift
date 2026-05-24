/** Throws if any two items share an `id`; called from data-module load to catch typos in data files. */
export function assertUniqueIds(items: readonly { id: string }[], kind: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${kind} id: "${item.id}"`);
    }
    seen.add(item.id);
  }
}

/** Example: generateCounterId("WAY", 7, 3) → "WAY-007". */
export function generateCounterId(prefix: string, counter: number, padLength: number): string {
  return `${prefix}-${String(counter).padStart(padLength, "0")}`;
}

/** Generate an id not present in `takenIds` by trying `randomAttempts` random
 *  draws, then falling back. `randomSuffix()` and `fallback()` are
 *  caller-supplied so each id family keeps its own alphabet/width and its own
 *  exhaustion policy (a sequential scan that throws, or a one-shot tail).
 *  Stops at the first free random draw; the random sequence and fallback
 *  order are exactly the caller's. */
export function generateUniqueId(params: {
  prefix: string;
  randomSuffix: () => string;
  randomAttempts: number;
  /** Anything that can answer "is this id taken?" — a `Set` of ids or a `Map` keyed by id. */
  takenIds: { has(id: string): boolean };
  fallback: () => string;
}): string {
  for (let attempt = 0; attempt < params.randomAttempts; attempt++) {
    const id = `${params.prefix}-${params.randomSuffix()}`;
    if (!params.takenIds.has(id)) return id;
  }
  return params.fallback();
}
