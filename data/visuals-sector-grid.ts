// Visual-only tuning for the sector-grid overlay — the lines, per-sector
// corner brackets, and name labels drawn by src/phaser/sector-grid.ts.
// "auto" mode holds the grid at full alpha after a camera move, then fades
// it out.

import { overviewTradeVisuals } from "./visuals-overview";

export const sectorGridVisuals = {
  // How long after the last camera move the grid stays fully visible.
  fadeDelaySeconds: 3,
  // How long the fade-out takes once the hold ends.
  fadeDurationSeconds: 0.75,
  // Length of each corner-bracket arm, in map units.
  cornerArmLength: 60,
  gridLineAlpha: 0.18,
  // Alpha of a fully-shown corner bracket (scaled by the fade value).
  cornerBaseAlpha: 0.36,
  // Inset of each sector's name label from the sector's top-left corner.
  labelMargin: 12,
  // Matches the overview trade-count font so the map's two readable-at-zoom-out
  // text systems feel like one.
  labelFontPixels: overviewTradeVisuals.tradeLabelFontPixels,
  labelLineSpacing: 20,
  labelColor: "rgba(255,255,255,0.7)",
} as const;
