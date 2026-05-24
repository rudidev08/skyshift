import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  createFlightData,
  createOrbitEndpoint,
  createSurfaceEndpoint,
  computeFlightDuration,
  tickFlightData,
  type FlightData,
} from "../sim-travel.ts";
import { shipTravel } from "../../data/ship-travel.ts";
import { tanker, trader } from "../../data/ships.ts";
import { createStation } from "../sim-station.ts";
import { makePlacedStation } from "./factories.ts";

// Pins flight phase math in sim-travel.ts. Phase math controls whether flights
// stall, complete early, or keep ships in inconsistent phase states; silent
// off-by-one in easing or boundary checks mis-renders every flight without throwing.

function createTestFlight(
  destinationX: number,
  destinationY: number,
): FlightData {
  // Surface→Surface, inter-station, trader speed. Distance long enough that
  // the 40% phase cap doesn't kick in (depart/arrive zones stay below 40%).
  const origin = createStation(
    makePlacedStation({ id: "ORIGIN", x: 0, y: 0, size: "S" }),
    0,
  );
  const destination = createStation(
    makePlacedStation({ id: "DEST", x: destinationX, y: destinationY, size: "S" }),
    0,
  );
  return createFlightData({
    origin: createSurfaceEndpoint(origin),
    destination: createSurfaceEndpoint(destination),
    originStation: origin,
    destinationStation: destination,
    ship: trader,
    travelMode: "interStation",
  });
}

test("computeFlightDuration scales linearly with distance", () => {
  const baseDuration = computeFlightDuration({
    origin: { x: 0, y: 0 },
    destination: { x: 100, y: 0 },
    shipSpeedMultiplier: 1,
    travelMode: "local",
  });
  const doubleDuration = computeFlightDuration({
    origin: { x: 0, y: 0 },
    destination: { x: 200, y: 0 },
    shipSpeedMultiplier: 1,
    travelMode: "local",
  });
  // Pin distance/speed ratio. Mutating the formula to skip distance would
  // collapse both durations to the same value.
  assertEqual(doubleDuration, baseDuration * 2, "double the distance, double the duration");
});

test("computeFlightDuration uses Euclidean distance (Pythagorean), not Manhattan", () => {
  // Mutating Math.sqrt(dx² + dy²) → (dx + dy) would change a 3-4-5 to a 7-7
  // and produce 7/speed instead of 5/speed.
  const duration = computeFlightDuration({
    origin: { x: 0, y: 0 },
    destination: { x: 30, y: 40 },
    shipSpeedMultiplier: 1,
    travelMode: "local",
  });
  const expected = 50 / (shipTravel.baseFlightSpeedPixelsPerSecond * shipTravel.globalSpeed);
  assertEqual(duration, expected, "Pythagorean distance — sqrt(3² + 4²) = 5");
});

test("computeFlightDuration interStation includes shipSpeedMultiplier; local does not", () => {
  // Pin the travelMode branch in computeFlightDuration. Mutating the ternary
  // would collapse the speed difference — ships would all fly at the same speed.
  const localDuration = computeFlightDuration({
    origin: { x: 0, y: 0 },
    destination: { x: 100, y: 0 },
    shipSpeedMultiplier: 5,
    travelMode: "local",
  });
  const interStationDuration = computeFlightDuration({
    origin: { x: 0, y: 0 },
    destination: { x: 100, y: 0 },
    shipSpeedMultiplier: 5,
    travelMode: "interStation",
  });
  // interStation speed = base * global * shipSpeedMultiplier; local speed = base * global.
  // So interStation duration = local duration / shipSpeedMultiplier.
  assertEqual(
    interStationDuration,
    localDuration / 5,
    "interStation runs shipSpeedMultiplier× faster than local",
  );
});

test("phase bounds: depart and arrive zones each cap at 40% of total flight (Math.min clamp)", () => {
  // Construct a tiny inter-station flight so the surface zones (≈48px each
  // at S size × 3 multiplier = 48px per side) would naturally exceed 40% of
  // the trip. The Math.min(…, 0.4) clamp must fire for both sides.
  const flight = createTestFlight(50, 0);
  // Pin the 40% cap on each side. Mutating Math.min(…, 0.4) → Math.min(…, 0.5)
  // would let the boundaries grow past 40% and shrink the hyperjump segment
  // toward zero (or negative).
  assertEqual(flight.departDistanceFraction, 0.4, "depart zone clamped to 40%");
  assertEqual(flight.arriveDistanceFraction, 0.4, "arrive zone clamped to 40%");
  assertTrue(flight.flightDistanceFraction > 0, "hyperjump segment stays positive");
  assertEqual(
    flight.departDistanceFraction + flight.flightDistanceFraction + flight.arriveDistanceFraction,
    1,
    "phase fractions sum to 1.0",
  );
});

test("phase bounds: short flight where depart+arrive would exceed total clamps without producing negative hyperjump fraction", () => {
  // 40% cap each side → at most 80% total → flightDistanceFraction at least 0.2.
  // Pin the lower bound on flightDistanceFraction. Removing the clamp would
  // let it go to zero (or negative), which would NaN/lock hyperjump progress.
  const flight = createTestFlight(1, 0);
  // Floating-point: 1 - 0.4 - 0.4 may compute as 0.1999...96 — accept within ε.
  assertTrue(
    flight.flightDistanceFraction >= 0.2 - 1e-9,
    `hyperjump fraction stays ≥ 0.2 (got ${flight.flightDistanceFraction})`,
  );
  assertTrue(flight.departDistanceFraction <= 0.4, "depart zone capped at 40%");
  assertTrue(flight.arriveDistanceFraction <= 0.4, "arrive zone capped at 40%");
});

test("phase bounds: orbit endpoints use the fixed 20-pixel approach zone, not station-size-scaled", () => {
  // surface = body radius × proximityMultiplier (e.g. S size = 16 × 3 = 48px);
  // orbit = fixed 20px regardless of size. Pin the branch by comparing two
  // flights of the same length where one uses orbit endpoints and the other
  // surface — depart/arrive fractions must differ.
  const distance = 1000; // long enough that neither flight hits the 40% cap.

  const surfaceOrigin = createStation(makePlacedStation({ id: "S-O", x: 0, y: 0, size: "S" }), 0);
  const surfaceDest = createStation(makePlacedStation({ id: "S-D", x: distance, y: 0, size: "S" }), 0);
  const surfaceFlight = createFlightData({
    origin: createSurfaceEndpoint(surfaceOrigin),
    destination: createSurfaceEndpoint(surfaceDest),
    originStation: surfaceOrigin,
    destinationStation: surfaceDest,
    ship: trader,
    travelMode: "interStation",
  });

  const orbitOrigin = createStation(makePlacedStation({ id: "O-O", x: 0, y: 0, size: "S" }), 0);
  const orbitDest = createStation(makePlacedStation({ id: "O-D", x: distance, y: 0, size: "S" }), 0);
  const orbitFlight = createFlightData({
    origin: createOrbitEndpoint(orbitOrigin),
    destination: createOrbitEndpoint(orbitDest),
    originStation: orbitOrigin,
    destinationStation: orbitDest,
    ship: trader,
    travelMode: "interStation",
  });

  // Pin the surface-vs-orbit branch. Surface zone for S=16 × 3 = 48px / 1000 = 0.048.
  // Orbit fixed = 20px / 1000 = 0.02. Different by construction.
  assertTrue(
    surfaceFlight.departDistanceFraction !== orbitFlight.departDistanceFraction,
    "surface and orbit produce different depart zones",
  );
  assertEqual(
    surfaceFlight.departDistanceFraction,
    48 / distance,
    "surface depart = body radius × multiplier / distance",
  );
  assertEqual(orbitFlight.departDistanceFraction, 20 / distance, "orbit depart = fixed 20 / distance");
  // Pin the destination side independently — depart and arrive use separate
  // surface/orbit checks. Flipping `destination.endpoint.surfaceOrOrbit === "surface"`
  // would only show on arriveDistanceFraction.
  assertEqual(
    surfaceFlight.arriveDistanceFraction,
    48 / distance,
    "surface arrive = body radius × multiplier / distance",
  );
  assertEqual(orbitFlight.arriveDistanceFraction, 20 / distance, "orbit arrive = fixed 20 / distance");
});

test("createFlightData starts with phase='departing', progress 0, totalElapsedSeconds 0", () => {
  const flight = createTestFlight(1000, 0);
  assertEqual(flight.phase, "departing", "starts in departing phase");
  assertEqual(flight.progress, 0, "starts at progress 0");
  assertEqual(flight.totalElapsedSeconds, 0, "starts at totalElapsedSeconds 0");
  assertEqual(flight.phaseStartSeconds, 0, "starts at phaseStartSeconds 0");
  // Pin null default for previousHeadingRadians. Render reads `flight.previousHeadingRadians !== null`
  // to gate smooth turning at flight start; mutating `?? null` to `?? 0` would
  // trigger turn-blending against a fake zero heading on first-flight ships.
  assertEqual(flight.previousHeadingRadians, null, "starts with previousHeadingRadians null");
});

test("tickFlightData: totalElapsedSeconds accumulates monotonically without reset between phases", () => {
  // Pin that totalElapsedSeconds is += deltaSeconds on every tick — never reset
  // when phaseStartSeconds advances. The hyperjump-progress math depends on the
  // delta `(totalElapsedSeconds - phaseStartSeconds)`, which is wrong if total resets.
  const flight = createTestFlight(1000, 0);
  let expectedTotalElapsedSeconds = 0;
  for (let stepIndex = 0; stepIndex < 30; stepIndex++) {
    tickFlightData(flight, 1);
    expectedTotalElapsedSeconds += 1;
    assertEqual(
      flight.totalElapsedSeconds,
      expectedTotalElapsedSeconds,
      `totalElapsedSeconds after ${stepIndex + 1} ticks`,
    );
  }
});

test("tickFlightData: departing phase eases via p² (ease-in, accelerating from rest)", () => {
  // Departing uses phaseProgress * phaseProgress as the eased curve — ease-in,
  // matching the physical intent of accelerating from zero speed. Pin both
  // the inversion-free shape and the squared exponent.
  const flight = createTestFlight(100000, 0);
  // accelerationDurationSeconds = 5; a 1.0s tick lands phaseProgress = 0.2.
  // easedProgress = 0.2² = 0.04. Then progress = 0.04 * departDistanceFraction.
  tickFlightData(flight, 1);
  // Pin the squared curve. Mutating p² → p (linear) would yield 0.2 * df, ~5x larger.
  // Mutating p² → 1-(1-p)² (ease-out) would yield 0.36 * df, ~9x larger.
  const expectedProgress = 0.04 * flight.departDistanceFraction;
  assertTrue(
    Math.abs(flight.progress - expectedProgress) < 1e-9,
    `expected progress ≈ ${expectedProgress}, got ${flight.progress}`,
  );
});

test("tickFlightData: departing → hyperjump transition fires when progress reaches departEnd", () => {
  // After accelerationDurationSeconds (5s), phaseProgress hits 1.0 and
  // easedProgress = 1.0, so progress reaches departDistanceFraction. Pin the
  // transition: phase flips to hyperjump, phaseStartSeconds updates.
  const flight = createTestFlight(100000, 0);
  tickFlightData(flight, shipTravel.accelerationDurationSeconds);
  // Pin the >= boundary on `progress >= departEnd`. A `> → >=` mutation
  // would skip the transition exactly at the edge.
  assertEqual(flight.phase, "hyperjump", "phase flipped to hyperjump");
  assertEqual(flight.progress, flight.departDistanceFraction, "progress pinned at departEnd");
  assertEqual(
    flight.phaseStartSeconds,
    shipTravel.accelerationDurationSeconds,
    "phaseStartSeconds captured at transition",
  );
});

test("tickFlightData: hyperjump phase has linear progress between departEnd and hyperjumpEnd", () => {
  // Hyperjump uses (totalElapsedSeconds - phaseStartSeconds) / flightDurationSeconds —
  // linear in time, so progress should grow at constant rate within this phase.
  const flight = createTestFlight(100000, 0);
  tickFlightData(flight, shipTravel.accelerationDurationSeconds); // → hyperjump
  const departEnd = flight.departDistanceFraction;

  // Tick 25% of the flight duration. Hyperjump progress = 0.25.
  const quarterDuration = flight.flightDurationSeconds * 0.25;
  tickFlightData(flight, quarterDuration);
  const expectedProgressQuarter = departEnd + 0.25 * flight.flightDistanceFraction;
  assertTrue(
    Math.abs(flight.progress - expectedProgressQuarter) < 1e-9,
    `quarter-way progress: expected ${expectedProgressQuarter}, got ${flight.progress}`,
  );

  // Another 25% → 50% of hyperjump.
  tickFlightData(flight, quarterDuration);
  const expectedProgressHalf = departEnd + 0.5 * flight.flightDistanceFraction;
  assertTrue(
    Math.abs(flight.progress - expectedProgressHalf) < 1e-9,
    `half-way progress: expected ${expectedProgressHalf}, got ${flight.progress}`,
  );
});

test("tickFlightData: hyperjump → arriving transition fires when hyperjumpProgress reaches 1.0", () => {
  // After flightDurationSeconds seconds in hyperjump, progress hits hyperjumpEnd
  // (= departEnd + flightDistanceFraction). Pin the transition.
  const flight = createTestFlight(100000, 0);
  tickFlightData(flight, shipTravel.accelerationDurationSeconds); // → hyperjump
  const departEnd = flight.departDistanceFraction;
  const hyperjumpEnd = departEnd + flight.flightDistanceFraction;

  tickFlightData(flight, flight.flightDurationSeconds);
  // Pin the >= 1.0 boundary in hyperjump progress check. A < mutation would
  // skip the transition at exactly t = flightDurationSeconds.
  assertEqual(flight.phase, "arriving", "phase flipped to arriving");
  assertEqual(flight.progress, hyperjumpEnd, "progress pinned at hyperjumpEnd");
});

test("tickFlightData: arriving phase eases via 1-(1-p)² (ease-out, decelerating into dock)", () => {
  // Arriving uses easedProgress = 1 - (1 - arriveProgress)² — ease-out,
  // matching the physical intent of decelerating into the destination.
  // Pin both the (1-p) inversion and the squared exponent.
  const flight = createTestFlight(100000, 0);
  // Skip to arriving phase by ticking past departing + hyperjump.
  tickFlightData(flight, shipTravel.accelerationDurationSeconds);
  tickFlightData(flight, flight.flightDurationSeconds);
  const hyperjumpEnd = flight.departDistanceFraction + flight.flightDistanceFraction;

  // Tick 1s into arriving. dockingDurationSeconds=5, so arriveProgress = 0.2.
  // easedProgress = 1 - (1-0.2)² = 1 - 0.64 = 0.36.
  tickFlightData(flight, 1);
  const expectedEased = 0.36;
  const expectedProgress = hyperjumpEnd + expectedEased * flight.arriveDistanceFraction;
  // Pin the formula. Mutating to p² (ease-in instead of ease-out) would yield
  // 0.04 instead of 0.36 — a 9x error.
  assertTrue(
    Math.abs(flight.progress - expectedProgress) < 1e-9,
    `expected progress ≈ ${expectedProgress}, got ${flight.progress}`,
  );
});

test("tickFlightData: arriving phase clamps progress to 1.0 (no overshoot)", () => {
  // The Math.min(1.0, flight.progress) clamp at the end of tickArrivingPhase
  // prevents floating-point drift from pushing progress past 1.0. Pin the clamp.
  const flight = createTestFlight(100000, 0);
  tickFlightData(flight, shipTravel.accelerationDurationSeconds);
  tickFlightData(flight, flight.flightDurationSeconds);
  // Tick well past dockingDurationSeconds.
  tickFlightData(flight, shipTravel.dockingDurationSeconds * 2);
  // Pin the upper-bound clamp. Mutating Math.min(1.0, …) → Math.max(1.0, …)
  // would let progress grow without bound.
  assertTrue(flight.progress <= 1, `progress clamped to 1.0; got ${flight.progress}`);
});

test("tickFlightData returns true on the tick that finishes the arriving phase", () => {
  // Only the arriving phase returns true at completion; pre-completion ticks
  // return false. Pin the return-value contract.
  const flight = createTestFlight(100000, 0);
  // Pre-completion ticks all return false.
  let flightCompleted = tickFlightData(flight, 1);
  assertEqual(flightCompleted, false, "departing tick returns false");
  // Skip to arriving and almost-finish.
  tickFlightData(flight, shipTravel.accelerationDurationSeconds);
  tickFlightData(flight, flight.flightDurationSeconds);
  flightCompleted = tickFlightData(flight, 1);
  assertEqual(flightCompleted, false, "mid-arrival tick returns false");
  // The completing tick. Completion is signaled only by the boolean return —
  // there is no "complete" phase, so the phase stays "arriving" (the caller
  // nulls ship.flight the same tick before any state is observable). Under the
  // OLD behavior this assertion fails: tickArrivingPhase set phase = "complete".
  flightCompleted = tickFlightData(flight, shipTravel.dockingDurationSeconds);
  assertEqual(flightCompleted, true, "completing tick returns true");
  assertEqual(flight.phase, "arriving", "phase is never mutated past arriving — completion is the boolean return");
});

test("tickFlightData with a different ship speed scales flightDurationSeconds accordingly", () => {
  // Pin ship-speed-multiplier propagation through computeFlightDuration. Mutating
  // `* input.shipSpeedMultiplier` to `* 1` would equalize fast/slow ships.
  const fastFlight = createTestFlight(1000, 0);
  // Build with a slower ship — tanker (speed 0.8) vs trader (speed 3.5).
  const origin = createStation(makePlacedStation({ id: "ORIGIN", x: 0, y: 0, size: "S" }), 0);
  const destination = createStation(makePlacedStation({ id: "DEST", x: 1000, y: 0, size: "S" }), 0);
  const slowFlight = createFlightData({
    origin: createSurfaceEndpoint(origin),
    destination: createSurfaceEndpoint(destination),
    originStation: origin,
    destinationStation: destination,
    ship: tanker,
    travelMode: "interStation",
  });
  // tanker.speed=0.8, trader.speed=3.5 → trader is 4.375× faster → fastFlight is shorter.
  const speedRatio = trader.speed / tanker.speed;
  assertTrue(
    Math.abs(slowFlight.flightDurationSeconds / fastFlight.flightDurationSeconds - speedRatio) < 1e-9,
    `slow/fast duration ratio = ${speedRatio}; got ${slowFlight.flightDurationSeconds / fastFlight.flightDurationSeconds}`,
  );
});
