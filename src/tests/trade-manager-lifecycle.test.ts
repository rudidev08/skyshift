// Targeted tests for the TradeManager class boundary — update loop, queue
// dispatch, instance methods, and snapshot round-trip via the public class
// API. Existing trade.test.ts and savegame-*.test.ts cover trade behavior
// end-to-end; this file isolates the class-API contract that the broader
// tests exercise only transitively.

import { test, assertEqual, assertNotUndefined, assertTrue } from "./test-utils.ts";
import { createSimulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-create.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { tradeShipFromSnapshot, tradeShipToSnapshot, type SnapshotContext } from "../sim-trade-save-snapshot.ts";
import { advanceQueue } from "../sim-trade-queue.ts";
import type { ShipAction } from "../sim-travel-types.ts";
import { type TradeShip } from "../sim-trade-types.ts";

function createSettledSimulation() {
  return createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDurationSeconds: 0,
  });
}

// --- createMapFromTemplate: zone deduplication ---

test("createMapFromTemplate strips zones that preset stations occupy", () => {
  // Pin the occupiedZoneIds.add call in createPresetPlacedStations. Without it,
  // the returned set stays empty so the stationZones filter passes every zone
  // through — each preset station would render its zone footprint twice (once
  // for the station, once for the still-present empty zone underneath).
  const map = createMapFromTemplate(settledUniverse, settledPreset);
  const presetZoneIds = new Set(settledPreset.presetStations.map((p) => p.zoneId));
  const remainingZoneIds = new Set(map.stationZones.map((zone) => zone.id));

  assertTrue(presetZoneIds.size > 0, "fixture: preset has at least one station");
  for (const presetZoneId of presetZoneIds) {
    assertTrue(
      !remainingZoneIds.has(presetZoneId),
      `zone ${presetZoneId} occupied by a preset station must not appear in map.stationZones`,
    );
  }
  // And every preset station's zoneId survives onto the placement itself.
  for (const station of map.stations) {
    assertNotUndefined(station.zoneId, `preset station ${station.id} retains its zoneId`);
  }
});

// --- update() and queue dispatch ---

test("advanceQueue bursts through instant actions until a blocker", () => {
  const simulation = createSettledSimulation();
  const ship = simulation.tradeManager.tradeShips[0]!;
  const station = simulation.stations[0];
  const wareId = assertNotUndefined(
    station.stationType.produces[0],
    "fixture station produces at least one ware",
  );

  // Synthetic queue: leading placeholder (always shifted by advanceQueue),
  // then withdraw + deposit (instant, amount=0 so they no-op the slot but
  // still consume queue entries), then a wait blocker. After the call, the
  // queue should collapse to just the blocker.
  ship.actionQueue = [
    { type: "wait", duration: 0, label: "placeholder" },
    { type: "cargo-withdrawal", station, wareId, amount: 0 },
    { type: "cargo-deposit", station, wareId, amount: 0 },
    { type: "wait", duration: 999, label: "blocker" },
  ];

  advanceQueue(ship, simulation.tradeManager);

  assertEqual(ship.actionQueue.length, 1, "queue collapsed to the blocker");
  assertEqual(ship.actionQueue[0].type, "wait", "blocker remains at head");
  assertEqual(
    (ship.actionQueue[0] as Extract<ShipAction, { type: "wait" }>).label,
    "blocker",
    "right blocker",
  );
  simulation.tradeManager.dispose();
});

test("timer firing at exactly tradeTime fires this tick (boundary is <=, not <)", () => {
  // Pin the boundary in processDueTimers' fireTime check. A `<= → <` mutation
  // would let a timer scheduled at the exact tick boundary linger one tick
  // longer. Verify by giving a ship a fresh action queue head, scheduling
  // its wake-up at tradeTime+delta, ticking by exactly delta, and checking
  // that the queue head was consumed (advanceQueue ran).
  const simulation = createSettledSimulation();
  // Drain one tick so most ships have moved past their initial deploy timer.
  simulation.tradeManager.tick(0.5);
  const ship = simulation.tradeManager.tradeShips[0]!;
  // Replace the queue head with a synthetic placeholder we can detect; cancel
  // any existing timer for this ship by clearing then rescheduling at exact
  // tradeTime + 1.
  ship.actionQueue = [{ type: "wait", duration: 0, label: "boundary-marker" }];
  simulation.tradeManager.scheduleTimer(ship, 1);
  simulation.tradeManager.tick(1);
  // After ticking by exactly the scheduled delay, the placeholder must have
  // been consumed — advanceQueue shifts the head when it runs.
  const headIsBoundaryMarker =
    ship.actionQueue.length > 0 &&
    ship.actionQueue[0].type === "wait" &&
    (ship.actionQueue[0] as Extract<ShipAction, { type: "wait" }>).label === "boundary-marker";
  assertTrue(!headIsBoundaryMarker, "timer at fireTime === now must fire on this tick");
  simulation.tradeManager.dispose();
});

test("cancelTimersFor at index === timerHead does not surface a consumed timer in pendingTimers", () => {
  // Pin the `i < timerHead` boundary in cancelTimersFor. A `< → <=` mutation
  // would decrement timerHead when the splice index equals it — making the
  // most-recently-consumed entry resurface in pendingTimers (which save-load
  // captures verbatim), so post-load a fired timer would re-fire.
  const simulation = createSettledSimulation();
  // Wipe the auto-built roster + initial deploy timers so we control the queue.
  simulation.tradeManager.clearTradeShips();
  // Three synthetic TradeShips registered for timer-tracking purposes only.
  function makeStubTradeShip(idSuffix: string): TradeShip {
    return {
      orbitingShipId: `cancelTimers-${idSuffix}`,
      homeStationId: `home-${idSuffix}`,
      actionQueue: [],
      flight: null,
      targetStationId: null,
      tradeDirection: null,
      cargoAmountByWareId: new Map(),
      reservations: [],
      lastFlightHeadingRadians: null,
      idleSinceTradeTime: 0,
    };
  }
  const shipA = makeStubTradeShip("A");
  const shipB = makeStubTradeShip("B");
  const shipC = makeStubTradeShip("C");
  simulation.tradeManager.registerTradeShip(shipA);
  simulation.tradeManager.registerTradeShip(shipB);
  simulation.tradeManager.registerTradeShip(shipC);
  // Schedule strictly increasing fireTimes — A then B then C.
  simulation.tradeManager.scheduleTimer(shipA, 1);
  simulation.tradeManager.scheduleTimer(shipB, 2);
  simulation.tradeManager.scheduleTimer(shipC, 3);
  simulation.tradeManager.advanceTradeTime(1.5);
  // Drive timerHead past A's entry without invoking the manager's
  // queue-handling logic — pass a no-op handler so we isolate the boundary.
  simulation.tradeManager.activeTradeShips.processDueTimers(simulation.tradeManager.tradeTime, () => {});
  // Sanity-check: B and C are pending after advancing past A.
  const pendingBeforeCancel = simulation.tradeManager.toSnapshot().scheduledTimers;
  assertEqual(pendingBeforeCancel.length, 2, "B and C remain pending after consuming A's timer");

  // Cancel B's timer — its slot in the queue is at the timerHead boundary.
  simulation.tradeManager.activeTradeShips.cancelTimersFor(shipB);

  const pendingAfterCancel = simulation.tradeManager.toSnapshot().scheduledTimers;
  // With `<` (correct): B is gone, A's consumed entry stays consumed → only C remains.
  // With `<=` (mutated): timerHead decrements by one, exposing A's consumed
  //   entry again → 2 entries (A and C).
  assertEqual(
    pendingAfterCancel.length,
    1,
    "exactly one timer pending — C alone, A's consumed entry stays consumed",
  );
  assertEqual(pendingAfterCancel[0].shipId, shipC.orbitingShipId, "the surviving pending timer is C's");

  simulation.tradeManager.dispose();
});

test("decommission observer can read homeStationId after another observer removes the ship", () => {
  const simulation = createSettledSimulation();
  const ship = simulation.tradeManager.tradeShips[0]!;
  const expectedHomeStationId = ship.homeStationId;
  let homeStationIdReadByB: string | null = null;

  // Observer A simulates the lifecycle observer that calls shipManager.removeShip
  // — that removal also deregisters the trade ship via the onRemove hook.
  simulation.tradeManager.addShipDecommissionObserver((event) => {
    simulation.shipManager.removeShip(event.orbitingShip);
  });
  // Observer B reads homeStationId from the event payload, not from a singleton lookup.
  simulation.tradeManager.addShipDecommissionObserver((event) => {
    homeStationIdReadByB = event.homeStationId;
  });

  ship.actionQueue = [
    { type: "wait", duration: 0, label: "placeholder" },
    { type: "decommission", station: simulation.stations[0], label: "test" },
  ];
  advanceQueue(ship, simulation.tradeManager);

  assertEqual(
    homeStationIdReadByB,
    expectedHomeStationId,
    "observer B reads home from payload regardless of A",
  );
  simulation.tradeManager.dispose();
});

// --- Instance method coverage ---

test("deregisterShip removes the trade ship from the roster", () => {
  // The shipManager's onRemove hook calls deregisterShip → removeForShipId on
  // the registry; the registry must drop the ship from `roster` so the public
  // `tradeShips` getter no longer surfaces it. Pins the splice at the bottom
  // of removeForShipId — without it, the trade ship still appears in the
  // roster after its underlying Ship has been removed.
  const simulation = createSettledSimulation();
  const shipsBefore = simulation.tradeManager.tradeShips.length;
  const targetShip = simulation.tradeManager.tradeShips[0]!;
  const orbitingShip = simulation.shipManager.getShip(targetShip.orbitingShipId)!;

  simulation.tradeManager.deregisterShip(orbitingShip);

  assertEqual(simulation.tradeManager.tradeShips.length, shipsBefore - 1, "roster shrunk by one");
  assertEqual(
    simulation.tradeManager.findTradeShip(orbitingShip),
    undefined,
    "lookup misses after deregister",
  );
  simulation.tradeManager.dispose();
});

test("deregisterShip releases the deregistered ship's reservations on the station's slot", () => {
  // Pin the clearReservations call in deregisterTradeShipForShip. Skipping it
  // would leak the ship's reservedIncoming/reservedOutgoing onto the slot —
  // breaking the per-slot accounting that downstream demand calculations rely
  // on, since multiple ships share the same slot's reserved totals.
  const simulation = createSettledSimulation();
  const targetTradeShip = simulation.tradeManager.tradeShips[0]!;
  const orbitingShip = simulation.shipManager.getShip(targetTradeShip.orbitingShipId)!;
  const reservedStation = simulation.stationManager.getStation(targetTradeShip.homeStationId)!;
  const reservedWareId = reservedStation.stationType.produces[0] ?? reservedStation.inventory[0]?.ware.id;
  if (!reservedWareId) throw new Error("fixture station has no inventory slot");
  const reservedSlot = reservedStation.inventory.find((slot) => slot.ware.id === reservedWareId);
  if (!reservedSlot) throw new Error(`fixture station has no slot for ${reservedWareId}`);
  const reservedIncomingBefore = reservedSlot.reservedIncoming;
  // Attach a reservation directly so the ship has slot accounting to clear.
  // Use the station-side reserveIncoming so the slot's totals match the ship's
  // reservation entry (mirrors what the trade-reservation lifecycle does).
  const reservationAmount = 500;
  reservedSlot.reservedIncoming += reservationAmount;
  targetTradeShip.reservations.push({
    station: reservedStation,
    wareId: reservedWareId,
    amount: reservationAmount,
    cargoDirection: "incoming",
  });
  assertEqual(
    reservedSlot.reservedIncoming,
    reservedIncomingBefore + reservationAmount,
    "preconditions: slot's reservedIncoming reflects the ship's reservation",
  );

  simulation.tradeManager.deregisterShip(orbitingShip);

  // Without clearReservations, the slot's reservedIncoming would still hold
  // the deregistered ship's claim — leaking accounting onto the station.
  assertEqual(
    reservedSlot.reservedIncoming,
    reservedIncomingBefore,
    "slot's reservedIncoming returns to its pre-reservation total after deregister",
  );
  simulation.tradeManager.dispose();
});

test("deregisterShip clears the flight membership for an in-flight ship", () => {
  // Pin the flying.delete call inside removeForShipId. Without it, an in-flight
  // ship that gets removed via shipManager.removeShip would still be reported
  // as in-flight afterward — and tickTrade would attempt to advance a flight
  // on a ship no longer in the roster. Verify isShipInFlight flips false post
  // deregister.
  const simulation = createSettledSimulation();
  // Tick until at least one ship is flying, then locate one we can target.
  for (let i = 0; i < 60; i++) simulation.tick(0.5);
  let flyingTradeShip: TradeShip | null = null;
  for (const candidate of simulation.tradeManager.tradeShips) {
    if (simulation.tradeManager.isShipInFlight(candidate)) {
      flyingTradeShip = candidate;
      break;
    }
  }
  assertTrue(flyingTradeShip != null, "fixture warmed at least one flying ship");
  const orbitingShip = simulation.shipManager.getShip(flyingTradeShip!.orbitingShipId)!;

  simulation.tradeManager.deregisterShip(orbitingShip);

  assertTrue(
    !simulation.tradeManager.isShipInFlight(flyingTradeShip!),
    "deregistered in-flight ship is no longer in the flying set",
  );
  simulation.tradeManager.dispose();
});

test("shipManager.removeShip wires through to tradeManager.deregisterShip", () => {
  // Pin the onRemove → deregisterShip wiring in sim-lifecycle's subscribeSimObservers.
  // Removing the ship via the ship-manager path (which decommission observer A
  // does in production) must also drop its TradeShip from the trade roster.
  // A skipped deregisterShip leaves a stale trade ship pointing at a removed
  // orbiting ship.
  const simulation = createSettledSimulation();
  const tradeShip = simulation.tradeManager.tradeShips[0]!;
  const orbitingShip = simulation.shipManager.getShip(tradeShip.orbitingShipId)!;
  const rosterSizeBefore = simulation.tradeManager.tradeShips.length;

  simulation.shipManager.removeShip(orbitingShip);

  assertEqual(
    simulation.tradeManager.tradeShips.length,
    rosterSizeBefore - 1,
    "trade roster shrunk after shipManager removal",
  );
  assertEqual(
    simulation.tradeManager.findTradeShip(orbitingShip),
    undefined,
    "trade-ship lookup misses after shipManager removal",
  );
  simulation.tradeManager.dispose();
});

test("clearTradeShips() empties the roster on the instance", () => {
  const simulation = createSettledSimulation();
  assertTrue(simulation.tradeManager.tradeShips.length > 0, "roster non-empty before clear");
  simulation.tradeManager.clearTradeShips();
  assertEqual(simulation.tradeManager.tradeShips.length, 0, "roster empty after clear");
  simulation.tradeManager.dispose();
});

test("getTradeShipsByHomeStationId still returns surviving ships after deregistering one homed there", () => {
  // Pin the `set.size === 0` cleanup boundary in indexHomeRemove. A mutation
  // that flipped the check (e.g. `size > 0`) would delete the byHomeStationId
  // entry whenever other ships remain — leaving the surviving ships invisible
  // to the home-station lookup that emigration's per-station departure gate
  // depends on.
  const simulation = createSettledSimulation();
  // Find a home station with at least two ships so deregistering one leaves
  // others behind.
  let multiShipHomeId: string | null = null;
  for (const station of simulation.stations) {
    if (simulation.tradeManager.getTradeShipsByHomeStationId(station.id).size >= 2) {
      multiShipHomeId = station.id;
      break;
    }
  }
  assertTrue(multiShipHomeId !== null, "fixture has at least one station with two homed ships");
  const homedBefore = [...simulation.tradeManager.getTradeShipsByHomeStationId(multiShipHomeId!)];
  const targetTradeShip = homedBefore[0];
  const survivor = homedBefore[1];
  const targetOrbitingShip = simulation.shipManager.getShip(targetTradeShip.orbitingShipId)!;

  simulation.tradeManager.deregisterShip(targetOrbitingShip);

  const homedAfter = simulation.tradeManager.getTradeShipsByHomeStationId(multiShipHomeId!);
  assertTrue(homedAfter.has(survivor), "surviving sibling ship still surfaces from the home-station lookup");
  assertTrue(!homedAfter.has(targetTradeShip), "deregistered ship no longer surfaces");
  simulation.tradeManager.dispose();
});

test("registerShip is idempotent — re-enrolling the same orbiting ship returns the existing TradeShip", () => {
  // Pin the existing-ship early-return guard. Without it, a second registerShip
  // would push a duplicate TradeShip into the roster and overwrite the lookup,
  // leaving stale entries in the by-home set.
  const simulation = createSettledSimulation();
  const tradeShip = simulation.tradeManager.tradeShips[0]!;
  const orbitingShip = simulation.shipManager.getShip(tradeShip.orbitingShipId)!;
  const homeStation = simulation.stationManager.getStation(tradeShip.homeStationId)!;
  const rosterSizeBefore = simulation.tradeManager.tradeShips.length;

  const reEnrolled = simulation.tradeManager.registerShip(orbitingShip, homeStation);

  assertEqual(reEnrolled, tradeShip, "second enroll returns the same TradeShip instance");
  assertEqual(
    simulation.tradeManager.tradeShips.length,
    rosterSizeBefore,
    "roster size unchanged after re-enroll",
  );
  simulation.tradeManager.dispose();
});

test("simulation.dispose detaches the lifecycle decommission observer", () => {
  // Pin the unsubscribeDecommission() call inside Simulation.dispose. Skipping
  // it leaves a stale lifecycle observer on the trade manager that would call
  // shipManager.removeShip on a freshly-reset shipManager. Strategy: reset the
  // observer array to a single sentinel (the lifecycle observer) by adding
  // ours, clearing all OTHERS, then disposing — only Simulation.dispose's
  // unsubscribe call can detach our lifecycle-style entry.
  const simulation = createSettledSimulation();
  // Reset to a known state: only the lifecycle-style observer wires through
  // shipManager.removeShip, and we install one we control to mirror that
  // behavior. Other observers (emigration, route-stats) are unrelated to the
  // mutation we're targeting.
  simulation.tradeManager.decommissionObservers.length = 0;
  let lifecycleObserverFired = false;
  // Re-mimic the lifecycle wiring: register a decommission observer through
  // the same path simulation uses. Capture the unsubscribe like subscribeSimObservers
  // does, and stash it where dispose() can find it.
  // (We replace the private field via a runtime cast — necessary because the
  // lifecycle observer was already wired at construction; we reset it to test
  // the unsubscribe path on a clean observer.)
  const newUnsubscribe = simulation.tradeManager.addShipDecommissionObserver(() => {
    lifecycleObserverFired = true;
  });
  (simulation as unknown as { unsubscribeDecommission: () => void }).unsubscribeDecommission = newUnsubscribe;
  assertEqual(simulation.tradeManager.decommissionObservers.length, 1, "exactly one observer registered");

  simulation.dispose();

  // After dispose, our lifecycle-style observer must be unsubscribed.
  assertEqual(
    simulation.tradeManager.decommissionObservers.length,
    0,
    "lifecycle decommission observer detached on simulation.dispose",
  );
  assertTrue(!lifecycleObserverFired, "post-dispose: observer never fired during dispose itself");
});

test("simulation.dispose is idempotent — calling twice does not re-detach the decommission observer", () => {
  // Pin the `this.disposed = true` guard in Simulation.dispose. The class doc
  // says dispose is "safe to call more than once" — and the only protection
  // against double-detach (which would re-invoke unsubscribeDecommission and
  // also re-run every manager.reset/dispose) is the early-return on
  // `this.disposed`. A mutation that removed the `this.disposed = true`
  // assignment would let the body run on every call.
  //
  // Strategy: install a sentinel decommission observer post-construction, then
  // replace the lifecycle's stored unsubscribe with a callback that counts
  // invocations. Dispose twice. With the assignment intact, the unsubscribe
  // fires exactly once. With it removed, it fires twice.
  const simulation = createSettledSimulation();
  let unsubscribeCallCount = 0;
  (simulation as unknown as { unsubscribeDecommission: () => void }).unsubscribeDecommission = () => {
    unsubscribeCallCount++;
  };

  simulation.dispose();
  simulation.dispose();

  assertEqual(unsubscribeCallCount, 1, "unsubscribeDecommission fires exactly once across two dispose calls");
});

test("dispose clears trade ships, route stats, and route cache so a reused manager has no stale state", () => {
  // dispose() must wipe activeTradeShips, tradeRouteStats, and
  // routesCacheByWindow — trade ships, recorded routes, and cached query
  // results from before disposal shouldn't bleed into post-dispose queries on
  // the same manager. Reuse path only matters for tooling that holds onto a
  // manager and calls dispose between sessions, but the contract still applies.
  const simulation = createSettledSimulation();
  assertTrue(simulation.tradeManager.tradeShips.length > 0, "active roster has ships before dispose");
  simulation.tradeManager.tradeRouteStats.recordDelivery({
    time: 0,
    fromStationId: simulation.stations[0].id,
    toStationId: simulation.stations[1].id,
    wareId: "water",
    amount: 100,
    fillFraction: 1,
  });
  // Warm the routesCacheByWindow at windowSeconds=Infinity so dispose has something to clear.
  assertEqual(
    simulation.tradeManager.getTradedRoutes(0, Infinity).length,
    1,
    "warm cache holds recorded delivery",
  );
  assertTrue(
    simulation.tradeManager.routesCacheByWindow.has(Infinity),
    "routesCacheByWindow primed before dispose",
  );

  // Tick a couple times so tradeTime is non-zero before dispose, otherwise
  // the post-dispose check is trivially satisfied.
  simulation.tick(0.5);
  simulation.tick(0.5);
  assertTrue(simulation.tradeManager.tradeTime > 0, "tradeTime advanced before dispose");

  simulation.tradeManager.dispose();

  assertEqual(simulation.tradeManager.tradeShips.length, 0, "active roster cleared by dispose");
  assertEqual(simulation.tradeManager.tradeTime, 0, "tradeTime reset by dispose");
  assertEqual(
    simulation.tradeManager.tradeRouteStats.getRouteStatsInWindow(0, Infinity).length,
    0,
    "route stats history is cleared by dispose",
  );
  // Cache-size check must come before the public-API query — the query itself
  // re-warms the cache as a side effect.
  assertEqual(
    simulation.tradeManager.routesCacheByWindow.size,
    0,
    "routesCacheByWindow is cleared by dispose",
  );
  // Public-API view: even if a future refactor restructures the cache, the
  // user-facing query must return empty after dispose.
  assertEqual(
    simulation.tradeManager.getTradedRoutes(0, Infinity).length,
    0,
    "post-dispose getTradedRoutes returns empty",
  );
});

test("addShipDecommissionObserver returns an unsubscribe that detaches the first-registered observer", () => {
  // Pin the splice-guard boundary on the decommission observer pair — sister
  // to the trade-transfer observer test below. Detach the lifecycle-wired
  // observer so the externally-added one truly sits at index 0; an
  // `observerIndex >= 0 → > 0` mutation in the unsubscribe closure would
  // silently leave it attached. Verify behaviorally by firing an event
  // after unsubscribe and confirming the observer didn't run.
  const simulation = createSettledSimulation();
  simulation.tradeManager.decommissionObservers.length = 0;
  let observerCallCount = 0;
  const unsubscribe = simulation.tradeManager.addShipDecommissionObserver(() => {
    observerCallCount++;
  });
  const tradeShip = simulation.tradeManager.tradeShips[0]!;
  const orbitingShip = simulation.shipManager.getShip(tradeShip.orbitingShipId)!;

  function fireOneEvent() {
    for (const observer of simulation.tradeManager.decommissionObservers) {
      observer({
        tradeShip,
        orbitingShip,
        orbitingShipId: orbitingShip.id,
        homeStationId: tradeShip.homeStationId,
        decommissionStationId: simulation.stations[0].id,
        reason: "decommission-action",
      });
    }
  }

  fireOneEvent();
  assertEqual(observerCallCount, 1, "observer fires before unsubscribe");

  unsubscribe();
  fireOneEvent();
  assertEqual(observerCallCount, 1, "post-unsubscribe fire must not increment count");

  simulation.tradeManager.dispose();
});

test("addTradeTransferObserver returns an unsubscribe function that actually detaches the observer", () => {
  // The first observer added by external code lives at array index 0 in
  // `tradeTransferObservers` (only the constructor's recordRouteDeliveryFromTransfer
  // is registered before this point — but that is internal). Test the case
  // where this externally-added observer is at the lowest external index, so
  // a `>= 0 → > 0` mutation in the splice guard would silently leave it
  // attached. We verify detachment behaviorally — fire an event after
  // unsubscribe and confirm the count doesn't increment — so a future
  // refactor that swaps the array for another container still reads green.
  const simulation = createSettledSimulation();
  // Detach the constructor's internal recordRouteDeliveryFromTransfer to ensure
  // the externally-added observer truly sits at index 0.
  simulation.tradeManager.tradeTransferObservers.length = 0;

  let observerCallCount = 0;
  const unsubscribe = simulation.tradeManager.addTradeTransferObserver(() => {
    observerCallCount++;
  });
  assertTrue(typeof unsubscribe === "function", "unsubscribe is a function");

  function fireOneTransfer() {
    for (const observer of simulation.tradeManager.tradeTransferObservers) {
      observer({
        amount: 1,
        ship: simulation.tradeManager.tradeShips[0]!,
        station: simulation.stations[0],
        cargoDirection: "outgoing",
        wareId: "water",
      });
    }
  }

  fireOneTransfer();
  assertEqual(observerCallCount, 1, "observer fires before unsubscribe");

  unsubscribe();
  fireOneTransfer();
  assertEqual(observerCallCount, 1, "post-unsubscribe fire must not increment count");

  simulation.tradeManager.dispose();
});

// --- Snapshot round-trip ---

test("dispose followed by snapshot rehydration on a fresh sim restores trade time and roster", () => {
  const original = createSettledSimulation();

  for (let i = 0; i < 60; i++) original.tick(0.5);

  // Capture trade-side state (module clock + per-ship snapshots) before tearing down.
  const moduleSnapshot = original.tradeManager.toSnapshot();
  const tradeShipSnapshots = original.tradeManager.tradeShips.map(tradeShipToSnapshot);
  const expectedShipCount = tradeShipSnapshots.length;
  const expectedTradeTime = moduleSnapshot.tradeTime;
  const expectedTimerCount = moduleSnapshot.scheduledTimers.length;
  // Pin the in-flight count so the registry's `if (tradeShip.flight) flying.add()`
  // wiring on register survives — without it, post-load isShipInFlight would
  // wrongly report all ships idle and the per-tick flight-completion loop
  // would skip in-flight ships.
  let expectedInFlightCount = 0;
  for (const tradeShip of original.tradeManager.tradeShips) {
    if (original.tradeManager.isShipInFlight(tradeShip)) expectedInFlightCount++;
  }
  assertTrue(expectedInFlightCount > 0, "warmup left at least one ship in flight before snapshot");

  // Capture each ship's homeStationId + cargo so the round-trip assertion can
  // pin the per-ship scalar/Map fields, not just counts. homeStationId drives
  // the byHomeStationId index (emigration's per-station departure gate) and
  // recordRouteDeliveryFromTransfer's fromStationId derivation; cargo drives
  // every withdrawal/deposit a reloaded ship runs.
  const expectedHomeByShipId = new Map<string, string>();
  const expectedCargoByShipId = new Map<string, Array<[string, number]>>();
  for (const tradeShip of original.tradeManager.tradeShips) {
    expectedHomeByShipId.set(tradeShip.orbitingShipId, tradeShip.homeStationId);
    expectedCargoByShipId.set(
      tradeShip.orbitingShipId,
      [...tradeShip.cargoAmountByWareId.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  // At least one warmed ship is carrying cargo, so the cargo-fidelity check
  // below isn't vacuously satisfied by empty Maps.
  const shipsWithCargo = [...expectedCargoByShipId.values()].filter((entries) => entries.length > 0);
  assertTrue(shipsWithCargo.length > 0, "warmup left at least one ship carrying cargo before snapshot");

  // Snapshot context for tradeShipFromSnapshot — needs id→game-object maps.
  const stationsById = new Map(original.stations.map((station) => [station.id, station]));
  const shipsById = new Map(original.ships.map((ship) => [ship.id, ship]));
  const snapshotContext: SnapshotContext = { stations: stationsById, ships: shipsById };

  // Tear down and reconstruct, then rehydrate through the same code path
  // restoreSavedGame uses internally.
  original.dispose();

  const replay = createSettledSimulation();
  replay.tradeManager.clearTradeShips();
  const tradeShipsByShipId = new Map<string, TradeShip>();
  for (const snapshot of tradeShipSnapshots) {
    const tradeShip = tradeShipFromSnapshot(snapshot, snapshotContext);
    replay.tradeManager.registerTradeShip(tradeShip);
    tradeShipsByShipId.set(snapshot.shipId, tradeShip);
  }
  replay.tradeManager.restoreFromSnapshot(moduleSnapshot, tradeShipsByShipId);

  assertEqual(replay.tradeManager.tradeTime, expectedTradeTime, "tradeTime restored");
  assertEqual(replay.tradeManager.tradeShips.length, expectedShipCount, "roster size restored");
  assertEqual(
    replay.tradeManager.toSnapshot().scheduledTimers.length,
    expectedTimerCount,
    "scheduled timer count restored",
  );
  // Pin the post-restore flight set wiring.
  let restoredInFlightCount = 0;
  for (const tradeShip of replay.tradeManager.tradeShips) {
    if (replay.tradeManager.isShipInFlight(tradeShip)) restoredInFlightCount++;
  }
  assertEqual(
    restoredInFlightCount,
    expectedInFlightCount,
    "isShipInFlight count restored across snapshot rehydration",
  );

  // Pin per-ship homeStationId across the round trip. A tradeShipToSnapshot
  // or tradeShipFromSnapshot mutation that wrote orbitingShipId/shipId into
  // homeStationId would leave counts/tradeTime green but misindex every ship
  // in byHomeStationId (emigration's departure gate goes blind) and misroute
  // recordRouteDeliveryFromTransfer's fromStationId.
  for (const tradeShip of replay.tradeManager.tradeShips) {
    assertEqual(
      tradeShip.homeStationId,
      expectedHomeByShipId.get(tradeShip.orbitingShipId),
      `homeStationId restored for ${tradeShip.orbitingShipId}`,
    );
  }
  // Pin per-ship cargo contents across the round trip. A tradeShipFromSnapshot
  // mutation that swapped the cargo Map's [wareId, amount] key/value would
  // leave the roster intact but corrupt every reloaded ship's cargo — wrong
  // wares, wrong quantities delivered on the next deposit.
  for (const tradeShip of replay.tradeManager.tradeShips) {
    const restoredCargo = [...tradeShip.cargoAmountByWareId.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const expectedCargo = assertNotUndefined(
      expectedCargoByShipId.get(tradeShip.orbitingShipId),
      `expected cargo captured for ${tradeShip.orbitingShipId}`,
    );
    assertEqual(
      JSON.stringify(restoredCargo),
      JSON.stringify(expectedCargo),
      `cargo Map entries restored for ${tradeShip.orbitingShipId}`,
    );
  }

  replay.dispose();
});

// --- Demolished-endpoint tolerance (emigration ferry mid-flight) ---

test("snapshot restore replaces fly with placeholder when origin station is demolished", () => {
  // Construct a snapshot where the orbiting ship is alive but the fly action's
  // origin station is missing from the stations map — mirrors the state after
  // emigration demolishes a kept ship's home while the ferry is in flight.
  const simulation = createSettledSimulation();
  const someShip = simulation.ships[0];
  const someStation = simulation.stations[0];

  const snapshotContext: SnapshotContext = {
    stations: new Map([[someStation.id, someStation]]), // home id absent on purpose
    ships: new Map([[someShip.id, someShip]]),
  };

  const restored = tradeShipFromSnapshot(
    {
      shipId: someShip.id,
      homeStationId: "DEMOLISHED-HOME",
      cargo: [],
      actionQueue: [
        {
          type: "fly",
          origin: { stationId: "DEMOLISHED-HOME", surfaceOrOrbit: "orbit" },
          destination: { stationId: someStation.id, surfaceOrOrbit: "orbit" },
          travelMode: "interStation",
          label: "Ferry to elsewhere",
        },
        { type: "decommission", stationId: someStation.id, label: "Decommission at elsewhere" },
      ],
      flight: null,
      targetStationId: null,
      tradeDirection: null,
      reservations: [],
      lastFlightHeadingRadians: null,
      idleSinceTradeTime: 0,
    },
    snapshotContext,
  );

  // Fly action collapses to a no-op wait so the queue still advances when the
  // in-progress flight completes.
  assertEqual(restored.actionQueue.length, 2, "queue length preserved");
  assertEqual(restored.actionQueue[0].type, "wait", "fly with demolished origin became wait");
  const placeholder = restored.actionQueue[0] as Extract<ShipAction, { type: "wait" }>;
  assertEqual(placeholder.duration, 0, "placeholder wait is zero-duration");
  assertEqual(restored.actionQueue[1].type, "decommission", "trailing decommission preserved");

  simulation.tradeManager.dispose();
});

test("snapshot restore preserves reservations when station and slot still exist", () => {
  // Pin the slot-check guard's polarity in reservationFromSnapshot — `if (!slot)
  // return null;`. Inverting it would drop valid reservations on every load,
  // silently leaking the corresponding inventory slot accounting on the live sim.
  const simulation = createSettledSimulation();
  const someShip = simulation.ships[0];
  const someStation = simulation.stations[0];
  const reservedWareId = someStation.stationType.produces[0] ?? someStation.inventory[0]?.ware.id;
  if (!reservedWareId) throw new Error("fixture station has no inventory slot");

  const snapshotContext: SnapshotContext = {
    stations: new Map([[someStation.id, someStation]]),
    ships: new Map([[someShip.id, someShip]]),
  };

  const restored = tradeShipFromSnapshot(
    {
      shipId: someShip.id,
      homeStationId: someStation.id,
      cargo: [],
      actionQueue: [],
      flight: null,
      targetStationId: null,
      tradeDirection: null,
      reservations: [
        {
          stationId: someStation.id,
          wareId: reservedWareId,
          amount: 200,
          cargoDirection: "incoming",
        },
      ],
      lastFlightHeadingRadians: null,
      idleSinceTradeTime: 0,
    },
    snapshotContext,
  );

  // With the correct guard, a valid reservation survives. With the inverted
  // guard, it would be dropped silently.
  assertEqual(restored.reservations.length, 1, "valid reservation preserved across snapshot load");
  assertEqual(restored.reservations[0].station.id, someStation.id, "reservation re-binds to live station");
  assertEqual(restored.reservations[0].wareId, reservedWareId, "reservation wareId preserved");
  assertEqual(restored.reservations[0].amount, 200, "reservation amount preserved");

  simulation.tradeManager.dispose();
});

test("snapshot restore replaces deposit with placeholder when station is demolished", () => {
  const simulation = createSettledSimulation();
  const someShip = simulation.ships[0];

  const snapshotContext: SnapshotContext = {
    stations: new Map(), // no stations at all — every ref misses
    ships: new Map([[someShip.id, someShip]]),
  };

  const restored = tradeShipFromSnapshot(
    {
      shipId: someShip.id,
      homeStationId: "DEMOLISHED-HOME",
      cargo: [],
      actionQueue: [
        { type: "cargo-deposit", stationId: "DEMOLISHED-HOME", wareId: "water", amount: 100 },
        { type: "cargo-withdrawal", stationId: "DEMOLISHED-HOME", wareId: "ice", amount: 50 },
      ],
      flight: null,
      targetStationId: null,
      tradeDirection: null,
      reservations: [],
      lastFlightHeadingRadians: null,
      idleSinceTradeTime: 0,
    },
    snapshotContext,
  );

  assertEqual(restored.actionQueue.length, 2, "queue length preserved");
  assertEqual(restored.actionQueue[0].type, "wait", "deposit on demolished station became wait");
  assertEqual(restored.actionQueue[1].type, "wait", "withdraw on demolished station became wait");

  simulation.tradeManager.dispose();
});

test("flight completion clears ship.flight and advances the queue even when the next queue entry is a wait", () => {
  // Pin two effects in completeFinishedTradeFlights' second loop: the explicit
  // `ship.flight = null` and the post-clearFlight `advanceQueue(ship, manager)`
  // call. Either mutation alone is silent on a queue whose only fall-through
  // is a blocking wait — `flight = null` skip leaves stale flight, and
  // `advanceQueue` skip leaves the just-completed fly action at the head with
  // nothing to consume it (no in-flight, no scheduled timer for the next entry,
  // and the next-trip path doesn't fire when the queue isn't empty).
  const simulation = createSettledSimulation();
  const tradeShip = simulation.tradeManager.tradeShips[0]!;
  const homeStation = simulation.stationManager.getStation(tradeShip.homeStationId)!;
  // Cancel the pre-scheduled deploy timer so processDueTimers doesn't advance
  // the queue first — only completeFinishedTradeFlights' second loop can shift
  // the fly action off when the post-flight advanceQueue runs.
  simulation.tradeManager.activeTradeShips.cancelTimersFor(tradeShip);
  // Replace queue with a fly + two waits so the queue still has entries after
  // the flight completes; without trailing entries, resetTradeState would
  // back-door clear ship.flight when the queue empties, masking the mutation.
  tradeShip.actionQueue = [
    {
      type: "fly",
      origin: { stationId: homeStation.id, surfaceOrOrbit: "surface" },
      originStation: homeStation,
      destination: { stationId: homeStation.id, surfaceOrOrbit: "orbit" },
      destinationStation: homeStation,
      travelMode: "local",
      deploying: false,
      label: "current",
    },
    { type: "wait", duration: 999, label: "blocker-1" },
    { type: "wait", duration: 999, label: "blocker-2" },
  ];
  tradeShip.flight = {
    phase: "arriving",
    progress: 0.99,
    origin: { stationId: homeStation.id, surfaceOrOrbit: "surface" },
    destination: { stationId: homeStation.id, surfaceOrOrbit: "orbit" },
    phaseStartSeconds: 0,
    totalElapsedSeconds: 999,
    flightDuration: 1,
    departDistanceFraction: 0.1,
    flightDistanceFraction: 0.8,
    arriveDistanceFraction: 0.1,
    travelMode: "local",
    previousHeading: null,
  };
  simulation.tradeManager.activeTradeShips.setInFlight(tradeShip);

  simulation.tradeManager.tick(2);

  assertTrue(tradeShip.flight === null, "flight cleared on the same tick that completed it");
  // Pin advanceQueue ran post-completion: the queue's leading fly was consumed
  // and the wait at the new head fired its scheduleTimer (which the original
  // tick caller doesn't see, but the consumed fly is observable here).
  assertEqual(tradeShip.actionQueue.length, 2, "fly action shifted off the queue");
  const queueHead = tradeShip.actionQueue[0];
  assertEqual(queueHead.type, "wait", "queue head is the wait blocker, not the consumed fly");
  assertEqual(
    (queueHead as Extract<ShipAction, { type: "wait" }>).label,
    "blocker-1",
    "queue head is blocker-1 — the action that follows the consumed fly",
  );

  simulation.tradeManager.dispose();
});

test("flight completion sets lastFlightHeadingRadians to atan2(dy, dx) of origin → destination, not the swapped form", () => {
  // Pin Math.atan2's argument order in the post-completion lastFlightHeadingRadians update.
  // atan2(dx, dy) instead of atan2(dy, dx) computes the complementary angle —
  // departing flights then lerp from the wrong starting heading and the
  // smooth-turn render breaks. Tests that don't observe lastFlightHeadingRadians miss this.
  const simulation = createSettledSimulation();
  const tradeShip = simulation.tradeManager.tradeShips[0]!;
  const originStation = simulation.stationManager.getStation(tradeShip.homeStationId)!;
  // Pick a destination at a different position so dx/dy disambiguate the angle.
  // Use the station with the largest combined |dx|+|dy| from origin to make the
  // expected angle distinct from 0 / π/2 / π / -π/2 (where swapping args could
  // coincidentally land on the right value).
  let destinationStation: typeof originStation | null = null;
  let bestDistanceSquared = 0;
  for (const candidate of simulation.stations) {
    if (candidate.id === originStation.id) continue;
    const deltaX = candidate.x - originStation.x;
    const deltaY = candidate.y - originStation.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (Math.abs(deltaX) > 0 && Math.abs(deltaY) > 0 && distanceSquared > bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      destinationStation = candidate;
    }
  }
  assertTrue(destinationStation !== null, "found a destination station with non-trivial dx/dy");

  // Cancel the deploy timer and stage a fly + completed flight by hand so the
  // assertion isolates the post-completion lastFlightHeadingRadians update.
  simulation.tradeManager.activeTradeShips.cancelTimersFor(tradeShip);
  tradeShip.actionQueue = [
    {
      type: "fly",
      origin: { stationId: originStation.id, surfaceOrOrbit: "orbit" },
      originStation,
      destination: { stationId: destinationStation!.id, surfaceOrOrbit: "orbit" },
      destinationStation: destinationStation!,
      travelMode: "interStation",
      deploying: false,
      label: "leg",
    },
    { type: "wait", duration: 999, label: "blocker" },
  ];
  tradeShip.flight = {
    phase: "arriving",
    progress: 0.99,
    origin: { stationId: originStation.id, surfaceOrOrbit: "orbit" },
    destination: { stationId: destinationStation!.id, surfaceOrOrbit: "orbit" },
    phaseStartSeconds: 0,
    totalElapsedSeconds: 999,
    flightDuration: 1,
    departDistanceFraction: 0.1,
    flightDistanceFraction: 0.8,
    arriveDistanceFraction: 0.1,
    travelMode: "interStation",
    previousHeading: null,
  };
  simulation.tradeManager.activeTradeShips.setInFlight(tradeShip);
  // Sentinel value so we can detect "lastFlightHeadingRadians not written at all" vs "wrong value".
  tradeShip.lastFlightHeadingRadians = 9999;

  simulation.tradeManager.tick(2);

  // The right value is atan2(dy, dx). atan2(dx, dy) (arg-swap) and any drop
  // (sentinel survives) both fail this assertion.
  const expectedHeading = Math.atan2(
    destinationStation!.y - originStation.y,
    destinationStation!.x - originStation.x,
  );
  assertEqual(
    tradeShip.lastFlightHeadingRadians,
    expectedHeading,
    "lastFlightHeadingRadians equals atan2(dy, dx) of origin → destination",
  );

  simulation.tradeManager.dispose();
});

test("flight completion does not throw when origin or destination station is demolished", () => {
  // Build a ship whose flight references a station id not in the manager's
  // roster, then drive the flight to completion. Pre-fix this threw on the
  // requireResolvedStation lookup inside the per-tick trade update.
  const simulation = createSettledSimulation();
  const tradeShip = assertNotUndefined(
    simulation.tradeManager.tradeShips[0],
    "fixture has at least one trade ship",
  );

  // Replace the ship's flight with one whose origin id is missing from the
  // station roster. Phase already at "arriving" and progress near 1 so the
  // next tick completes it.
  tradeShip.flight = {
    phase: "arriving",
    progress: 0.99,
    origin: { stationId: "GONE", surfaceOrOrbit: "orbit" },
    destination: { stationId: "ALSO-GONE", surfaceOrOrbit: "orbit" },
    phaseStartSeconds: 0,
    totalElapsedSeconds: 999,
    flightDuration: 1,
    departDistanceFraction: 0.1,
    flightDistanceFraction: 0.8,
    arriveDistanceFraction: 0.1,
    travelMode: "interStation",
    previousHeading: null,
  };
  // Tick twice — flight transitions complete on the second pass.
  simulation.tradeManager.tick(2);
  simulation.tradeManager.tick(0.1);

  assertTrue(tradeShip.flight === null, "flight cleared after completion");

  simulation.tradeManager.dispose();
});
