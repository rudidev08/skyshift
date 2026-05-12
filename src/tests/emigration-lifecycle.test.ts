import { test, assertEqual, assertTrue, assertNotUndefined } from "./test-utils.ts";
import { createSimulation, type Simulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-builder.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { sizeMultiplierBySize } from "../../data/stations.ts";
import type { DecommissionEvent } from "../sim-trade-manager.ts";

// Pins emigration end-to-end live flow:
//   trigger → ferry launches → station demolitions → WAY jump → POST_JUMP_GAP
// Covers sim-emigration-manager.ts AND sim-emigration-start.ts launch math.
// Save/load mid-event lives in emigration-save-load.test.ts.

const EMIGRANT_SHIPS_PER_STATION_BASE = 10;
const POST_JUMP_GAP_SECONDS = 3 * 60 * 60;

function assertNotNull<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label}: expected non-null value`);
  return value;
}

function freshSim(): Simulation {
  // Manual mode so auto-trigger doesn't fire mid-test; settled preset gives
  // enough stations across BIO/HUB/ORE/SKY/FAR for selection to land somewhere.
  const simulation = createSimulation(
    createMapFromTemplate(settledUniverse, settledPreset),
    { ignoreCargoCompatibility: true, initialStaggerDuration: 0 },
  );
  simulation.emigrationManager.setMode("manual");
  return simulation;
}

test("trigger creates an active event with the expected nation/station roster", () => {
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  const generationalShip = assertNotNull(simulation.emigrationManager.getActiveGenerationalShip(), "generational ship present after init");

  assertTrue(event !== null, "triggerEvent returns a non-null event");
  assertEqual(simulation.emigrationManager.getActiveEvent(), event, "getActiveEvent matches");
  assertEqual(event!.generationalShipId, generationalShip.id, "event references the active generational ship");
  assertTrue(event!.stationIds.length > 0, "event has at least one selected station");
  assertTrue(event!.nationIds.length > 0, "event has at least one nation");
  // Pin that every station id in the event maps to a real station and has
  // emigrationEvent state attached. Mutating beginStationEmigration to skip
  // the per-station write would leave these undefined.
  for (const stationId of event!.stationIds) {
    const station = assertNotUndefined(simulation.stationManager.getStation(stationId), `event station ${stationId}`);
    assertEqual(station.state, "emigrating", `${stationId} flipped to emigrating`);
    assertNotNull(station.emigrationEvent, `${stationId}.emigrationEvent attached`);
  }

  simulation.dispose();
});

test("trigger sets the event id from the next-event counter", () => {
  // generateCounterId formats as "EMIG-000001" for the first counter increment.
  // Pin that the counter starts at 0 and the first triggered event picks up id #1.
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "first trigger succeeds");
  assertTrue(event!.id.startsWith("EMIG-"), `id has EMIG prefix; got ${event!.id}`);
  assertTrue(event!.id.endsWith("000001"), `first event id ends in -000001; got ${event!.id}`);

  simulation.dispose();
});

test("trigger refuses a second event while one is active (at-most-one invariant)", () => {
  const simulation = freshSim();
  const first = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(first !== null, "first trigger fires");
  // Pin the early-return on this.activeEvent !== null. A second triggerEvent
  // call must return null without touching state.
  const second = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertEqual(second, null, "second trigger returns null while first active");
  assertEqual(simulation.emigrationManager.getActiveEvent(), first, "active event unchanged");

  simulation.dispose();
});

test("totalExpectedShips equals BASE × sizeMultiplier summed across picked stations + pre-existing homed", () => {
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  // Pin the formula in beginStationEmigration:
  //   per station: BASE * sizeMultiplier + initialHomedShipIds.length
  // Mutating BASE or dropping the homed count would diverge from this sum.
  let expectedTotal = 0;
  for (const stationId of event!.stationIds) {
    const station = assertNotUndefined(simulation.stationManager.getStation(stationId), `station ${stationId}`);
    const emigrationState = assertNotNull(station.emigrationEvent, `station ${stationId} emigration state`);
    const sizeMultiplier = sizeMultiplierBySize[station.size];
    expectedTotal += EMIGRANT_SHIPS_PER_STATION_BASE * sizeMultiplier;
    expectedTotal += emigrationState.initialHomedShipIds.length;
    assertEqual(
      emigrationState.totalEmigrants,
      EMIGRANT_SHIPS_PER_STATION_BASE * sizeMultiplier,
      `${stationId} totalEmigrants = BASE × sizeMultiplier`,
    );
  }
  assertEqual(event!.totalExpectedShips, expectedTotal, "event.totalExpectedShips equals the per-station sum");

  simulation.dispose();
});

test("pre-existing homed trade ships get a fly+decommission tail appended on trigger", () => {
  // beginStationEmigration walks each picked station's pre-existing homed
  // trade ships and queueFerryToGenerationalShip's onto each. Pin that the
  // last two actions on each homed ship are now fly + decommission targeting
  // the generational ship.
  const simulation = freshSim();
  const generationalShip = assertNotNull(simulation.emigrationManager.getActiveGenerationalShip(), "gen ship");
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  let checkedAtLeastOne = false;
  for (const stationId of event!.stationIds) {
    const homedShips = simulation.tradeManager.getTradeShipsByHomeStationId(stationId);
    for (const tradeShip of homedShips) {
      // initialStaggerDuration: 0 means homed ships have already started executing
      // their queues; the ferry+decommission tail is appended at the end.
      const queue = tradeShip.actionQueue;
      const decommissionAction = queue[queue.length - 1];
      const flyAction = queue[queue.length - 2];
      // Pin that decommission targets the generational ship — without this,
      // the homed ship would never increment shipsArrived and WAY would wait
      // forever.
      assertEqual(decommissionAction?.type, "decommission", `last action is decommission for ${tradeShip.orbitingShipId}`);
      if (decommissionAction?.type === "decommission") {
        assertEqual(decommissionAction.station.id, generationalShip.id, "decommission targets generational ship");
      }
      assertEqual(flyAction?.type, "fly", "second-to-last action is fly");
      checkedAtLeastOne = true;
    }
  }
  assertTrue(checkedAtLeastOne, "at least one event-station had homed ships to verify");

  simulation.dispose();
});

test("tick spawns emigrant ferry ships at the configured per-second cadence", () => {
  // EMIGRANT_LAUNCH_INTERVAL_SECONDS = 1; first tick fires 2 launches because
  // secondsUntilNextLaunch starts at 0 (subtract delta → -1 → loop runs twice
  // before sec lands above 0). Subsequent 1-second ticks fire 1 launch each.
  // Pin: 5 ticks of 1 second → 6 launches per station.
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "event triggered");

  for (let secondIndex = 0; secondIndex < 5; secondIndex++) {
    simulation.tickDynamics(1);
  }

  for (const stationId of event!.stationIds) {
    const station = assertNotUndefined(simulation.stationManager.getStation(stationId), `station ${stationId}`);
    const emigrationState = assertNotNull(station.emigrationEvent, `${stationId}.emigrationEvent`);
    // Pin the loop's `<=` boundary. Mutating to `<` would drop the first-tick
    // double-launch and the count would be 5 instead of 6.
    const expected = Math.min(6, emigrationState.totalEmigrants);
    assertEqual(emigrationState.launched, expected, `${stationId} launched ${expected} after 5 sim-seconds`);
  }

  simulation.dispose();
});

test("tick stops launching once a station's launched count reaches its planned total", () => {
  // launchEmigrantsForStation early-returns when launched >= totalEmigrants.
  // Pin the cap: with M-size stations (totalEmigrants = 20), tick 30 seconds
  // and verify launched stays at 20.
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "event triggered");

  // Tick well past any station's totalEmigrants cap.
  for (let secondIndex = 0; secondIndex < 60; secondIndex++) {
    simulation.tickDynamics(1);
  }

  // Some stations may already be demolished after launch+departure complete —
  // but the others' launched should equal totalEmigrants exactly.
  for (const stationId of event!.stationIds) {
    const station = simulation.stationManager.getStation(stationId);
    if (!station) continue; // already demolished
    const emigrationState = assertNotNull(station.emigrationEvent, `${stationId}.emigrationEvent`);
    assertEqual(emigrationState.launched, emigrationState.totalEmigrants, `${stationId} launched count caps at totalEmigrants`);
  }

  simulation.dispose();
});

test("ferry arriving at the generational ship increments shipsArrived (decommission observer)", () => {
  // Fire a synthesized DecommissionEvent for an event-station's homed ship
  // and verify activeEvent.shipsArrived increments. Mutating the homeStationId
  // check inside onShipDecommissioned would skip the increment.
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  const before = event!.shipsArrived;
  const eventStationId = event!.stationIds[0];

  // Fan out a synthetic DecommissionEvent through the trade manager's
  // observer list — same path the real flow hits when a ferry arrives.
  const synthetic: DecommissionEvent = {
    tradeShip: { orbitingShipId: "synthetic-ship", homeStationId: eventStationId } as never,
    orbitingShip: { id: "synthetic-ship" } as never,
    orbitingShipId: "synthetic-ship",
    homeStationId: eventStationId,
    decommissionStationId: event!.generationalShipId,
    reason: "decommission-action",
  };
  for (const observer of simulation.tradeManager.decommissionObservers) observer(synthetic);

  assertEqual(event!.shipsArrived, before + 1, "shipsArrived incremented for event-station decommission");

  simulation.dispose();
});

test("decommission of a non-event ship does NOT increment shipsArrived", () => {
  const simulation = freshSim();
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
  const synthetic: DecommissionEvent = {
    tradeShip: { orbitingShipId: "non-event-ship", homeStationId: nonEventStationId! } as never,
    orbitingShip: { id: "non-event-ship" } as never,
    orbitingShipId: "non-event-ship",
    homeStationId: nonEventStationId!,
    decommissionStationId: event!.generationalShipId,
    reason: "decommission-action",
  };
  for (const observer of simulation.tradeManager.decommissionObservers) observer(synthetic);

  // Pin the homeStationId membership check. Mutating
  // `stationIdSet.has(homeStationId)` to its negation would increment for
  // non-event ships and shorten the wait-for-jump arbitrarily.
  assertEqual(event!.shipsArrived, before, "shipsArrived unchanged for non-event-station decommission");

  simulation.dispose();
});

test("WAY jump fires when shipsArrived reaches totalExpectedShips and clears active event", () => {
  // executeJump removes the generational ship, clears activeEvent, and
  // schedules the next gen-ship arrival at simTime + POST_JUMP_GAP. Force the
  // shipsArrived counter to total and run one tick to fire the jump check.
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "event triggered");
  const generationalShipId = event!.generationalShipId;

  // Force the arrival count high so the next tick's jump check trips.
  event!.shipsArrived = event!.totalExpectedShips;
  const simTimeBeforeJump = simulation.emigrationManager.getSimTime();
  simulation.tickDynamics(1);

  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "activeEvent cleared after jump");
  assertEqual(simulation.stationManager.getStation(generationalShipId), undefined, "generational ship removed from roster");
  // Pin POST_JUMP_GAP scheduling. Mutating the `+ POST_JUMP_GAP_SECONDS` in
  // executeJump (e.g. dropping it) would let next-arrival fire immediately
  // and double up generational ships.
  const nextArrival = simulation.emigrationManager.getNextGenerationalShipArrivalAt();
  assertTrue(nextArrival !== null, "next gen-ship arrival scheduled");
  // simTime advanced by 1 inside tickDynamics, so use the post-tick simTime.
  assertEqual(nextArrival, simTimeBeforeJump + 1 + POST_JUMP_GAP_SECONDS, "next arrival = simTime + POST_JUMP_GAP");

  simulation.dispose();
});

test("POST_JUMP_GAP throttles auto-trigger — no new event fires while gap is in effect", () => {
  // Auto mode + gap pending must not trigger a second event before the gap
  // elapses. Pin `if (this.nextGenerationalShipArrivalAt !== null) return;`
  // in triggerAutoEmigrationEventIfDue.
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(event !== null, "first event triggered");
  event!.shipsArrived = event!.totalExpectedShips;
  simulation.tickDynamics(1); // executeJump fires; nextGenerationalShipArrivalAt scheduled.
  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "first event ended");

  // Switch to auto so the auto-trigger path activates. Tick well past
  // anything that would normally trigger — but still within the POST_JUMP_GAP.
  simulation.emigrationManager.setMode("auto");
  simulation.tickDynamics(60); // 1 minute, way under 3-hour gap

  // No new generational ship arrived yet, so no event can fire either.
  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "no new event during gap");
  assertEqual(simulation.emigrationManager.getActiveGenerationalShip(), null, "no gen ship during gap");

  simulation.dispose();
});

test("after POST_JUMP_GAP elapses, a fresh generational ship arrives and a new event can trigger", () => {
  // Once simTime ≥ nextGenerationalShipArrivalAt, spawnNextGenerationalShipIfDue
  // creates a new generational ship and clears nextGenerationalShipArrivalAt.
  // Pin the gate by ticking through the gap.
  const simulation = freshSim();
  const firstEvent = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(firstEvent !== null, "first event triggered");
  firstEvent!.shipsArrived = firstEvent!.totalExpectedShips;
  simulation.tickDynamics(1); // jump fires
  // Tick through the gap. tickDynamics accepts seconds and advances simTime in one go.
  simulation.tickDynamics(POST_JUMP_GAP_SECONDS);
  // Then one more tick to pass the gap (simTime >= nextGenerationalShipArrivalAt).
  simulation.tickDynamics(1);
  assertTrue(simulation.emigrationManager.getActiveGenerationalShip() !== null, "fresh generational ship arrived after gap");
  assertEqual(simulation.emigrationManager.getNextGenerationalShipArrivalAt(), null, "next-arrival timer cleared after spawn");

  // Now a manual trigger can succeed.
  simulation.emigrationManager.setMode("manual");
  const secondEvent = simulation.emigrationManager.triggerEvent({ intensity: "low" });
  assertTrue(secondEvent !== null, "second event triggered after gap");
  assertTrue(secondEvent!.id !== firstEvent!.id, "second event has a fresh id");
  assertTrue(secondEvent!.id.endsWith("000002"), `second event id ends in -000002; got ${secondEvent!.id}`);

  simulation.dispose();
});

test("station demolition removes the station from StationManager and rebuilds the ware-station-index", () => {
  // checkStationDemolition fires removeStationForEmigration once a station's
  // launches complete and all its initial homed ships have departed. Verify
  // both effects: the station is removed from StationManager.byId, and the
  // wareStationIndex no longer lists it.
  const simulation = freshSim();
  const event = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertTrue(event !== null, "event triggered");

  // Pick a station from the event and force its emigration state into a
  // demolishable shape: launched === total AND no initial homed ships still docked.
  const targetStationId = event!.stationIds[0];
  const station = assertNotUndefined(simulation.stationManager.getStation(targetStationId), "target station present");
  const emigrationState = station.emigrationEvent;
  if (emigrationState === null) throw new Error("target emigration state should be set");
  emigrationState.launched = emigrationState.totalEmigrants;
  // Clear the initialHomedShipIdSet so the "still docked" check sees zero
  // remaining — equivalent to all homed ships having already departed.
  emigrationState.initialHomedShipIdSet.clear();
  emigrationState.initialHomedShipIds.length = 0;

  // Confirm the producer/consumer index has the station before demolition (it
  // is "emigrating" so canStationTrade=false; should already be excluded).
  // Capture a ware this station produces to sanity-check after demolition.
  const producedWareId = station.stationType.produces[0];

  simulation.tickDynamics(1);

  assertEqual(simulation.stationManager.getStation(targetStationId), undefined, "station removed from byId");
  // Pin the rebuildWareIndex call inside unregisterStation. Without it, the
  // index would still reference the removed station.
  if (producedWareId) {
    const producers = simulation.tradeManager.wareStationIndex.getProducers(producedWareId);
    for (const producerStation of producers) {
      assertTrue(producerStation.id !== targetStationId, `removed station absent from producers[${producedWareId}]`);
    }
  }

  simulation.dispose();
});

test("station demolition is gated on still-docked initial homed ships", () => {
  // checkStationDemolition continues (skips demolition) when any initial
  // homed ship is not in flight. Pin the gate by setting launched===total but
  // keeping a homed ship docked.
  const simulation = freshSim();
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

  const station = assertNotUndefined(simulation.stationManager.getStation(targetStationId!), "target station");
  const emigrationState = assertNotNull(station.emigrationEvent, "emigration state");
  emigrationState.launched = emigrationState.totalEmigrants;
  // Don't clear the homed set — the gate should keep the station alive.

  // Park homed ships at the station: clear any in-flight state.
  const homed = simulation.tradeManager.getTradeShipsByHomeStationId(targetStationId!);
  for (const tradeShip of homed) {
    tradeShip.flight = null; // not in flight → still docked at home
  }

  simulation.tickDynamics(1);
  // Pin "anyStillDocked → continue". A mutation that flipped the gate would
  // demolish prematurely.
  assertNotUndefined(simulation.stationManager.getStation(targetStationId!), "station survives while homed ships still docked");

  simulation.dispose();
});

test("triggering with zero eligible posts a toast and leaves activeEvent null", () => {
  // selectStationsForEmigration returns 0 selected when nothing eligible
  // (e.g., before generational ship). Pin the toast-set + early-return.
  const simulation = freshSim();
  // Force every nation into "no producing stations" by setting all stations to
  // emigrating (canStationTrade false for all, so eligibility=0).
  simulation.stationManager.setStationStates(simulation.stationManager.getStations(), "claimed");

  const result = simulation.emigrationManager.triggerEvent({ intensity: "high" });
  assertEqual(result, null, "trigger returns null when zero eligible");
  assertEqual(simulation.emigrationManager.getActiveEvent(), null, "no active event");
  const toast = simulation.emigrationManager.takePendingToast();
  assertTrue(toast !== null && toast.length > 0, "pending toast surfaced");

  simulation.dispose();
});
