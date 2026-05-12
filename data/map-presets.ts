// Registry of universe presets — each names which zones start with a station
// and supplies initial economy tuning. The `presetById` lookup helper lives in
// src/util-map-preset.ts.
//
// Invariant: `blank` must stay registered. continueUniverse (src/game-entry.ts)
// composes restored saves on top of the blank preset's empty-zone layout and
// throws at init if presetById("blank") returns null.
import type { MapPreset } from "./map-types";
import { assertUniqueIds } from "../src/util-ids";
import { settledPreset } from "./map-preset-settled";
import { frontierPreset } from "./map-preset-frontier";
import { blankPreset } from "./map-preset-blank";

export const presets: readonly MapPreset[] = [
  settledPreset,
  frontierPreset,
  blankPreset,
];

assertUniqueIds(presets, "preset");
