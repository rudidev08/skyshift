import type { StationZoneTemplate } from "../data/station-zone-types";
import type { StationZone } from "./sim-station-zone-types";
import type { Sector } from "./sim-map-types";
import { stationBuilderNations } from "../data/nations";
import { findSectorAtPosition } from "./sim-sector-lookup";

/** Sector id a zone id names by the `<sector-id>-<n>` convention (strip the trailing `-<number>`). */
function sectorIdFromZoneId(zoneId: string): string {
  return zoneId.replace(/-\d+$/, "");
}

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

/** Create runtime StationZone from a zone template. The zone's sector is
 *  resolved from its position. Throws if the position is outside every sector,
 *  or lands in a sector the zone id's `<sector-id>-<n>` prefix doesn't name. */
function createZoneFromTemplate(
  template: StationZoneTemplate,
  index: number,
  sectors: Sector[],
  takenCodes: Set<string>,
): StationZone {
  const sector = findSectorAtPosition(sectors, template.x, template.y);
  if (!sector) {
    throw new Error(`Zone "${template.id}" at (${template.x}, ${template.y}) is outside every sector.`);
  }
  const namedSectorId = sectorIdFromZoneId(template.id);
  if (sector.id !== namedSectorId) {
    throw new Error(
      `Zone "${template.id}" sits in sector "${sector.id}" but its id names sector "${namedSectorId}".`,
    );
  }

  const nation = stationBuilderNations[index % stationBuilderNations.length];
  const nameSuffix = nation.nameSuffixes[index % nation.nameSuffixes.length] ?? String(index + 1);

  return {
    ...template,
    sector,
    name: `Unclaimed ${sector.name} ${nameSuffix}`,
    nameSuffix,
    code: generateUniqueZoneCode(takenCodes),
  };
}

/** Create runtime StationZones from zone templates. Each zone picks a
 *  suffix from a different building nation so unclaimed names vary in style. */
export function createStationZones(zoneTemplates: StationZoneTemplate[], sectors: Sector[]): StationZone[] {
  const takenCodes = new Set<string>();
  return zoneTemplates.map((template, index) =>
    createZoneFromTemplate(template, index, sectors, takenCodes),
  );
}
