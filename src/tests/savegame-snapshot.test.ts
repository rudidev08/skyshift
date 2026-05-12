// Round-trip preservation: captureSnapshot → applySnapshot → captureSnapshot
// produces an equivalent snapshot for the meaningful fields. Field-level
// asserts run first so a regression names the broken field, then a
// full-payload JSON compare backstops everything else.

import { test, assertEqual, assertTrue, assertNotUndefined } from "./test-utils.ts";
import { captureSnapshot, applySnapshot } from "../ui-savegame-manager.ts";
import { getInventorySlot } from "../sim-station.ts";
import {
  setupFreshTestGame,
  stripVolatileFields,
} from "./savegame-test-fixtures.ts";

test("savegame roundtrip preserves state for mid-trip ships", () => {
  const sourceGame = setupFreshTestGame();
  // Run long enough that ships are mid-flight with queued actions.
  for (let i = 0; i < 120; i++) {
    sourceGame.simulation.tick(0.5);
  }

  const snapshot1 = captureSnapshot(sourceGame as never);

  // Capture sim-truth flying-ship ids before constructing restoredGame —
  // setupFreshTestGame disposes the previous simulation, which clears the
  // sourceGame trade manager's flight set.
  const expectedFlyingShipIds = new Set(
    sourceGame.simulation.tradeManager.tradeShips
      .filter((tradeShip) => tradeShip.flight !== null)
      .map((tradeShip) => tradeShip.orbitingShipId),
  );

  const restoredGame = setupFreshTestGame();
  applySnapshot(restoredGame as never, snapshot1);

  const snapshot2 = captureSnapshot(restoredGame as never);

  // Field-level first — when one of these fails, it names the specific
  // field instead of an opaque blob. Match ship by id so order changes
  // don't masquerade as data loss.
  assertEqual(snapshot1.stations.length, snapshot2.stations.length, "station count preserved");
  assertEqual(snapshot1.ships.length, snapshot2.ships.length, "ship count preserved");
  assertEqual(snapshot1.version, snapshot2.version, "save version preserved");
  // Anchor simTick on its absolute value, not just round-trip equality —
  // a captureSnapshot that hardcoded simTick to 0 would still produce two
  // matching snapshots, since restoredGame's applySnapshot would carry the
  // wrong value through. Tick must reflect the 120 ticks sourceGame ran.
  assertTrue(snapshot1.simTick > 0, `snapshot1.simTick should reflect ticks run, got ${snapshot1.simTick}`);
  assertEqual(restoredGame.economyTimer.tick, snapshot1.simTick, "applySnapshot restored sim tick to captured value");

  // Anchor inFlight derivation on the trade manager's actual flying set —
  // a flipped predicate (`flight === null`) or negated `.has(...)` would
  // round-trip cleanly but produce a snapshot whose inFlight flags are
  // inverted compared to sim truth. Sim truth: a ship is in flight iff its
  // trade-ship counterpart has a non-null flight.
  // At 120 ticks of settled-preset sim there should be at least one ship in
  // flight — otherwise the per-ship assertion below is vacuously true.
  assertTrue(
    expectedFlyingShipIds.size > 0,
    `expected at least one in-flight ship after 120 ticks, got ${expectedFlyingShipIds.size}`,
  );
  for (const shipSnapshot of snapshot1.ships) {
    const expectedInFlight = expectedFlyingShipIds.has(shipSnapshot.id);
    assertEqual(
      shipSnapshot.inFlight,
      expectedInFlight,
      `ship ${shipSnapshot.id} inFlight matches trade-manager flight set`,
    );
  }

  // Full-payload compare catches regressions in fields the targeted
  // assertions don't cover (emigrationManager, map, station inventory
  // internals).
  assertEqual(
    JSON.stringify(stripVolatileFields(snapshot1)),
    JSON.stringify(stripVolatileFields(snapshot2)),
    "full snapshot payload",
  );
});

test("savegame roundtrip: building station's slot.max derives from waresRequired, not the rate helpers", () => {
  // stationFromSnapshot's building branch derives slot.max from
  // build.waresRequired (not the getWare*Storage helpers), so a building
  // station's slot caps must survive a roundtrip even though
  // InventorySlotSnapshot intentionally drops the `max` field.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame as never);

  // Push the first station into "building" with non-zero current and
  // reservations on provisions+hulls so each field gets its own assertion.
  const target = snapshot.stations[0];
  target.state = "building";
  target.build = { waresRequired: { provisions: 250, hulls: 80 } };
  target.inventory = [
    { wareId: "provisions", current: 100, reservedIncoming: 5, reservedOutgoing: 0 },
    { wareId: "hulls", current: 30, reservedIncoming: 0, reservedOutgoing: 2 },
  ];

  const restoredGame = setupFreshTestGame();
  applySnapshot(restoredGame as never, snapshot);

  const restored = assertNotUndefined(
    restoredGame.stations.find((station) => station.id === target.id),
    `restored station ${target.id}`,
  );
  assertEqual(restored.state, "building", "state preserved");

  const provisionsSlot = assertNotUndefined(getInventorySlot(restored, "provisions"), "provisions slot");
  assertEqual(provisionsSlot.max, 250, "provisions max derived from waresRequired");
  assertEqual(provisionsSlot.current, 100, "provisions current preserved");
  assertEqual(provisionsSlot.reservedIncoming, 5, "provisions reservedIncoming preserved");

  const hullsSlot = assertNotUndefined(getInventorySlot(restored, "hulls"), "hulls slot");
  assertEqual(hullsSlot.max, 80, "hulls max derived from waresRequired");
  assertEqual(hullsSlot.current, 30, "hulls current preserved");
  assertEqual(hullsSlot.reservedOutgoing, 2, "hulls reservedOutgoing preserved");
});
