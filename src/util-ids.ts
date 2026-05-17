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
