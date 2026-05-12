// Authored station-zone shape. Runtime StationZone (with resolved sector ref +
// seed-time identity) lives in src/sim-station-zone-types.ts.

import type { StationSize } from "./station-types";
import type { EnvironmentId } from "./map-environments";

/** Authored station zone — a buildable slot. Position and size are fixed by
 *  the universe; whether a station sits here at game start comes from the preset. */
export interface StationZoneTemplate {
  /** `<sector-id>-<n>` — stable, scoped to the containing sector. */
  id: string;
  /** Sector the zone lives in. Denormalized so consumers don't have to spatially resolve. */
  sectorId: string;
  x: number;
  y: number;
  size: StationSize;
  /** Per-zone environment override (for mixed-use spots inside a sector). */
  environmentOverride?: EnvironmentId;
}
