import { stationTypes } from "../data/stations";
import type { StationTemplate, StationTypeId } from "../data/station-types";
import type { Station } from "./sim-station-types";

const stationTemplatesById = new Map<StationTypeId, StationTemplate>(stationTypes.map((stationTemplate) => [stationTemplate.id, stationTemplate]));

export function getStationTemplate(id: StationTypeId): StationTemplate {
  const stationTemplate = stationTemplatesById.get(id);
  if (!stationTemplate) throw new Error(`Unknown station type: ${id}`);
  return stationTemplate;
}

/** Label with nation code prefix, e.g. "SKY Drifthollow". */
export function stationCodeNameLabel(station: Station): string {
  return `${station.nation.codeName} ${station.name}`;
}

/** Singular display form for a station template — just `name`. */
export function displayStationTypeSingular(stationTemplate: StationTemplate): string {
  return stationTemplate.name;
}

/** Plural display form for a station template — `plural` overrides default `name + "s"`. */
export function displayStationTypePlural(stationTemplate: StationTemplate): string {
  return stationTemplate.plural ?? stationTemplate.name + "s";
}
