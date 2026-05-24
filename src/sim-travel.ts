import type { ShipTypeTemplate } from "../data/ship-types";
import type { Station } from "./sim-station-types";
import { shipTravel, orbitApproachRadiusPixels } from "../data/ship-travel";
import { bodyRadiusBySize } from "../data/stations";
import type { TravelEndpoint, TravelMode } from "./sim-travel-types";

/** Sim-side flight state — phase, progress, timing, logical endpoints. Bezier
 *  geometry (start/end coords, curve angle) lives on the render side as
 *  FlightCurveGeometry; sim's progress math depends only on the fields here. */
export interface FlightData {
  /** Lifecycle phase: `departing` accelerates from rest (p²), `hyperjump` cruises
   *  at constant speed, `arriving` decelerates into dock (1-(1-p)²). Completion is
   *  the boolean return of `tickFlightData` — the caller nulls `ship.flight` the
   *  same tick, so no flight is ever observed in a post-arrival state. */
  phase: "departing" | "hyperjump" | "arriving";
  /** 0–1 fractional distance along the curve. */
  progress: number;
  origin: TravelEndpoint;
  destination: TravelEndpoint;
  phaseStartSeconds: number;
  totalElapsedSeconds: number;
  flightDurationSeconds: number;
  /** Fractional distance (0-1) for each phase boundary. */
  departDistanceFraction: number;
  flightDistanceFraction: number;
  arriveDistanceFraction: number;
  /** Inter-station flight (trail + ring pulse) vs local maneuver. */
  travelMode: TravelMode;
  /** Previous heading for smooth turning; null = no turn needed. */
  previousHeadingRadians: number | null;
}

/** Build a logical surface endpoint at the given station — the station
 *  center, paired with `createOrbitEndpoint`. */
export function createSurfaceEndpoint(station: Station): TravelEndpoint {
  return { stationId: station.id, surfaceOrOrbit: "surface" };
}

/** Build a logical orbit endpoint at the given station. Carries only station
 *  identity — render re-derives orbital position so flight endpoints survive
 *  saves regardless of in-orbit angle. */
export function createOrbitEndpoint(station: Station): TravelEndpoint {
  return { stationId: station.id, surfaceOrOrbit: "orbit" };
}

/** Position + station + endpoint for one side of a flight leg. Shared by the
 *  duration / phase-bounds / factory helpers so each side's three coupled
 *  fields stay grouped. */
export interface FlightLegEndpoint {
  position: { x: number; y: number };
  station: Station;
  endpoint: TravelEndpoint;
}

export interface ComputeFlightDurationInput {
  origin: { x: number; y: number };
  destination: { x: number; y: number };
  shipSpeedMultiplier: number;
  travelMode: TravelMode;
}

/** Flight duration in seconds. Caller resolves map coords from stations —
 *  sim doesn't store them. */
export function computeFlightDuration(input: ComputeFlightDurationInput): number {
  const deltaX = input.destination.x - input.origin.x;
  const deltaY = input.destination.y - input.origin.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const speed =
    input.travelMode === "interStation"
      ? shipTravel.baseFlightSpeedPixelsPerSecond * shipTravel.globalSpeed * input.shipSpeedMultiplier
      : shipTravel.baseFlightSpeedPixelsPerSecond * shipTravel.globalSpeed;
  return distance / speed;
}

interface PhaseBounds {
  departDistanceFraction: number;
  flightDistanceFraction: number;
  arriveDistanceFraction: number;
}

/** Phase-boundary fractions for a flight. Surface endpoints scale their
 *  approach/depart zone with station size; non-surface use a fixed zone. */
function computePhaseBounds(input: {
  origin: FlightLegEndpoint;
  destination: FlightLegEndpoint;
}): PhaseBounds {
  const { origin, destination } = input;
  const deltaX = destination.position.x - origin.position.x;
  const deltaY = destination.position.y - origin.position.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  const departZonePx =
    origin.endpoint.surfaceOrOrbit === "surface"
      ? bodyRadiusBySize[origin.station.size] * shipTravel.stationProximityZoneRadiusMultiplier
      : shipTravel.orbitApproachZonePixels;
  const arriveZonePx =
    destination.endpoint.surfaceOrOrbit === "surface"
      ? bodyRadiusBySize[destination.station.size] * shipTravel.stationProximityZoneRadiusMultiplier
      : shipTravel.orbitApproachZonePixels;

  // Cap each zone at 40% so short flights still get a hyperjump segment
  // (otherwise depart + arrive could swallow the whole trip).
  const departDistanceFraction = Math.min(departZonePx / distance, 0.4);
  const arriveDistanceFraction = Math.min(arriveZonePx / distance, 0.4);
  const flightDistanceFraction = 1 - departDistanceFraction - arriveDistanceFraction;

  return { departDistanceFraction, flightDistanceFraction, arriveDistanceFraction };
}

/** Resolve an endpoint to map coords. Surface = station center; orbit = +X
 *  offset by orbitApproachRadiusPixels. Used by sim for phase-bound math and by
 *  render as the default before applying orbit-pose adjustments. The orbit
 *  offset keeps distance math non-degenerate for same-station orbit↔surface
 *  flights (which would otherwise yield NaN headings). */
export function resolveEndpointPosition(
  endpoint: TravelEndpoint,
  station: Station,
): { x: number; y: number } {
  if (endpoint.surfaceOrOrbit === "surface") return { x: station.x, y: station.y };
  return { x: station.x + orbitApproachRadiusPixels, y: station.y };
}

export interface CreateFlightDataInput {
  origin: TravelEndpoint;
  destination: TravelEndpoint;
  originStation: Station;
  destinationStation: Station;
  ship: ShipTypeTemplate;
  travelMode: TravelMode;
  previousHeadingRadians?: number | null;
}

/** Build flight data for a single-leg flight. Station refs let sim compute
 *  duration and phase bounds without a render helper. */
export function createFlightData(input: CreateFlightDataInput): FlightData {
  const originLeg: FlightLegEndpoint = {
    position: resolveEndpointPosition(input.origin, input.originStation),
    station: input.originStation,
    endpoint: input.origin,
  };
  const destinationLeg: FlightLegEndpoint = {
    position: resolveEndpointPosition(input.destination, input.destinationStation),
    station: input.destinationStation,
    endpoint: input.destination,
  };
  const flightDurationSeconds = computeFlightDuration({
    origin: originLeg.position,
    destination: destinationLeg.position,
    shipSpeedMultiplier: input.ship.speed,
    travelMode: input.travelMode,
  });
  const phaseBounds = computePhaseBounds({ origin: originLeg, destination: destinationLeg });

  return {
    phase: "departing",
    progress: 0,
    origin: input.origin,
    destination: input.destination,
    phaseStartSeconds: 0,
    totalElapsedSeconds: 0,
    flightDurationSeconds,
    departDistanceFraction: phaseBounds.departDistanceFraction,
    flightDistanceFraction: phaseBounds.flightDistanceFraction,
    arriveDistanceFraction: phaseBounds.arriveDistanceFraction,
    travelMode: input.travelMode,
    previousHeadingRadians: input.previousHeadingRadians ?? null,
  };
}

/** Departing phase — accelerates from rest via p²; transitions to hyperjump when progress reaches departEnd. */
function tickDepartingPhase(flight: FlightData, departEnd: number): void {
  const phaseProgress = Math.min(1.0, flight.totalElapsedSeconds / shipTravel.accelerationDurationSeconds);
  const easedProgress = phaseProgress * phaseProgress;
  flight.progress = easedProgress * flight.departDistanceFraction;

  if (flight.progress >= departEnd) {
    flight.progress = departEnd;
    flight.phase = "hyperjump";
    flight.phaseStartSeconds = flight.totalElapsedSeconds;
  }
}

/** Hyperjump phase — constant speed; transition to arriving when phase progress reaches 1. */
function tickHyperjumpPhase(flight: FlightData, departEnd: number, hyperjumpEnd: number): void {
  const hyperjumpProgress = (flight.totalElapsedSeconds - flight.phaseStartSeconds) / flight.flightDurationSeconds;
  flight.progress = departEnd + hyperjumpProgress * flight.flightDistanceFraction;

  if (hyperjumpProgress >= 1.0) {
    flight.progress = hyperjumpEnd;
    flight.phase = "arriving";
    flight.phaseStartSeconds = flight.totalElapsedSeconds;
  }
}

/** Arriving phase — ease into destination; returns true when the flight completes. */
function tickArrivingPhase(flight: FlightData, hyperjumpEnd: number): boolean {
  const arrivingProgress = Math.min(
    1.0,
    (flight.totalElapsedSeconds - flight.phaseStartSeconds) / shipTravel.dockingDurationSeconds,
  );
  const easedProgress = 1 - (1 - arrivingProgress) * (1 - arrivingProgress);
  flight.progress = hyperjumpEnd + easedProgress * flight.arriveDistanceFraction;
  flight.progress = Math.min(1.0, flight.progress);

  return arrivingProgress >= 1.0;
}

/** Tick a flight forward by deltaSeconds. Returns true when the flight is complete. */
export function tickFlightData(flight: FlightData, deltaSeconds: number): boolean {
  flight.totalElapsedSeconds += deltaSeconds;

  const departEnd = flight.departDistanceFraction;
  const hyperjumpEnd = departEnd + flight.flightDistanceFraction;

  if (flight.phase === "departing") {
    tickDepartingPhase(flight, departEnd);
  } else if (flight.phase === "hyperjump") {
    tickHyperjumpPhase(flight, departEnd, hyperjumpEnd);
  } else if (flight.phase === "arriving") {
    return tickArrivingPhase(flight, hyperjumpEnd);
  }

  return false;
}
