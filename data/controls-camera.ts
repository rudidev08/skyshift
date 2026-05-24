/** Floor for Phaser's camera.zoom (render-side scale multiplier on the whole scene). Clamped at runtime on every wheel/pinch/+/-. */
export const cameraMinZoomPhaserClamp = 0.2;
/** Ceiling for Phaser's camera.zoom. */
export const cameraMaxZoomPhaserClamp = 1.1;
/** Overview mode allows zooming further out since only station dots and trade routes are visible. */
export const overviewMinZoomPhaserClamp = 0.1;
/** Zoom level the parallax star tiles are sized to fully cover. Kept below
 *  cameraMinZoomPhaserClamp (0.2) so the tile edge stays off-screen at the
 *  furthest zoom-out; the star tile spans 1 / this. */
export const starfieldOversizeZoomFloor = 0.15;

/** Internal zoom is mapped to a 1.0–9.0 level shown to the user (purely presentation). */
export const cameraZoomLevelMin = 1.0;
export const cameraZoomLevelMax = 9.0;
// Denominator for converting between Phaser zoom and the 1.0–9.0 user-facing level.
export const cameraZoomLevelSpan = cameraZoomLevelMax - cameraZoomLevelMin;
/** Stops the +/- buttons and a tap on the zoom dial move between, in the 1.0–9.0 level shown to the user. + jumps to the next higher stop, - to the next lower, a tap cycles to the next (wrapping back to the first). The mouse wheel ignores these and zooms continuously. */
export const cameraZoomLevelStops = [1.0, 2.0, 4.0, 6.0, 9.0];
/** How far each mouse-wheel notch moves the zoom level. Sub-step so wheel zoom feels continuous instead of jumping a whole digit per notch. */
export const cameraWheelZoomLevelStep = 0.25;

/** Dots in the range indicator below the zoom digit — evenly spaced from min→max zoom, closest one lit. */
export const zoomDialDotCount = 5;
/** Glide time when the +/- buttons or a dial tap animate the camera between zoom stops. */
export const zoomAnimationDurationMilliseconds = 300;
/** Display-level slack so pressing +/- while sitting just off a stop doesn't re-select that same stop. */
export const zoomStopReselectMargin = 0.05;

/** Zoom level where station detail (labels, icons, planet disc) starts fading in. */
export const closeViewFadeStart = 0.6;
/** Zoom level where station detail is fully visible. */
export const closeViewFadeEnd = 0.7;

/** Per-frame velocity multiplier after a drag-pan releases — lower stops faster, higher glides longer. */
export const cameraDragFriction = 0.92;

/** Keeps objects just off-screen rendered so they don't pop in while panning, as a fraction of screen dimensions. 0.5 = half a screen of slack on each side. */
export const cullingMargin = 0.5;

/** Min ms between culling-bounds recomputations. */
export const cullingRefreshIntervalMilliseconds = 200;
