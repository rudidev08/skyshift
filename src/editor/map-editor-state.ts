import type { MapPreset } from "../../data/map-types";
import type { Nebula } from "../../data/map-types";
import type { GameMap } from "../sim-map-types";
import type { StationPlacement } from "../../data/station-types";
import { map } from "../../data/map";
import { presets } from "../../data/map-presets";
import { presetById } from "../util-map-preset";
import { createMapFromTemplate } from "../sim-map-builder";

/** Holds the editor's mutable map-authoring inputs and the baseline they were seeded from (for unsaved-edit detection). */
export class MapEditorState {
  activePreset: MapPreset;
  baselineMap: GameMap;
  editableStations: StationPlacement[] = [];
  editableNebulas: Nebula[] = [];

  constructor(initialPresetId: string) {
    this.activePreset = presetById(initialPresetId) ?? presets[0];
    this.baselineMap = createMapFromTemplate(map, this.activePreset);
    this.seedEditableArraysFromBaseline();
  }

  /** Build a fresh GameMap from the current editable arrays. Each call clones every station and nebula — call once per sim run, not once per render frame. */
  currentMap(): GameMap {
    const gameMap = createMapFromTemplate(map, this.activePreset);
    gameMap.stations = this.editableStations.map((station) => ({ ...station }));
    gameMap.nebulas = this.editableNebulas.map((nebula) => ({ ...nebula }));
    return gameMap;
  }

  /** Re-seed editable arrays from a new preset. Returns false without changing anything for an unknown or already-active preset id. Caller handles unsaved-edit prompts. */
  switchPreset(presetId: string): boolean {
    if (presetId === this.activePreset.id) return false;
    const next = presetById(presetId);
    if (!next) return false;
    this.activePreset = next;
    this.baselineMap = createMapFromTemplate(map, this.activePreset);
    this.seedEditableArraysFromBaseline();
    return true;
  }

  /** Clears and refills the arrays in place (length=0 + push) so views that captured the array reference keep seeing the new contents. */
  private seedEditableArraysFromBaseline(): void {
    this.editableStations.length = 0;
    for (const station of this.baselineMap.stations) this.editableStations.push({ ...station });
    this.editableNebulas.length = 0;
    for (const nebula of map.nebulas) this.editableNebulas.push({ ...nebula });
  }
}
