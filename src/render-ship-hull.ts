import type { ShipTypeTemplate } from "../data/ship-types";

export const SHIP_SQUARE = 16; // Ship hull is 2 squares wide × 1 tall; this is one square's side in source pixels.
export const TEXTURE_SCALE = 4; // Texture supersampling — draw at 4× then downscale, so taper curves stay crisp at any zoom.
const DIM_FACTOR = 0.8; // Back-half tint multiplier — gives the two-tone hull its darker stern.

/** Top-left origin and per-square size of one ship hull on the target canvas. */
export interface HullCanvasOrigin {
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
  ship: ShipTypeTemplate,
  canvasOrigin: HullCanvasOrigin,
  palette: HullPalette,
): void {
  context.fillStyle = palette.back;
  traceBackHalfTrapezoid(context, ship, canvasOrigin);
  context.fill();

  context.fillStyle = palette.front;
  traceFrontHalfTrapezoid(context, ship, canvasOrigin);
  context.fill();
}

/** Stroke the two-half ship silhouette. Used for the HUD seal icon. */
export function drawShipSilhouetteOutline(
  context: CanvasRenderingContext2D,
  ship: ShipTypeTemplate,
  canvasOrigin: HullCanvasOrigin,
  palette: HullPalette,
): void {
  context.lineWidth = Math.max(1, canvasOrigin.squareSize * 0.08);
  context.lineJoin = "round";

  context.strokeStyle = palette.back;
  traceBackHalfTrapezoid(context, ship, canvasOrigin);
  context.stroke();

  context.strokeStyle = palette.front;
  traceFrontHalfTrapezoid(context, ship, canvasOrigin);
  context.stroke();
}

function traceBackHalfTrapezoid(
  context: CanvasRenderingContext2D,
  ship: ShipTypeTemplate,
  canvasOrigin: HullCanvasOrigin,
): void {
  traceHalfTrapezoid(context, canvasOrigin, {
    outerX: canvasOrigin.x,
    innerX: canvasOrigin.x + canvasOrigin.squareSize,
    taper: ship.taperBack,
    taperCurve: ship.taperBackCurve,
  });
}

function traceFrontHalfTrapezoid(
  context: CanvasRenderingContext2D,
  ship: ShipTypeTemplate,
  canvasOrigin: HullCanvasOrigin,
): void {
  traceHalfTrapezoid(context, canvasOrigin, {
    outerX: canvasOrigin.x + canvasOrigin.squareSize * 2,
    innerX: canvasOrigin.x + canvasOrigin.squareSize,
    taper: ship.taperFront,
    taperCurve: ship.taperFrontCurve,
  });
}

interface TrapezoidHalf {
  /** X of the tapered (stern or nose) edge. */
  outerX: number;
  /** X of the seam — full-height edge shared with the other half. */
  innerX: number;
  /** ship.taperBack or ship.taperFront — fraction of squareSize the outer edge keeps (1 = full, 0 = sharp point). */
  taper: number;
  /** ship.taperBackCurve or ship.taperFrontCurve — outward bulge on the side edges. */
  taperCurve: number;
}

/** Trace one half-trapezoid (stern or bow). Outer edge is shortened by `taper`;
 *  side edges may bulge per `taperCurve`. Caller decides fill vs stroke. */
function traceHalfTrapezoid(
  context: CanvasRenderingContext2D,
  canvasOrigin: HullCanvasOrigin,
  half: TrapezoidHalf,
): void {
  const { y, squareSize } = canvasOrigin;
  const { outerX, innerX, taper, taperCurve } = half;
  const inset = (squareSize * (1 - taper)) / 2;
  const bulge = taperCurve * squareSize * 0.5;
  const sideMidpointX = (outerX + innerX) / 2;

  context.beginPath();
  context.moveTo(outerX, y + inset);

  // Top side: outer-top → inner-top, optional outward bulge at midpoint.
  if (taperCurve) {
    context.quadraticCurveTo(sideMidpointX, y + inset * 0.5 - bulge, innerX, y);
  } else {
    context.lineTo(innerX, y);
  }

  // Seam runs the full square height — only the outer edge tapers.
  context.lineTo(innerX, y + squareSize);

  // Bottom side: inner-bottom → outer-bottom, mirror bulge.
  if (taperCurve) {
    context.quadraticCurveTo(
      sideMidpointX,
      y + squareSize - inset * 0.5 + bulge,
      outerX,
      y + squareSize - inset,
    );
  } else {
    context.lineTo(outerX, y + squareSize - inset);
  }

  context.closePath();
}

/** Render a tinted two-tone ship outline to a `size` × `size/2` canvas — used for HUD seals. */
export function renderShipIcon(ship: ShipTypeTemplate, nationColor: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const context = canvas.getContext("2d")!;
  const squareSize = size / 2;
  const palette: HullPalette = { back: tintColor(nationColor, DIM_FACTOR), front: nationColor };
  drawShipSilhouetteOutline(context, ship, { x: 0, y: 0, squareSize }, palette);
  return canvas;
}
