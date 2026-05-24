/** Convert a CSS hex color string (e.g. "#ff8800") to the 0xRRGGBB number Phaser color APIs expect. */
export function hexToColorNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Split a 0xRRGGBB number into its three 0–255 channels. */
export function numberToRgb(packed: number): Rgb {
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  };
}

/** Split a CSS hex color string (e.g. "#ff8800") into its three 0–255 channels. */
export function hexToRgb(hex: string): Rgb {
  return numberToRgb(hexToColorNumber(hex));
}
