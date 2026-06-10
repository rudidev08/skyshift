// Render-side bezier geometry for trade flights. Sim owns flight phase/progress
// (FlightData); render owns the curve shape (start/end coords, curve angle).
// Sim never reads these — they exist so render can position the ship sprite,
// trail, and engine glow along a smooth bezier between station endpoints.

import type { ShipTypeTemplate } from "../../data/ship-types";
import type { Station } from "../sim-station-types";
import type { TravelEndpoint } from "../sim-travel-types";
import { type FlightData, resolveEndpointPosition } from "../sim-travel";

export interface FlightCurveGeometry {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Random per-flight curve magnitude in degrees; sign flips give clockwise vs counter-clockwise sweep. */
  curveAngle: number;
}

/** One end of a flight's render geometry: the logical endpoint, the station it
 *  references, and an optional sprite-aligned position override (used at flight
 *  start so takeoff/landing align with the visible orbit-sprite ring instead
 *  of the station center). */
interface FlightEndpointInput {
  endpoint: TravelEndpoint;
  station: Station;
  spritePositionOverride?: { x: number; y: number };
}

/** Build render geometry for a flight. Re-rolls `curveAngle` each call (it
 *  isn't persisted in snapshots, so mid-flight loads pick a fresh curve — fine
 *  because the curve is render-only and doesn't affect sim arrival time). */
export function createFlightCurveGeometry(
  origin: FlightEndpointInput,
  destination: FlightEndpointInput,
  shipType: ShipTypeTemplate,
): FlightCurveGeometry {
  const originPos = origin.spritePositionOverride ?? resolveEndpointPosition(origin.endpoint, origin.station);
  const destinationPos =
    destination.spritePositionOverride ?? resolveEndpointPosition(destination.endpoint, destination.station);

  const curveAngle = rollFlightCurveAngle(shipType);

  return {
    startX: originPos.x,
    startY: originPos.y,
    endX: destinationPos.x,
    endY: destinationPos.y,
    curveAngle,
  };
}

function rollFlightCurveAngle(shipType: ShipTypeTemplate): number {
  const minDegrees = shipType.flightPathCurveAngleMinDegrees;
  const maxDegrees = shipType.flightPathCurveAngleMaxDegrees;
  const magnitude = minDegrees + Math.random() * (maxDegrees - minDegrees);
  const sign = Math.random() < 0.5 ? 1 : -1;
  return magnitude * sign;
}

/** Quadratic bezier point at progress (0-1). */
export function getPointOnCurve(
  geometry: FlightCurveGeometry,
  progress: number,
): { x: number; y: number } {
  const dx = geometry.endX - geometry.startX;
  const dy = geometry.endY - geometry.startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  // Degenerate flight (start === end, e.g. same-station surface→orbit deploy)
  // — return the start point so the perp math doesn't divide by zero.
  if (distance === 0) {
    return { x: geometry.startX, y: geometry.startY };
  }

  const midX = (geometry.startX + geometry.endX) / 2;
  const midY = (geometry.startY + geometry.endY) / 2;

  const offsetDistance = distance * Math.tan((geometry.curveAngle * Math.PI) / 180);
  const perpX = -dy / distance;
  const perpY = dx / distance;

  const controlX = midX + perpX * offsetDistance;
  const controlY = midY + perpY * offsetDistance;

  return {
    x:
      (1 - progress) * (1 - progress) * geometry.startX +
      2 * (1 - progress) * progress * controlX +
      progress * progress * geometry.endX,
    y:
      (1 - progress) * (1 - progress) * geometry.startY +
      2 * (1 - progress) * progress * controlY +
      progress * progress * geometry.endY,
  };
}

/** Raw curve tangent heading at a flight's current progress. */
export function getFlightHeading(flight: FlightData, geometry: FlightCurveGeometry): number {
  const progress = flight.progress;
  // Sample 0.5% of the flight on each side of progress — smaller picks up
  // floating-point jitter, larger smooths through tight curves.
  const dt = 0.005;
  const before = getPointOnCurve(geometry, Math.max(0, progress - dt));
  const after = getPointOnCurve(geometry, Math.min(1, progress + dt));
  return Math.atan2(after.y - before.y, after.x - before.x);
}
