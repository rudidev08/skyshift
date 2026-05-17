/* Bezier flight math for the static-page sector scene. Owns the
 * FlightAnimation shape, control-point selection, position/tangent sampling,
 * and trail-segment append logic — all independent of canvas state. */

import type { SectorShipHull } from "./static-ship-preview";

const CURVE_ANGLE_MIN_DEGREES = 18;
const CURVE_ANGLE_MAX_DEGREES = 38;
const TRAIL_SEGMENTS_PER_SECOND = 30;
const TANGENT_SAMPLE_STEP = 0.005;

/** A point in normalized [0,1] xRatio/yRatio space — the unit used throughout the sector scene. */
export interface RatioPoint {
  xRatio: number;
  yRatio: number;
}

/** One bezier flight from a station to another, with progress, trail samples, and a fade-out tail. */
export interface FlightAnimation {
  fromX: number;
  fromY: number;
  controlX: number;
  controlY: number;
  toX: number;
  toY: number;
  color: string;
  ship: SectorShipHull;
  elapsed: number;
  flightDuration: number;
  trailSegments: Array<{ x: number; y: number; progress: number }>;
  lastTrailTime: number;
  fading: boolean;
  fadeElapsed: number;
  fadeAlpha: number;
  done: boolean;
}

/** One sample along the quadratic bezier defined by `start`, `control`, `end`. */
export function bezier(start: number, control: number, end: number, progress: number): number {
  const inverse = 1 - progress;
  return inverse * inverse * start + 2 * inverse * progress * control + progress * progress * end;
}

/**
 * Pick a curve side and bend amount for a flight from `from` to `to`. The two
 * angle ranges are intentionally asymmetric — one direction tends sharper than
 * the other, so paired outbound/return flights don't draw mirror-image arcs.
 */
export function computeBezierControlPoint(
  from: RatioPoint,
  to: RatioPoint,
): { controlX: number; controlY: number } {
  const side = Math.random() < 0.5 ? 1 : -1;
  const sideBias = side > 0 ? 0.6 + Math.random() * 0.4 : 0.15 + Math.random() * 0.45;
  const angleDegrees =
    CURVE_ANGLE_MIN_DEGREES + sideBias * (CURVE_ANGLE_MAX_DEGREES - CURVE_ANGLE_MIN_DEGREES);
  const deltaX = to.xRatio - from.xRatio;
  const deltaY = to.yRatio - from.yRatio;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const offsetDistance = distance * Math.tan((angleDegrees * Math.PI) / 180);
  const perpendicularX = -deltaY / distance;
  const perpendicularY = deltaX / distance;
  const controlX = Math.max(
    0.05,
    Math.min(0.95, (from.xRatio + to.xRatio) / 2 + perpendicularX * offsetDistance * side),
  );
  const controlY = Math.max(
    0.05,
    Math.min(0.95, (from.yRatio + to.yRatio) / 2 + perpendicularY * offsetDistance * side),
  );
  return { controlX, controlY };
}

/** Bezier-sample the flight at `progress`, returning normalized xRatio/yRatio. */
export function sampleFlightPosition(
  flight: FlightAnimation,
  progress: number,
): { xRatio: number; yRatio: number } {
  return {
    xRatio: bezier(flight.fromX, flight.controlX, flight.toX, progress),
    yRatio: bezier(flight.fromY, flight.controlY, flight.toY, progress),
  };
}

/**
 * Compute the heading angle (radians, atan2) for the ship at `progress`.
 * Samples the curve just before and just after the current point, then atan2
 * the pixel-space difference — `canvasWidth`/`canvasHeight` rescale the
 * normalized delta so the angle matches the on-screen direction of travel.
 */
export function computeFlightAngle(
  flight: FlightAnimation,
  progress: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const tangentStart = Math.max(0, progress - TANGENT_SAMPLE_STEP);
  const tangentEnd = Math.min(1, progress + TANGENT_SAMPLE_STEP);
  const startX = bezier(flight.fromX, flight.controlX, flight.toX, tangentStart);
  const startY = bezier(flight.fromY, flight.controlY, flight.toY, tangentStart);
  const endX = bezier(flight.fromX, flight.controlX, flight.toX, tangentEnd);
  const endY = bezier(flight.fromY, flight.controlY, flight.toY, tangentEnd);
  return Math.atan2((endY - startY) * canvasHeight, (endX - startX) * canvasWidth);
}

/** Append a trail-segment sample if enough sim time has elapsed since the last one. */
export function appendTrailSegmentIfDue(
  flight: FlightAnimation,
  positionX: number,
  positionY: number,
  progress: number,
): void {
  if (flight.elapsed - flight.lastTrailTime < 1 / TRAIL_SEGMENTS_PER_SECOND) return;
  flight.lastTrailTime = flight.elapsed;
  flight.trailSegments.push({ x: positionX, y: positionY, progress });
}
