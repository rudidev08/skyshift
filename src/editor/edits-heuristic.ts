import type { PlacedStation } from "../../data/station-types";
import type { Nebula } from "../../data/map-types";

export interface EditComparison {
  stations: { current: readonly PlacedStation[]; baseline: readonly PlacedStation[] };
  nebulas: { current: readonly Nebula[]; baseline: readonly Nebula[] };
}

/** True when editor state diverges from the preset baseline. Stations match by id; nebulas match by index since they have no stable id. */
export function hasUnsavedEdits(comparison: EditComparison): boolean {
  return (
    stationsDifferFromBaseline(comparison.stations.current, comparison.stations.baseline) ||
    nebulasDifferFromBaseline(comparison.nebulas.current, comparison.nebulas.baseline)
  );
}

function stationsDifferFromBaseline(
  stations: readonly PlacedStation[],
  baselineStations: readonly PlacedStation[],
): boolean {
  if (stations.length !== baselineStations.length) return true;

  const baselineStationById = new Map(baselineStations.map((station) => [station.id, station]));
  for (const station of stations) {
    const original = baselineStationById.get(station.id);
    if (!original) return true;
    if (original.x !== station.x) return true;
    if (original.y !== station.y) return true;
  }

  return false;
}

function nebulasDifferFromBaseline(nebulas: readonly Nebula[], baselineNebulas: readonly Nebula[]): boolean {
  if (nebulas.length !== baselineNebulas.length) return true;

  for (let i = 0; i < nebulas.length; i++) {
    const current = nebulas[i];
    const original = baselineNebulas[i];
    if (original.x !== current.x) return true;
    if (original.y !== current.y) return true;
    if (original.textureKey !== current.textureKey) return true;
  }

  return false;
}
