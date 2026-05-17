// Zoom level where station detail (labels, icons, planet disc) starts fading in.
const closeViewFadeStart = 0.6;
// Zoom level where station detail is fully visible.
const closeViewFadeEnd = 0.7;

/** Fraction (0-1) into the close-view zoom range — 0 = far out, 1 = detail level. */
export function closeViewAlpha(zoom: number): number {
  return Math.max(0, Math.min(1, (zoom - closeViewFadeStart) / (closeViewFadeEnd - closeViewFadeStart)));
}
