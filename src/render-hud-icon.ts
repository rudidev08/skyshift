// Composites ship/station/sector/zone renders onto a common ghosted-ring
// backdrop for the HUD info-panel icons. Cached via data-uri-cache.

import type { ShipTypeTemplate } from "../data/ship-types";
import type { StationTypeId } from "../data/station-types";
import { hudIconVisuals } from "../data/visuals-hud-icon";
import { getCachedDataUri, svgToDataUri } from "./render-data-uri-cache";
import { renderShipIcon } from "./render-ship-hull";
import { renderStationIconDataUri } from "./render-station-icon";

const ICON_SIZE_PIXELS = hudIconVisuals.iconSize;
const CENTER_PIXELS = ICON_SIZE_PIXELS / 2;

function drawBackdrop(context: CanvasRenderingContext2D, color: string): void {
  context.beginPath();
  context.arc(CENTER_PIXELS, CENTER_PIXELS, hudIconVisuals.discRadius, 0, Math.PI * 2);
  context.strokeStyle = color;
  context.lineWidth = hudIconVisuals.subtleRingWidth;
  context.stroke();
}

function buildShipIcon(ship: ShipTypeTemplate): string {
  // Pixel density of 4 keeps strokes sharp when the ghosted seal is enlarged for display.
  const pixelDensity = 4;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE_PIXELS * pixelDensity;
  canvas.height = ICON_SIZE_PIXELS * pixelDensity;
  const context = canvas.getContext("2d")!;
  context.scale(pixelDensity, pixelDensity);

  drawBackdrop(context, hudIconVisuals.sealColor);

  const shipHalfExtentIconUnits = 8.5;
  // Match the outer pixel density so the ship stays crisp when the parent
  // canvas scales up for the seal.
  const shipCanvas = renderShipIcon(ship, hudIconVisuals.sealColor, shipHalfExtentIconUnits * 2 * pixelDensity);
  // Tilt up-right — ship hulls draw nose-right, but HUD icons read better
  // with the silhouette angled diagonally.
  context.translate(CENTER_PIXELS, CENTER_PIXELS);
  context.rotate((-45 * Math.PI) / 180);
  context.drawImage(shipCanvas, -shipHalfExtentIconUnits, -shipHalfExtentIconUnits * 0.5, shipHalfExtentIconUnits * 2, shipHalfExtentIconUnits);

  return canvas.toDataURL();
}

function svgIconWithRing(innerSvg: string, ringWidth: number = hudIconVisuals.subtleRingWidth, dashed = false): string {
  const dashAttribute = dashed ? ` stroke-dasharray="4 3"` : "";
  const svg = [
    `<svg viewBox="0 0 ${ICON_SIZE_PIXELS} ${ICON_SIZE_PIXELS}" xmlns="http://www.w3.org/2000/svg">`,
    `<circle cx="${CENTER_PIXELS}" cy="${CENTER_PIXELS}" r="${hudIconVisuals.discRadius}" fill="none" stroke="${hudIconVisuals.sealColor}" stroke-width="${ringWidth}"${dashAttribute}/>`,
    innerSvg,
    `</svg>`,
  ].join("");
  return svgToDataUri(svg);
}

function buildStationIcon(stationTypeId: StationTypeId): string {
  const iconDisplaySizePixels = 18;
  const offset = (ICON_SIZE_PIXELS - iconDisplaySizePixels) / 2;

  const stationIconUri = renderStationIconDataUri(stationTypeId, hudIconVisuals.sealColor, iconDisplaySizePixels);

  return svgIconWithRing(
    `<image x="${offset}" y="${offset}" width="${iconDisplaySizePixels}" height="${iconDisplaySizePixels}" href="${stationIconUri}"/>`,
  );
}

function buildSectorIcon(): string {
  const crosshair = [
    `<circle cx="${CENTER_PIXELS}" cy="${CENTER_PIXELS}" r="8" fill="none" stroke="${hudIconVisuals.sealColor}" stroke-width="1"/>`,
    `<line x1="${CENTER_PIXELS}" y1="6" x2="${CENTER_PIXELS}" y2="26" stroke="${hudIconVisuals.sealColor}" stroke-width="1"/>`,
    `<line x1="6" y1="${CENTER_PIXELS}" x2="26" y2="${CENTER_PIXELS}" stroke="${hudIconVisuals.sealColor}" stroke-width="1"/>`,
    `<circle cx="${CENTER_PIXELS}" cy="${CENTER_PIXELS}" r="1.5" fill="${hudIconVisuals.sealColor}"/>`,
  ].join("");
  return svgIconWithRing(crosshair);
}

export function getShipHudIcon(ship: ShipTypeTemplate): string {
  return getCachedDataUri(`hud-ship-${ship.id}`, () => buildShipIcon(ship));
}

export function getStationHudIcon(stationTypeId: StationTypeId): string {
  return getCachedDataUri(`hud-station-${stationTypeId}`, () => buildStationIcon(stationTypeId));
}

export function getSectorHudIcon(): string {
  return getCachedDataUri("hud-sector", buildSectorIcon);
}

function buildStationZoneIcon(): string {
  return svgIconWithRing("", hudIconVisuals.atmosphereWidth, true);
}

export function getStationZoneHudIcon(): string {
  return getCachedDataUri("hud-station-zone", buildStationZoneIcon);
}
