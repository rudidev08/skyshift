// Rasterizes public/app-icon.svg into the iOS home-screen and PWA icons.
//
// Outputs:
//   - public/apple-touch-icon.png  (180×180, iOS home-screen)
//   - public/icons/icon-192.png    (manifest / Android home-screen)
//   - public/icons/icon-512.png    (manifest / splash screen source)
//
// How app-icon.svg differs from the browser-tab favicon.svg:
//   - The gold reticle is inset (~62% width) so iOS's squircle mask
//     doesn't crop the ring against the home-screen edge.
//   - A dashed paper-line grid sits behind the reticle at stroke 0.5 /
//     opacity 0.85 — tuned hot enough to survive downsampling to 180×180
//     without washing out into the black background.
//
// The tighter, ungridded favicon.svg is still used for the .ico (browser
// tabs don't mask and render too small for a background pattern to read).
//
// Usage:
//   node dev/images/generate-app-icon.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { renderPng } from "./_render-svg.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const publicDir = path.join(root, "public");
const iconsDir = path.join(publicDir, "icons");
const svgPath = path.join(publicDir, "app-icon.svg");
const appleTouchPath = path.join(publicDir, "apple-touch-icon.png");
const icon192Path = path.join(iconsDir, "icon-192.png");
const icon512Path = path.join(iconsDir, "icon-512.png");

const svgBuffer = await fs.readFile(svgPath);

const [png180, png192, png512] = await Promise.all([
  renderPng(svgBuffer, 180),
  renderPng(svgBuffer, 192),
  renderPng(svgBuffer, 512),
]);

await fs.mkdir(iconsDir, { recursive: true });
await Promise.all([
  fs.writeFile(appleTouchPath, png180),
  fs.writeFile(icon192Path, png192),
  fs.writeFile(icon512Path, png512),
]);

const rel = (p) => path.relative(root, p);
console.log(`Wrote ${rel(appleTouchPath)}   (${png180.length} bytes, 180×180)`);
console.log(`Wrote ${rel(icon192Path)}        (${png192.length} bytes, 192×192)`);
console.log(`Wrote ${rel(icon512Path)}        (${png512.length} bytes, 512×512)`);
console.log(`Source: ${rel(svgPath)}        (iOS + PWA home-screen icon)`);
