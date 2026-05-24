import { test, assertEqual, assertTrue, assertNotUndefined, assertNotNull } from "./test-utils.ts";
import { captureSnapshot, restoreSavedGame } from "../ui-savegame-manager.ts";
import { setupFreshTestGame } from "./savegame-test-fixtures.ts";
import { makeSyntheticDecommissionEvent, emitSyntheticDecommission } from "./factories.ts";

// Pins emigration snapshot/restore mid-event. Cache fields (per the comment on
// EmigrationManager.fromSnapshot) are intentionally deferred; failure modes
// here are silent state mismatches after load.

test("snapshot mid-event: activeEvent fields roundtrip through fromSnapshot unchanged", () => {
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "high" }),
    "event triggered",
  );

  const snapshot = captureSnapshot(source);

  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredEvent = assertNotNull(
    restoredGame.simulation.emigrationManager.getActiveEvent(),
    "restored event",
  );
  // Pin every persistent field. Anything that drifts here would silently
  // misroute post-load decommissions and demolitions.
  assertEqual(restoredEvent.id, event.id, "event id preserved");
  assertEqual(restoredEvent.generationalShipId, event.generationalShipId, "generationalShipId preserved");
  assertEqual(restoredEvent.totalExpectedShips, event.totalExpectedShips, "totalExpectedShips preserved");
  assertEqual(restoredEvent.shipsArrived, event.shipsArrived, "shipsArrived preserved");
  assertEqual(restoredEvent.destinationName, event.destinationName, "destinationName preserved");
  assertEqual(restoredEvent.stationIds.length, event.stationIds.length, "stationIds count preserved");
  assertEqual(restoredEvent.nationIds.length, event.nationIds.length, "nationIds count preserved");
  for (let stationIndex = 0; stationIndex < event.stationIds.length; stationIndex++) {
    assertEqual(
      restoredEvent.stationIds[stationIndex],
      event.stationIds[stationIndex],
      `stationIds[${stationIndex}] preserved`,
    );
  }
  // Pin that stationIdSet (a not-serialized mirror) is rebuilt on load —
  // if emigrationEventFromSnapshot dropped the Set construction, post-load decommission
  // routing would always miss.
  for (const stationId of event.stationIds) {
    assertTrue(restoredEvent.stationIdSet.has(stationId), `stationIdSet has ${stationId} after load`);
  }
});

test("snapshot mid-event after some ferries arrived: shipsArrived counter survives load", () => {
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "high" }),
    "event",
  );

  // Inject 3 synthetic decommissions for event-station ships to bump shipsArrived.
  const eventStationId = event.stationIds[0];
  for (let arrivalIndex = 0; arrivalIndex < 3; arrivalIndex++) {
    const synthetic = makeSyntheticDecommissionEvent(
      `synth-${arrivalIndex}`,
      eventStationId,
      event.generationalShipId,
    );
    emitSyntheticDecommission(source.simulation, synthetic);
  }
  assertEqual(event.shipsArrived, 3, "preconditions: 3 arrivals counted");

  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredEvent = assertNotNull(
    restoredGame.simulation.emigrationManager.getActiveEvent(),
    "restored event",
  );
  assertEqual(restoredEvent.shipsArrived, 3, "shipsArrived counter survives load");
});

test("after load: decommission observer reattaches and continues counting arrivals", () => {
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "high" }),
    "event",
  );

  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredEvent = assertNotNull(
    restoredGame.simulation.emigrationManager.getActiveEvent(),
    "restored event",
  );
  const before = restoredEvent.shipsArrived;
  // Pin that the EmigrationManager constructor's
  // tradeManager.addShipDecommissionObserver call wires up correctly on the
  // restored sim too. Mutating the constructor to skip the subscription
  // would leave shipsArrived stuck at `before` post-load.
  const synthetic = makeSyntheticDecommissionEvent(
    "post-load-ship",
    event.stationIds[0],
    event.generationalShipId,
  );
  emitSyntheticDecommission(restoredGame.simulation, synthetic);
  assertEqual(restoredEvent.shipsArrived, before + 1, "post-load observer counts the new arrival");
});

test("snapshot when no event is active: activeEvent=null roundtrips without errors", () => {
  // Default mode is "auto" but no event triggered yet → activeEvent should be null.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  assertEqual(source.simulation.emigrationManager.getActiveEvent(), null, "preconditions: no active event");

  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  // Force timeScale off the resume value to pin restoreSavedGame's reset.
  // `timeScale = 0` would freeze the loaded sim; `timeScale = 2` would race it.
  restoredGame.timeScale = 2;
  restoreSavedGame(restoredGame, snapshot);
  assertEqual(
    restoredGame.simulation.emigrationManager.getActiveEvent(),
    null,
    "activeEvent stays null after load",
  );
  // Pin the "loaded saves resume at 1×" contract documented on resetPlaybackSpeed.
  // A mutation that sets timeScale to 0 (freeze) or skips the reset entirely would
  // surface here as a non-1 timeScale post-load.
  assertEqual(restoredGame.timeScale, 1, "playback resumes at 1× after restore");
});

test("snapshot post-demolition before WAY jump: load completes the jump on the next tick", () => {
  // Set the event into a "ready to jump" state (shipsArrived === total),
  // capture before tick fires the jump, then load and tick once → jump fires.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "low" }),
    "event",
  );
  event.shipsArrived = event.totalExpectedShips;

  // Capture BEFORE the jump fires — activeEvent still set, generational ship still present.
  const snapshot = captureSnapshot(source);
  assertNotNull(source.simulation.emigrationManager.getActiveEvent(), "preconditions: event still active");

  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);
  restoredGame.simulation.seedRosterForSavedGame(restoredGame.stations, restoredGame.ships);
  // Verify load preserved the jumpable state.
  assertNotNull(restoredGame.simulation.emigrationManager.getActiveEvent(), "load preserves activeEvent");
  // Now tick once on the restored sim — the jump-check should fire.
  restoredGame.simulation.slowSimulationTick(1);
  assertEqual(restoredGame.simulation.emigrationManager.getActiveEvent(), null, "post-load tick fires the jump");
  assertTrue(
    restoredGame.simulation.emigrationManager.getNextGenerationalShipArrivalAt() !== null,
    "post-load jump schedules the next gen-ship arrival",
  );
});

test("nextEventCounter / nextEmigrantShipCounter / nextGenerationalShipCounter survive snapshot round-trip", () => {
  // Trigger an event so each counter increments off zero. Pin that the
  // restored manager's snapshot-out reproduces the same values — drifting
  // counters would let post-load events reuse ids of in-flight emigrant ships.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "high" }),
    "event triggered",
  );

  // Run a few ticks so emigrant ship ids get generated (nextEmigrantShipCounter > 0).
  source.simulation.slowSimulationTick(3);

  // Capture source's snapshot BEFORE setupFreshTestGame destroys the source sim.
  // destroy() resets the manager counters to zero, so reading toSnapshot after
  // would lie about pre-destroy state.
  const sourceManagerSnapshot = source.simulation.emigrationManager.toSnapshot();
  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredManagerSnapshot = restoredGame.simulation.emigrationManager.toSnapshot();
  assertEqual(
    restoredManagerSnapshot.nextEventCounter,
    sourceManagerSnapshot.nextEventCounter,
    "nextEventCounter preserved",
  );
  assertEqual(
    restoredManagerSnapshot.nextEmigrantShipCounter,
    sourceManagerSnapshot.nextEmigrantShipCounter,
    "nextEmigrantShipCounter preserved",
  );
  assertEqual(
    restoredManagerSnapshot.nextGenerationalShipCounter,
    sourceManagerSnapshot.nextGenerationalShipCounter,
    "nextGenerationalShipCounter preserved",
  );
  // First event drove nextEventCounter to 1; sanity-check the absolute value too.
  assertEqual(restoredManagerSnapshot.nextEventCounter, 1, "nextEventCounter absolute value matches");
  assertTrue(
    restoredManagerSnapshot.nextEmigrantShipCounter > 0,
    "nextEmigrantShipCounter advanced past zero by emigrant launches",
  );
  // Reference event so unused-variable lint stays quiet.
  assertTrue(event.id.length > 0, "event has an id");
});

test("usedDestinations array survives snapshot round-trip", () => {
  // drawAndRecordDestination mutates EmigrationManager.usedDestinations. Triggering
  // an event consumes one destination — pin that the post-load array contains it.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "low" }),
    "event",
  );

  const sourceManagerSnapshot = source.simulation.emigrationManager.toSnapshot();
  assertEqual(sourceManagerSnapshot.usedDestinations.length, 1, "preconditions: one destination consumed");
  assertEqual(
    sourceManagerSnapshot.usedDestinations[0],
    event.destinationName,
    "consumed destination matches event",
  );

  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredManagerSnapshot = restoredGame.simulation.emigrationManager.toSnapshot();
  assertEqual(restoredManagerSnapshot.usedDestinations.length, 1, "usedDestinations length preserved");
  assertEqual(
    restoredManagerSnapshot.usedDestinations[0],
    event.destinationName,
    "destination identity preserved",
  );
});

test("activeGenerationalShipId survives snapshot round-trip and reattaches to the live ship", () => {
  // The id alone isn't enough — getActiveGenerationalShip() must resolve to a
  // real Station in the restored stationManager. Pin both halves: id preserved
  // AND lookup succeeds.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const sourceShip = assertNotNull(
    source.simulation.emigrationManager.getActiveGenerationalShip(),
    "source generational ship",
  );

  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredShip = assertNotNull(
    restoredGame.simulation.emigrationManager.getActiveGenerationalShip(),
    "restored generational ship",
  );
  // Pin the id round-trip + the stationManager lookup. Mutating
  // restoreSavedGame's restoreStations to drop the gen ship would resolve the
  // id but return undefined for the lookup.
  assertEqual(restoredShip.id, sourceShip.id, "generational ship id preserved");
  assertEqual(restoredShip.stationType.id, "generational-ship", "restored ship is the gen-ship type");
});

test("clockSeconds, mode, intensity, nextGenerationalShipArrivalAtSeconds all roundtrip", () => {
  // The full-snapshot test in savegame-snapshot.test.ts catches drift via
  // JSON compare. This pins the individual fields so a regression names the
  // specific drift.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  source.simulation.emigrationManager.setIntensity("high");
  // Drive clockSeconds past zero by ticking.
  source.simulation.slowSimulationTick(15);
  // Force a jump so nextGenerationalShipArrivalAtSeconds becomes a non-null number.
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "low" }),
    "event",
  );
  event.shipsArrived = event.totalExpectedShips;
  source.simulation.slowSimulationTick(1);
  const sourceArrival = source.simulation.emigrationManager.getNextGenerationalShipArrivalAt();
  assertTrue(sourceArrival !== null, "preconditions: nextGenerationalShipArrivalAtSeconds scheduled");

  // Capture source state before setupFreshTestGame destroys source's sim.
  const sourceState = source.simulation.emigrationManager.toSnapshot();
  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredState = restoredGame.simulation.emigrationManager.toSnapshot();
  assertEqual(restoredState.clockSeconds, sourceState.clockSeconds, "clockSeconds preserved");
  assertEqual(restoredState.mode, "manual", "mode preserved");
  assertEqual(restoredState.intensity, "high", "intensity preserved");
  assertEqual(
    restoredState.nextGenerationalShipArrivalAtSeconds,
    sourceArrival,
    "nextGenerationalShipArrivalAtSeconds preserved",
  );
});

test("fromSnapshot leaves per-station progressFraction at 0 (deferred sync)", () => {
  // Per fromSnapshot's comment: progressFraction / arrivalFraction stay at
  // their snapshotted values until the first slow simulation tick re-runs
  // syncStationCaches with seeded managers. progressFraction is NOT in the
  // snapshot, so the snapshot-restored value is the initial 0 from
  // emigrationFromSnapshot — pin that.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "high" }),
    "event",
  );

  // Tick to drive progressFraction past zero (some launches happen, syncStationCaches updates).
  for (let i = 0; i < 3; i++) {
    source.simulation.slowSimulationTick(1);
  }

  const eventStationId = event.stationIds[0];
  // Capture source progress before setupFreshTestGame destroys source's sim.
  const sourceStation = assertNotUndefined(
    source.simulation.stationManager.getStation(eventStationId),
    "source station",
  );
  const sourceProgress = assertNotNull(sourceStation.emigrationEvent, "source emigration").progressFraction;

  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  // Find the restored station via game.stations (stationManager not yet re-seeded
  // for this assertion path — and the deferred-sync claim is about state
  // immediately after restoreSavedGame, before any tick).
  const restoredStation = assertNotUndefined(
    restoredGame.stations.find((station) => station.id === eventStationId),
    "restored station",
  );
  const restoredProgress = assertNotNull(
    restoredStation.emigrationEvent,
    "restored emigration",
  ).progressFraction;
  assertEqual(restoredProgress, 0, "progressFraction at 0 immediately after load (deferred sync)");
  assertTrue(sourceProgress >= 0 && sourceProgress <= 1, "source progressFraction is in [0,1]");
});

test("homed-ship membership + count survive save/load when only the Set is serialized", () => {
  // StationEmigration carries only initialHomedShipIdSet (the parallel array
  // was removed). It serializes as [...set] and is rebuilt as a Set on load.
  // This pins that the full save round-trip preserves exact membership and
  // size — a codec/derivation regression (e.g. serializing the wrong field or
  // dropping the Set rebuild) would change membership post-load.
  const source = setupFreshTestGame();
  source.simulation.emigrationManager.setMode("manual");
  const event = assertNotNull(
    source.simulation.emigrationManager.triggerEvent({ intensity: "high" }),
    "event triggered",
  );

  // Find an event station that actually had homed trade ships at trigger so
  // the membership assertion isn't vacuous.
  let homedStationId: string | null = null;
  let expectedHomedIds: string[] = [];
  for (const stationId of event.stationIds) {
    const station = assertNotUndefined(
      source.simulation.stationManager.getStation(stationId),
      `station ${stationId}`,
    );
    const emigration = assertNotNull(station.emigrationEvent, `station ${stationId} emigration`);
    if (emigration.initialHomedShipIdSet.size > 0) {
      homedStationId = stationId;
      expectedHomedIds = [...emigration.initialHomedShipIdSet];
      break;
    }
  }
  assertTrue(homedStationId !== null, "at least one event station had homed ships at trigger");

  const snapshot = captureSnapshot(source);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredStation = assertNotUndefined(
    restoredGame.stations.find((station) => station.id === homedStationId),
    "restored homed station",
  );
  const restoredEmigration = assertNotNull(
    restoredStation.emigrationEvent,
    "restored emigration state",
  );
  assertEqual(
    restoredEmigration.initialHomedShipIdSet.size,
    expectedHomedIds.length,
    "homed-ship count survives save/load",
  );
  for (const shipId of expectedHomedIds) {
    assertTrue(
      restoredEmigration.initialHomedShipIdSet.has(shipId),
      `homed ship ${shipId} present in restored Set`,
    );
  }
});
