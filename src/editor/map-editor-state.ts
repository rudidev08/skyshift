import type { MapPreset } from "../../data/map-types";
import type { Nebula } from "../../data/map-types";
import type { GameMap } from "../sim-map-types";
import type { PlacedStation } from "../../data/station-types";
import { map } from "../../data/map";
import { presets } from "../../data/map-presets";
import { getPresetById } from "../util-map-preset";
import { createMapFromTemplate } from "../sim-map-create";

/** Holds the editor's mutable map-editing inputs and the baseline they were seeded from (for unsaved-edit detection). */
export class MapEditorState {
  activePreset: MapPreset;
  baselineMap: GameMap;
  editableStations: PlacedStation[] = [];
  editableNebulas: Nebula[] = [];

  constructor(initialPresetId: string) {
    this.activePreset = getPresetById(initialPresetId) ?? presets[0];
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
    const next = getPresetById(presetId);
    if (!next) return false;
    this.activePreset = next;
    this.baselineMap = createMapFromTemplate(map, this.activePreset);
    this.seedEditableArraysFromBaseline();
    return true;
  }

  /** Clears and refills the arrays in place (length=0 + push) so views that captured the array reference keep seeing the new contents. */
  private seedEditableArraysFromBaseline(): void {
    replaceArrayInPlace(this.editableStations, this.baselineMap.stations);
    replaceArrayInPlace(this.editableNebulas, this.baselineMap.nebulas);
  }
}

function replaceArrayInPlace<T>(target: T[], source: readonly T[]): void {
  target.length = 0;
  for (const item of source) target.push({ ...item });
}
