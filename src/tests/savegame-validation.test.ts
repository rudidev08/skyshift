// validateSnapshot acceptance and rejection cases. Every rejection path
// (corrupt JSON, version mismatch, missing fields, malformed building state,
// unknown station state) gets its own test so a regression names the failing
// scenario instead of an opaque "expected ok: false".

import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { captureSnapshot } from "../ui-savegame-manager.ts";
import { validateSnapshot } from "../ui-snapshot-validator.ts";
import { SAVE_VERSION } from "../sim-save-types.ts";
import { setupFreshTestGame } from "./savegame-test-fixtures.ts";

// Baseline snapshot is built once — per-case `setupFreshTestGame()` would
// rebuild the whole settled universe.
const baselineSnapshotJson = JSON.stringify(captureSnapshot(setupFreshTestGame()));

/** Fresh mutable clone of the baseline snapshot — each rejection case mutates
 *  its own copy to provoke one validation failure. */
function parseBaselineSnapshot() {
  return JSON.parse(baselineSnapshotJson);
}

function assertRejectsWith(
  result: ReturnType<typeof validateSnapshot>,
  expected: {
    reason: "corrupt" | "version" | "incompatible";
    detailMatches: (detail: string) => boolean;
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
  reason: "corrupt" | "version" | "incompatible";
  detailMatches: (detail: string) => boolean;
  detailLabel: string;
}> = [
  {
    name: "corrupt JSON",
    json: () => "not json {{{",
    reason: "corrupt",
    detailMatches: (detail) => detail.length > 0,
    detailLabel: "non-empty parse-error detail",
  },
  {
    name: "wrong version",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.version = SAVE_VERSION + 1;
      return JSON.stringify(snapshot);
    },
    reason: "version",
    detailMatches: (detail) => detail.includes(String(SAVE_VERSION + 1)),
    detailLabel: `mentions found version ${SAVE_VERSION + 1}`,
  },
  {
    name: "missing top-level field",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      delete snapshot.emigrationManager;
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("emigrationManager"),
    detailLabel: "names missing field emigrationManager",
  },
  {
    // Pin the presetId shape check on the accept-path field. Dropping
    // `typeof snapshot.presetId !== "string"` would let a missing/non-string
    // presetId load, then surface downstream where the slot label and export
    // filename read snapshot.presetId directly. Only this rejection case feeds
    // a malformed presetId — the accept-path test alone wouldn't catch the drop.
    name: "missing presetId",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      delete snapshot.presetId;
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("presetId"),
    detailLabel: "names missing field presetId",
  },
  {
    // Pin the simulationTick shape check. Load assigns snapshot.simulationTick
    // straight into economyTimer.tickCount — a missing value lands undefined
    // there, NaN-ing the tick arithmetic so every shouldUpdateUI throttle freezes.
    name: "missing simulationTick",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      delete snapshot.simulationTick;
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("simulationTick"),
    detailLabel: "names missing field simulationTick",
  },
  {
    name: "non-object root",
    json: () => "null",
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("(root)"),
    detailLabel: "mentions (root)",
  },
  {
    name: "deep field path",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      // activeEvent missing required scalars forces the walker to descend
      // into emigrationManager.activeEvent.* before reporting.
      snapshot.emigrationManager.activeEvent = {
        id: "EMIG-001",
        nationIds: ["hub"],
        generationalShipId: "WAY-001",
        stationIds: ["hub-1"],
      };
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("emigrationManager.activeEvent."),
    detailLabel: "includes nested path under activeEvent",
  },
  {
    // fromSnapshot assigns nextGenerationalShipArrivalAtSeconds unguarded like
    // its sibling scalars — a missing value lands undefined in a number-or-null
    // field and corrupts the next-arrival clock comparisons.
    name: "missing emigrationManager.nextGenerationalShipArrivalAtSeconds",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      delete snapshot.emigrationManager.nextGenerationalShipArrivalAtSeconds;
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("nextGenerationalShipArrivalAtSeconds"),
    detailLabel: "names missing field nextGenerationalShipArrivalAtSeconds",
  },
  {
    name: "station in 'building' state without build metadata",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].state = "building";
      delete snapshot.stations[0].build;
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("build"),
    detailLabel: "mention build",
  },
  {
    // stationFromSnapshot reads build.waresRequired.{provisions,hulls}
    // directly to derive slot.max — a non-numeric value crashes apply.
    name: "building station with non-numeric waresRequired.provisions",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].state = "building";
      snapshot.stations[0].build = { waresRequired: { provisions: "lots", hulls: 10 } };
      snapshot.stations[0].inventory = [
        { wareId: "provisions", current: 0, reservedIncoming: 0, reservedOutgoing: 0 },
        { wareId: "hulls", current: 0, reservedIncoming: 0, reservedOutgoing: 0 },
      ];
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("waresRequired.provisions"),
    detailLabel: "mention waresRequired.provisions",
  },
  {
    // Building inventory is limited to provisions/hulls — any other ware
    // would be silently zeroed by stationFromSnapshot's max ternary.
    name: "building station whose inventory holds non-build wares",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].state = "building";
      snapshot.stations[0].build = { waresRequired: { provisions: 100, hulls: 50 } };
      snapshot.stations[0].inventory = [{ wareId: "food", current: 0, reservedIncoming: 0, reservedOutgoing: 0 }];
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("inventory") && detail.includes("wareId"),
    detailLabel: "mention inventory wareId",
  },
  {
    name: "station with unknown state",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].state = "exploded";
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("state"),
    detailLabel: "mention state",
  },
  {
    // findIncompatibleReference reads ships[i].shipTypeId directly — a non-object
    // entry (a corrupt array element) must be caught as "corrupt" by the shape
    // walker, not throw a TypeError out of validateSnapshot.
    name: "ship entry that is not an object",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.ships[0] = null;
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("ships[0]"),
    detailLabel: "name the malformed ships[0] entry",
  },
  {
    // The resolver reads each operating-station inventory slot's wareId; a
    // non-object slot must likewise be caught as "corrupt" rather than throw.
    name: "inventory slot that is not an object",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].inventory[0] = null;
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("inventory[0]"),
    detailLabel: "name the malformed inventory[0] slot",
  },
  {
    // Passes shape + version (nationId is a non-empty string) but names a
    // nation absent from data/nations — getNationById would throw mid-load.
    name: "station referencing an unknown nation",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].nationId = "atlantis";
      return JSON.stringify(snapshot);
    },
    reason: "incompatible",
    detailMatches: (detail) => detail.includes("nation") && detail.includes("atlantis"),
    detailLabel: "name the unknown nation atlantis",
  },
  {
    // typeId is a valid string for shape, but no such station type exists —
    // getStationTypeTemplate would throw mid-load.
    name: "station with an unknown station type",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].typeId = "death-star";
      return JSON.stringify(snapshot);
    },
    reason: "incompatible",
    detailMatches: (detail) => detail.includes("station type") && detail.includes("death-star"),
    detailLabel: "name the unknown station type death-star",
  },
  {
    // shipTypeId is a valid string for shape, but no such ship class exists —
    // the ship-type registry would throw mid-load.
    name: "ship with an unknown ship type",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.ships[0].shipTypeId = "x-wing";
      return JSON.stringify(snapshot);
    },
    reason: "incompatible",
    detailMatches: (detail) => detail.includes("ship type") && detail.includes("x-wing"),
    detailLabel: "name the unknown ship type x-wing",
  },
  {
    // Inventory wareId is a valid string for shape, but no such ware exists —
    // getWareTemplate would throw while rebuilding the slot.
    name: "inventory slot referencing an unknown ware",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].inventory[0].wareId = "antimatter";
      return JSON.stringify(snapshot);
    },
    reason: "incompatible",
    detailMatches: (detail) => detail.includes("ware") && detail.includes("antimatter"),
    detailLabel: "name the unknown ware antimatter",
  },
  {
    // stations[0] is an operating (producing) farm — food/water only. "metal"
    // is a real ware, so it clears the unknown-ware check, but a farm neither
    // produces nor consumes it: stationFromOperatingSnapshot would throw because
    // createStation builds no metal slot for a farm.
    name: "operating station holding a ware its type does not produce or consume",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.stations[0].inventory.push({
        wareId: "metal",
        current: 0,
        reservedIncoming: 0,
        reservedOutgoing: 0,
      });
      return JSON.stringify(snapshot);
    },
    reason: "incompatible",
    detailMatches: (detail) => detail.includes("metal") && detail.includes("does not produce or consume"),
    detailLabel: "name the offending ware metal and the produce/consume mismatch",
  },
  {
    // Trade-ship cargo ware ids are resolved against the ware catalog — a ship
    // carrying a ware the build no longer defines must be rejected at load, not
    // crash later when the trade log renders the cargo.
    name: "trade ship cargo referencing an unknown ware",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.tradeShips.push({
        shipId: "GHOST-1",
        homeStationId: snapshot.stations[0].id,
        cargo: [{ wareId: "unobtanium", amount: 5 }],
        actionQueue: [],
        flight: null,
        targetStationId: null,
        tradeDirection: null,
        reservations: [],
        idleSinceTradeTimeSeconds: 0,
      });
      return JSON.stringify(snapshot);
    },
    reason: "incompatible",
    detailMatches: (detail) => detail.includes("unobtanium") && detail.includes("cargo"),
    detailLabel: "name the unknown cargo ware unobtanium",
  },
  {
    // Pin the trade-ship cargo.amount shape check. tradeShipFromSnapshot
    // reconstructs cargo straight from the snapshot and the trade log /
    // cargo math read amount as a number; dropping
    // `typeof cargo.amount !== "number"` would let a non-numeric amount load
    // and corrupt cargo arithmetic. wareId stays valid so the failure lands on
    // amount, not the unknown-ware path.
    name: "trade ship cargo with a non-numeric amount",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.tradeShips.push({
        shipId: "GHOST-3",
        homeStationId: snapshot.stations[0].id,
        cargo: [{ wareId: "food", amount: "lots" }],
        actionQueue: [],
        flight: null,
        targetStationId: null,
        tradeDirection: null,
        reservations: [],
        idleSinceTradeTimeSeconds: 0,
      });
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("cargo") && detail.includes("amount"),
    detailLabel: "name the malformed cargo amount field",
  },
  {
    // Queued cargo-withdrawal/deposit ware ids are resolved too — otherwise the
    // action throws mid-sim when it runs against the missing ware.
    name: "trade ship cargo action referencing an unknown ware",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.tradeShips.push({
        shipId: "GHOST-2",
        homeStationId: snapshot.stations[0].id,
        cargo: [],
        actionQueue: [
          { type: "cargo-withdrawal", stationId: snapshot.stations[0].id, wareId: "unobtanium", amount: 5 },
        ],
        flight: null,
        targetStationId: null,
        tradeDirection: null,
        reservations: [],
        idleSinceTradeTimeSeconds: 0,
      });
      return JSON.stringify(snapshot);
    },
    reason: "incompatible",
    detailMatches: (detail) => detail.includes("unobtanium"),
    detailLabel: "name the unknown cargo-action ware unobtanium",
  },
  {
    // shipActionFromSnapshot's switch has no default — an out-of-set action
    // type would restore as undefined in the queue: load succeeds, the sim
    // throws mid-session, and the next autosave fails. Reject at load instead.
    name: "trade ship action with an unknown type",
    json: () => {
      const snapshot = parseBaselineSnapshot();
      snapshot.tradeShips.push({
        shipId: "GHOST-4",
        homeStationId: snapshot.stations[0].id,
        cargo: [],
        actionQueue: [{ type: "teleport", label: "impossible" }],
        flight: null,
        targetStationId: null,
        tradeDirection: null,
        reservations: [],
        idleSinceTradeTimeSeconds: 0,
      });
      return JSON.stringify(snapshot);
    },
    reason: "corrupt",
    detailMatches: (detail) => detail.includes("actionQueue") && detail.includes("type"),
    detailLabel: "name the malformed actionQueue entry's type field",
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
  const snapshot = parseBaselineSnapshot();
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
  const result = validateSnapshot(baselineSnapshotJson);
  assertTrue(result.ok, `expected ok: true, got ${result.ok === false ? result.reason : "unknown"}`);
});
