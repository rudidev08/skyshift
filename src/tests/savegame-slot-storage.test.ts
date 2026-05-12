// Slot storage I/O — saveToManualSlot validation and key derivation,
// loadFromSlot empty-vs-populated branches, saveAutoSlot rotation arithmetic.

import { test, assertEqual, assertTrue, assertNotUndefined, assertThrows } from "./test-utils.ts";
import { saveToManualSlot, saveAutoSlot, loadFromSlot } from "../ui-savegame-manager.ts";
import {
  SAVE_VERSION,
  AUTO_SLOT_COUNT,
  MANUAL_SLOT_COUNT,
  saveSlotKey,
  autoSaveNextIndexKey,
} from "../sim-save-types.ts";
import { setupFreshTestGame, localStorageShim } from "./savegame-test-fixtures.ts";

test("saveToManualSlot rejects out-of-range indices", () => {
  // Bracket the valid range — 0 below and MANUAL_SLOT_COUNT+1 above. An
  // off-by-one comparison flip would let a hostile index sneak through.
  localStorageShim.clear();
  const game = setupFreshTestGame();
  assertThrows(
    () => saveToManualSlot(game as never, 0),
    "Invalid manual slot 0",
    "rejects 0",
  );
  assertThrows(
    () => saveToManualSlot(game as never, -1),
    "Invalid manual slot -1",
    "rejects negative index",
  );
  assertThrows(
    () => saveToManualSlot(game as never, MANUAL_SLOT_COUNT + 1),
    `Invalid manual slot ${MANUAL_SLOT_COUNT + 1}`,
    "rejects above-range index",
  );
});

test("saveToManualSlot accepts the valid boundary indices", () => {
  // Bracket the valid range — 1 (lower bound) and MANUAL_SLOT_COUNT (upper
  // bound) inside. An off-by-one flip would reject a legitimate boundary slot.
  localStorageShim.clear();
  const game = setupFreshTestGame();
  saveToManualSlot(game as never, 1);
  assertNotUndefined(localStorageShim.get(saveSlotKey("manual", 1)), "slot 1 written");
  saveToManualSlot(game as never, MANUAL_SLOT_COUNT);
  assertNotUndefined(
    localStorageShim.get(saveSlotKey("manual", MANUAL_SLOT_COUNT)),
    `slot ${MANUAL_SLOT_COUNT} written`,
  );
});

test("saveToManualSlot writes to the slot key derived from kind + index", () => {
  // Anchors writeSlot on its actual storage path — a swapped key derivation
  // would write somewhere loadFromSlot can't find on the way back.
  localStorageShim.clear();
  const game = setupFreshTestGame();
  saveToManualSlot(game as never, 2);
  const raw = localStorageShim.get(saveSlotKey("manual", 2));
  assertNotUndefined(raw, "slot 2 written under manual.2 key");
  const parsed = JSON.parse(raw!);
  assertEqual(parsed.source, "manual", "snapshot tagged with manual source");
  assertEqual(parsed.version, SAVE_VERSION, "snapshot version stored");
});

test("saveAutoSlot tags the written snapshot with source 'auto'", () => {
  // Slot picker reads `source` to label rows ("Auto save" vs "Manual save").
  // A swapped argument to captureSnapshot would silently mislabel the row.
  localStorageShim.clear();
  const game = setupFreshTestGame();
  localStorageShim.set(autoSaveNextIndexKey(), "1");
  saveAutoSlot(game as never);
  const raw = localStorageShim.get(saveSlotKey("auto", 1));
  assertNotUndefined(raw, "auto slot 1 written");
  const parsed = JSON.parse(raw!);
  assertEqual(parsed.source, "auto", "snapshot tagged with auto source");
});

test("loadFromSlot returns ok: false with reason 'empty' for an unwritten slot", () => {
  // The empty-vs-corrupt distinction drives different load-error UI; an
  // inverted `if (!raw)` would either swallow real saves or invent fake ones.
  localStorageShim.clear();
  const empty = loadFromSlot("manual", 1);
  assertEqual(empty.ok, false, "empty slot returns ok: false");
  if (!empty.ok) assertEqual(empty.reason, "empty", "empty slot reason");
});

test("loadFromSlot returns ok: true for a populated slot", () => {
  // Round-trip check — what saveToManualSlot writes must come back ok.
  localStorageShim.clear();
  const game = setupFreshTestGame();
  saveToManualSlot(game as never, 1);
  const loaded = loadFromSlot("manual", 1);
  assertEqual(loaded.ok, true, "populated slot validates as ok");
});

test("saveToManualSlot maps a QuotaExceededError onto the user-facing quota message", () => {
  // writeSlot translates the browser's QuotaExceededError into a friendlier
  // message — anything else (including swallowing the cause) leaves the user
  // staring at "DOMException: QuotaExceededError" with no recovery hint.
  // Other DOMException names should bubble unchanged.
  localStorageShim.clear();
  const game = setupFreshTestGame();

  const realLocalStorage = globalThis.localStorage;
  let injectedName = "QuotaExceededError";
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => realLocalStorage.getItem(key),
    setItem: () => {
      const error = new DOMException("storage full", injectedName);
      throw error;
    },
    removeItem: (key: string) => realLocalStorage.removeItem(key),
    clear: () => realLocalStorage.clear(),
    key: (i: number) => realLocalStorage.key(i),
    get length() { return realLocalStorage.length; },
  } as Storage;

  try {
    let quotaCaught: unknown = null;
    try { saveToManualSlot(game as never, 1); }
    catch (error) { quotaCaught = error; }
    assertTrue(quotaCaught instanceof Error, "quota error caught");
    assertEqual(
      (quotaCaught as Error).message,
      "Save failed: browser storage is full. Delete old saves or export to file.",
      "quota error mapped to user-facing message",
    );
    assertTrue(
      ((quotaCaught as Error & { cause?: unknown }).cause) instanceof DOMException,
      "underlying DOMException attached as cause",
    );

    // Other DOMException names must NOT be remapped — caller can distinguish
    // a quota failure from a security or invalid-state failure.
    injectedName = "SecurityError";
    let otherCaught: unknown = null;
    try { saveToManualSlot(game as never, 1); }
    catch (error) { otherCaught = error; }
    assertTrue(otherCaught instanceof DOMException, "non-quota DOMException bubbles");
    assertEqual(
      (otherCaught as DOMException).name,
      "SecurityError",
      "non-quota DOMException preserves its name",
    );
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = realLocalStorage;
  }
});

test("saveAutoSlot writes to the slot pointed at by the cursor and advances it", () => {
  // Guards the rotation arithmetic — `(nextIndex % AUTO_SLOT_COUNT) + 1`. A
  // wrong increment or modulus loses one slot to permanent overwrite.
  // Walk every cursor position 1..AUTO_SLOT_COUNT so a swapped formula like
  // `(nextIndex + 1) % AUTO_SLOT_COUNT` (matches at both boundaries but
  // produces 0 in the middle) gets caught.
  localStorageShim.clear();
  const game = setupFreshTestGame();

  for (let cursor = 1; cursor <= AUTO_SLOT_COUNT; cursor++) {
    localStorageShim.set(autoSaveNextIndexKey(), String(cursor));
    saveAutoSlot(game as never);
    assertNotUndefined(
      localStorageShim.get(saveSlotKey("auto", cursor)),
      `cursor=${cursor} writes into slot ${cursor}`,
    );
    const expectedNext = cursor === AUTO_SLOT_COUNT ? 1 : cursor + 1;
    assertEqual(
      localStorageShim.get(autoSaveNextIndexKey()),
      String(expectedNext),
      `cursor=${cursor} advances to ${expectedNext}`,
    );
  }
});

