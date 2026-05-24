/**
 * Rasterizes public/favicon.svg into the browser-tab favicon.ico.
 *
 * Outputs:
 *   - public/favicon.ico  (16×16 + 32×32, referenced by index.html / tools.html)
 *
 * The SVG itself is the hand-written source of truth (a direct port of the
 * sector icon built by buildSectorIcon() in src/render-hud-icon.ts). It's both
 * the live-served modern favicon and the input to this script — edit the SVG
 * to change the design, then re-run this script to regenerate the raster.
 *
 * The iOS home-screen / PWA rasters come from a separate source so the
 * reticle can be inset to survive iOS's squircle mask — see
 * generate-app-icon.mjs.
 *
 * Usage:
 *   node dev/images/generate-favicon.mjs
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { renderPng } from "./svg-to-png.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const publicDir = path.join(root, "public");
const svgPath = path.join(publicDir, "favicon.svg");
const icoPath = path.join(publicDir, "favicon.ico");

const svgBuffer = await fs.readFile(svgPath);

/**
 * Minimal ICO encoder. Modern ICO files allow each directory entry's image
 * payload to be a complete PNG stream (rather than legacy DIB). Layout:
 *
 *   [6-byte ICONDIR header] [16-byte ICONDIRENTRY] * N  [PNG bytes] * N
 *
 * See: https://en.wikipedia.org/wiki/ICO_(file_format)
 */
function encodeIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const tableSize = headerSize + entrySize * images.length;

  const header = Buffer.alloc(tableSize);
  // ICONDIR: reserved=0, type=1 (ICO), count=N
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let payloadOffset = tableSize;
  for (let i = 0; i < images.length; i++) {
    const { width, height, data } = images[i];
    const entryOffset = headerSize + i * entrySize;
    header.writeUInt8(width, entryOffset + 0);
    header.writeUInt8(height, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2); // palette size (0 = no palette)
    header.writeUInt8(0, entryOffset + 3); // reserved
    header.writeUInt16LE(1, entryOffset + 4); // color planes
    header.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    header.writeUInt32LE(data.length, entryOffset + 8);
    header.writeUInt32LE(payloadOffset, entryOffset + 12);
    payloadOffset += data.length;
  }

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const [png16, png32] = await Promise.all([renderPng(svgBuffer, 16), renderPng(svgBuffer, 32)]);

const icoBuffer = encodeIco([
  { width: 16, height: 16, data: png16 },
  { width: 32, height: 32, data: png32 },
]);

await fs.writeFile(icoPath, icoBuffer);

const rel = (p) => path.relative(root, p);
console.log(`Wrote ${rel(icoPath)}     (${icoBuffer.length} bytes, 16×16 + 32×32)`);
console.log(`Source: ${rel(svgPath)}  (served as /favicon.svg)`);
