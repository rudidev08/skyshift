// Shared texture cache — ship silhouettes, Lucide SVG icons, the single
// station orbit-ring. Each helper generates once per key and returns it
// on subsequent calls.

import { type Scene } from "phaser";
import type { ShipTypeTemplate } from "../../data/ship-types";
import type { StationTypeId } from "../../data/station-types";
import { SHIP_SQUARE, TEXTURE_SCALE, drawShipSilhouetteFilled } from "../render-ship-hull";
import { iconSvgByStationType } from "../render-station-icon";
import { bodyRadiusBySize } from "../../data/stations";
import { stationVisuals } from "../../data/station-visuals";

const SHIP_BRIGHT = "#ffffff";
// 80% intensity — paired with SHIP_BRIGHT to produce the two-tone hull (front bright, back dim).
const SHIP_DIM = "#cccccc";

export function ensureShipTexture(scene: Scene, ship: ShipTypeTemplate): string {
  const textureKey = `ship-${ship.id}`;
  if (scene.textures.exists(textureKey)) return textureKey;

  const squareSize = SHIP_SQUARE * TEXTURE_SCALE;
  const padding = TEXTURE_SCALE * 2; // Avoids edge sampling artifacts.
  const width = squareSize * 2 + padding * 2;
  const height = squareSize + padding * 2;

  const canvas = scene.textures.createCanvas(textureKey, width, height)!;
  const context = canvas.getContext();

  drawShipSilhouetteFilled(
    context,
    ship,
    { x: padding, y: padding, squareSize },
    { back: SHIP_DIM, front: SHIP_BRIGHT },
  );

  canvas.refresh();
  return textureKey;
}

/** Rasterize SVG icons at this resolution so they stay crisp when scaled. */
export const ICON_TEXTURE_SIZE = 64;

/** Lucide SVGs ship as 24×24 with `currentColor` strokes; replace the color with white so Phaser tints work, and upscale to `ICON_TEXTURE_SIZE` for crisp display. */
function prepareLucideSvgForPhaserTinting(rawSvg: string): string {
  return rawSvg
    .replace(/currentColor/g, "#ffffff")
    .replace(/width="24"/, `width="${ICON_TEXTURE_SIZE}"`)
    .replace(/height="24"/, `height="${ICON_TEXTURE_SIZE}"`);
}

/** Queue one Lucide SVG as a Phaser texture under `textureKey`. Shared entry point so the SVG → data URI pipeline lives in one place. */
export function loadLucideSvgTexture(scene: Scene, textureKey: string, rawSvg: string): void {
  const prepared = prepareLucideSvgForPhaserTinting(rawSvg);
  scene.load.image(textureKey, `data:image/svg+xml,${encodeURIComponent(prepared)}`);
}

/** Queue all station-type icon textures for loading. Call during preload. */
export function preloadStationIcons(scene: Scene) {
  for (const [typeId, svg] of Object.entries(iconSvgByStationType)) {
    loadLucideSvgTexture(scene, `station-icon-${typeId}`, svg);
  }
}

export function getStationIconTextureKey(typeId: StationTypeId): string {
  return `station-icon-${typeId}`;
}

// Every station — including S/M — draws the same L-radius ring. Intentional:
// the ring marks "where ships orbit," not station body size.
const RING_TEXTURE_KEY = "station-orbit-ring";

export function ensureStationRingTexture(scene: Scene): string {
  if (scene.textures.exists(RING_TEXTURE_KEY)) return RING_TEXTURE_KEY;
  const RING_WIDTH = 1.5;
  const RING_COLOR = 0x888888;
  const RING_ALPHA = 0.35;
  const ringRadius = bodyRadiusBySize.L + stationVisuals.inventoryRingDistanceFromBody;
  const padding = 2;
  const textureSize = Math.ceil((ringRadius + RING_WIDTH + padding) * 2);
  const canvas = scene.textures.createCanvas(RING_TEXTURE_KEY, textureSize, textureSize)!;
  const context = canvas.getContext();
  const center = textureSize / 2;
  drawOrbitRing(context, center, ringRadius, {
    width: RING_WIDTH,
    color: RING_COLOR,
    alpha: RING_ALPHA,
  });
  canvas.refresh();
  return RING_TEXTURE_KEY;
}

function drawOrbitRing(
  context: CanvasRenderingContext2D,
  center: number,
  ringRadius: number,
  style: { width: number; color: number; alpha: number },
): void {
  const red = (style.color >> 16) & 0xff;
  const green = (style.color >> 8) & 0xff;
  const blue = style.color & 0xff;
  context.strokeStyle = `rgba(${red},${green},${blue},${style.alpha})`;
  context.lineWidth = style.width;
  context.beginPath();
  context.arc(center, center, ringRadius, 0, Math.PI * 2);
  context.stroke();
}
