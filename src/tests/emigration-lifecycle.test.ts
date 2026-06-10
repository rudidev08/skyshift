import { test, assertEqual, assertTrue, assertNotUndefined, assertNotNull } from "./test-utils.ts";
import { type Simulation } from "../sim-lifecycle.ts";
import { sizeMultiplierBySize } from "../../data/stations.ts";
import {
  EMIGRANT_SHIPS_PER_STATION_BASE,
  computeEmigrationFraction,
  retireUnlaunched,
} from "../sim-emigration-types.ts";
import type { EmigrationEvent } from "../sim-emigration-types.ts";
import type { StationEmigration } from "../sim-station-types.ts";
import { emptyZoneCount } from "../sim-emigration-decision.ts";
import { filterZonesForOccupants } from "../sim-map-create.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { createSettledSimulation } from "./sim-test-fixtures.ts";
import { makeSyntheticDecommissionEvent, emitSyntheticDecommission } from "./factories.ts";

// Pins emigration end-to-end live flow:
//   trigger → ferry launches → station demolitions → WAY jump → POST_JUMP_GAP
// Covers sim-emigration-manager.ts AND sim-emigration-start.ts launch math.
// Save/load mid-event lives in emigration-save-load.test.ts.

function createManualEmigrationSimulation(): Simulation {
  // Manual mode so auto-trigger doesn't fire mid-test; settled preset gives
  // enough stations across BIO/HUB/ORE/SKY/FAR for selection to land somewhere.
  const simulation = createSettledSimulation();
  simulation.emigrationManager.setMode("manual");
  return simulation;
}

function makeStationEmigration(overrides: Partial<StationEmigration> = {}): StationEmigration {
  return {
    eventId: "E1",
    destinationName: "Test",
    initialHomedShipIdSet: new Set(["s1", "s2"]),
    totalEmigrants: 8,
    launched: 3,
    secondsUntilNextLaunch: 1,
    progressFraction: 0,
    ...overrides,
  };
}

test("trigger creates an active event with the expected nation/station roster", () => {
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  const generationalShip = assertNotNull(
    simulation.emigrationManager.getActiveGenerationalShip(),
    "generational ship present after init",
  );

  assertTrue(event !== null, "triggerEvent returns a non-null event");
  assertEqual(simulation.emigrationManager.getActiveEvent(), event, "getActiveEvent matches");
  assertEqual(
    event!.generationalShipId,
    generationalShip.id,
    "event references the active generational ship",
  );
  assertTrue(event!.stationIds.length > 0, "event has at least one selected station");
  assertTrue(event!.nationIds.length > 0, "event has at least one nation");
  // Pin that every station id in the event maps to a real station and has
  // emigrationEvent state attached. Mutating beginStationEmigration to skip
  // the per-station write would leave these undefined.
  for (const stationId of event!.stationIds) {
    const station = assertNotUndefined(
      simulation.stationManager.getStation(stationId),
      `event station ${stationId}`,
    );
    assertEqual(station.state, "emigrating", `${stationId} flipped to emigrating`);
    assertNotNull(station.emigrationEvent, `${stationId}.emigrationEvent attached`);
  }

  simulation.destroy();
});

test("trigger sets the event id from the next-event counter", () => {
  // generateCounterId formats as "EMIG-000001" for the first counter increment.
  // Pin that the counter starts at 0 and the first triggered event picks up id #1.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "first trigger succeeds");
  assertTrue(event!.id.startsWith("EMIG-"), `id has EMIG prefix; got ${event!.id}`);
  assertTrue(event!.id.endsWith("000001"), `first event id ends in -000001; got ${event!.id}`);

  simulation.destroy();
});

test("trigger refuses a second event while one is active", () => {
  const simulation = createManualEmigrationSimulation();
  const first = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(first !== null, "first trigger fires");
  // Pin the early-return on this.activeEvent !== null. A second triggerEvent
  // call must return null without touching state.
  const second = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertEqual(second, null, "second trigger returns null while first active");
  assertEqual(simulation.emigrationManager.getActiveEvent(), first, "active event unchanged");

  simulation.destroy();
});

test("totalExpectedShips equals BASE × sizeMultiplier summed across picked stations + pre-existing homed", () => {
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  // Pin the formula in beginStationEmigration:
  //   per station: BASE * sizeMultiplier + initialHomedShipIdSet.size
  // Mutating BASE or dropping the homed count would diverge from this sum.
  let expectedTotal = 0;
  for (const stationId of event!.stationIds) {
    const station = assertNotUndefined(
      simulation.stationManager.getStation(stationId),
      `station ${stationId}`,
    );
    const emigrationState = assertNotNull(station.emigrationEvent, `station ${stationId} emigration state`);
    const sizeMultiplier = sizeMultiplierBySize[station.size];
    expectedTotal += EMIGRANT_SHIPS_PER_STATION_BASE * sizeMultiplier;
    expectedTotal += emigrationState.initialHomedShipIdSet.size;
    assertEqual(
      emigrationState.totalEmigrants,
      EMIGRANT_SHIPS_PER_STATION_BASE * sizeMultiplier,
      `${stationId} totalEmigrants = BASE × sizeMultiplier`,
    );
  }
  assertEqual(
    event!.totalExpectedShips,
    expectedTotal,
    "event.totalExpectedShips equals the per-station sum",
  );

  simulation.destroy();
});

test("pre-existing homed trade ships get a fly+decommission tail appended on trigger", () => {
  // beginStationEmigration walks each picked station's pre-existing homed
  // trade ships and queueFerryToGenerationalShip's onto each. Pin that the
  // last two actions on each homed ship are now fly + decommission targeting
  // the generational ship.
  const simulation = createManualEmigrationSimulation();
  const generationalShip = assertNotNull(
    simulation.emigrationManager.getActiveGenerationalShip(),
    "gen ship",
  );
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  let checkedAtLeastOne = false;
  for (const stationId of event!.stationIds) {
    const homedShips = simulation.tradeManager.getTradeShipsByHomeStationId(stationId);
    for (const tradeShip of homedShips) {
      // initialStaggerDurationSeconds: 0 means homed ships have already started executing
      // their queues; the ferry+decommission tail is appended at the end.
      const queue = tradeShip.actionQueue;
      const decommissionAction = queue[queue.length - 1];
      const flyAction = queue[queue.length - 2];
      // Pin that decommission targets the generational ship — without this,
      // the homed ship would never increment shipsArrived and WAY would wait
      // forever.
      assertEqual(
        decommissionAction?.type,
        "decommission",
        `last action is decommission for ${tradeShip.orbitingShipId}`,
      );
      if (decommissionAction?.type === "decommission") {
        assertEqual(
          decommissionAction.station.id,
          generationalShip.id,
          "decommission targets generational ship",
        );
      }
      assertEqual(flyAction?.type, "fly", "second-to-last action is fly");
      checkedAtLeastOne = true;
    }
  }
  assertTrue(checkedAtLeastOne, "at least one event-station had homed ships to verify");

  simulation.destroy();
});

test("tick spawns emigrant ferry ships at the configured per-second cadence", () => {
  // EMIGRANT_LAUNCH_INTERVAL_SECONDS = 1; first tick fires 2 launches because
  // secondsUntilNextLaunch starts at 0 (subtract delta → -1 → loop runs twice
  // before sec lands above 0). Subsequent 1-second ticks fire 1 launch each.
  // Pin: 5 ticks of 1 second → 6 launches per station.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "event triggered");

  for (let tickIndex = 0; tickIndex < 5; tickIndex++) {
    simulation.slowSimulationTick(1);
  }

  for (const stationId of event!.stationIds) {
    const station = assertNotUndefined(
      simulation.stationManager.getStation(stationId),
      `station ${stationId}`,
    );
    const emigrationState = assertNotNull(station.emigrationEvent, `${stationId}.emigrationEvent`);
    // Pin the loop's `<=` boundary. Mutating to `<` would drop the first-tick
    // double-launch and the count would be 5 instead of 6.
    const expected = Math.min(6, emigrationState.totalEmigrants);
    assertEqual(emigrationState.launched, expected, `${stationId} launched ${expected} after 5 sim-seconds`);
  }

  simulation.destroy();
});

test("tick stops launching once a station's launched count reaches its planned total", () => {
  // launchEmigrantsForStation early-returns when launched >= totalEmigrants.
  // Pin the cap: with M-size stations (totalEmigrants = 20), tick 60 seconds
  // and verify launched stays at 20.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "event triggered");

  // Tick well past any station's totalEmigrants cap.
  for (let tickIndex = 0; tickIndex < 60; tickIndex++) {
    simulation.slowSimulationTick(1);
  }

  // Some stations may already be demolished after launch+departure complete —
  // but the others' launched should equal totalEmigrants exactly.
  for (const stationId of event!.stationIds) {
    const station = simulation.stationManager.getStation(stationId);
    if (!station) continue; // already demolished
    const emigrationState = assertNotNull(station.emigrationEvent, `${stationId}.emigrationEvent`);
    assertEqual(
      emigrationState.launched,
      emigrationState.totalEmigrants,
      `${stationId} launched count caps at totalEmigrants`,
    );
  }

  simulation.destroy();
});

test("ferry arriving at the generational ship increments shipsArrived (decommission observer)", () => {
  // Fire a synthesized DecommissionEvent for an event-station's homed ship
  // and verify activeEvent.shipsArrived increments. Mutating the homeStationId
  // check inside onShipDecommissioned would skip the increment.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  const before = event!.shipsArrived;
  const eventStationId = event!.stationIds[0];

  // Fan out a synthetic DecommissionEvent through the trade manager's
  // observer list — same path the real flow hits when a ferry arrives.
  const synthetic = makeSyntheticDecommissionEvent(
    "synthetic-ship",
    eventStationId,
    event!.generationalShipId,
  );
  emitSyntheticDecommission(simulation, synthetic);

  assertEqual(event!.shipsArrived, before + 1, "shipsArrived incremented for event-station decommission");

  simulation.destroy();
});

test("decommission of a non-event ship does NOT increment shipsArrived", () => {
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "event triggered");

  // Pick a station that is NOT in the event roster. settled preset has many
  // stations; find one whose id is not in event.stationIds.
  let nonEventStationId: string | null = null;
  for (const station of simulation.stationManager.getStations()) {
    if (!event!.stationIdSet.has(station.id)) {
      nonEventStationId = station.id;
      break;
    }
  }
  assertTrue(nonEventStationId !== null, "found a station not in the event roster");

  const before = event!.shipsArrived;
  const synthetic = makeSyntheticDecommissionEvent(
    "non-event-ship",
    nonEventStationId!,
    event!.generationalShipId,
  );
  emitSyntheticDecommission(simulation, synthetic);

  // Pin the homeStationId membership check. Mutating
  // `stationIdSet.has(homeStationId)` to its negation would increment for
  // non-event ships and shorten the wait-for-jump arbitrarily.
  assertEqual(event!.shipsArrived, before, "shipsArrived unchanged for non-event-station decommission");

  simulation.destroy();
});

test("WAY jump fires when shipsArrived reaches totalExpectedShips and clears active event", () => {
  // jumpGenerationalShipAway removes the generational ship, clears activeEvent, and
  // schedules the next gen-ship arrival at clockSeconds + POST_JUMP_GAP. Force the
  // shipsArrived counter to total and run one tick to fire the jump check.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "event triggered");
  const generationalShipId = event!.generationalShipId;

  // Force the arrival count high so the next tick's jump check trips.
  event!.shipsArrived = event!.totalExpectedShips;
  const clockSecondsBeforeJump = simulation.emigrationManager.getClockSeconds();
  simulation.slowSimulationTick(1);

  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "activeEvent cleared after jump");
  assertEqual(
    simulation.stationManager.getStation(generationalShipId),
    undefined,
    "generational ship removed from roster",
  );
  // Pin POST_JUMP_GAP scheduling. Mutating the `+ POST_JUMP_GAP_SECONDS` in
  // jumpGenerationalShipAway (e.g. dropping it) would let next-arrival fire immediately
  // and double up generational ships.
  const nextArrival = simulation.emigrationManager.getNextGenerationalShipArrivalAt();
  assertTrue(nextArrival !== null, "next gen-ship arrival scheduled");
  // clockSeconds advanced by 1 inside slowSimulationTick, so use the post-tick clockSeconds.
  assertEqual(
    nextArrival,
    clockSecondsBeforeJump + 1 + simulation.emigrationManager.getPostJumpGapSeconds(),
    "next arrival = clockSeconds + POST_JUMP_GAP",
  );

  simulation.destroy();
});

test("POST_JUMP_GAP throttles auto-trigger — no new event fires while gap is in effect", () => {
  // Auto mode + gap pending must not trigger a second event before the gap
  // elapses. Pin `if (this.nextGenerationalShipArrivalAtSeconds !== null) return;`
  // in triggerAutoEmigrationEventIfDue.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "first event triggered");
  event!.shipsArrived = event!.totalExpectedShips;
  simulation.slowSimulationTick(1); // jumpGenerationalShipAway fires; nextGenerationalShipArrivalAtSeconds scheduled.
  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "first event ended");

  // Switch to auto so the auto-trigger path activates. Tick well past
  // anything that would normally trigger — but still within the POST_JUMP_GAP.
  simulation.emigrationManager.setMode("auto");
  simulation.slowSimulationTick(60); // 1 minute, way under 3-hour gap

  // No new generational ship arrived yet, so no event can fire either.
  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "no new event during gap");
  assertEqual(simulation.emigrationManager.getActiveGenerationalShip(), null, "no gen ship during gap");

  simulation.destroy();
});

test("after POST_JUMP_GAP elapses, a fresh generational ship arrives and a new event can trigger", () => {
  // Once clockSeconds ≥ nextGenerationalShipArrivalAtSeconds, spawnNextGenerationalShipIfDue
  // creates a new generational ship and clears nextGenerationalShipArrivalAtSeconds.
  // Pin the gate by ticking exactly to the scheduled arrival time.
  const simulation = createManualEmigrationSimulation();
  const firstEvent = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(firstEvent !== null, "first event triggered");
  firstEvent!.shipsArrived = firstEvent!.totalExpectedShips;
  simulation.slowSimulationTick(1); // jump fires; nextGenerationalShipArrivalAtSeconds now scheduled.

  // Advance the clock so it lands EXACTLY on the scheduled arrival second, not
  // past it. Pin `clockSeconds < nextArrival` (spawn fires when the clock
  // reaches the arrival). A `<=` mutation would defer the spawn one tick, so the
  // ship would still be absent at this exact-boundary tick.
  const scheduledArrival = assertNotNull(
    simulation.emigrationManager.getNextGenerationalShipArrivalAt(),
    "next-arrival scheduled after jump",
  );
  const clockBeforeArrivalTick = simulation.emigrationManager.getClockSeconds();
  simulation.slowSimulationTick(scheduledArrival - clockBeforeArrivalTick);
  assertEqual(
    simulation.emigrationManager.getClockSeconds(),
    scheduledArrival,
    "clock advanced to exactly the scheduled arrival second",
  );
  assertTrue(
    simulation.emigrationManager.getActiveGenerationalShip() !== null,
    "fresh generational ship arrives the moment the clock reaches the scheduled arrival",
  );
  assertEqual(
    simulation.emigrationManager.getNextGenerationalShipArrivalAt(),
    null,
    "next-arrival timer cleared after spawn",
  );

  // Now a manual trigger can succeed.
  simulation.emigrationManager.setMode("manual");
  const secondEvent = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(secondEvent !== null, "second event triggered after gap");
  assertTrue(secondEvent!.id !== firstEvent!.id, "second event has a fresh id");
  assertTrue(secondEvent!.id.endsWith("000002"), `second event id ends in -000002; got ${secondEvent!.id}`);

  simulation.destroy();
});

test("station demolition removes the station from StationManager and rebuilds the ware-station-index", () => {
  // demolishFinishedStations fires removeStationForEmigration once a station's
  // launches complete and all its initial homed ships have departed. Verify
  // both effects: the station is removed from StationManager.byId, and the
  // wareStationIndex no longer lists it.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  // Pick a station from the event and force its emigration state into a
  // demolishable shape: launched === total AND no initial homed ships still docked.
  const targetStationId = event!.stationIds[0];
  const station = assertNotUndefined(
    simulation.stationManager.getStation(targetStationId),
    "target station present",
  );
  const emigrationState = station.emigrationEvent;
  if (emigrationState === null) throw new Error("target emigration state should be set");
  emigrationState.launched = emigrationState.totalEmigrants;
  // Clear the initialHomedShipIdSet so the "still docked" check sees zero
  // remaining — equivalent to all homed ships having already departed.
  emigrationState.initialHomedShipIdSet.clear();

  // Confirm the producer/consumer index has the station before demolition (it
  // is "emigrating" so canStationTrade=false; should already be excluded).
  // Capture a ware this station produces to sanity-check after demolition.
  const producedWareId = station.stationType.produces[0];

  // Snapshot the ships still at this station before demolition. The ferry-vs-build
  // distinction matters here: removeStationForEmigration must NOT despawn them
  // (they hold a decommission action queued for the gen ship). If a mutation
  // calls shipManager.removeShipsForStation by mistake, the ferries disappear
  // and shipsArrived would never increment.
  const shipsAtStationBefore = simulation.shipManager.getShipsForStation(station);

  simulation.slowSimulationTick(1);

  assertEqual(simulation.stationManager.getStation(targetStationId), undefined, "station removed from byId");
  // Pin the rebuildWareIndex call inside unregisterStation. Without it, the
  // index would still reference the removed station.
  if (producedWareId) {
    const producers = simulation.tradeManager.wareStationIndex.getProducers(producedWareId);
    for (const producerStation of producers) {
      assertTrue(
        producerStation.id !== targetStationId,
        `removed station absent from producers[${producedWareId}]`,
      );
    }
  }
  // Pin that removeStationForEmigration does NOT despawn ships. The ferries
  // have a decommission queued; despawning them mid-flight would stall
  // shipsArrived forever. The pre-snapshot ships must all still resolve.
  for (const ship of shipsAtStationBefore) {
    assertEqual(
      simulation.shipManager.getShip(ship.id),
      ship,
      `ferry ship ${ship.id} still alive after emigration removal`,
    );
  }

  simulation.destroy();
});

test("emigration demolition frees a preset-seeded station's site for a new build", () => {
  // End-to-end equal-treatment guarantee: a site seeded by the map preset,
  // emptied through the real emigration pipeline (launches complete → slow
  // tick → removeStationForEmigration), must come back as buildable and accept
  // a new placeBuild — exactly like a site claimed mid-session. Pre-fix,
  // preset zones were stripped from the tracked list at map creation and
  // their sites were retired forever.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  const presetStationIds = new Set(settledPreset.presetStations.map((entry) => entry.stationId));
  const target = assertNotUndefined(
    event!.stationIds
      .map((stationId) => simulation.stationManager.getStation(stationId))
      .find((station) => station !== undefined && presetStationIds.has(station.id)),
    "event picked at least one preset-seeded station",
  );
  const zoneId = assertNotUndefined(target.zoneId, "preset station carries its zone claim");

  const emigrationState = target.emigrationEvent;
  if (emigrationState === null) throw new Error("target emigration state should be set");
  emigrationState.launched = emigrationState.totalEmigrants;
  emigrationState.initialHomedShipIdSet.clear();
  simulation.slowSimulationTick(1);
  assertEqual(simulation.stationManager.getStation(target.id), undefined, "station demolished");

  const freedZone = assertNotUndefined(
    filterZonesForOccupants(simulation.map.stationZones, simulation.stationManager.getStations()).find(
      (zone) => zone.id === zoneId,
    ),
    "freed preset site is offered as buildable again",
  );

  const { station: rebuilt } = simulation.stationManager.placeBuild({
    zoneId: freedZone.id,
    typeId: "habitat",
    size: freedZone.size,
    nationId: "bio",
    x: freedZone.x,
    y: freedZone.y,
  });
  assertEqual(rebuilt.zoneId, freedZone.id, "new station claims the freed site");
  assertTrue(
    !filterZonesForOccupants(simulation.map.stationZones, simulation.stationManager.getStations()).some(
      (zone) => zone.id === freedZone.id,
    ),
    "rebuilt site counts as occupied again",
  );

  simulation.destroy();
});

test("station demolition is gated on still-docked initial homed ships", () => {
  // demolishFinishedStations continues (skips demolition) when any initial
  // homed ship is not in flight. Pin the gate by setting launched===total but
  // keeping a homed ship docked.
  const simulation = createManualEmigrationSimulation();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  // Find an event station that has at least one homed trade ship.
  let targetStationId: string | null = null;
  for (const stationId of event!.stationIds) {
    const homed = simulation.tradeManager.getTradeShipsByHomeStationId(stationId);
    if (homed.size > 0) {
      targetStationId = stationId;
      break;
    }
  }
  assertTrue(targetStationId !== null, "found event station with homed ships");

  const station = assertNotUndefined(
    simulation.stationManager.getStation(targetStationId!),
    "target station",
  );
  const emigrationState = assertNotNull(station.emigrationEvent, "emigration state");
  emigrationState.launched = emigrationState.totalEmigrants;
  // Don't clear the homed set — the gate should keep the station alive.

  // Park homed ships at the station: clear any in-flight state.
  const homed = simulation.tradeManager.getTradeShipsByHomeStationId(targetStationId!);
  for (const tradeShip of homed) {
    tradeShip.flight = null; // not in flight → still docked at home
  }

  simulation.slowSimulationTick(1);
  // Pin "anyStillDocked → continue". A mutation that flipped the gate would
  // demolish prematurely.
  assertNotUndefined(
    simulation.stationManager.getStation(targetStationId!),
    "station survives while homed ships still docked",
  );

  simulation.destroy();
});

test("triggering with zero eligible posts a toast and leaves activeEvent null", () => {
  // selectStationsForEmigration returns 0 selected when nothing eligible
  // (e.g., before generational ship). Pin the toast-set + early-return.
  const simulation = createManualEmigrationSimulation();
  // Force every nation into "no producing stations" by setting all stations to
  // emigrating (canStationTrade false for all, so eligibility=0).
  simulation.stationManager.setStationStates(simulation.stationManager.getStations(), "emigrating");

  const result = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertEqual(result, null, "trigger returns null when zero eligible");
  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "no active event");
  const toast = simulation.emigrationManager.takePendingToast();
  assertTrue(toast !== null && toast.length > 0, "pending toast surfaced");
  // Pin takePendingToast clears the slot. Without `this.pendingToast = null`,
  // the same message would replay on every poll and the player would see a
  // permanently-stuck toast.
  assertEqual(
    simulation.emigrationManager.takePendingToast(),
    null,
    "second take returns null (toast cleared)",
  );

  simulation.destroy();
});

test("auto-trigger fires at the empty-zone threshold boundary (>= versus > matters)", () => {
  // Pin `emptyZoneCount > autoTriggerThreshold` (not `>=`). Mutating to
  // `>= threshold` would skip the trigger at empty == threshold, leaving the
  // player stuck with no auto-emigration even when zones are scarce.
  const simulation = createManualEmigrationSimulation();
  const threshold = simulation.emigrationManager.getAutoTriggerThreshold();
  // Mode starts manual in createManualEmigrationSimulation. Fill zones (one placeBuild
  // per zone) until emptyZoneCount drops to threshold + 1, then verify
  // auto-trigger DOESN'T fire. Then one more placeBuild lands empty at
  // threshold; verify it DOES.
  const freeZones = simulation.map.stationZones.filter(
    (zone) => !simulation.stationManager.getStations().some((station) => station.zoneId === zone.id),
  );
  let zoneIndex = 0;
  while (emptyZoneCount(simulation.map, simulation.stationManager) > threshold + 1) {
    const zone = freeZones[zoneIndex++];
    if (zone === undefined) throw new Error("ran out of free zones before reaching threshold");
    simulation.stationManager.placeBuild({
      zoneId: zone.id,
      typeId: "habitat",
      size: "S",
      nationId: "bio",
      x: zone.x,
      y: zone.y,
    });
  }

  assertEqual(
    emptyZoneCount(simulation.map, simulation.stationManager),
    threshold + 1,
    "drained empty zones to threshold + 1",
  );

  simulation.emigrationManager.setMode("auto");
  simulation.slowSimulationTick(1);
  assertEqual(
    simulation.emigrationManager.getActiveEvent(),
    null,
    "no auto event at empty == threshold + 1 (above the boundary)",
  );

  const oneMore = freeZones[zoneIndex];
  simulation.stationManager.placeBuild({
    zoneId: oneMore.id,
    typeId: "habitat",
    size: "S",
    nationId: "bio",
    x: oneMore.x,
    y: oneMore.y,
  });
  assertEqual(
    emptyZoneCount(simulation.map, simulation.stationManager),
    threshold,
    "one more build lands empty at the threshold boundary",
  );
  simulation.slowSimulationTick(1);
  assertTrue(
    simulation.emigrationManager.getActiveEvent() !== null,
    "auto event fires at empty == threshold (boundary inclusive in the trigger)",
  );

  simulation.destroy();
});

test("computeEmigrationFraction: completed = launched + (initialHomed - stillDocked); returns fraction over total", () => {
  // Pin the math. Mutating the `homedDeparted` subtraction to addition would
  // let progressFraction climb past 1 even before any ship departed; the
  // Math.min clamp would mask that at the endpoints, but mid-range values
  // would be wrong.
  const emigrationState = makeStationEmigration();
  // 8 emigrants + 2 homed = 10 expected. 3 launched + 1 homed departed = 4 done.
  assertEqual(
    computeEmigrationFraction(emigrationState, emigrationState.initialHomedShipIdSet, 1),
    4 / 10,
    "completed/total with 3 launched, 1 of 2 homed departed",
  );
  // All homed still docked, no launches → 0 done.
  assertEqual(
    computeEmigrationFraction({ ...emigrationState, launched: 0 }, emigrationState.initialHomedShipIdSet, 2),
    0,
    "no progress when nothing launched and all homed docked",
  );
  // All launched + all homed departed → 1.
  assertEqual(
    computeEmigrationFraction({ ...emigrationState, launched: 8 }, emigrationState.initialHomedShipIdSet, 0),
    1,
    "full completion = 1",
  );
});

test("computeEmigrationFraction: clamps out-of-range values to [0, 1]", () => {
  // Pin both Math.max(0, ...) and Math.min(1, ...) clamps. The HUD reads
  // `progressFraction` straight into a 0..1 progress bar; an unclamped value
  // would render as negative width or overflow the bar. The reads here pass
  // intentionally pathological inputs that drive `completed/totalRequired`
  // outside [0, 1] — dropping either clamp lets that out-of-range value through.
  const baseEmigrationState = makeStationEmigration({ totalEmigrants: 4, launched: 0, secondsUntilNextLaunch: 0 });
  // launched > totalEmigrants pushes `completed / totalRequired` above 1.
  // 12 launched + 2 homed-departed = 14 over 4 + 2 = 6 → 14/6 ≈ 2.33. Min clamp pins it to 1.
  assertEqual(
    computeEmigrationFraction({ ...baseEmigrationState, launched: 12 }, baseEmigrationState.initialHomedShipIdSet, 0),
    1,
    "Math.min(1, …) clamps over-completion to 1",
  );
  // homedStillDocked > initialHomed.size makes homedDeparted negative; combined
  // with 0 launched, completed drops below 0. 0 + (2 - 5) = -3 over 6 → -0.5.
  // Max clamp pins it to 0.
  assertEqual(
    computeEmigrationFraction(baseEmigrationState, baseEmigrationState.initialHomedShipIdSet, 5),
    0,
    "Math.max(0, …) clamps under-completion to 0",
  );
});

test("computeEmigrationFraction: returns 1 when station had nothing to send (no emigrants, no homed)", () => {
  // Pin the totalRequired === 0 short-circuit. Without it, the division
  // would yield NaN, propagating into render-cached progressFraction.
  const emigrationState = makeStationEmigration({
    initialHomedShipIdSet: new Set(),
    totalEmigrants: 0,
    launched: 0,
    secondsUntilNextLaunch: 0,
  });
  assertEqual(
    computeEmigrationFraction(emigrationState, emigrationState.initialHomedShipIdSet, 0),
    1,
    "0/0 case returns 1",
  );
});

test("retireUnlaunched: drops abandoned ships off totalExpectedShips so WAY doesn't wait on phantoms", () => {
  // Pin the `-= abandoned` sign. Mutating to `+= abandoned` would inflate
  // totalExpectedShips, and the WAY jump gate (shipsArrived >= totalExpectedShips)
  // would never trip — the player would wait forever for ships the nation never had.
  const emigrationState = makeStationEmigration({
    initialHomedShipIdSet: new Set(),
    totalEmigrants: 10,
    launched: 3,
    secondsUntilNextLaunch: 0,
  });
  const event: EmigrationEvent = {
    id: "E1",
    nationIds: ["bio"],
    generationalShipId: "WAY-001",
    stationIds: ["S1"],
    stationIdSet: new Set(["S1"]),
    shipsArrived: 0,
    totalExpectedShips: 10,
    destinationName: "Test",
  };
  retireUnlaunched(emigrationState, event);
  // 10 planned - 3 launched = 7 abandoned. totalExpectedShips drops to 3,
  // matching the actual launched count.
  assertEqual(emigrationState.totalEmigrants, 3, "totalEmigrants shrinks to launched count");
  assertEqual(event.totalExpectedShips, 3, "totalExpectedShips drops by the abandoned (7) count");
});

test("triggering an emigration event clears trade-route history but leaves the 20-day station log intact", () => {
  const simulation = createManualEmigrationSimulation();
  const tradeManager = simulation.tradeManager;

  // Record a synthetic delivery so there is history to clear.
  tradeManager.tradeRouteStats.recordDelivery({
    timeSeconds: tradeManager.tradeTimeSeconds,
    fromStationId: "ROUTE-FROM",
    toStationId: "ROUTE-TO",
    wareId: "water",
    fillFraction: 0.5,
  });
  assertEqual(
    tradeManager.getTradedRoutes(tradeManager.tradeTimeSeconds, Infinity).length,
    1,
    "synthetic delivery is in trade history before emigration",
  );

  const stationLogBefore = simulation.stationHistory.toSnapshot().length;
  assertTrue(stationLogBefore > 0, "initial stations are recorded in the 20-day station log");

  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "emigration event triggered");

  assertEqual(
    tradeManager.getTradedRoutes(tradeManager.tradeTimeSeconds, Infinity).length,
    0,
    "trade-route history cleared on emigration trigger",
  );
  assertEqual(
    simulation.stationHistory.toSnapshot().length,
    stationLogBefore,
    "20-day station log untouched by the trade-history clear",
  );

  simulation.destroy();
});
