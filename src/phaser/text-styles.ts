import { stationVisuals } from "../../data/station-visuals";
import { displayFontFamily, mapLabelColor } from "../../data/visuals-text";

/** Shared base text style for map-space labels (ship names, station names, cargo) — used directly or spread-extended with per-site overrides. */
export const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: displayFontFamily,
  fontSize: stationVisuals.labelFontSize,
  color: mapLabelColor,
};
