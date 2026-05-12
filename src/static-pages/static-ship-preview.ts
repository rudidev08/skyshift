/* 2D canvas ship silhouette for the sector scene.
 *
 * SYNC: src/render-ship-hull.ts — mirrors drawShipSilhouetteFilled / tintColor.
 * Two intentional deltas:
 *   1. Rotates around center (translate + rotate) instead of stern-corner offset.
 *   2. Curve bulge is *0.25 (half the game's *0.5) — less convex on these
 *      smaller previews.
 * Mirror any hull-shape change here when updating ship-hull.ts. */

export interface SectorShipHull {
  taperFront: number;
  taperBack: number;
  taperFrontCurve: number;
  taperBackCurve: number;
  trailWidth: number;
  trailDepartureAlphaMultiplier: number;
  trailArrivalAlphaMultiplier: number;
  speed: number;
}

const tintCache = new Map<string, string>();

function tintColor(hex: string, factor: number): string {
  const key = hex + factor;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const rgbInt = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((rgbInt >> 16) & 0xff) * factor);
  const g = Math.round(((rgbInt >> 8)  & 0xff) * factor);
  const b = Math.round((rgbInt         & 0xff) * factor);
  const rgb = `rgb(${r},${g},${b})`;
  tintCache.set(key, rgb);
  return rgb;
}

function drawSternHalf(
  context: CanvasRenderingContext2D,
  squareSize: number,
  backInset: number,
  ship: SectorShipHull,
): void {
  context.beginPath();
  context.moveTo(-squareSize, -squareSize / 2 + backInset);
  if (ship.taperBackCurve) {
    context.quadraticCurveTo(-squareSize / 2, -squareSize / 2 + backInset * 0.5 - ship.taperBackCurve * squareSize * 0.25, 0, -squareSize / 2);
  } else {
    context.lineTo(0, -squareSize / 2);
  }
  context.lineTo(0, squareSize / 2);
  if (ship.taperBackCurve) {
    context.quadraticCurveTo(-squareSize / 2, squareSize / 2 - backInset * 0.5 + ship.taperBackCurve * squareSize * 0.25, -squareSize, squareSize / 2 - backInset);
  } else {
    context.lineTo(-squareSize, squareSize / 2 - backInset);
  }
  context.closePath();
  context.fill();
}

function drawNoseHalf(
  context: CanvasRenderingContext2D,
  squareSize: number,
  frontInset: number,
  ship: SectorShipHull,
): void {
  context.beginPath();
  context.moveTo(0, -squareSize / 2);
  if (ship.taperFrontCurve) {
    context.quadraticCurveTo(squareSize / 2, -squareSize / 2 + frontInset * 0.5 - ship.taperFrontCurve * squareSize * 0.25, squareSize, -squareSize / 2 + frontInset);
  } else {
    context.lineTo(squareSize, -squareSize / 2 + frontInset);
  }
  context.lineTo(squareSize, squareSize / 2 - frontInset);
  if (ship.taperFrontCurve) {
    context.quadraticCurveTo(squareSize / 2, squareSize / 2 - frontInset * 0.5 + ship.taperFrontCurve * squareSize * 0.25, 0, squareSize / 2);
  } else {
    context.lineTo(0, squareSize / 2);
  }
  context.closePath();
  context.fill();
}

export interface ShipDrawRequest {
  x: number;
  y: number;
  rotation: number;
  nationColor: string;
  ship: SectorShipHull;
  scale: number;
}

export function drawShip(
  context: CanvasRenderingContext2D,
  request: ShipDrawRequest,
): void {
  const { x, y, rotation, nationColor, ship, scale } = request;
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  const squareSize = 5 * scale;
  const frontInset = squareSize * (1 - ship.taperFront) / 2;
  const backInset  = squareSize * (1 - ship.taperBack)  / 2;
  const sternColor = tintColor(nationColor, 0.8);

  context.fillStyle = sternColor;
  drawSternHalf(context, squareSize, backInset, ship);

  context.fillStyle = nationColor;
  drawNoseHalf(context, squareSize, frontInset, ship);

  context.restore();
}
