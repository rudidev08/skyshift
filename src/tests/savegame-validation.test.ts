// validateSnapshot acceptance and rejection cases. Every rejection path
// (corrupt JSON, version mismatch, missing fields, malformed building state,
// unknown station state) gets its own test so a regression names the failing
// scenario instead of an opaque "expected ok: false".

import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { captureSnapshot, validateSnapshot } from "../ui-savegame-manager.ts";
import { SAVE_VERSION } from "../sim-save-types.ts";
import { setupFreshTestGame } from "./savegame-test-fixtures.ts";

// Snapshot is built once and shared — per-case `setupFreshTestGame()` would
// rebuild the whole settled universe.
const sharedSnapshotJson = JSON.stringify(captureSnapshot(setupFreshTestGame() as never));

// Parameterized validateSnapshot rejection cases. Each entry produces a JSON
// string that should be rejected, names the expected reason, and supplies a
// predicate the detail must satisfy (predicate over substring so parse-error
// diagnostics can stay engine-agnostic).
function rejectionCases(): Array<{
  name: string;
  json: () => string;
  reason: "corrupt" | "version";
  detail: (value: string) => boolean;
  detailLabel: string;
}> {
  return [
    {
      name: "corrupt JSON",
      json: () => "not json {{{",
      reason: "corrupt",
      detail: (value) => value.length > 0,
      detailLabel: "non-empty parse-error detail",
    },
    {
      name: "wrong version",
      json: () => {
        const snapshot = JSON.parse(sharedSnapshotJson);
        snapshot.version = SAVE_VERSION + 1;
        return JSON.stringify(snapshot);
      },
      reason: "version",
      detail: (value) => value.includes(String(SAVE_VERSION + 1)),
      detailLabel: `mentions found version ${SAVE_VERSION + 1}`,
    },
    {
      name: "missing top-level field",
      json: () => {
        const broken = JSON.parse(sharedSnapshotJson);
        delete broken.emigrationManager;
        return JSON.stringify(broken);
      },
      reason: "corrupt",
      detail: (value) => value.includes("emigrationManager"),
      detailLabel: "names missing field emigrationManager",
    },
    {
      name: "non-object root",
      json: () => "null",
      reason: "corrupt",
      detail: (value) => value.includes("(root)"),
      detailLabel: "mentions (root)",
    },
    {
      name: "deep field path",
      json: () => {
        const broken = JSON.parse(sharedSnapshotJson);
        // activeEvent missing required scalars forces the walker to descend
        // into emigrationManager.activeEvent.* before reporting.
        broken.emigrationManager.activeEvent = {
          id: "EMIG-001",
          nationIds: ["hub"],
          generationalShipId: "WAY-001",
          stationIds: ["hub-1"],
        };
        return JSON.stringify(broken);
      },
      reason: "corrupt",
      detail: (value) => value.includes("emigrationManager.activeEvent."),
      detailLabel: "includes nested path under activeEvent",
    },
  ];
}

for (const rejectionCase of rejectionCases()) {
  test(`validateSnapshot rejects ${rejectionCase.name}`, () => {
    const result = validateSnapshot(rejectionCase.json());
    if (result.ok) throw new Error("expected ok: false");
    assertEqual(result.reason, rejectionCase.reason, "rejection reason");
    const detail = result.detail ?? "";
    assertTrue(rejectionCase.detail(detail), `detail should ${rejectionCase.detailLabel}, got: ${detail}`);
  });
}

test("validateSnapshot includes the expected version when it rejects a wrong version", () => {
  // Independent of the parameterized "found version appears" check — the
  // rejection should also surface what the engine expected so the player UI
  // can explain the mismatch.
  const snapshot = JSON.parse(sharedSnapshotJson);
  snapshot.version = SAVE_VERSION + 1;
  const result = validateSnapshot(JSON.stringify(snapshot));
  if (result.ok) throw new Error("expected ok: false");
  assertTrue(
    (result.detail ?? "").includes(String(SAVE_VERSION)),
    `detail should mention expected version ${SAVE_VERSION}, got: ${result.detail}`,
  );
});

test("validateSnapshot accepts a freshly-captured snapshot", () => {
  // Baseline-valid case — every other validateSnapshot test mutates the
  // captured snapshot to provoke a rejection; this one confirms the
  // unmutated capture passes the validator end-to-end.
  const result = validateSnapshot(sharedSnapshotJson);
  assertTrue(result.ok, `expected ok: true, got ${result.ok === false ? result.reason : "unknown"}`);
});

test("validateSnapshot rejects station in 'building' state without build metadata", () => {
  const snapshot = JSON.parse(sharedSnapshotJson);
  snapshot.stations[0].state = "building";
  delete snapshot.stations[0].build;
  const result = validateSnapshot(JSON.stringify(snapshot));
  if (result.ok) throw new Error("expected ok: false");
  assertEqual(result.reason, "corrupt", "rejection reason");
  assertTrue(
    (result.detail ?? "").includes("build"),
    `detail should mention build, got: ${result.detail}`,
  );
});

test("validateSnapshot rejects building station with non-numeric waresRequired.provisions", () => {
  // stationFromSnapshot reads build.waresRequired.{provisions,hulls}
  // directly to derive slot.max — a non-numeric value crashes apply.
  const snapshot = JSON.parse(sharedSnapshotJson);
  snapshot.stations[0].state = "building";
  snapshot.stations[0].build = { waresRequired: { provisions: "lots", hulls: 10 } };
  snapshot.stations[0].inventory = [
    { wareId: "provisions", current: 0, reservedIncoming: 0, reservedOutgoing: 0 },
    { wareId: "hulls", current: 0, reservedIncoming: 0, reservedOutgoing: 0 },
  ];
  const result = validateSnapshot(JSON.stringify(snapshot));
  if (result.ok) throw new Error("expected ok: false");
  assertEqual(result.reason, "corrupt", "rejection reason");
  assertTrue(
    (result.detail ?? "").includes("waresRequired.provisions"),
    `detail should mention waresRequired.provisions, got: ${result.detail}`,
  );
});

test("validateSnapshot rejects building station whose inventory holds non-build wares", () => {
  // Building inventory is limited to provisions/hulls — any other ware
  // would be silently zeroed by stationFromSnapshot's max ternary.
  const snapshot = JSON.parse(sharedSnapshotJson);
  snapshot.stations[0].state = "building";
  snapshot.stations[0].build = { waresRequired: { provisions: 100, hulls: 50 } };
  snapshot.stations[0].inventory = [
    { wareId: "food", current: 0, reservedIncoming: 0, reservedOutgoing: 0 },
  ];
  const result = validateSnapshot(JSON.stringify(snapshot));
  if (result.ok) throw new Error("expected ok: false");
  assertEqual(result.reason, "corrupt", "rejection reason");
  assertTrue(
    (result.detail ?? "").includes("inventory") && (result.detail ?? "").includes("wareId"),
    `detail should mention inventory wareId, got: ${result.detail}`,
  );
});

test("validateSnapshot rejects station with unknown state", () => {
  const snapshot = JSON.parse(sharedSnapshotJson);
  snapshot.stations[0].state = "exploded";
  const result = validateSnapshot(JSON.stringify(snapshot));
  if (result.ok) throw new Error("expected ok: false");
  assertEqual(result.reason, "corrupt", "rejection reason");
  assertTrue(
    (result.detail ?? "").includes("state"),
    `detail should mention state, got: ${result.detail}`,
  );
});
