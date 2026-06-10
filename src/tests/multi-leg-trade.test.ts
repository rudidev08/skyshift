import {
  test,
  assertEqual,
  assertTrue,
  assertNotNull,
  assertNotUndefined,
  assertActionType,
} from "./test-utils.ts";
import { type Simulation } from "../sim-lifecycle.ts";
import { createSettledSimulation } from "./sim-test-fixtures.ts";
import { startTrip } from "../sim-trade-queue.ts";
import { getInventorySlot } from "../sim-station.ts";
import type { TradeShip, TradeTransferEvent } from "../sim-trade-types.ts";
import type { TradeTripLeg } from "../sim-trade-types.ts";
import { findShipHomedAt, findShipWithRoundTrip } from "./trade-test-fixtures.ts";

// End-to-end trade chain crossing multiple sim ticks. Exercises the full
// pipeline: trade decision → queue building → travel → cargo transfer ×
// 1-or-2 legs → reservation cleanup. Catches cross-module drift that
// single-file tests can't.
//
// Note on 2-leg trips: pickSecondaryLeg requires the target to produce a
// ware that the home consumes — the current data files have a strictly
// hierarchical economy chain (raw → refined → final), so no two stations
// form a 2-cycle. Tests that need 2-leg behavior construct legs manually
// via startTrip (which only checks slot existence, not direction sanity).
// 1-leg natural trips still exercise most of the queue + reservation logic.

/** Build a synthetic 2-leg round trip between a medical-lab home and a habitat
 *  target — both have `medicine` and `food` slots, so startTrip's slot-existence
 *  check passes. */
function createSyntheticTwoLegTrip(simulation: Simulation): { ship: TradeShip; legs: TradeTripLeg[] } | null {
  // BIO-M (Rootspire, medical-lab) — produces medicine, consumes mineral + food.
  // BIO-H (Thornvale, habitat) — produces provisions, consumes food + medicine.
  // Both stations have medicine + food slots → 2-leg construction is legal.
  const home = simulation.stationManager.getStation("BIO-M");
  const target = simulation.stationManager.getStation("BIO-H");
  if (!home || !target) return null;
  // Find a trade ship homed at BIO-M.
  const ship = findShipHomedAt(simulation, "BIO-M");
  if (!ship) return null;
  // Confirm both wares' slots exist at both stations (sanity check).
  if (!getInventorySlot(home, "medicine") || !getInventorySlot(home, "food")) return null;
  if (!getInventorySlot(target, "medicine") || !getInventorySlot(target, "food")) return null;
  const legs: TradeTripLeg[] = [
    { wareId: "medicine", amount: 50, fromStation: home, toStation: target },
    { wareId: "food", amount: 50, fromStation: target, toStation: home },
  ];
  return { ship, legs };
}

function requireNaturalTrip(simulation: Simulation): { ship: TradeShip; legs: TradeTripLeg[] } {
  const candidate = findShipWithRoundTrip(simulation);
  return assertNotUndefined(candidate ?? undefined, "natural trip available");
}

function requireSyntheticTwoLegTrip(simulation: Simulation): { ship: TradeShip; legs: TradeTripLeg[] } {
  const candidate = createSyntheticTwoLegTrip(simulation);
  return assertNotUndefined(candidate ?? undefined, "synthetic two-leg trip available");
}

interface CargoActionCounts {
  homeDeposits: number;
  targetDeposits: number;
  homeWithdrawals: number;
  targetWithdrawals: number;
}

function countCargoActionsByStation(ship: TradeShip): CargoActionCounts {
  const counts: CargoActionCounts = {
    homeDeposits: 0,
    targetDeposits: 0,
    homeWithdrawals: 0,
    targetWithdrawals: 0,
  };
  for (const action of ship.actionQueue) {
    if (action.type === "cargo-deposit") {
      if (action.station.id === ship.homeStationId) counts.homeDeposits++;
      else counts.targetDeposits++;
    }
    if (action.type === "cargo-withdrawal") {
      if (action.station.id === ship.homeStationId) counts.homeWithdrawals++;
      else counts.targetWithdrawals++;
    }
  }
  return counts;
}

test("startTrip with 2 legs places 4 reservations (outgoing + incoming for each)", () => {
  const simulation = createSettledSimulation();
  const { ship, legs } = requireSyntheticTwoLegTrip(simulation);

  const reservationsBefore = ship.reservations.length;
  startTrip(ship, legs, simulation.tradeManager);

  // 2 legs × 2 directions (outgoing source, incoming destination) = 4 reservations.
  // Pin the loop in startTrip — dropping outgoing OR incoming branch would halve.
  assertEqual(ship.reservations.length, reservationsBefore + 4, "4 reservations placed");

  let outgoing = 0;
  let incoming = 0;
  for (const reservation of ship.reservations) {
    if (reservation.cargoDirection === "outgoing") outgoing++;
    if (reservation.cargoDirection === "incoming") incoming++;
  }
  assertEqual(outgoing, 2, "2 outgoing reservations (source per leg)");
  assertEqual(incoming, 2, "2 incoming reservations (destination per leg)");

  simulation.tradeManager.destroy();
});

test("2-leg trip queue: contains both home withdrawals and home deposits (round trip with backhaul)", () => {
  // Round-trip queue when there's home cargo to load AND target cargo to bring back.
  // Pin the queue's high-level shape: home dock + withdrawal, fly to target,
  // target dock + deposit + withdrawal, fly home, home dock + deposit, orbit home.
  const simulation = createSettledSimulation();
  const { ship, legs } = requireSyntheticTwoLegTrip(simulation);

  startTrip(ship, legs, simulation.tradeManager);

  // Count actions by type. Pin the structure that distinguishes 2-leg from 1-leg:
  // a 2-leg trip has cargo-deposits at BOTH home and target (one for each leg's
  // toStation). A 1-leg trip has only one of them.
  const counts = countCargoActionsByStation(ship);
  assertEqual(counts.homeWithdrawals, 1, "leg 0 fromStation=home → 1 home withdrawal");
  assertEqual(counts.targetDeposits, 1, "leg 0 toStation=target → 1 target deposit");
  assertEqual(counts.targetWithdrawals, 1, "leg 1 fromStation=target → 1 target withdrawal");
  assertEqual(counts.homeDeposits, 1, "leg 1 toStation=home → 1 home deposit");

  simulation.tradeManager.destroy();
});

test("startTrip: reservedOutgoing/reservedIncoming counters bump on stations at trip start", () => {
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);

  const sourceSlot = assertNotUndefined(getInventorySlot(legs[0].fromStation, legs[0].wareId), "source slot");
  const destinationSlot = assertNotUndefined(
    getInventorySlot(legs[0].toStation, legs[0].wareId),
    "dest slot",
  );
  const sourceReservedOutgoingBefore = sourceSlot.reservedOutgoing;
  const destinationReservedIncomingBefore = destinationSlot.reservedIncoming;

  startTrip(ship, legs, simulation.tradeManager);

  // Pin the slot-counter mutations. A startTrip mutation that placed
  // ship-only reservations without touching slot counters would let the
  // economy's available-supply math double-book.
  assertEqual(
    sourceSlot.reservedOutgoing,
    sourceReservedOutgoingBefore + legs[0].amount,
    "source slot reservedOutgoing bumped by leg amount",
  );
  assertEqual(
    destinationSlot.reservedIncoming,
    destinationReservedIncomingBefore + legs[0].amount,
    "destination slot reservedIncoming bumped by leg amount",
  );

  simulation.tradeManager.destroy();
});

test("trade-transfer observers fire with correct cargoDirection (outgoing at source, incoming at dest)", () => {
  // Source emits "outgoing" event when the ship withdraws; destination emits
  // "incoming" event when the ship deposits. Pin the cargoDirection rule.
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);

  const events: TradeTransferEvent[] = [];
  const unsubscribe = simulation.tradeManager.addTradeTransferObserver((event) => {
    if (event.ship === ship) events.push(event);
  });
  startTrip(ship, legs, simulation.tradeManager);

  // Tick generously past flight + dock durations.
  for (let tickIndex = 0; tickIndex < 1500; tickIndex++) {
    simulation.tradeManager.tick(1);
  }

  unsubscribe();

  // Pin the cargoDirection rule. Mutating the deposit observer's
  // cargoDirection from "incoming" to "outgoing" would invert direction
  // counters everywhere downstream.
  let outgoingCount = 0;
  let incomingCount = 0;
  for (const event of events) {
    if (event.cargoDirection === "outgoing") outgoingCount++;
    if (event.cargoDirection === "incoming") incomingCount++;
  }
  assertTrue(outgoingCount >= 1, "at least one outgoing transfer (cargo loaded at source)");
  assertTrue(incomingCount >= 1, "at least one incoming transfer (cargo delivered at dest)");

  simulation.tradeManager.destroy();
});

test("trip end-to-end: ship cargo drained and original reservation cleared", () => {
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);

  startTrip(ship, legs, simulation.tradeManager);

  // Long tick budget — even longest trips finish well within 4000 sim-seconds.
  for (let tickIndex = 0; tickIndex < 4000; tickIndex++) {
    simulation.tradeManager.tick(1);
  }

  // Cargo emptied (ship orbits at home, no held cargo).
  let totalCargo = 0;
  for (const amount of ship.cargoAmountByWareId.values()) totalCargo += amount;
  assertEqual(totalCargo, 0, "ship cargo drained at trip end");

  // The original leg 0 reservation has been fulfilled and cleared on the ship.
  let stillReserved = false;
  for (const reservation of ship.reservations) {
    if (
      reservation.station === legs[0].fromStation &&
      reservation.wareId === legs[0].wareId &&
      reservation.cargoDirection === "outgoing" &&
      reservation.amount === legs[0].amount
    )
      stillReserved = true;
  }
  assertEqual(stillReserved, false, "leg 0 outgoing reservation cleared");

  simulation.tradeManager.destroy();
});

test("2-leg trip: per-ware reservations stay isolated to their station/direction (no cross-ware leakage)", () => {
  const simulation = createSettledSimulation();
  const { ship, legs } = requireSyntheticTwoLegTrip(simulation);

  // Pin per-ware reservation isolation. After startTrip:
  //   - medicine: outgoing on BIO-M (home), incoming on BIO-H (target)
  //   - food:     outgoing on BIO-H (target), incoming on BIO-M (home)
  // Cross-ware leakage would put medicine reservation on food's slot or vice versa.
  const home = legs[0].fromStation; // BIO-M
  const target = legs[0].toStation; // BIO-H
  const homeMedicineSlot = assertNotUndefined(getInventorySlot(home, "medicine"), "home medicine slot");
  const homeFoodSlot = assertNotUndefined(getInventorySlot(home, "food"), "home food slot");
  const targetMedicineSlot = assertNotUndefined(getInventorySlot(target, "medicine"), "target medicine slot");
  const targetFoodSlot = assertNotUndefined(getInventorySlot(target, "food"), "target food slot");

  // Captured before startTrip — slots may carry pre-existing reservations from the natural sim,
  // so the cross-direction check below asserts startTrip's amount didn't add to the wrong direction.
  const homeMedicineIncomingBefore = homeMedicineSlot.reservedIncoming;

  startTrip(ship, legs, simulation.tradeManager);

  assertTrue(homeMedicineSlot.reservedOutgoing >= 50, "home has outgoing medicine reservation");
  assertTrue(targetMedicineSlot.reservedIncoming >= 50, "target has incoming medicine reservation");
  assertTrue(targetFoodSlot.reservedOutgoing >= 50, "target has outgoing food reservation");
  assertTrue(homeFoodSlot.reservedIncoming >= 50, "home has incoming food reservation");

  assertEqual(
    homeMedicineSlot.reservedIncoming,
    homeMedicineIncomingBefore,
    "trip didn't add incoming on home medicine (would be wrong direction)",
  );

  simulation.tradeManager.destroy();
});

test("startTrip: tradeDirection is 'sell' when first leg starts at home, 'buy' otherwise", () => {
  // Pin the tradeDirection ternary in startTrip.
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);

  startTrip(ship, legs, simulation.tradeManager);

  const expectedDirection = legs[0].fromStation.id === ship.homeStationId ? "sell" : "buy";
  assertEqual(
    ship.tradeDirection,
    expectedDirection,
    `firstLeg.fromStation=${legs[0].fromStation.id}, home=${ship.homeStationId} → tradeDirection=${expectedDirection}`,
  );
  const expectedTarget =
    legs[0].fromStation.id === ship.homeStationId ? legs[0].toStation.id : legs[0].fromStation.id;
  assertEqual(ship.targetStationId, expectedTarget, "targetStationId is the non-home end of leg 0");

  simulation.tradeManager.destroy();
});

test("queue ends with an orbit-at-home local hop (ship lands in orbit, not on the surface)", () => {
  // Pin the trailing orbit hop. Mutating createQueueFromTrip to drop it would
  // park ships on the surface — visible at game level as idle ships drawn on
  // station bodies.
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);

  startTrip(ship, legs, simulation.tradeManager);

  const lastFly = assertActionType(
    ship.actionQueue[ship.actionQueue.length - 1],
    "fly",
    "last action is a fly hop",
  );
  assertEqual(lastFly.destination.stationId, ship.homeStationId, "last hop ends at home");
  assertEqual(lastFly.destination.surfaceOrOrbit, "orbit", "last hop ends in orbit");
  assertEqual(lastFly.travelMode, "local", "last hop is a local maneuver");

  simulation.tradeManager.destroy();
});

test("queue contains exactly 2 inter-station fly actions (home→target and target→home)", () => {
  // Pin the queue's between-stations flight count AND direction. Mutating
  // createQueueFromTrip to drop the return flight would leave the ship
  // stranded at the target; swapping the return-flight's source/destination
  // would route it the wrong direction and never bring the ship home.
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);
  const home = legs[0].fromStation.id === ship.homeStationId ? legs[0].fromStation : legs[0].toStation;
  const target = legs[0].fromStation.id === ship.homeStationId ? legs[0].toStation : legs[0].fromStation;

  startTrip(ship, legs, simulation.tradeManager);

  const interStationFlights: Array<{ from: string; to: string }> = [];
  for (const action of ship.actionQueue) {
    if (action.type === "fly" && action.travelMode === "interStation") {
      interStationFlights.push({ from: action.originStation.id, to: action.destinationStation.id });
    }
  }
  assertEqual(interStationFlights.length, 2, "2 inter-station flights (home→target and target→home)");
  // Pin direction. Swapping (origin, destination) for the return flight in
  // createQueueFromTrip would still produce 2 inter-station flies; the
  // from/to assertions catch the direction flip.
  assertEqual(interStationFlights[0].from, home.id, "first inter-station fly starts at home");
  assertEqual(interStationFlights[0].to, target.id, "first inter-station fly ends at target");
  assertEqual(interStationFlights[1].from, target.id, "second inter-station fly starts at target");
  assertEqual(interStationFlights[1].to, home.id, "second inter-station fly ends at home");

  simulation.tradeManager.destroy();
});

test("save mid-flight: ship.flight survives roundtrip and the queue tail remains intact", () => {
  // Tick partway through a trip and verify ship.flight reflects in-flight state.
  // Full save/load roundtrip is exercised in savegame-snapshot.test.ts; here
  // we pin the mid-flight observable shape that a snapshot captures.
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);

  startTrip(ship, legs, simulation.tradeManager);

  // Tick enough to reach mid-flight on first inter-station leg. Initial ticks
  // burst through dock + withdrawal (instant); next tick starts the fly.
  for (let tickIndex = 0; tickIndex < 5; tickIndex++) {
    simulation.tradeManager.tick(1);
  }

  // Pin that mid-flight ship has a flight object and a non-empty action queue.
  // The snapshot pipeline relies on both being capturable. assertNotUndefined
  // (instead of `if (ship.flight)`) makes the test fail loudly if 5 ticks
  // didn't actually land mid-flight — catching a fixture drift that would
  // otherwise let every assertion below pass vacuously.
  const flight = assertNotUndefined(ship.flight ?? undefined, "ship is mid-flight after 5 ticks");
  assertTrue(typeof flight.totalElapsedSeconds === "number", "flight has totalElapsedSeconds");
  assertTrue(["departing", "hyperjump", "arriving"].includes(flight.phase), "flight phase is non-complete");
  assertTrue(ship.actionQueue.length > 0, "queue tail remains for post-flight steps");

  simulation.tradeManager.destroy();
});

test("queue handles 1-leg trips: home dock → withdrawal → fly → target dock → deposit → fly → orbit home", () => {
  // 1-leg-specific structure — primary leg only, no homeDeposits since the
  // backhaul leg doesn't exist. Pin that the queue still has all the right
  // pieces: one home withdrawal, one target deposit, no home deposit.
  const simulation = createSettledSimulation();
  const { ship, legs } = requireNaturalTrip(simulation);
  // Natural trips are 1-leg with the current data files (no 2-cycles — see the
  // file header). Assert loudly so fixture drift can't skip the test silently.
  assertEqual(legs.length, 1, "natural trip on the settled fixture is 1-leg");

  startTrip(ship, legs, simulation.tradeManager);

  const counts = countCargoActionsByStation(ship);
  // 1-leg sell trip: home produces, target consumes.
  // Expected: homeWithdrawal=1, targetDeposit=1, no targetWithdrawal, no homeDeposit.
  // 1-leg buy trip: target produces, home consumes.
  // Expected: targetWithdrawal=1, homeDeposit=1, no homeWithdrawal, no targetDeposit.
  // Either way, exactly one withdrawal and one deposit total.
  assertEqual(counts.homeWithdrawals + counts.targetWithdrawals, 1, "1-leg trip has exactly 1 withdrawal");
  assertEqual(counts.homeDeposits + counts.targetDeposits, 1, "1-leg trip has exactly 1 deposit");

  simulation.tradeManager.destroy();
});

test("1-leg sell trip: no trailing home-dock wait when there are no home deposits", () => {
  // Pin `buckets.homeDeposits.length > 0` (strict > 0). A `>= 0` mutation
  // makes the home-deposits block always run, pushing an extra Dock: home
  // wait at the trip's tail with no deposits behind it. Observable shape:
  // last action before the orbit hop should be the return-flight fly, not
  // a wait.
  const simulation = createSettledSimulation();
  const candidate = findShipWithRoundTrip(
    simulation,
    (ship, legs) => legs.length === 1 && legs[0].fromStation.id === ship.homeStationId,
  );
  const { ship, legs } = assertNotNull(candidate, "1-leg sell trip available on the settled fixture");

  startTrip(ship, legs, simulation.tradeManager);

  // Last action is the orbit-hop local fly. Penultimate must be the
  // inter-station return fly — NOT a Dock: home wait that would only appear
  // when buckets.homeDeposits.length > 0.
  const queue = ship.actionQueue;
  const penultimateFly = assertActionType(
    queue[queue.length - 2],
    "fly",
    "penultimate action is a fly (no spurious home dock-wait at tail)",
  );
  assertEqual(penultimateFly.travelMode, "interStation", "penultimate fly is the return inter-station hop");

  simulation.tradeManager.destroy();
});

test("1-leg buy trip: outbound fly leaves from orbit (no home cargo to load → no surface dock at home)", () => {
  // Pin `needsHomeLanding = buckets.homeWithdrawals.length > 0` (strict > 0).
  // A `>= 0` mutation makes needsHomeLanding always true; the queue would
  // include an empty home dock-wait and the outbound fly's origin would be
  // "surface" instead of "orbit". This test pins the buy-trip happy path
  // where the queue must skip the home landing.
  const simulation = createSettledSimulation();
  // Find a ship whose natural trip is a 1-leg buy (target → home).
  const candidate = findShipWithRoundTrip(
    simulation,
    (ship, legs) => legs.length === 1 && legs[0].fromStation.id !== ship.homeStationId,
  );
  const { ship, legs } = assertNotNull(candidate, "1-leg buy trip available on the settled fixture");

  startTrip(ship, legs, simulation.tradeManager);

  // Find the first inter-station fly action in the queue. For a buy trip with
  // no home cargo to load, its origin should be the orbit endpoint at home.
  let firstInterStationFly = null;
  for (const action of ship.actionQueue) {
    if (action.type === "fly" && action.travelMode === "interStation") {
      firstInterStationFly = action;
      break;
    }
  }
  const outboundFly = assertNotNull(firstInterStationFly, "buy trip has an outbound inter-station fly");
  assertEqual(
    outboundFly.origin.surfaceOrOrbit,
    "orbit",
    "outbound fly leaves from orbit when no home cargo to load",
  );
  assertEqual(outboundFly.origin.stationId, ship.homeStationId, "outbound fly leaves from home");

  simulation.tradeManager.destroy();
});

test("Simulation.tick: drives economy production — counter on a non-zero-offset station advances", () => {
  // Pin the `tickEconomy(this.stations, ...)` call in Simulation.tick.
  // Skipping it would freeze production: stations' secondsSinceLastTick
  // would never change. Pick a station with a non-zero stagger offset
  // (the second station in the seed list is at offset -interval/N) so the
  // first delta advances the counter without firing production.
  const simulation = createSettledSimulation();
  // Pick a station whose stagger offset is well below 0 so a 0.1s tick
  // advances without crossing simulationIntervalSeconds.
  const stations = simulation.stationManager.getStations();
  let chosenStation = stations[0];
  for (const station of stations) {
    if (station.secondsSinceLastTick < -0.05) {
      chosenStation = station;
      break;
    }
  }
  assertTrue(chosenStation.secondsSinceLastTick < -0.05, "station with negative stagger offset present");
  const offsetBefore = chosenStation.secondsSinceLastTick;
  simulation.tick(0.1);
  // Pin: counter advanced by 0.1s (no production fire because offset still <0).
  const offsetAfter = chosenStation.secondsSinceLastTick;
  assertTrue(
    Math.abs(offsetAfter - (offsetBefore + 0.1)) < 1e-9,
    `tick advances station counter by 0.1s (was ${offsetBefore}, now ${offsetAfter})`,
  );

  simulation.destroy();
});
