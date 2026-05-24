// Shared texture cache — ship silhouettes, Lucide SVG icons, the single
// station orbit-ring. Each helper generates once per key and returns it
// on subsequent calls.

import { type Scene } from "phaser";
import type { ShipTypeTemplate } from "../../data/ship-types";
import type { StationTypeId } from "../../data/station-types";
import { SHIP_SQUARE, TEXTURE_SCALE, drawShipSilhouetteFilled } from "../render-ship-hull";
import { iconSvgByStationType } from "../render-station-icon";
import { svgToDataUri } from "../render-data-uri-cache";
import { stationOrbitRingRadius } from "../../data/station-visuals";
import { numberToRgb } from "../util-hex-color";

const SHIP_BRIGHT = "#ffffff";
// 80% intensity — paired with SHIP_BRIGHT to produce the two-tone hull (front bright, back dim).
const SHIP_DIM = "#cccccc";

export function getOrCreateShipTexture(scene: Scene, ship: ShipTypeTemplate): string {
  const textureKey = `ship-${ship.id}`;
  if (scene.textures.exists(textureKey)) return textureKey;

  const squareSize = SHIP_SQUARE * TEXTURE_SCALE;
  const paddingPixels = TEXTURE_SCALE * 2; // Avoids edge sampling artifacts.
  const width = squareSize * 2 + paddingPixels * 2;
  const height = squareSize + paddingPixels * 2;

  const canvas = scene.textures.createCanvas(textureKey, width, height)!;
  const context = canvas.getContext();

  drawShipSilhouetteFilled(
    context,
    ship,
    { x: paddingPixels, y: paddingPixels, squareSize },
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

/** Single entry point for loading Lucide SVG textures so the SVG → data URI pipeline stays in one place. */
export function loadLucideSvgTexture(scene: Scene, textureKey: string, rawSvg: string): void {
  const preparedSvg = prepareLucideSvgForPhaserTinting(rawSvg);
  scene.load.image(textureKey, svgToDataUri(preparedSvg));
}

/** Call during scene preload — Phaser's load pipeline only runs there. */
export function preloadStationIcons(scene: Scene) {
  for (const [typeId, iconSvg] of Object.entries(iconSvgByStationType)) {
    loadLucideSvgTexture(scene, getStationIconTextureKey(typeId as StationTypeId), iconSvg);
  }
}

export function getStationIconTextureKey(typeId: StationTypeId): string {
  return `station-icon-${typeId}`;
}

// Every station — including S/M — draws the same L-radius ring. Intentional:
// the ring marks "where ships orbit," not station body size.
const RING_TEXTURE_KEY = "station-orbit-ring";

export function getOrCreateStationRingTexture(scene: Scene): string {
  if (scene.textures.exists(RING_TEXTURE_KEY)) return RING_TEXTURE_KEY;
  const ringWidthPixels = 1.5;
  const ringColor = 0x888888;
  const ringAlpha = 0.35;
  const paddingPixels = 2;
  const textureSizePixels = Math.ceil(
    (stationOrbitRingRadius + ringWidthPixels + paddingPixels) * 2,
  );
  const canvas = scene.textures.createCanvas(RING_TEXTURE_KEY, textureSizePixels, textureSizePixels)!;
  const context = canvas.getContext();
  const center = textureSizePixels / 2;
  drawOrbitRing(context, center, stationOrbitRingRadius, {
    width: ringWidthPixels,
    color: ringColor,
    alpha: ringAlpha,
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
  const { r, g, b } = numberToRgb(style.color);
  context.strokeStyle = `rgba(${r},${g},${b},${style.alpha})`;
  context.lineWidth = style.width;
  context.beginPath();
  context.arc(center, center, ringRadius, 0, Math.PI * 2);
  context.stroke();
}
