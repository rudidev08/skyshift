/** Convert a CSS hex color string (e.g. "#ff8800") to the 0xRRGGBB number Phaser color APIs expect. */
export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
