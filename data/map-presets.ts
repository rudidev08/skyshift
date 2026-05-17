// two map presets player can start with
import type { MapPreset } from "./map-types";
import { settledPreset } from "./map-preset-settled";
import { frontierPreset } from "./map-preset-frontier";

export const presets: readonly MapPreset[] = [settledPreset, frontierPreset];
