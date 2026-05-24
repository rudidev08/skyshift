/* 2D canvas ship silhouette for the sector scene.
 *
 * Wraps the canonical hull drawer with a rotate-around-center transform and
 * the static-page's flatter curve scale (0.25 vs the in-game 0.5). */

import { STERN_DIM_FACTOR, drawShipSilhouetteFilled, tintHexColor } from "../render-ship-hull";

/** Hull geometry and flight behavior for one ship type in the static-page sector scene. */
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

/** Half the in-game bulge — preview silhouettes are smaller and read better with flatter side curves. */
const PREVIEW_HULL_CURVE_SCALE = 0.25;

/** Parameters for a single ship draw call: canvas position, orientation, color, and scale. */
export interface ShipDrawRequest {
  x: number;
  y: number;
  rotation: number;
  nationColor: string;
  ship: SectorShipHull;
  scale: number;
}

/** Draw a two-tone ship silhouette at the requested position, rotation, and scale. */
export function drawShipPreview(context: CanvasRenderingContext2D, request: ShipDrawRequest): void {
  const { x, y, rotation, nationColor, ship, scale } = request;
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  const squareSize = 5 * scale;
  drawShipSilhouetteFilled(
    context,
    ship,
    { x: -squareSize, y: -squareSize / 2, squareSize },
    { back: tintHexColor(nationColor, STERN_DIM_FACTOR), front: nationColor },
    PREVIEW_HULL_CURVE_SCALE,
  );
  context.restore();
}
