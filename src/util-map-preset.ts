// View helpers over the preset registry — kept in src/ since data/ stays free of presentation/lookup logic.
import { presets } from "../data/map-presets";
import type { MapPreset } from "../data/map-types";

export function getPresetById(id: string): MapPreset | null {
  return presets.find((preset) => preset.id === id) ?? null;
}

export function getPresetLabel(presetId: string): string {
  return getPresetById(presetId)?.name ?? presetId;
}
