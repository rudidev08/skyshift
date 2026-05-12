// Station zones — buildable slots shown by the HUD's "Zones" view mode.
// Unoccupied zones render as NIL-namespaced dashed-circle overlays.

import type { StationZoneTemplate } from "../data/station-zone-types";
import type { StationZone } from "./sim-station-zone-types";
import type { Sector } from "./sim-map-types";
import { buildingNations } from "../data/nations";

/** Generate an unused NIL-namespaced zone code (e.g. "NIL-3K"). Mutates `takenCodes` by inserting the returned code. */
function generateUniqueZoneCode(takenCodes: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const digit = Math.floor(Math.random() * 10);
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const code = `NIL-${digit}${letter}`;
    if (!takenCodes.has(code)) {
      takenCodes.add(code);
      return code;
    }
  }
  // Pool is 26 letters × 10 digits = 260 codes. Fall back to a 3-char base36 tail if all are taken.
  const tail = Math.random().toString(36).slice(2, 5).toUpperCase();
  const code = `NIL-${tail}`;
  takenCodes.add(code);
  return code;
}

/** Create runtime StationZone from authored zone definition. Throws if `definition.sectorId` is unknown. */
function createZoneFromDefinition(
  definition: StationZoneTemplate,
  index: number,
  sectorsById: Map<string, Sector>,
  takenCodes: Set<string>,
): StationZone {
  const sector = sectorsById.get(definition.sectorId);
  if (!sector) {
    throw new Error(
      `Zone "${definition.id}" references unknown sectorId "${definition.sectorId}".`,
    );
  }

  const nation = buildingNations[index % buildingNations.length];
  const nameSuffix = nation.nameSuffixes[index % nation.nameSuffixes.length] ?? String(index + 1);

  const { sectorId: _sectorId, ...authored } = definition;
  return {
    ...authored,
    sector,
    name: `Unclaimed ${sector.name} ${nameSuffix}`,
    nameSuffix,
    code: generateUniqueZoneCode(takenCodes),
  };
}

/** Create runtime StationZone from zone definitions. Each zone picks a
 *  suffix from a different building nation so unclaimed names vary in style. */
export function createStationZones(
  zoneDefinitions: StationZoneTemplate[],
  sectors: Sector[],
): StationZone[] {
  const takenCodes = new Set<string>();
  const sectorsById = new Map(sectors.map((sector) => [sector.id, sector]));
  return zoneDefinitions.map((definition, index) =>
    createZoneFromDefinition(definition, index, sectorsById, takenCodes),
  );
}
