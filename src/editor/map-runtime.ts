import type { Nebula, MapPreset } from "../../data/map-types";
import type { PlacedStation } from "../../data/station-types";
import { createMapFromTemplate } from "../sim-map-create";
import { map } from "../../data/map";

/** Forces `simulationWarmupSeconds: 0` so editor tweaks show on the first visible frame. */
export function createEditorRuntimeMapFromPreset(
  preset: MapPreset,
  editableStations: PlacedStation[],
  editableNebulas: Nebula[],
) {
  const gameMap = createMapFromTemplate(map, { ...preset, simulationWarmupSeconds: 0 });
  gameMap.stations = editableStations.map((station) => ({ ...station }));
  gameMap.nebulas = editableNebulas.map((nebula) => ({ ...nebula }));
  return gameMap;
}
