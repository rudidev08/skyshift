import { test, assertTrue, assertEqual } from "./test-utils.ts";
import { SAVE_VERSION } from "../sim-save-types.ts";
import { saveSlotKey, autoSaveNextIndexKey, MANUAL_SLOT_COUNT, AUTO_SLOT_COUNT } from "../sim-save-slots.ts";
import {
  clearAllSaves,
  getNextAutoIndex,
  listSlots,
  readSlotSummary,
  findLatestSave,
} from "../storage-save-slots.ts";

// Tests run as plain tsx Node scripts — no jsdom, no real localStorage.
// Save-slots only touches localStorage inside function bodies (not at
// module load), so installing this Map-backed shim after the static import
// resolves but before any test() runs is enough for clearAllSaves() to
// land in our store.
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

test("saveSlotKey is shared across maps (no map segment)", () => {
  // Slot keys intentionally omit the map so saves from different universes
  // compete for the same M1/M2/M3/A1/A2/A3 slot set. Literal equality pins
  // the full shape — drift in any segment fails, including a "skyshift.save.<map>.manual.1"
  // accidental insertion that absence-checks for two known map ids would miss.
  assertEqual(saveSlotKey("manual", 1), "skyshift.save.manual.1", "manual slot key");
});

test("slot counts match the M1/M2/M3 + A1/A2/A3 contract the slot picker UI exposes", () => {
  // Pin the literal count. Bumping MANUAL_SLOT_COUNT or AUTO_SLOT_COUNT to 2
  // (or 4) would silently shrink/grow every loop in this file but stay green
  // because the loops bracket on the constants themselves.
  assertEqual(MANUAL_SLOT_COUNT, 3, "three manual slots");
  assertEqual(AUTO_SLOT_COUNT, 3, "three auto slots");
});

test("SAVE_VERSION is permanently 1 during pre-release development", () => {
  // Pin the literal value. Both captureSnapshot's `version` field and
  // validateSnapshot's expected version come from this constant, so a bump
  // would round-trip cleanly inside one process — only a pin against the
  // literal catches drift away from the documented contract (AGENTS.md:
  // "Save schema is permanently SAVE_VERSION = 1 during development").
  assertEqual(SAVE_VERSION, 1, "save schema version literal");
});

test("autoSaveNextIndexKey has stable format", () => {
  // Single sentinel key (not a pattern) — literal equality is correct since
  // drift (e.g. "nextIndex" → "nextIdx") strands every player's cursor.
  const key = autoSaveNextIndexKey();
  assertEqual(key, "skyshift.save.auto.nextIndex", "auto cursor key");
});

test("getNextAutoIndex defaults to 1 when no cursor stored", () => {
  store.clear();
  assertEqual(getNextAutoIndex(), 1, "missing cursor falls back to 1");
});

test("getNextAutoIndex returns stored cursor when in range", () => {
  store.clear();
  // Each in-range value must round-trip — bracket bounds (1, AUTO_SLOT_COUNT)
  // so an off-by-one comparison flip in getNextAutoIndex would surface here.
  for (let i = 1; i <= AUTO_SLOT_COUNT; i++) {
    store.set(autoSaveNextIndexKey(), String(i));
    assertEqual(getNextAutoIndex(), i, `cursor=${i} preserved`);
  }
});

test("getNextAutoIndex falls back to 1 for out-of-range values", () => {
  // Below-range and above-range cursors both reset to 1 — guards against a
  // stale or hand-edited entry stranding autosave on a phantom slot.
  store.clear();
  store.set(autoSaveNextIndexKey(), "0");
  assertEqual(getNextAutoIndex(), 1, "below-range cursor resets to 1");
  store.set(autoSaveNextIndexKey(), String(AUTO_SLOT_COUNT + 1));
  assertEqual(getNextAutoIndex(), 1, "above-range cursor resets to 1");
});

test("clearAllSaves wipes every slot key + auto-rotation cursor", () => {
  store.clear();
  // Seed every slot the helper should remove — full 1..COUNT range so an
  // off-by-one loop bound in clearAllSaves would leave a stranded entry.
  for (let i = 1; i <= MANUAL_SLOT_COUNT; i++) {
    store.set(saveSlotKey("manual", i), "{}");
  }
  for (let i = 1; i <= AUTO_SLOT_COUNT; i++) {
    store.set(saveSlotKey("auto", i), "{}");
  }
  store.set(autoSaveNextIndexKey(), "2");
  // Plant a non-save key — settings/viewMode live in localStorage too and
  // must survive, proving the helper stays in its namespace.
  store.set("skyshift.viewMode", "zones");

  clearAllSaves();

  for (let i = 1; i <= MANUAL_SLOT_COUNT; i++) {
    assertTrue(!store.has(saveSlotKey("manual", i)), `M${i} should be removed`);
  }
  for (let i = 1; i <= AUTO_SLOT_COUNT; i++) {
    assertTrue(!store.has(saveSlotKey("auto", i)), `A${i} should be removed`);
  }
  assertTrue(!store.has(autoSaveNextIndexKey()), "auto-next-index should be removed");
  assertTrue(
    store.get("skyshift.viewMode") === "zones",
    "non-save keys outside the slot namespace must be preserved",
  );
});

function seedSlot(slotKind: "manual" | "auto", index: number, savedAt: number): void {
  store.set(saveSlotKey(slotKind, index), JSON.stringify({ savedAt, presetId: "settled", source: slotKind }));
}

test("listSlots returns one summary per manual + auto slot", () => {
  // Bracket the loop bounds — every M1..MANUAL_SLOT_COUNT and A1..AUTO_SLOT_COUNT
  // index must appear, so an off-by-one loop bound in listSlots would
  // strand a slot index. Order is not asserted (caller filters by `kind`).
  store.clear();
  const slots = listSlots();
  assertEqual(slots.length, MANUAL_SLOT_COUNT + AUTO_SLOT_COUNT, "summary count");
  for (let i = 1; i <= MANUAL_SLOT_COUNT; i++) {
    assertTrue(
      slots.some((slot) => slot.kind === "manual" && slot.index === i),
      `manual slot ${i} included`,
    );
  }
  for (let i = 1; i <= AUTO_SLOT_COUNT; i++) {
    assertTrue(
      slots.some((slot) => slot.kind === "auto" && slot.index === i),
      `auto slot ${i} included`,
    );
  }
});

test("readSlotSummary returns empty placeholder for an unwritten slot", () => {
  store.clear();
  const summary = readSlotSummary("manual", 1);
  assertEqual(summary.kind, "manual", "kind preserved");
  assertEqual(summary.index, 1, "index preserved");
  assertEqual(summary.savedAt, null, "empty savedAt");
  assertEqual(summary.presetId, null, "empty presetId");
  assertEqual(summary.source, null, "empty source");
});

test("readSlotSummary returns the breadcrumb fields when a slot blob is present", () => {
  // Anchors validateSlotSummary on a real round-trip — so a flipped
  // `typeof savedAt !== "number"` check (silently treating numbers as bad)
  // would surface here as a null savedAt.
  store.clear();
  store.set(
    saveSlotKey("manual", 2),
    JSON.stringify({ savedAt: 12345, presetId: "frontier", source: "manual" }),
  );
  const summary = readSlotSummary("manual", 2);
  assertEqual(summary.savedAt, 12345, "savedAt extracted");
  assertEqual(summary.presetId, "frontier", "presetId extracted");
  assertEqual(summary.source, "manual", "source extracted");
});

test("readSlotSummary falls back to empty when source is not in the allowed set", () => {
  // Anchors the SLOT_SOURCES whitelist — drift (e.g. dropping "export")
  // would surface as a populated source slipping past validation.
  store.clear();
  store.set(saveSlotKey("manual", 1), JSON.stringify({ savedAt: 1, presetId: "settled", source: "haxxor" }));
  const summary = readSlotSummary("manual", 1);
  assertEqual(summary.savedAt, null, "rejected blob falls back to empty");
});

test("readSlotSummary accepts every supported source value", () => {
  // Anchors SLOT_SOURCES on its three allowed values — silently dropping
  // "export" or any other value would reject a legitimate exported snapshot.
  store.clear();
  for (const source of ["auto", "manual", "export"] as const) {
    store.set(saveSlotKey("manual", 1), JSON.stringify({ savedAt: 1, presetId: "settled", source }));
    const summary = readSlotSummary("manual", 1);
    assertEqual(summary.source, source, `${source} source preserved`);
    assertEqual(summary.savedAt, 1, `${source} blob accepted`);
  }
});

test("readSlotSummary falls back to empty for non-string presetId", () => {
  // typeof guard on presetId — a flipped check would let a number leak through
  // and break the slot picker which reads .presetId directly.
  store.clear();
  store.set(saveSlotKey("auto", 1), JSON.stringify({ savedAt: 1, presetId: 42, source: "auto" }));
  const summary = readSlotSummary("auto", 1);
  assertEqual(summary.savedAt, null, "non-string presetId rejected");
});

test("readSlotSummary falls back to empty when JSON.parse throws", () => {
  // Try/catch path — the helper has to swallow malformed JSON instead of
  // letting it bubble to the slot picker. Removing the catch would fail here.
  store.clear();
  store.set(saveSlotKey("manual", 1), "not json {{{");
  const summary = readSlotSummary("manual", 1);
  assertEqual(summary.savedAt, null, "malformed JSON falls back to empty");
});

test("findLatestSave returns null when every slot is empty", () => {
  store.clear();
  assertEqual(findLatestSave(), null, "no saves anywhere → null");
});

test("findLatestSave picks the slot with the highest savedAt timestamp", () => {
  // Comparison flip in `latest.savedAt < slot.savedAt` would pick the
  // oldest. Three timestamps so the largest is unambiguous regardless of
  // iteration order.
  store.clear();
  seedSlot("manual", 1, 1000);
  seedSlot("manual", 2, 3000);
  seedSlot("auto", 1, 2000);
  const latest = findLatestSave();
  if (!latest) throw new Error("expected a latest slot");
  assertEqual(latest.savedAt, 3000, "highest timestamp wins");
  assertEqual(latest.kind, "manual", "M2 wins on timestamp");
  assertEqual(latest.index, 2, "M2 wins on timestamp");
});

test("findLatestSave skips empty slots when picking the latest", () => {
  // The `isSavedSlot` filter step — dropping it would let the reduce see an
  // empty (savedAt=null) slot and either crash on the comparison or pick a
  // slot with no savedAt to display.
  store.clear();
  seedSlot("auto", 2, 5000);
  const latest = findLatestSave();
  if (!latest) throw new Error("expected the populated A2 slot");
  assertEqual(latest.kind, "auto", "auto kind preserved");
  assertEqual(latest.index, 2, "A2 picked even though earlier slots are empty");
});
