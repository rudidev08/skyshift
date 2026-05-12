import { test, assertEqual, assertTrue, assertNotUndefined } from "./test-utils.ts";
import { captureSnapshot, applySnapshot } from "../ui-savegame-manager.ts";
import { setupFreshTestGame } from "./savegame-test-fixtures.ts";
import type { DecommissionEvent } from "../sim-trade-manager.ts";

// Pins emigration snapshot/restore mid-event. Cache fields (per the comment on
// EmigrationManager.fromSnapshot) are intentionally deferred; failure modes
// here are silent state mismatches after load.

function assertNotNull<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label}: expected non-null value`);
  return value;
}

/** setupFreshTestGame disposes the previous simulation, which resets the
 *  EmigrationManager's counters to zero. Re-seed the restored sim's
 *  stationManager and shipManager from the loaded game.stations/ships so
 *  ticks resolve to the restored stations, not the orphaned roster the
 *  fresh-init left behind. */
function reseedManagersAfterLoad(loaded: ReturnType<typeof setupFreshTestGame>): void {
  loaded.simulation.initStationsAndShipsForRestore(loaded.stations, loaded.ships);
}

test("snapshot mid-event: activeEvent fields roundtrip through fromSnapshot unchanged", () => {
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const event = source.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  const snapshot = captureSnapshot(source as never);

  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  const restoredEvent = assertNotNull(restored.emigrationManager.getActiveEvent(), "restored event");
  // Pin every persistent field. Anything that drifts here would silently
  // misroute post-load decommissions and demolitions.
  assertEqual(restoredEvent.id, event!.id, "event id preserved");
  assertEqual(restoredEvent.generationalShipId, event!.generationalShipId, "generationalShipId preserved");
  assertEqual(restoredEvent.totalExpectedShips, event!.totalExpectedShips, "totalExpectedShips preserved");
  assertEqual(restoredEvent.shipsArrived, event!.shipsArrived, "shipsArrived preserved");
  assertEqual(restoredEvent.destinationName, event!.destinationName, "destinationName preserved");
  assertEqual(restoredEvent.eventStartAt, event!.eventStartAt, "eventStartAt preserved");
  assertEqual(restoredEvent.stationIds.length, event!.stationIds.length, "stationIds count preserved");
  assertEqual(restoredEvent.nationIds.length, event!.nationIds.length, "nationIds count preserved");
  for (let stationIndex = 0; stationIndex < event!.stationIds.length; stationIndex++) {
    assertEqual(restoredEvent.stationIds[stationIndex], event!.stationIds[stationIndex], `stationIds[${stationIndex}] preserved`);
  }
  // Pin that stationIdSet (a not-serialized mirror) is rebuilt on load —
  // if eventFromSnapshot dropped the Set construction, post-load decommission
  // routing would always miss.
  for (const stationId of event!.stationIds) {
    assertTrue(restoredEvent.stationIdSet.has(stationId), `stationIdSet has ${stationId} after load`);
  }
});

test("snapshot mid-event after some ferries arrived: shipsArrived counter survives load", () => {
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const event = assertNotNull(source.emigrationManager.triggerEvent({ intensity: "high" }), "event");

  // Inject 3 synthetic decommissions for event-station ships to bump shipsArrived.
  const eventStationId = event.stationIds[0];
  for (let arrival = 0; arrival < 3; arrival++) {
    const synthetic: DecommissionEvent = {
      tradeShip: { orbitingShipId: `synth-${arrival}`, homeStationId: eventStationId } as never,
      orbitingShip: { id: `synth-${arrival}` } as never,
      orbitingShipId: `synth-${arrival}`,
      homeStationId: eventStationId,
      decommissionStationId: event.generationalShipId,
      reason: "decommission-action",
    };
    for (const observer of source.tradeManager.decommissionObservers) observer(synthetic);
  }
  assertEqual(event.shipsArrived, 3, "preconditions: 3 arrivals counted");

  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  const restoredEvent = assertNotNull(restored.emigrationManager.getActiveEvent(), "restored event");
  assertEqual(restoredEvent.shipsArrived, 3, "shipsArrived counter survives load");
});

test("after load: decommission observer reattaches and continues counting arrivals", () => {
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const event = assertNotNull(source.emigrationManager.triggerEvent({ intensity: "high" }), "event");

  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  const restoredEvent = assertNotNull(restored.emigrationManager.getActiveEvent(), "restored event");
  const before = restoredEvent.shipsArrived;
  // Pin that the EmigrationManager constructor's
  // tradeManager.addShipDecommissionObserver call wires up correctly on the
  // restored sim too. Mutating the constructor to skip the subscription
  // would leave shipsArrived stuck at `before` post-load.
  const synthetic: DecommissionEvent = {
    tradeShip: { orbitingShipId: "post-load-ship", homeStationId: event.stationIds[0] } as never,
    orbitingShip: { id: "post-load-ship" } as never,
    orbitingShipId: "post-load-ship",
    homeStationId: event.stationIds[0],
    decommissionStationId: event.generationalShipId,
    reason: "decommission-action",
  };
  for (const observer of restored.tradeManager.decommissionObservers) observer(synthetic);
  assertEqual(restoredEvent.shipsArrived, before + 1, "post-load observer counts the new arrival");
});

test("snapshot when no event is active: activeEvent=null roundtrips without errors", () => {
  // Default mode is "auto" but no event triggered yet → activeEvent should be null.
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  assertEqual(source.emigrationManager.getActiveEvent(), null, "preconditions: no active event");

  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);
  assertEqual(restored.emigrationManager.getActiveEvent(), null, "activeEvent stays null after load");
});

test("snapshot post-demolition before WAY jump: load completes the jump on the next tick", () => {
  // Set the event into a "ready to jump" state (shipsArrived === total),
  // capture before tick fires the jump, then load and tick once → jump fires.
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const event = assertNotNull(source.emigrationManager.triggerEvent({ intensity: "low" }), "event");
  event.shipsArrived = event.totalExpectedShips;

  // Capture BEFORE the jump fires — activeEvent still set, generational ship still present.
  const snapshot = captureSnapshot(source as never);
  assertNotNull(source.emigrationManager.getActiveEvent(), "preconditions: event still active");

  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);
  reseedManagersAfterLoad(restored);
  // Verify load preserved the jumpable state.
  assertNotNull(restored.emigrationManager.getActiveEvent(), "load preserves activeEvent");
  // Now tick once on the restored sim — the jump-check should fire.
  restored.simulation.tickDynamics(1);
  assertEqual(restored.emigrationManager.getActiveEvent(), null, "post-load tick fires the jump");
  assertTrue(
    restored.emigrationManager.getNextGenerationalShipArrivalAt() !== null,
    "post-load jump schedules the next gen-ship arrival",
  );
});

test("nextEventCounter / nextEmigrantShipCounter / nextGenerationalShipCounter survive snapshot round-trip", () => {
  // Trigger an event so each counter increments off zero. Pin that the
  // restored manager's snapshot-out reproduces the same values — drifting
  // counters would let post-load events reuse ids of in-flight emigrant ships.
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const event = assertNotNull(source.emigrationManager.triggerEvent({ intensity: "high" }), "event triggered");

  // Run a few ticks so emigrant ship ids get generated (nextEmigrantShipCounter > 0).
  source.simulation.tickDynamics(3);

  // Capture source's snapshot BEFORE setupFreshTestGame disposes the source sim.
  // dispose() resets the manager counters to zero, so reading toSnapshot after
  // would lie about pre-disposal state.
  const sourceManagerSnapshot = source.emigrationManager.toSnapshot();
  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  const restoredManagerSnapshot = restored.emigrationManager.toSnapshot();
  assertEqual(restoredManagerSnapshot.nextEventCounter, sourceManagerSnapshot.nextEventCounter, "nextEventCounter preserved");
  assertEqual(restoredManagerSnapshot.nextEmigrantShipCounter, sourceManagerSnapshot.nextEmigrantShipCounter, "nextEmigrantShipCounter preserved");
  assertEqual(restoredManagerSnapshot.nextGenerationalShipCounter, sourceManagerSnapshot.nextGenerationalShipCounter, "nextGenerationalShipCounter preserved");
  // First event drove nextEventCounter to 1; sanity-check the absolute value too.
  assertEqual(restoredManagerSnapshot.nextEventCounter, 1, "nextEventCounter absolute value matches");
  assertTrue(restoredManagerSnapshot.nextEmigrantShipCounter > 0, "nextEmigrantShipCounter advanced past zero by emigrant launches");
  // Reference event so unused-variable lint stays quiet.
  assertTrue(event.id.length > 0, "event has an id");
});

test("usedDestinations array survives snapshot round-trip", () => {
  // drawDestination mutates EmigrationManager.usedDestinations. Triggering
  // an event consumes one destination — pin that the post-load array contains it.
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const event = assertNotNull(source.emigrationManager.triggerEvent({ intensity: "low" }), "event");

  const sourceManagerSnapshot = source.emigrationManager.toSnapshot();
  assertEqual(sourceManagerSnapshot.usedDestinations.length, 1, "preconditions: one destination consumed");
  assertEqual(sourceManagerSnapshot.usedDestinations[0], event.destinationName, "consumed destination matches event");

  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  const restoredManagerSnapshot = restored.emigrationManager.toSnapshot();
  assertEqual(restoredManagerSnapshot.usedDestinations.length, 1, "usedDestinations length preserved");
  assertEqual(restoredManagerSnapshot.usedDestinations[0], event.destinationName, "destination identity preserved");
});

test("activeGenerationalShipId survives snapshot round-trip and reattaches to the live ship", () => {
  // The id alone isn't enough — getActiveGenerationalShip() must resolve to a
  // real Station in the restored stationManager. Pin both halves: id preserved
  // AND lookup succeeds.
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const sourceShip = assertNotNull(source.emigrationManager.getActiveGenerationalShip(), "source gen ship");

  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  const restoredShip = assertNotNull(restored.emigrationManager.getActiveGenerationalShip(), "restored gen ship");
  // Pin the id round-trip + the stationManager lookup. Mutating
  // applySnapshot's restoreStations to drop the gen ship would resolve the
  // id but return undefined for the lookup.
  assertEqual(restoredShip.id, sourceShip.id, "generational ship id preserved");
  assertEqual(restoredShip.stationType.id, "generational-ship", "restored ship is the gen-ship type");
});

test("simTime, mode, intensity, nextGenerationalShipArrivalAt all roundtrip", () => {
  // The full-snapshot test in savegame-snapshot.test.ts catches drift via
  // JSON compare. This pins the individual fields so a regression names the
  // specific drift.
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  source.emigrationManager.setIntensity("high");
  // Drive simTime past zero by ticking.
  source.simulation.tickDynamics(15);
  // Force a jump so nextGenerationalShipArrivalAt becomes a non-null number.
  const event = assertNotNull(source.emigrationManager.triggerEvent({ intensity: "low" }), "event");
  event.shipsArrived = event.totalExpectedShips;
  source.simulation.tickDynamics(1);
  const sourceArrival = source.emigrationManager.getNextGenerationalShipArrivalAt();
  assertTrue(sourceArrival !== null, "preconditions: nextGenerationalShipArrivalAt scheduled");

  // Capture source state before setupFreshTestGame disposes source's sim.
  const sourceState = source.emigrationManager.toSnapshot();
  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  const restoredState = restored.emigrationManager.toSnapshot();
  assertEqual(restoredState.simTime, sourceState.simTime, "simTime preserved");
  assertEqual(restoredState.mode, "manual", "mode preserved");
  assertEqual(restoredState.intensity, "high", "intensity preserved");
  assertEqual(restoredState.nextGenerationalShipArrivalAt, sourceArrival, "nextGenerationalShipArrivalAt preserved");
});

test("fromSnapshot leaves per-station progressFraction at 0 (deferred sync)", () => {
  // Per fromSnapshot's comment: progressFraction / arrivalFraction stay at
  // their snapshotted values until the first dynamics tick re-runs
  // syncStationCaches with seeded managers. progressFraction is NOT in the
  // snapshot, so the snapshot-restored value is the initial 0 from
  // emigrationFromSnapshot — pin that.
  const source = setupFreshTestGame();
  source.emigrationManager.setMode("manual");
  const event = assertNotNull(source.emigrationManager.triggerEvent({ intensity: "high" }), "event");

  // Tick to drive progressFraction past zero (some launches happen, syncStationCaches updates).
  for (let secondIndex = 0; secondIndex < 3; secondIndex++) {
    source.simulation.tickDynamics(1);
  }

  const eventStationId = event.stationIds[0];
  // Capture source progress before setupFreshTestGame disposes source's sim.
  const sourceStation = assertNotUndefined(source.simulation.stationManager.getStation(eventStationId), "source station");
  const sourceProgress = assertNotNull(sourceStation.emigrationEvent, "source emigration").progressFraction;

  const snapshot = captureSnapshot(source as never);
  const restored = setupFreshTestGame();
  applySnapshot(restored as never, snapshot);

  // Find the restored station via game.stations (stationManager not yet re-seeded
  // for this assertion path — and the deferred-sync claim is about state
  // immediately after applySnapshot, before any tick).
  const restoredStation = assertNotUndefined(
    restored.stations.find((station) => station.id === eventStationId),
    "restored station",
  );
  const restoredProgress = assertNotNull(restoredStation.emigrationEvent, "restored emigration").progressFraction;
  assertEqual(restoredProgress, 0, "progressFraction at 0 immediately after load (deferred sync)");
  assertTrue(sourceProgress >= 0 && sourceProgress <= 1, "source progressFraction is in [0,1]");
});
