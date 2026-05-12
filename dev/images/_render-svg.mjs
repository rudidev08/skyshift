// Rasterizes an SVG buffer to a square PNG at the target pixel size.
//
// The source viewBox is 32×32 for the Skyshift icons, so we scale sharp's
// input density to match the target size — this renders the SVG at the
// native pixel grid rather than upsampling a 32×32 raster.

import sharp from "sharp";

export function renderPng(svgBuffer, size) {
  const density = Math.max(72, Math.round((72 * size) / 32));
  return sharp(svgBuffer, { density }).resize(size, size).png().toBuffer();
}
