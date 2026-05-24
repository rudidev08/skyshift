// Round-trip preservation: captureSnapshot → restoreSavedGame → captureSnapshot
// produces an equivalent snapshot for the meaningful fields. Field-level
// asserts run first so a regression names the broken field, then a
// full-payload JSON compare backstops everything else.

import { test, assertEqual, assertTrue, assertNotUndefined } from "./test-utils.ts";
import { captureSnapshot, restoreSavedGame } from "../ui-savegame-manager.ts";
import { getInventorySlot } from "../sim-station.ts";
import { setupFreshTestGame, stripVolatileSnapshotFields } from "./savegame-test-fixtures.ts";

test("savegame roundtrip preserves state for mid-trip ships", () => {
  const sourceGame = setupFreshTestGame();
  // Run long enough that ships are mid-flight with queued actions.
  for (let i = 0; i < 120; i++) {
    sourceGame.simulation.tick(0.5);
  }

  const preSaveSnapshot = captureSnapshot(sourceGame);

  // Capture sim-truth flying-ship ids before constructing restoredGame —
  // setupFreshTestGame destroys the previous simulation, which clears the
  // sourceGame trade manager's flight set.
  const expectedFlyingShipIds = new Set(
    sourceGame.simulation.tradeManager.tradeShips
      .filter((tradeShip) => tradeShip.flight !== null)
      .map((tradeShip) => tradeShip.orbitingShipId),
  );

  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, preSaveSnapshot);

  const postRestoreSnapshot = captureSnapshot(restoredGame);

  // Field-level first — when one of these fails, it names the specific
  // field instead of an opaque blob. Match ship by id so order changes
  // don't masquerade as data loss.
  assertEqual(preSaveSnapshot.stations.length, postRestoreSnapshot.stations.length, "station count preserved");
  assertEqual(preSaveSnapshot.ships.length, postRestoreSnapshot.ships.length, "ship count preserved");
  assertEqual(preSaveSnapshot.version, postRestoreSnapshot.version, "save version preserved");
  // Anchor simulationTick on its absolute value, not just round-trip equality —
  // a captureSnapshot that hardcoded simulationTick to 0 would still produce two
  // matching snapshots, since restoredGame's restoreSavedGame would carry the
  // wrong value through. Tick must reflect the 120 ticks sourceGame ran.
  assertTrue(
    preSaveSnapshot.simulationTick > 0,
    `preSaveSnapshot.simulationTick should reflect ticks run, got ${preSaveSnapshot.simulationTick}`,
  );
  assertEqual(
    restoredGame.simulation.economyTimer.tickCount,
    preSaveSnapshot.simulationTick,
    "restoreSavedGame restored sim tick to captured value",
  );

  // The in-flight set is no longer stored on ShipSnapshot — it's rebuilt on
  // load from each trade ship's `flight` field. Assert the load path
  // reconstructs the same flying set the source sim had before the save:
  // post-load { trade ship with non-null flight } must equal the pre-save
  // set captured above. A load path that dropped or mis-bound flights would
  // round-trip the rest of the payload cleanly but leave restored ships
  // grounded.
  // At 120 ticks of settled-preset sim there should be at least one ship in
  // flight — otherwise the equality below is vacuously true (both empty).
  assertTrue(
    expectedFlyingShipIds.size > 0,
    `expected at least one in-flight ship after 120 ticks, got ${expectedFlyingShipIds.size}`,
  );
  const restoredFlyingShipIds = new Set(
    restoredGame.simulation.tradeManager.tradeShips
      .filter((tradeShip) => tradeShip.flight !== null)
      .map((tradeShip) => tradeShip.orbitingShipId),
  );
  assertEqual(
    restoredFlyingShipIds.size,
    expectedFlyingShipIds.size,
    "post-load flying ship count matches pre-save",
  );
  for (const shipId of expectedFlyingShipIds) {
    assertTrue(
      restoredFlyingShipIds.has(shipId),
      `ship ${shipId} flying pre-save is flying again after load (rebuilt from TradeShip.flight)`,
    );
  }

  // Full-payload compare catches regressions in fields the targeted
  // assertions don't cover (emigrationManager, map, station inventory
  // internals).
  assertEqual(
    JSON.stringify(stripVolatileSnapshotFields(preSaveSnapshot)),
    JSON.stringify(stripVolatileSnapshotFields(postRestoreSnapshot)),
    "full snapshot payload",
  );
});

test("savegame roundtrip: building station's slot.max derives from waresRequired, not the rate helpers", () => {
  // stationFromSnapshot's building branch derives slot.max from
  // build.waresRequired (not the getWare*Storage helpers), so a building
  // station's slot caps must survive a roundtrip even though
  // InventorySlotSnapshot intentionally drops the `max` field.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame);

  // Push the first station into "building" with non-zero current and
  // reservations on provisions+hulls so each field gets its own assertion.
  const targetStationSnapshot = snapshot.stations[0];
  targetStationSnapshot.state = "building";
  targetStationSnapshot.build = { waresRequired: { provisions: 250, hulls: 80 } };
  targetStationSnapshot.inventory = [
    { wareId: "provisions", current: 100, reservedIncoming: 5, reservedOutgoing: 0 },
    { wareId: "hulls", current: 30, reservedIncoming: 0, reservedOutgoing: 2 },
  ];

  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredStation = assertNotUndefined(
    restoredGame.stations.find((station) => station.id === targetStationSnapshot.id),
    `restored station ${targetStationSnapshot.id}`,
  );
  assertEqual(restoredStation.state, "building", "state preserved");

  const provisionsSlot = assertNotUndefined(getInventorySlot(restoredStation, "provisions"), "provisions slot");
  assertEqual(provisionsSlot.max, 250, "provisions max derived from waresRequired");
  assertEqual(provisionsSlot.current, 100, "provisions current preserved");
  assertEqual(provisionsSlot.reservedIncoming, 5, "provisions reservedIncoming preserved");

  const hullsSlot = assertNotUndefined(getInventorySlot(restoredStation, "hulls"), "hulls slot");
  assertEqual(hullsSlot.max, 80, "hulls max derived from waresRequired");
  assertEqual(hullsSlot.current, 30, "hulls current preserved");
  assertEqual(hullsSlot.reservedOutgoing, 2, "hulls reservedOutgoing preserved");
});
