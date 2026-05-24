import { clamped01Fraction } from "../util-clamp";
import { closeViewFadeStart, closeViewFadeEnd } from "../../data/controls-camera";

/** Fraction (0-1) into the close-view zoom range — 0 = far out, 1 = detail level. */
export function closeViewAlpha(zoom: number): number {
  return clamped01Fraction(zoom, closeViewFadeStart, closeViewFadeEnd);
}
