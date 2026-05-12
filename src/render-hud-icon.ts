// Composites ship/station/sector/zone renders onto a common ghosted-ring
// backdrop for the HUD info-panel icons. Cached via data-uri-cache.

import type { ShipTemplate } from "../data/ship-types";
import type { StationTypeId } from "../data/station-types";
import { hudIconVisuals } from "../data/visuals-hud-icon";
import { getCachedDataUri, svgToDataUri } from "./render-data-uri-cache";
import { renderShipIcon } from "./render-ship-hull";
import { renderStationIconDataUri } from "./render-station-icon";

const {
  iconSize: ICON_SIZE,
  discRadius: DISC_RADIUS,
  // ATMOSPHERE_WIDTH is used only by the zone icon (no subtle variant).
  atmosphereWidth: ATMOSPHERE_WIDTH,
  subtleRingWidth: SUBTLE_RING_WIDTH,
  sealColor: SEAL_COLOR,
} = hudIconVisuals;
const CENTER = ICON_SIZE / 2;

/** Ghosted seal-colored ring backdrop. */
function drawBackdrop(context: CanvasRenderingContext2D, color: string): void {
  context.beginPath();
  context.arc(CENTER, CENTER, DISC_RADIUS, 0, Math.PI * 2);
  context.strokeStyle = color;
  context.lineWidth = SUBTLE_RING_WIDTH;
  context.stroke();
}

function buildShipIcon(ship: ShipTemplate): string {
  // Pixel density of 4 keeps strokes sharp when the ghosted seal is enlarged for display.
  const pixelDensity = 4;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE * pixelDensity;
  canvas.height = ICON_SIZE * pixelDensity;
  const context = canvas.getContext("2d")!;
  context.scale(pixelDensity, pixelDensity);

  drawBackdrop(context, SEAL_COLOR);

  const shipSquare = 8.5;
  // Match the outer pixel density so the ship stays crisp when the parent
  // canvas scales up for the seal.
  const shipCanvas = renderShipIcon(ship, SEAL_COLOR, shipSquare * 2 * pixelDensity);
  // Tilt up-right — ship hulls draw nose-right, but HUD icons read better
  // with the silhouette angled diagonally.
  context.translate(CENTER, CENTER);
  context.rotate(-45 * Math.PI / 180);
  context.drawImage(shipCanvas, -shipSquare, -shipSquare * 0.5, shipSquare * 2, shipSquare);

  return canvas.toDataURL();
}

function buildStationIcon(stationTypeId: StationTypeId): string {
  const iconDisplaySize = 18;
  const offset = (ICON_SIZE - iconDisplaySize) / 2;

  const stationIconUri = renderStationIconDataUri(stationTypeId, SEAL_COLOR, iconDisplaySize);

  const svg = [
    `<svg viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="${DISC_RADIUS}" fill="none" stroke="${SEAL_COLOR}" stroke-width="${SUBTLE_RING_WIDTH}"/>`,
    `<image x="${offset}" y="${offset}" width="${iconDisplaySize}" height="${iconDisplaySize}" href="${stationIconUri}"/>`,
    `</svg>`,
  ].join("");
  return svgToDataUri(svg);
}

function buildSectorIcon(): string {
  const svg = [
    `<svg viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="${DISC_RADIUS}" fill="none" stroke="${SEAL_COLOR}" stroke-width="${SUBTLE_RING_WIDTH}"/>`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="8" fill="none" stroke="${SEAL_COLOR}" stroke-width="1"/>`,
    `<line x1="${CENTER}" y1="6" x2="${CENTER}" y2="26" stroke="${SEAL_COLOR}" stroke-width="1"/>`,
    `<line x1="6" y1="${CENTER}" x2="26" y2="${CENTER}" stroke="${SEAL_COLOR}" stroke-width="1"/>`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="1.5" fill="${SEAL_COLOR}"/>`,
    `</svg>`,
  ].join("");
  return svgToDataUri(svg);
}

export function getShipHudIcon(ship: ShipTemplate): string {
  return getCachedDataUri(`hud-ship-${ship.id}`, () => buildShipIcon(ship));
}

export function getStationHudIcon(stationTypeId: StationTypeId): string {
  return getCachedDataUri(`hud-station-${stationTypeId}`, () => buildStationIcon(stationTypeId));
}

export function getSectorHudIcon(): string {
  return getCachedDataUri("hud-sector", buildSectorIcon);
}

function buildStationZoneIcon(): string {
  const dashLength = 4;
  const gapLength = 3;
  const svg = [
    `<svg viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">`,
    `<circle cx="${CENTER}" cy="${CENTER}" r="${DISC_RADIUS}" fill="none"`,
    ` stroke="${SEAL_COLOR}" stroke-width="${ATMOSPHERE_WIDTH}"`,
    ` stroke-dasharray="${dashLength} ${gapLength}"/>`,
    `</svg>`,
  ].join("");
  return svgToDataUri(svg);
}

export function getStationZoneHudIcon(): string {
  return getCachedDataUri("hud-station-zone", buildStationZoneIcon);
}
