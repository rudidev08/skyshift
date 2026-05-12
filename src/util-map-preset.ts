// View helpers over the preset registry — kept in src/ since data/ stays free of presentation/lookup logic.
import { presets } from "../data/map-presets";
import type { MapPreset } from "../data/map-types";

export function presetById(id: string): MapPreset | null {
  return presets.find((preset) => preset.id === id) ?? null;
}

export function getPresetLabel(presetId: string): string {
  return presetById(presetId)?.name ?? presetId;
}

/** Excludes `blank`, which exists only so the editor and continueUniverse can
 *  compose on top of an empty layout — not a player-facing starting option. */
export function presetsForLandingPage(): readonly MapPreset[] {
  return presets.filter((preset) => preset.id !== "blank");
}
