// Per-station orbit-slot reservation + idle-orbit pose. Slots are released on
// ship destroy so churning stations don't push later arrivals into ever-larger
// orbit radii. The 0–0.4×spacing radius jitter hides the occasional slot reuse.

import type { Ship } from "../sim-ships";
import { shipOrbitVisuals } from "../../data/ship-visuals";

export interface OrbitState {
  orbitAngleAtZero: number;
  orbitSpeedRadPerSec: number;
  orbitRadius: number;
}

export interface ShipOrbitPool {
  /** Reserve the next free orbit slot at this station, returning the slot index.
   *  Caller must pair with releaseOrbitSlot on ship destroy. */
  reserveOrbitSlot(stationId: string): number;
  /** Release one orbit slot back to the station's pool. */
  releaseOrbitSlot(stationId: string): void;
  /** Reset the pool — used on scene remount or save load. */
  reset(): void;
}

export function createShipOrbitPool(): ShipOrbitPool {
  // Per-station live-ship count → orbit slot index.
  const liveShipCountByStationId = new Map<string, number>();

  return {
    reserveOrbitSlot(stationId) {
      const slotIndex = liveShipCountByStationId.get(stationId) ?? 0;
      liveShipCountByStationId.set(stationId, slotIndex + 1);
      return slotIndex;
    },
    releaseOrbitSlot(stationId) {
      const previousLiveShipCount = liveShipCountByStationId.get(stationId) ?? 0;
      if (previousLiveShipCount <= 1) liveShipCountByStationId.delete(stationId);
      else liveShipCountByStationId.set(stationId, previousLiveShipCount - 1);
    },
    reset() {
      liveShipCountByStationId.clear();
    },
  };
}

/** Build a fresh orbit state for the given slot — random phase angle, random
 *  direction, and a radius that grows with the slot index so concurrent
 *  orbiters don't overlap. */
export function createOrbitState(slotIndex: number): OrbitState {
  const orbitAngleAtZero = Math.random() * Math.PI * 2;
  const orbitSpeedRadPerSec =
    (shipOrbitVisuals.speedMin + Math.random() * (shipOrbitVisuals.speedMax - shipOrbitVisuals.speedMin)) *
    (Math.random() < 0.5 ? 1 : -1);
  const orbitRadius =
    shipOrbitVisuals.radiusMin +
    slotIndex * shipOrbitVisuals.radiusSpacing +
    Math.random() * (shipOrbitVisuals.radiusSpacing * 0.4);
  return { orbitAngleAtZero, orbitSpeedRadPerSec, orbitRadius };
}

/** Current orbit pose (map x/y + heading angle) for a ship orbiting its home
 *  station. `timeSec` is the game clock (frozen on pause, scaled by game
 *  speed), so idle orbits track the simulation rather than the wall clock. */
export function getOrbitingShipPose(
  ship: Ship,
  orbit: OrbitState,
  timeSec: number,
): { x: number; y: number; angle: number } {
  const station = ship.station;
  const angle = orbit.orbitAngleAtZero + orbit.orbitSpeedRadPerSec * timeSec;
  return {
    x: station.x + Math.cos(angle) * orbit.orbitRadius,
    y: station.y + Math.sin(angle) * orbit.orbitRadius,
    angle,
  };
}
