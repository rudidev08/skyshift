/** DPR clamped to 2 — keeps static-page canvases crisp on HiDPI without
 *  paying the 3×/4× cost some phones report. Shared by background.ts and
 *  sector-scene-2d.ts. */
export const PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
