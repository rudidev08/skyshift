import { allStationTypes, sizeMultiplierBySize } from "../data/stations";
import type { StationTypeTemplate, StationTypeId, StationSize } from "../data/station-types";
import type { Station } from "./sim-station-types";

// At S size, an even split is 3000 each (6000 total); larger sizes scale via sizeMultiplierBySize.
const BUILD_BASE_PER_WARE_S = 3000;

// Fraction of build cost going to provisions; remainder to hulls. Generational
// ships arrive fully formed, so their entry here is never read — 0.5 is just a
// placeholder so the exhaustive-key type is satisfied.
const PROVISIONS_SHARE: Record<StationTypeId, number> = {
  // Life-support flavor — 65/35
  "habitat": 0.65,
  "farm": 0.65,
  "medical-lab": 0.65,
  "water-processing": 0.65,
  // Signal/data flavor — 50/50
  "archives": 0.5,
  "observatory": 0.5,
  // Industrial flavor — 35/65
  "mine": 0.35,
  "metal-forge": 0.35,
  "tech-factory": 0.35,
  "shipyard": 0.35,
  // Generational ships are not built — value never read.
  "generational-ship": 0.5,
};

/** Compute the build ware requirement for a given type/size, with optional contract 2× multiplier. */
export function computeBuildWares(
  typeId: StationTypeId,
  size: StationSize,
  contracted: boolean,
): { provisions: number; hulls: number } {
  const total = BUILD_BASE_PER_WARE_S * 2 * sizeMultiplierBySize[size] * (contracted ? 2 : 1);
  const provisionsShare = PROVISIONS_SHARE[typeId];
  const provisions = Math.round(total * provisionsShare);
  const hulls = total - provisions;
  return { provisions, hulls };
}

const stationTemplatesById = new Map<StationTypeId, StationTypeTemplate>(
  allStationTypes.map((stationTemplate) => [stationTemplate.id, stationTemplate]),
);

export function getStationTypeTemplate(id: StationTypeId): StationTypeTemplate {
  const stationTemplate = stationTemplatesById.get(id);
  if (!stationTemplate) throw new Error(`Unknown station type: ${id}`);
  return stationTemplate;
}

/** Label with nation code prefix, e.g. "SKY Drifthollow". */
export function stationCodeNameLabel(station: Station): string {
  return `${station.nation.codeName} ${station.name}`;
}
