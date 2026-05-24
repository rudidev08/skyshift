/** Pin `value` to the 0–1 range — anything below 0 becomes 0, anything above 1 becomes 1. */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** How far `value` lies between `min` and `max`, as a 0–1 fraction, clamped at
 *  either end. Requires `max !== min` — equal bounds produce NaN. */
export function clamped01Fraction(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}
