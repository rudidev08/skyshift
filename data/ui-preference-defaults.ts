import type { SectorGridMode } from "../src/sector-grid-mode";

/** First-load values for the device-global UI preferences. Each is used only
 *  when the device has no stored value for that preference's localStorage key;
 *  a player's saved choice always wins, so changing a default here only affects
 *  devices that have never set that preference. */
export const uiPreferenceDefaults: {
  audioEnabled: boolean;
  sectorGridMode: SectorGridMode;
  controlsShown: boolean;
  infoCardCollapsed: boolean;
} = {
  audioEnabled: true,
  // Sector-grid overlay fades in when you pan the camera, then fades out
  // again — rather than always on or always off.
  sectorGridMode: "auto",
  controlsShown: false,
  infoCardCollapsed: true,
};
