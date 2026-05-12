import type { Nebula } from "../../data/map-types";
import type { StationPlacement } from "../../data/station-types";
import type { MapPreset } from "../../data/map-types";
import { createMapFromTemplate } from "../sim-map-builder";
import { map } from "../../data/map";

/** Swaps the preset's stations/nebulas for the editor's mutable copies so
 *  edits take effect without re-authoring preset data, and forces
 *  `simulationWarmup: 0` so tweaks show on the first visible frame. */
export function buildEditorRuntimeMap(
  preset: MapPreset,
  editableStations: StationPlacement[],
  editableNebulas: Nebula[],
) {
  const gameMap = createMapFromTemplate(map, { ...preset, simulationWarmup: 0 });
  gameMap.stations = editableStations.map((station) => ({ ...station }));
  gameMap.nebulas = editableNebulas.map((nebula) => ({ ...nebula }));
  return gameMap;
}
