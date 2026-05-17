import type { StationTypeId } from "../data/station-types";
import { sectorEnvironmentById } from "../data/map-sector-environments";
import type { StationZone } from "./sim-station-zone-types";

/** Station types a zone can host, taken from its containing sector's environment. */
export function allowedStationTypesForZone(zone: StationZone): readonly StationTypeId[] {
  return sectorEnvironmentById[zone.sector.environment].allowedStationTypeIds;
}
