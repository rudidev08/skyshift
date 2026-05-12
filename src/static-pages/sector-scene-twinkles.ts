/* Per-station twinkle generation for the static-page sector scene.
 * Twinkles are the small white dots that pulse around each station's ring. */

import type { SectorStation } from "./sector-scene-2d";

const TWINKLE_MIN_SPEED = 0.067;
const TWINKLE_MAX_SPEED = 0.167;

/** One twinkle dot: angular position around the station ring, animation phase, and pulse speed. */
export interface Twinkle {
  angle: number;
  phase: number;
  speed: number;
}

/** Build a fresh, randomized twinkle list for each station, keyed by station id. */
export function createTwinklesForStations(stations: SectorStation[]): Map<string, Twinkle[]> {
  const twinklesByStation = new Map<string, Twinkle[]>();
  for (const station of stations) {
    const twinkles: Twinkle[] = [];
    for (let i = 0; i < station.twinkleCount; i++) {
      twinkles.push({
        angle: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        speed: TWINKLE_MIN_SPEED + Math.random() * (TWINKLE_MAX_SPEED - TWINKLE_MIN_SPEED),
      });
    }
    twinklesByStation.set(station.id, twinkles);
  }
  return twinklesByStation;
}
