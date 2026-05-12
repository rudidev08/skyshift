import type { ShipTemplate } from "../data/ship-types";

export const SHIP_SQUARE = 16; // Ship hull is 2 squares wide × 1 tall; this is one square's side in source pixels.
export const TEXTURE_SCALE = 4; // Texture supersampling — draw at 4× then downscale, so taper curves stay crisp at any zoom.
const DIM_FACTOR = 0.8; // Back-half tint multiplier — gives the two-tone hull its darker stern.

/** Top-left origin and per-square size of one ship hull on the target canvas. */
export interface HullPlacement {
  x: number;
  y: number;
  squareSize: number;
}

/** Two-tone palette for a filled ship silhouette: stern (dimmer) + bow (brighter). */
export interface HullPalette {
  back: string;
  front: string;
}

/** Multiply each RGB channel by a factor — matches Phaser's tint of a white texture. */
export function tintColor(hex: string, factor: number): string {
  const packed = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((packed >> 16) & 0xff) * factor);
  const g = Math.round(((packed >> 8) & 0xff) * factor);
  const b = Math.round((packed & 0xff) * factor);
  return `rgb(${r},${g},${b})`;
}

/** Fill the two-half ship silhouette in two tones. Used for the in-game Phaser texture.
 *
 *  Each half is a trapezoid: full-height seam edge + shorter outer edge.
 *  taperFront/taperBack scale the outer edge (1 = no taper, 0 = point);
 *  taperFrontCurve/taperBackCurve add Bezier bulge (positive = convex). */
export function drawShipSilhouetteFilled(
  context: CanvasRenderingContext2D,
  ship: ShipTemplate,
  placement: HullPlacement,
  palette: HullPalette,
): void {
  context.fillStyle = palette.back;
  traceBackHalfTrapezoid(context, ship, placement);
  context.fill();

  context.fillStyle = palette.front;
  traceFrontHalfTrapezoid(context, ship, placement);
  context.fill();
}

/** Stroke the two-half ship silhouette. Used for the HUD seal icon. */
export function drawShipSilhouetteOutline(
  context: CanvasRenderingContext2D,
  ship: ShipTemplate,
  placement: HullPlacement,
  palette: HullPalette,
): void {
  context.lineWidth = Math.max(1, placement.squareSize * 0.08);
  context.lineJoin = "round";

  context.strokeStyle = palette.back;
  traceBackHalfTrapezoid(context, ship, placement);
  context.stroke();

  context.strokeStyle = palette.front;
  traceFrontHalfTrapezoid(context, ship, placement);
  context.stroke();
}

/** Trace the stern trapezoid: shorter stern edge + full-height seam edge.
 *  Outer edges may bulge per `taperBackCurve`. Caller decides fill vs stroke. */
function traceBackHalfTrapezoid(
  context: CanvasRenderingContext2D,
  ship: ShipTemplate,
  placement: HullPlacement,
): void {
  const { x, y, squareSize } = placement;
  const backInset = squareSize * (1 - ship.taperBack) / 2;
  const backBulge = ship.taperBackCurve * squareSize * 0.5;

  context.beginPath();
  context.moveTo(x, y + backInset);

  // Top side line: stern top → seam top
  if (ship.taperBackCurve) {
    // Control point at line midpoint, offset outward by bulge.
    const controlX = x + squareSize * 0.5;
    const controlY = y + backInset * 0.5 - backBulge;
    context.quadraticCurveTo(controlX, controlY, x + squareSize, y);
  } else {
    context.lineTo(x + squareSize, y);
  }

  // Seam edge runs the full square height — only stern/nose edges taper.
  context.lineTo(x + squareSize, y + squareSize);

  // Bottom side line: seam bottom → stern bottom
  if (ship.taperBackCurve) {
    const controlX = x + squareSize * 0.5;
    const controlY = y + squareSize - backInset * 0.5 + backBulge;
    context.quadraticCurveTo(controlX, controlY, x, y + squareSize - backInset);
  } else {
    context.lineTo(x, y + squareSize - backInset);
  }

  context.closePath();
}

/** Trace the bow trapezoid: full-height seam edge + shorter nose edge.
 *  Outer edges may bulge per `taperFrontCurve`. Caller decides fill vs stroke. */
function traceFrontHalfTrapezoid(
  context: CanvasRenderingContext2D,
  ship: ShipTemplate,
  placement: HullPlacement,
): void {
  const { x, y, squareSize } = placement;
  const frontInset = squareSize * (1 - ship.taperFront) / 2;
  const frontBulge = ship.taperFrontCurve * squareSize * 0.5;

  context.beginPath();
  context.moveTo(x + squareSize, y);

  // Top side line: seam top → nose top
  if (ship.taperFrontCurve) {
    const controlX = x + squareSize * 1.5;
    const controlY = y + frontInset * 0.5 - frontBulge;
    context.quadraticCurveTo(controlX, controlY, x + squareSize * 2, y + frontInset);
  } else {
    context.lineTo(x + squareSize * 2, y + frontInset);
  }

  // Nose edge stays straight (no curve param) but shortens with taperFront.
  context.lineTo(x + squareSize * 2, y + squareSize - frontInset);

  // Bottom side line: nose bottom → seam bottom
  if (ship.taperFrontCurve) {
    const controlX = x + squareSize * 1.5;
    const controlY = y + squareSize - frontInset * 0.5 + frontBulge;
    context.quadraticCurveTo(controlX, controlY, x + squareSize, y + squareSize);
  } else {
    context.lineTo(x + squareSize, y + squareSize);
  }

  context.closePath();
}

/** Render a tinted two-tone ship outline to a `size` × `size/2` canvas — used for HUD seals. */
export function renderShipIcon(ship: ShipTemplate, nationColor: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const context = canvas.getContext("2d")!;
  const squareSize = size / 2;
  const palette: HullPalette = { back: tintColor(nationColor, DIM_FACTOR), front: nationColor };
  drawShipSilhouetteOutline(context, ship, { x: 0, y: 0, squareSize }, palette);
  return canvas;
}
