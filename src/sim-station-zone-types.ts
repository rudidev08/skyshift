// Runtime station-zone type — instance with resolved sector ref + seed-time identity.
// Template type (StationZoneTemplate) lives in data/station-zone-types.ts.

import type { StationZoneTemplate } from "../data/station-zone-types";
import type { Sector } from "./sim-map-types";

/** Runtime zone — template fields plus the sector resolved from the zone's
 *  position and seed-time identity (`code`, `nameSuffix`, `name`). */
export type StationZone = StationZoneTemplate & {
  sector: Sector;
  /** Display name, e.g. "Unclaimed Deep Space Alpha". */
  name: string;
  /** Name-pool suffix from a building nation (rotated by zone index), e.g. "Alpha". */
  nameSuffix: string;
  /** Passport-style id unique among zones, e.g. "NIL-3A". */
  code: string;
};
