import { stationVisuals } from "../../data/station-visuals";

export const DISPLAY_FONT_FAMILY = '"Space Grotesk", system-ui, sans-serif';
export const MONO_FONT_FAMILY = '"JetBrains Mono", ui-monospace, monospace';

/** Default text style for map-space labels (station names, ship names, cargo). */
export const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: DISPLAY_FONT_FAMILY,
  fontSize: stationVisuals.labelFontSize,
  color: "#c0c0c0",
};
