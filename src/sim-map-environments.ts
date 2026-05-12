// Lookup helper paired with data/map-environments.ts. Authored vocabulary
// (EnvironmentId, ENVIRONMENT_ALLOWED_TYPES) stays in data/; this runtime helper
// resolves zone-vs-sector environment precedence to the allowed station types.

import type { StationTypeId } from "../data/station-types";
import type { EnvironmentId } from "../data/map-environments";
import { ENVIRONMENT_ALLOWED_TYPES } from "../data/map-environments";

/** Zone's `environmentOverride` wins when set; otherwise the containing sector's environment applies. */
export function allowedStationTypesForZone(
  zoneEnvironment: EnvironmentId | undefined,
  sectorEnvironment: EnvironmentId,
): StationTypeId[] {
  return ENVIRONMENT_ALLOWED_TYPES[zoneEnvironment ?? sectorEnvironment];
}
