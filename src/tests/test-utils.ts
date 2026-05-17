let passed = 0;
let failed = 0;

export function test(name: string, body: () => void) {
  try {
    body();
    passed++;
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${name}\n    ${(error as Error).message}`);
  }
}

/** Generic so primitive comparisons report `expected X, got Y` instead of a bare boolean failure. */
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

// Sets process.exitCode on failure so run-tests.sh sees a non-zero exit per test file.
process.on("beforeExit", () => {
  const file = process.argv[1].split("/").pop();
  console.log(`\n${file}: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
});
