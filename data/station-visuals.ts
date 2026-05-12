// Visual-only station render constants. Removing any only changes how
// stations look, not their simulated behavior.

import type { StationSize } from "./station-types";

export const stationVisuals = {
  /** Pixel size for station labels in map space. */
  labelFontSize: "16px",
  /** Radius of the station body (black disc) when zoomed in. */
  iconRadius: 32,
  /** Station type icon size as a multiple of iconRadius. */
  iconScale: 1.1,
  /**
   * Padding from L-size body edge to inventory ring; ring radius is always
   * bodyRadiusBySize.L + this so every station shares one ring radius.
   * Zoomed out the ring shows as twinkling dots; zoomed in it becomes the
   * inventory capacity arc segments.
   */
  inventoryRingDistanceFromBody: 16,
  /** Thickness of the nation-colored atmosphere ring around the body. */
  atmosphereRingWidth: 3,
};

/** Twinkle particles that ride along the zoomed-out inventory ring. */
export const ringTwinkles = {
  size: 3,
  color: 0xeeeeee,
  speedMin: 0.067,
  speedMax: 0.167,
  count: {
    L: 12,
    M: 6,
    S: 2,
  } satisfies Record<StationSize, number>,
  peakAlpha: {
    L: 0.9,
    M: 0.8,
    S: 0.7,
  } satisfies Record<StationSize, number>,
};

/** Twinkle particles distributed within each inventory segment arc (zoomed in). */
export const segmentTwinkles = {
  size: 2,
  color: 0xb3b3b3,
  speedMin: 0.1,
  speedMax: 0.267,
  count: {
    L: 10,
    M: 8,
    S: 6,
  } satisfies Record<StationSize, number>,
  peakAlpha: {
    L: 0.6,
    M: 0.5,
    S: 0.4,
  } satisfies Record<StationSize, number>,
};

/** Small "!" / "×" badge stamped above a station in overview mode when the
 *  station's ware-level health drops below ok. Pulses in the "bad" state. */
export const statusBadgeVisuals = {
  offsetX: 20,
  offsetY: -20,
  radius: 7,
  pulseDurationMilliseconds: 1200,
  colors: {
    warn: 0xe0a94a,
    bad: 0xc94a3a,
  } as const,
  glyphs: {
    warn: "!",
    bad: "×",
  } as const,
};

/** Inventory-ring segment appearance — the stroked arcs that show each ware
 *  slot's fill level. Reused for both station rings and ship cargo rings. */
export const inventoryRingVisuals = {
  segmentWidth: 1.5,
  segmentWidthSelected: 12,
  gapAngleRadians: 0.45,
  segmentColor: 0x4d4d4d,
  segmentFillColor: 0xf2f2f2,
};

/** The white arc drawn around the currently-selected target. */
export const selectionRingVisuals = {
  width: 3,
  color: 0xeeeeee,
};
