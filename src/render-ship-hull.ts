import { hexToRgb } from "./util-hex-color";

export const SHIP_SQUARE = 16; // Ship hull is 2 squares wide × 1 tall; this is one square's side in source pixels.
export const TEXTURE_SCALE = 4; // Texture supersampling — draw at 4× then downscale, so taper curves stay crisp at any zoom.
/** Darker stern for the two-tone hull — multiplied per RGB channel against the nation color. */
export const STERN_DIM_FACTOR = 0.8;
const DEFAULT_HULL_CURVE_SCALE = 0.5; // In-game hull bulge; the static-page preview overrides to flatten its smaller silhouettes.

/** Only the four hull taper fields read by the silhouette drawers — structural so both `ShipTypeTemplate` and the static-page `SectorShipHull` satisfy it. */
export interface HullTaperShape {
  taperFront: number;
  taperBack: number;
  taperFrontCurve: number;
  taperBackCurve: number;
}

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

const tintCache = new Map<string, string>();

/** Multiply each RGB channel by a factor — matches Phaser's tint of a white texture. Cached by hex+factor since callers tint per ship per frame. */
export function tintHexColor(hex: string, factor: number): string {
  const key = `${hex}|${factor}`;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const { r, g, b } = hexToRgb(hex);
  const rgb = `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
  tintCache.set(key, rgb);
  return rgb;
}

/** Fill the two-half ship silhouette in two tones. Used for the in-game Phaser texture.
 *
 *  Each half is a trapezoid: full-height seam edge + shorter outer edge.
 *  taperFront/taperBack scale the outer edge (1 = no taper, 0 = point);
 *  taperFrontCurve/taperBackCurve add Bezier bulge (positive = convex).
 *  curveScaleFactor scales the bulge magnitude — defaults to the in-game value; static-page previews pass 0.25 for a flatter silhouette. */
export function drawShipSilhouetteFilled(
  context: CanvasRenderingContext2D,
  ship: HullTaperShape,
  canvasOrigin: HullCanvasOrigin,
  palette: HullPalette,
  curveScaleFactor: number = DEFAULT_HULL_CURVE_SCALE,
): void {
  context.fillStyle = palette.back;
  traceBackHalfTrapezoid(context, ship, canvasOrigin, curveScaleFactor);
  context.fill();

  context.fillStyle = palette.front;
  traceFrontHalfTrapezoid(context, ship, canvasOrigin, curveScaleFactor);
  context.fill();
}

/** Stroke the two-half ship silhouette. Used for the HUD seal icon. */
export function drawShipSilhouetteOutline(
  context: CanvasRenderingContext2D,
  ship: HullTaperShape,
  canvasOrigin: HullCanvasOrigin,
  palette: HullPalette,
): void {
  context.lineWidth = Math.max(1, canvasOrigin.squareSize * 0.08);
  context.lineJoin = "round";

  context.strokeStyle = palette.back;
  traceBackHalfTrapezoid(context, ship, canvasOrigin, DEFAULT_HULL_CURVE_SCALE);
  context.stroke();

  context.strokeStyle = palette.front;
  traceFrontHalfTrapezoid(context, ship, canvasOrigin, DEFAULT_HULL_CURVE_SCALE);
  context.stroke();
}

function traceBackHalfTrapezoid(
  context: CanvasRenderingContext2D,
  ship: HullTaperShape,
  canvasOrigin: HullCanvasOrigin,
  curveScaleFactor: number,
): void {
  traceHalfTrapezoid(context, canvasOrigin, {
    outerX: canvasOrigin.x,
    innerX: canvasOrigin.x + canvasOrigin.squareSize,
    taper: ship.taperBack,
    taperCurve: ship.taperBackCurve,
  }, curveScaleFactor);
}

function traceFrontHalfTrapezoid(
  context: CanvasRenderingContext2D,
  ship: HullTaperShape,
  canvasOrigin: HullCanvasOrigin,
  curveScaleFactor: number,
): void {
  traceHalfTrapezoid(context, canvasOrigin, {
    outerX: canvasOrigin.x + canvasOrigin.squareSize * 2,
    innerX: canvasOrigin.x + canvasOrigin.squareSize,
    taper: ship.taperFront,
    taperCurve: ship.taperFrontCurve,
  }, curveScaleFactor);
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
 *  side edges may bulge per `taperCurve` × `curveScaleFactor`. Caller decides fill vs stroke. */
function traceHalfTrapezoid(
  context: CanvasRenderingContext2D,
  canvasOrigin: HullCanvasOrigin,
  half: TrapezoidHalf,
  curveScaleFactor: number,
): void {
  const { y, squareSize } = canvasOrigin;
  const { outerX, innerX, taper, taperCurve } = half;
  const inset = (squareSize * (1 - taper)) / 2;
  const bulge = taperCurve * squareSize * curveScaleFactor;
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
export function renderShipIcon(ship: HullTaperShape, nationColor: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const context = canvas.getContext("2d")!;
  const squareSize = size / 2;
  const palette: HullPalette = { back: tintHexColor(nationColor, STERN_DIM_FACTOR), front: nationColor };
  drawShipSilhouetteOutline(context, ship, { x: 0, y: 0, squareSize }, palette);
  return canvas;
}
