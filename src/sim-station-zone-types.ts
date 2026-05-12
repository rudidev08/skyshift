// Runtime station-zone type — instance with resolved sector ref + seed-time identity.
// Authored type (StationZoneTemplate) lives in data/station-zone-types.ts.

import type { StationZoneTemplate } from "../data/station-zone-types";
import type { Sector } from "./sim-map-types";

/** Runtime zone — authored fields plus resolved sector reference and seed-time
 *  identity (`code`, `nameSuffix`, `name`). `sectorId` is dropped because
 *  `sector.id` carries the same value once resolved. */
export type StationZone = Omit<StationZoneTemplate, "sectorId"> & {
  sector: Sector;
  /** Display name, e.g. "Unclaimed Deep Space Alpha". */
  name: string;
  /** Name-pool suffix from a building nation (rotated by zone index), e.g. "Alpha". */
  nameSuffix: string;
  /** Passport-style id unique among zones, e.g. "NIL-3A". */
  code: string;
};
