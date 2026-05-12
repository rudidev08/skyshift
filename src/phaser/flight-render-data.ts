// Render-side bezier geometry for trade flights. Sim owns flight phase/progress
// (FlightData); render owns the curve shape (start/end coords, curve angle).
// Sim never reads these — they exist so render can position the ship sprite,
// trail, and engine glow along a smooth bezier between station endpoints.

import type { ShipTemplate } from "../../data/ship-types";
import type { Station } from "../sim-station-types";
import type { TravelEndpoint } from "../sim-travel-types";
import { type FlightData, resolveEndpointPos } from "../sim-travel";

export interface FlightRenderData {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Random per-flight curve magnitude in degrees; sign flips give clockwise vs
   *  counter-clockwise sweep. Re-rolled each time render builds a fresh
   *  FlightRenderData (mid-flight loads pick a new curve since this isn't
   *  persisted in snapshots). */
  curveAngle: number;
}

/** One end of a flight's render geometry: the logical endpoint, the station it
 *  references, and an optional sprite-aligned position override (used at flight
 *  start so takeoff/landing align with the visible orbit-sprite ring instead
 *  of the station center). */
export interface FlightEndpointInput {
  endpoint: TravelEndpoint;
  station: Station;
  spritePositionOverride?: { x: number; y: number };
}

/** Build render geometry for a flight. */
export function createFlightRenderData(
  origin: FlightEndpointInput,
  destination: FlightEndpointInput,
  ship: ShipTemplate,
): FlightRenderData {
  const originPos = origin.spritePositionOverride ?? resolveEndpointPos(origin.endpoint, origin.station);
  const destinationPos = destination.spritePositionOverride ?? resolveEndpointPos(destination.endpoint, destination.station);

  const curveAngle = pickRandomCurveAngle(ship);

  return {
    startX: originPos.x,
    startY: originPos.y,
    endX: destinationPos.x,
    endY: destinationPos.y,
    curveAngle,
  };
}

function pickRandomCurveAngle(ship: ShipTemplate): number {
  const minDegrees = ship.flightPathCurveAngleMinDegrees;
  const maxDegrees = ship.flightPathCurveAngleMaxDegrees;
  const magnitude = minDegrees + Math.random() * (maxDegrees - minDegrees);
  const sign = Math.random() < 0.5 ? 1 : -1;
  return magnitude * sign;
}

/** Quadratic bezier point at t (0-1). Returns a fresh `{ x, y }` each call. */
export function getPointOnCurve(render: FlightRenderData, t: number): { x: number; y: number } {
  const dx = render.endX - render.startX;
  const dy = render.endY - render.startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  // Degenerate flight (start === end, e.g. same-station surface→orbit deploy)
  // — return the start point so the perp math doesn't divide by zero.
  if (distance === 0) {
    return { x: render.startX, y: render.startY };
  }

  const midX = (render.startX + render.endX) / 2;
  const midY = (render.startY + render.endY) / 2;

  const offsetDistance = distance * Math.tan((render.curveAngle * Math.PI) / 180);
  const perpX = -dy / distance;
  const perpY = dx / distance;

  const controlX = midX + perpX * offsetDistance;
  const controlY = midY + perpY * offsetDistance;

  return {
    x: (1 - t) * (1 - t) * render.startX + 2 * (1 - t) * t * controlX + t * t * render.endX,
    y: (1 - t) * (1 - t) * render.startY + 2 * (1 - t) * t * controlY + t * t * render.endY,
  };
}

/** Raw curve tangent heading at a flight's current progress. */
export function getFlightHeading(flight: FlightData, render: FlightRenderData): number {
  const t = flight.progress;
  // Sample 0.5% of the flight on each side of t — smaller picks up
  // floating-point jitter, larger smooths through tight curves.
  const dt = 0.005;
  const before = getPointOnCurve(render, Math.max(0, t - dt));
  const after = getPointOnCurve(render, Math.min(1, t + dt));
  return Math.atan2(after.y - before.y, after.x - before.x);
}
