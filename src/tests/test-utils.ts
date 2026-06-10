let passed = 0;
let failed = 0;

/** Test bodies must be synchronous — the summary below fires on setImmediate,
 *  so an async body would count as passed at its first `await` and its
 *  remaining assertions would silently never run. A body that returns a
 *  thenable is therefore counted as failed. */
export function test(name: string, body: () => void) {
  try {
    const result = body() as unknown;
    if (typeof (result as PromiseLike<unknown> | undefined)?.then === "function") {
      // Detach the still-running body's eventual rejection so it can't crash
      // the process on top of the failure reported here.
      (result as PromiseLike<unknown>).then(undefined, () => {});
      throw new Error("test bodies must be synchronous — assertions after an await would never run");
    }
    passed++;
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${name}\n    ${(error as Error).message}`);
  }
}

/** Generic ties `actual` and `expected` to the same type, so a type mismatch fails at compile time instead of slipping through to a runtime `!==` comparison. */
export function assertEqual<T>(actual: T, expected: T, label = "") {
  if (actual !== expected) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function assertTrue(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

/** Narrows `T | undefined` to `T` so callers can chain property access without `!`. */
export function assertNotUndefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label}: expected non-undefined value`);
  return value;
}

/** Narrows `T | null` to `T` so callers can chain property access without `!`. */
export function assertNotNull<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label}: expected non-null value`);
  return value;
}

/** Narrows a discriminated-union value to the variant matching `type`, so callers can read variant-only fields without re-checking. */
export function assertActionType<T extends { type: string }, K extends T["type"]>(
  value: T,
  type: K,
  label: string,
): Extract<T, { type: K }> {
  if (value.type !== type) {
    throw new Error(`${label}: expected type=${type}, got ${value.type}`);
  }
  return value as Extract<T, { type: K }>;
}

/** Replaces Math.random for the duration of `run`, cycling through `sequence` (looping if needed), then restores the original. */
export function withScriptedMathRandom(sequence: number[], run: () => void): void {
  const original = Math.random;
  let cursor = 0;
  Math.random = () => {
    const value = sequence[cursor % sequence.length];
    cursor++;
    return value;
  };
  try {
    run();
  } finally {
    Math.random = original;
  }
}

export function assertThrows(action: () => void, expectedSubstring: string, label: string) {
  try {
    action();
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes(expectedSubstring)) {
      const wrapped = new Error(`${label}: error should include "${expectedSubstring}", got: ${message}`);
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
    return;
  }
  throw new Error(`${label}: expected to throw`);
}

// Print the per-file summary and exit (non-zero on any failure, which run-tests.sh reads).
// Every test body above runs synchronously (test() fails bodies that return a thenable),
// so by the time this fires all tests in the file have finished. Using setImmediate
// instead of a "beforeExit" listener means the process still exits even if an imported
// module left a timer or other open handle that kept the event loop from emptying on
// its own. (A synchronous infinite loop is the one case this can't catch — it blocks
// the event loop so this never fires; the per-file timeout in dev/run-test-file.sh is
// what bounds that instead.)
// The write callback flushes the summary before exiting so it isn't truncated.
setImmediate(() => {
  const file = process.argv[1].split("/").pop();
  const code = failed > 0 ? 1 : 0;
  process.stdout.write(`\n${file}: ${passed} passed, ${failed} failed\n`, () => process.exit(code));
});
