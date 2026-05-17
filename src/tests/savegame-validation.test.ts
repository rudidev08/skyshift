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

function assertRejectsWith(
  result: ReturnType<typeof validateSnapshot>,
  expected: {
    reason: "corrupt" | "version";
    detailMatches: (value: string) => boolean;
    detailLabel: string;
  },
): void {
  if (result.ok) throw new Error("expected ok: false");
  assertEqual(result.reason, expected.reason, "rejection reason");
  const detail = result.detail ?? "";
  assertTrue(expected.detailMatches(detail), `detail should ${expected.detailLabel}, got: ${detail}`);
}

// Parameterized validateSnapshot rejection cases. Each entry produces a JSON
// string that should be rejected, names the expected reason, and supplies a
// predicate the detail must satisfy (predicate over substring so parse-error
// diagnostics can stay engine-agnostic).
const validateSnapshotRejectionCases: Array<{
  name: string;
  json: () => string;
  reason: "corrupt" | "version";
  detailMatches: (value: string) => boolean;
  detailLabel: string;
}> = [
  {
    name: "corrupt JSON",
    json: () => "not json {{{",
    reason: "corrupt",
    detailMatches: (value) => value.length > 0,
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
    detailMatches: (value) => value.includes(String(SAVE_VERSION + 1)),
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
    detailMatches: (value) => value.includes("emigrationManager"),
    detailLabel: "names missing field emigrationManager",
  },
  {
    name: "non-object root",
    json: () => "null",
    reason: "corrupt",
    detailMatches: (value) => value.includes("(root)"),
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
    detailMatches: (value) => value.includes("emigrationManager.activeEvent."),
    detailLabel: "includes nested path under activeEvent",
  },
];

for (const rejection of validateSnapshotRejectionCases) {
  test(`validateSnapshot rejects ${rejection.name}`, () => {
    assertRejectsWith(validateSnapshot(rejection.json()), rejection);
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
  assertRejectsWith(validateSnapshot(JSON.stringify(snapshot)), {
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("build"),
    detailLabel: "mention build",
  });
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
  assertRejectsWith(validateSnapshot(JSON.stringify(snapshot)), {
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("waresRequired.provisions"),
    detailLabel: "mention waresRequired.provisions",
  });
});

test("validateSnapshot rejects building station whose inventory holds non-build wares", () => {
  // Building inventory is limited to provisions/hulls — any other ware
  // would be silently zeroed by stationFromSnapshot's max ternary.
  const snapshot = JSON.parse(sharedSnapshotJson);
  snapshot.stations[0].state = "building";
  snapshot.stations[0].build = { waresRequired: { provisions: 100, hulls: 50 } };
  snapshot.stations[0].inventory = [{ wareId: "food", current: 0, reservedIncoming: 0, reservedOutgoing: 0 }];
  assertRejectsWith(validateSnapshot(JSON.stringify(snapshot)), {
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("inventory") && detail.includes("wareId"),
    detailLabel: "mention inventory wareId",
  });
});

test("validateSnapshot rejects station with unknown state", () => {
  const snapshot = JSON.parse(sharedSnapshotJson);
  snapshot.stations[0].state = "exploded";
  assertRejectsWith(validateSnapshot(JSON.stringify(snapshot)), {
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("state"),
    detailLabel: "mention state",
  });
});
