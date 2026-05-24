// Builds the Sectors-map dataset for one preset, used by lore.html's
// Sectors-map switcher (called once per preset selection). Returns only
// what the map render needs.

import type { MapPreset, PresetStation } from "../../data/map-types";
import type { NationTemplate } from "../../data/nation-types";
import type { StationSize } from "../../data/station-types";
import type { StationZoneTemplate } from "../../data/station-zone-types";

/** A preset station resolved against zones (x, y, size) and nations. */
export interface DerivedPresetStation extends PresetStation {
  x: number;
  y: number;
  size: StationSize;
  nation: NationTemplate;
}

/** Output of `derivePresetMap` — only the structures the sectors-map renderer reads. */
export interface DerivedPresetMap {
  mapStations: DerivedPresetStation[];
  /** Zones with no station placed by the preset (unclaimed slots). */
  stationZones: StationZoneTemplate[];
  /** sector-key → nation-codeName → station count for that nation in that sector. */
  sectorDotMap: Record<string, Record<string, number>>;
  /** sector-key → stations in that sector. */
  stationsBySector: Record<string, DerivedPresetStation[]>;
  /** nation-codeName → station display names. */
  stationNamesByNation: Record<string, string[]>;
}

export interface DerivePresetMapDeps {
  zoneById: Map<string, StationZoneTemplate>;
  nationById: Map<string, NationTemplate>;
  universeZones: readonly StationZoneTemplate[];
  sectorKey: (x: number, y: number) => string;
}

function resolvePresetStation(
  station: PresetStation,
  presetId: string,
  deps: DerivePresetMapDeps,
): DerivedPresetStation {
  const zone = deps.zoneById.get(station.zoneId);
  if (!zone) {
    throw new Error(
      `derivePresetMap: preset "${presetId}" station "${station.stationId}" references unknown zoneId "${station.zoneId}"`,
    );
  }
  const nation = deps.nationById.get(station.nationId);
  if (!nation) {
    throw new Error(
      `derivePresetMap: preset "${presetId}" station "${station.stationId}" references unknown nationId "${station.nationId}"`,
    );
  }
  return { ...station, x: zone.x, y: zone.y, size: zone.size, nation };
}

function groupStationsForSectorRender(
  mapStations: DerivedPresetStation[],
  sectorKey: (x: number, y: number) => string,
): {
  stationNamesByNation: Record<string, string[]>;
  stationsBySector: Record<string, DerivedPresetStation[]>;
  sectorDotMap: Record<string, Record<string, number>>;
} {
  const stationNamesByNation: Record<string, string[]> = {};
  const stationsBySector: Record<string, DerivedPresetStation[]> = {};
  const sectorDotMap: Record<string, Record<string, number>> = {};
  for (const station of mapStations) {
    const nationCode = station.nation.codeName;
    if (!stationNamesByNation[nationCode]) stationNamesByNation[nationCode] = [];
    if (station.name) stationNamesByNation[nationCode].push(station.name);
    const key = sectorKey(station.x, station.y);
    if (!sectorDotMap[key]) sectorDotMap[key] = {};
    sectorDotMap[key][nationCode] = (sectorDotMap[key][nationCode] || 0) + 1;
    if (!stationsBySector[key]) stationsBySector[key] = [];
    stationsBySector[key].push(station);
  }
  return { stationNamesByNation, stationsBySector, sectorDotMap };
}

/** Resolves a preset's stations against zones (for x/y/size) and nations,
 *  and groups them by sector for the sectors-map render. */
export function derivePresetMap(preset: MapPreset, deps: DerivePresetMapDeps): DerivedPresetMap {
  const occupiedZoneIds = new Set(preset.presetStations.map((station) => station.zoneId));
  const mapStations = preset.presetStations.map((station) =>
    resolvePresetStation(station, preset.id, deps),
  );
  const stationZones = deps.universeZones.filter((zone) => !occupiedZoneIds.has(zone.id));
  const { stationNamesByNation, stationsBySector, sectorDotMap } = groupStationsForSectorRender(
    mapStations,
    deps.sectorKey,
  );
  return { mapStations, stationZones, sectorDotMap, stationsBySector, stationNamesByNation };
}
