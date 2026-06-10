import { test, assertEqual, assertTrue, assertNotNull, assertNotUndefined } from "./test-utils.ts";
import { tradeShipToSnapshot, tradeShipFromSnapshot, type SnapshotContext } from "../sim-trade-save-snapshot.ts";
import { createStation, getInventorySlot, type Station } from "../sim-station.ts";
import { createSurfaceEndpoint, createOrbitEndpoint } from "../sim-travel.ts";
import type { Ship } from "../sim-ships.ts";
import type { ShipAction } from "../sim-travel-types.ts";
import { makeEmptyTradeShip } from "./trade-test-fixtures.ts";
import { hubNation } from "../../data/nations.ts";

// Isolated tradeShipToSnapshot → tradeShipFromSnapshot round-trip focused on
// reference rebinding (sim-trade-save-snapshot.ts:57). Snapshots store ids; the
// runtime carries live object refs. This test builds a TradeShip with a
// reservation and a fly action (each holding station refs), captures it, then
// restores it against id→object maps and asserts every rebound reference
// resolves to the live object — not just that the round-trip "ran".

function habitatStation(stationId: string): Station {
  return createStation(
    { id: stationId, name: stationId, x: 0, y: 0, nation: hubNation, stationTypeId: "habitat", size: "M" },
    0.5,
  );
}

/** Minimal Ship entry — tradeShipFromSnapshot only checks the ships map for
 *  membership, so the object is never dereferenced. */
function shipStub(shipId: string): Ship {
  return { id: shipId } as never;
}

test("tradeShipToSnapshot → tradeShipFromSnapshot: scalar and id fields round-trip", () => {
  const home = habitatStation("HOME");
  const target = habitatStation("TARGET");

  const original = makeEmptyTradeShip();
  original.orbitingShipId = "SHIP-1";
  original.homeStationId = home.id;
  original.targetStationId = target.id;
  original.tradeDirection = "sell";
  original.cargoAmountByWareId = new Map([["food", 40]]);
  original.idleSinceTradeTimeSeconds = 7;

  const context: SnapshotContext = {
    stations: new Map([[home.id, home], [target.id, target]]),
    ships: new Map([["SHIP-1", shipStub("SHIP-1")]]),
  };

  const restored = tradeShipFromSnapshot(tradeShipToSnapshot(original), context);

  assertEqual(restored.orbitingShipId, "SHIP-1", "orbiting ship id round-trips");
  assertTrue(context.ships.has(restored.orbitingShipId), "orbiting ship id resolves in ships map");
  assertEqual(restored.homeStationId, home.id, "home station id round-trips");
  assertTrue(context.stations.has(restored.homeStationId), "home station id resolves in stations map");
  assertEqual(restored.targetStationId, target.id, "target station id round-trips");
  assertTrue(
    context.stations.has(assertNotNull(restored.targetStationId, "target id present")),
    "target station id resolves in stations map",
  );
  assertEqual(restored.tradeDirection, "sell", "trade direction round-trips");
  assertEqual(restored.cargoAmountByWareId.get("food"), 40, "cargo amount round-trips");
  assertEqual(restored.idleSinceTradeTimeSeconds, 7, "idle-since round-trips");
});

test("tradeShipToSnapshot → tradeShipFromSnapshot: reservation rebinds to the live station object", () => {
  const home = habitatStation("HOME");
  const remote = habitatStation("REMOTE");
  // habitat stations carry a `food` inventory slot, so the slot-existence guard
  // in reservationsFromSnapshot keeps this reservation.
  assertNotUndefined(getInventorySlot(remote, "food"), "fixture remote station has a food slot");

  const original = makeEmptyTradeShip();
  original.orbitingShipId = "SHIP-2";
  original.homeStationId = home.id;
  original.reservations = [
    { station: remote, wareId: "food", amount: 120, cargoDirection: "outgoing" },
  ];

  const context: SnapshotContext = {
    stations: new Map([[home.id, home], [remote.id, remote]]),
    ships: new Map([["SHIP-2", shipStub("SHIP-2")]]),
  };

  const restored = tradeShipFromSnapshot(tradeShipToSnapshot(original), context);

  assertEqual(restored.reservations.length, 1, "reservation survives round-trip");
  const reservation = restored.reservations[0];
  assertTrue(
    reservation.station === remote,
    "reservation.station rebinds to the same live Station instance from the map",
  );
  assertEqual(reservation.wareId, "food", "reservation wareId round-trips");
  assertEqual(reservation.amount, 120, "reservation amount round-trips");
  assertEqual(reservation.cargoDirection, "outgoing", "reservation cargoDirection round-trips");
});

test("tradeShipToSnapshot → tradeShipFromSnapshot: fly action endpoints rebind to live stations", () => {
  const home = habitatStation("HOME");
  const target = habitatStation("TARGET");

  const flyAction: Extract<ShipAction, { type: "fly" }> = {
    type: "fly",
    origin: createSurfaceEndpoint(home),
    originStation: home,
    destination: createOrbitEndpoint(target),
    destinationStation: target,
    travelMode: "interStation",
    label: "sell leg",
  };

  const original = makeEmptyTradeShip();
  original.orbitingShipId = "SHIP-3";
  original.homeStationId = home.id;
  original.actionQueue = [flyAction];

  const context: SnapshotContext = {
    stations: new Map([[home.id, home], [target.id, target]]),
    ships: new Map([["SHIP-3", shipStub("SHIP-3")]]),
  };

  const restored = tradeShipFromSnapshot(tradeShipToSnapshot(original), context);

  assertEqual(restored.actionQueue.length, 1, "fly action survives round-trip");
  const restoredFly = restored.actionQueue[0];
  assertTrue(restoredFly.type === "fly", "queued action is still a fly action");
  if (restoredFly.type !== "fly") return;
  assertTrue(restoredFly.originStation === home, "fly originStation rebinds to live home station");
  assertTrue(restoredFly.destinationStation === target, "fly destinationStation rebinds to live target station");
  assertEqual(restoredFly.origin.stationId, home.id, "fly origin endpoint stationId preserved");
  assertEqual(restoredFly.origin.surfaceOrOrbit, "surface", "fly origin endpoint surfaceOrOrbit preserved");
  assertEqual(restoredFly.destination.surfaceOrOrbit, "orbit", "fly destination endpoint surfaceOrOrbit preserved");
});

test("tradeShipFromSnapshot: throws when the orbiting ship is missing from the ships map", () => {
  const home = habitatStation("HOME");
  const original = makeEmptyTradeShip();
  original.orbitingShipId = "GHOST-SHIP";
  original.homeStationId = home.id;

  const context: SnapshotContext = {
    stations: new Map([[home.id, home]]),
    ships: new Map(), // GHOST-SHIP intentionally absent
  };

  let threw = false;
  try {
    tradeShipFromSnapshot(tradeShipToSnapshot(original), context);
  } catch (error) {
    threw = true;
    assertTrue(
      (error as Error).message.includes("GHOST-SHIP"),
      "error names the missing ship id",
    );
  }
  assertTrue(threw, "a missing orbiting ship is treated as structural corruption");
});
