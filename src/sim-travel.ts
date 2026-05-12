import type { ShipTemplate } from "../data/ship-types";
import type { Station } from "./sim-station-types";
import { shipTravel, ORBIT_APPROACH_RADIUS } from "../data/ship-travel";
import { bodyRadiusBySize } from "../data/stations";
import type { TravelEndpoint, TravelMode } from "./sim-travel-types";

/** Sim-side flight state — phase, progress, timing, logical endpoints. Bezier
 *  geometry (start/end coords, curve angle) lives on the render side as
 *  FlightRenderData; sim's progress math depends only on the fields here. */
export interface FlightData {
  /** Lifecycle phase: `departing` ease-out, `hyperjump` cruise, `arriving`
   *  ease-in, `complete` (consumed by caller). */
  phase: "departing" | "hyperjump" | "arriving" | "complete";
  /** 0–1 fractional distance along the curve. */
  progress: number;
  origin: TravelEndpoint;
  destination: TravelEndpoint;
  phaseStartTime: number;
  totalElapsedTime: number;
  flightDuration: number;
  /** Fractional distance (0-1) for each phase boundary. */
  departDistanceFraction: number;
  flightDistanceFraction: number;
  arriveDistanceFraction: number;
  /** Inter-station flight (trail + ring pulse) vs local maneuver. */
  travelMode: TravelMode;
  /** Previous heading for smooth turning; null = no turn needed. */
  prevHeading: number | null;
}

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
  nationSpeed: number;
  travelMode: TravelMode;
}

/** Flight duration in seconds. Caller resolves map coords from stations —
 *  sim doesn't store them. */
export function computeFlightDuration(input: ComputeFlightDurationInput): number {
  const dx = input.destination.x - input.origin.x;
  const dy = input.destination.y - input.origin.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = input.travelMode === "interStation"
    ? shipTravel.baseFlightSpeed * shipTravel.globalSpeed * input.nationSpeed
    : shipTravel.baseFlightSpeed * shipTravel.globalSpeed;
  return distance / speed;
}

interface PhaseBounds {
  departDistanceFraction: number;
  flightDistanceFraction: number;
  arriveDistanceFraction: number;
}

/** Phase-boundary fractions for a flight. Surface endpoints scale their
 *  approach/depart zone with station size; non-surface use a fixed zone. */
function computePhaseBounds(input: { origin: FlightLegEndpoint; destination: FlightLegEndpoint }): PhaseBounds {
  const { origin, destination } = input;
  const dx = destination.position.x - origin.position.x;
  const dy = destination.position.y - origin.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const departPx = origin.endpoint.surfaceOrOrbit === "surface"
    ? bodyRadiusBySize[origin.station.size] * shipTravel.stationProximityMultiplier
    : 20;
  const arrivePx = destination.endpoint.surfaceOrOrbit === "surface"
    ? bodyRadiusBySize[destination.station.size] * shipTravel.stationProximityMultiplier
    : 20;

  // Cap each zone at 40% so short flights still get a hyperjump segment
  // (otherwise depart + arrive could swallow the whole trip).
  const departDistanceFraction = Math.min(departPx / distance, 0.4);
  const arriveDistanceFraction = Math.min(arrivePx / distance, 0.4);
  const flightDistanceFraction = 1 - departDistanceFraction - arriveDistanceFraction;

  return { departDistanceFraction, flightDistanceFraction, arriveDistanceFraction };
}

/** Resolve an endpoint to map coords. Surface = station center; orbit = +X
 *  offset by ORBIT_APPROACH_RADIUS. Used by sim for phase-bound math and by
 *  render as the default before applying orbit-pose adjustments. The orbit
 *  offset keeps distance math non-degenerate for same-station orbit↔surface
 *  flights (which would otherwise yield NaN headings). */
export function resolveEndpointPos(endpoint: TravelEndpoint, station: Station): { x: number; y: number } {
  if (endpoint.surfaceOrOrbit === "surface") return { x: station.x, y: station.y };
  return { x: station.x + ORBIT_APPROACH_RADIUS, y: station.y };
}

export interface CreateFlightDataInput {
  origin: TravelEndpoint;
  destination: TravelEndpoint;
  originStation: Station;
  destinationStation: Station;
  ship: ShipTemplate;
  travelMode: TravelMode;
  prevHeading?: number | null;
}

/** Build flight data for a single-leg flight. Station refs let sim compute
 *  duration and phase bounds without a render helper. */
export function createFlightData(input: CreateFlightDataInput): FlightData {
  const originLeg: FlightLegEndpoint = {
    position: resolveEndpointPos(input.origin, input.originStation),
    station: input.originStation,
    endpoint: input.origin,
  };
  const destinationLeg: FlightLegEndpoint = {
    position: resolveEndpointPos(input.destination, input.destinationStation),
    station: input.destinationStation,
    endpoint: input.destination,
  };
  const flightDuration = computeFlightDuration({
    origin: originLeg.position,
    destination: destinationLeg.position,
    nationSpeed: input.ship.speed,
    travelMode: input.travelMode,
  });
  const phaseBounds = computePhaseBounds({ origin: originLeg, destination: destinationLeg });

  return {
    phase: "departing",
    progress: 0,
    origin: input.origin,
    destination: input.destination,
    phaseStartTime: 0,
    totalElapsedTime: 0,
    flightDuration,
    departDistanceFraction: phaseBounds.departDistanceFraction,
    flightDistanceFraction: phaseBounds.flightDistanceFraction,
    arriveDistanceFraction: phaseBounds.arriveDistanceFraction,
    travelMode: input.travelMode,
    prevHeading: input.prevHeading ?? null,
  };
}

/** Departing phase — ease out from origin; transition to hyperjump when progress reaches departEnd. */
function tickDepartingPhase(flight: FlightData, departEnd: number): void {
  const phaseProgress = Math.min(1.0, flight.totalElapsedTime / shipTravel.accelerationDurationSeconds);
  const easedProgress = phaseProgress * phaseProgress;
  flight.progress = easedProgress * flight.departDistanceFraction;

  if (flight.progress >= departEnd) {
    flight.progress = departEnd;
    flight.phase = "hyperjump";
    flight.phaseStartTime = flight.totalElapsedTime;
  }
}

/** Hyperjump phase — constant speed; transition to arriving when phase progress reaches 1. */
function tickHyperjumpPhase(flight: FlightData, departEnd: number, hyperjumpEnd: number): void {
  const hyperjumpProgress = (flight.totalElapsedTime - flight.phaseStartTime) / flight.flightDuration;
  flight.progress = departEnd + hyperjumpProgress * flight.flightDistanceFraction;

  if (hyperjumpProgress >= 1.0) {
    flight.progress = hyperjumpEnd;
    flight.phase = "arriving";
    flight.phaseStartTime = flight.totalElapsedTime;
  }
}

/** Arriving phase — ease into destination; returns true when the flight completes. */
function tickArrivingPhase(flight: FlightData, hyperjumpEnd: number): boolean {
  const arriveProgress = Math.min(1.0, (flight.totalElapsedTime - flight.phaseStartTime) / shipTravel.dockingDurationSeconds);
  const easedProgress = 1 - (1 - arriveProgress) * (1 - arriveProgress);
  flight.progress = hyperjumpEnd + easedProgress * flight.arriveDistanceFraction;
  flight.progress = Math.min(1.0, flight.progress);

  if (arriveProgress >= 1.0) {
    flight.phase = "complete";
    return true;
  }
  return false;
}

/** Advance a flight by deltaSeconds. Returns true when the flight is complete. */
export function tickFlightData(flight: FlightData, deltaSeconds: number): boolean {
  flight.totalElapsedTime += deltaSeconds;

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
