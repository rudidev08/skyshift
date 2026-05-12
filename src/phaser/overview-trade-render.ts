// Trade-route overlay for overview mode's Trading tab. Per ware per route: one
// gradient-alpha line plus a consumer-end arrow head; "N shipments" label on
// each highlighted route; station rings (green if on a highlighted route, else
// neutral). Labels reuse a pool of Graphics + Text objects between redraws.

import type { Scene } from "phaser";
import type { WareId } from "../../data/ware-types";
import { overviewTradeVisuals } from "../../data/visuals-overview";
import { Layer } from "./depth-layers";
import { MONO_FONT_FAMILY } from "./viewport-culling";

// Arrow head geometry scales with line stroke so the head stays proportional.
const ARROW_LENGTH = overviewTradeVisuals.lineStroke * overviewTradeVisuals.arrowLengthMultiplier;
const ARROW_HALF_WIDTH = overviewTradeVisuals.lineStroke * overviewTradeVisuals.arrowHalfWidthMultiplier;

/** "none" suppresses the green overlay and green station rings; baseline lines still render. */
export type WareSelection = WareId | "none";
export const NONE: WareSelection = "none";

export interface StationPosition { id: string; x: number; y: number; }

export interface TradeRouteData {
  fromStationId: string;
  toStationId: string;
  wares: WareId[];
  /** Fill-equivalent trade activity per ware, used to render "N shipments" labels. */
  wareActivity: Map<WareId, number>;
}

export interface TradeRouteRender {
  /** Redraw all lines, rings, and labels for the given snapshot. */
  redraw(
    routes: TradeRouteData[],
    selectedWare: WareSelection,
    stationById: Map<string, StationPosition>,
  ): void;
  setVisible(visible: boolean): void;
  clear(): void;
  destroy(): void;
}

/** Pooled label slot — one graphics backdrop and one text child reused across redraws. */
interface LabelSlot {
  background: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
}

function formatTradeCount(activity: number): string | null {
  if (activity < 0.05) return null;
  // Under 10, show one decimal — the tenths matter at low volumes (2.3 vs 2.7).
  // ≥10 rounds to an integer.
  const formatted = activity < 10 ? activity.toFixed(1) : String(Math.round(activity));
  return `${formatted} shipment${Number(formatted) === 1 ? "" : "s"}`;
}

function computeGreenSelectionSets(
  routes: TradeRouteData[],
  highlightWare: WareId | null,
): { greenStations: Set<string>; greenRouteKeys: Set<string> } {
  const greenStations = new Set<string>();
  const greenRouteKeys = new Set<string>();
  if (highlightWare === null) return { greenStations, greenRouteKeys };
  for (const route of routes) {
    if (!route.wares.includes(highlightWare)) continue;
    greenStations.add(route.fromStationId);
    greenStations.add(route.toStationId);
    greenRouteKeys.add(`${route.fromStationId}::${route.toStationId}`);
  }
  return { greenStations, greenRouteKeys };
}

interface RouteLineGeometry {
  /** Unit vector along the line, from→to. */
  ux: number; uy: number;
  /** Perpendicular unit vector (rotated 90°), used for parallel-line offsetting. */
  px: number; py: number;
  /** From-side endpoint, pulled inward by endpointPad so lines stop at the station ring. */
  sx: number; sy: number;
  /** To-side endpoint, pulled inward by endpointPad so lines stop at the station ring. */
  ex: number; ey: number;
  /** Number of wares on the route — drives parallel-line stacking. */
  wareCount: number;
}

function computeRouteLineGeometry(
  route: TradeRouteData,
  stationById: Map<string, StationPosition>,
): RouteLineGeometry | null {
  const from = stationById.get(route.fromStationId);
  const to = stationById.get(route.toStationId);
  if (!from || !to) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  const lineLength = Math.hypot(dx, dy);
  if (lineLength < 1) return null;
  const ux = dx / lineLength, uy = dy / lineLength;
  const px = -uy, py = ux;
  const sx = from.x + ux * overviewTradeVisuals.endpointPad;
  const sy = from.y + uy * overviewTradeVisuals.endpointPad;
  const ex = to.x - ux * overviewTradeVisuals.endpointPad;
  const ey = to.y - uy * overviewTradeVisuals.endpointPad;
  return { ux, uy, px, py, sx, sy, ex, ey, wareCount: route.wares.length };
}

interface LineSegment {
  startX: number; startY: number;
  endX: number; endY: number;
}

interface ArrowGeometry {
  tipX: number; tipY: number;
  /** Unit vector pointing from the line tail toward the tip. */
  directionX: number; directionY: number;
}

/** Stepped sub-segments give the alpha gradient that brightens into the destination ring, encoding trade direction. */
function drawGradientLine(
  linesGraphics: Phaser.GameObjects.Graphics,
  segment: LineSegment,
  color: number,
): void {
  const segmentDeltaX = segment.endX - segment.startX;
  const segmentDeltaY = segment.endY - segment.startY;
  const segments = overviewTradeVisuals.gradientSegments;
  const alphaMin = overviewTradeVisuals.lineAlphaProducer;
  const alphaMax = overviewTradeVisuals.lineAlphaConsumer;
  for (let k = 0; k < segments; k++) {
    const t0 = k / segments;
    const t1 = (k + 1) / segments;
    const alpha = alphaMin + (alphaMax - alphaMin) * ((t0 + t1) / 2);
    linesGraphics.lineStyle(overviewTradeVisuals.lineStroke, color, alpha);
    linesGraphics.lineBetween(
      segment.startX + segmentDeltaX * t0, segment.startY + segmentDeltaY * t0,
      segment.startX + segmentDeltaX * t1, segment.startY + segmentDeltaY * t1,
    );
  }
}

/** Filled triangle at the consumer end: tip at (tipX, tipY) along (directionX, directionY); back edge perpendicular at ARROW_LENGTH. */
function drawArrowHead(
  linesGraphics: Phaser.GameObjects.Graphics,
  arrow: ArrowGeometry,
  color: number,
): void {
  const px = -arrow.directionY, py = arrow.directionX;
  const baseX = arrow.tipX - arrow.directionX * ARROW_LENGTH;
  const baseY = arrow.tipY - arrow.directionY * ARROW_LENGTH;
  const lx = baseX + px * ARROW_HALF_WIDTH;
  const ly = baseY + py * ARROW_HALF_WIDTH;
  const rx = baseX - px * ARROW_HALF_WIDTH;
  const ry = baseY - py * ARROW_HALF_WIDTH;
  linesGraphics.fillStyle(color, overviewTradeVisuals.arrowAlpha);
  linesGraphics.fillTriangle(arrow.tipX, arrow.tipY, lx, ly, rx, ry);
}

/** Compute the parallel-line offset for the i-th ware out of `wareCount` lanes on a route. */
function laneOffsetFor(laneIndex: number, wareCount: number): number {
  return (laneIndex - (wareCount - 1) / 2) * overviewTradeVisuals.lineStroke * overviewTradeVisuals.lineGapMultiplier;
}

/** Gray baseline: one line per ware per route. Shares the gradient and arrow head with accent lines so direction reads everywhere. */
function drawBaselineRoutes(
  linesGraphics: Phaser.GameObjects.Graphics,
  routes: TradeRouteData[],
  stationById: Map<string, StationPosition>,
): void {
  for (const route of routes) {
    const geom = computeRouteLineGeometry(route, stationById);
    if (geom === null) continue;
    const { ux, uy, px, py, sx, sy, ex, ey, wareCount } = geom;
    for (let i = 0; i < wareCount; i++) {
      const lineOffset = laneOffsetFor(i, wareCount);
      const startX = sx + px * lineOffset, startY = sy + py * lineOffset;
      const endX = ex + px * lineOffset, endY = ey + py * lineOffset;
      drawGradientLine(linesGraphics, { startX, startY, endX, endY }, overviewTradeVisuals.baselineLineRgb);
      drawArrowHead(linesGraphics, { tipX: endX, tipY: endY, directionX: ux, directionY: uy }, overviewTradeVisuals.baselineLineRgb);
    }
  }
}

interface LabelCandidate { cx: number; cy: number; text: string; activity: number; }

interface HighlightSelection {
  highlightWare: WareId;
  greenRouteKeys: Set<string>;
}

/** Green overlay: paints over the baseline at the same offset so stacking stays aligned. Returns label candidates for centered "N shipments" placement. */
function drawHighlightedRoutesAndCollectLabels(
  linesGraphics: Phaser.GameObjects.Graphics,
  routes: TradeRouteData[],
  selection: HighlightSelection,
  stationById: Map<string, StationPosition>,
): LabelCandidate[] {
  const { highlightWare, greenRouteKeys } = selection;
  const labelCandidates: LabelCandidate[] = [];
  for (const route of routes) {
    if (!greenRouteKeys.has(`${route.fromStationId}::${route.toStationId}`)) continue;
    const index = route.wares.indexOf(highlightWare);
    if (index < 0) continue;
    const geom = computeRouteLineGeometry(route, stationById);
    if (geom === null) continue;
    const { ux, uy, px, py, sx, sy, ex, ey, wareCount } = geom;
    const lineOffset = laneOffsetFor(index, wareCount);
    const startX = sx + px * lineOffset, startY = sy + py * lineOffset;
    const endX = ex + px * lineOffset, endY = ey + py * lineOffset;
    drawGradientLine(linesGraphics, { startX, startY, endX, endY }, overviewTradeVisuals.accentRgb);
    drawArrowHead(linesGraphics, { tipX: endX, tipY: endY, directionX: ux, directionY: uy }, overviewTradeVisuals.accentRgb);

    const activity = route.wareActivity.get(highlightWare) ?? 0;
    const labelText = formatTradeCount(activity);
    if (labelText !== null) {
      labelCandidates.push({
        cx: (startX + endX) / 2,
        cy: (startY + endY) / 2,
        text: labelText,
        activity,
      });
    }
  }
  return labelCandidates;
}

/** Station rings: green if on a highlighted route, gray otherwise. */
function drawStationRings(
  ringsGraphics: Phaser.GameObjects.Graphics,
  stationById: Map<string, StationPosition>,
  greenStations: Set<string>,
): void {
  for (const [id, station] of stationById) {
    const isGreen = greenStations.has(id);
    const color = isGreen ? overviewTradeVisuals.accentRgb : overviewTradeVisuals.neutralRingRgb;
    const alpha = isGreen ? overviewTradeVisuals.fullAlpha : 0.75;
    ringsGraphics.lineStyle(overviewTradeVisuals.stationRingStroke, color, alpha);
    ringsGraphics.strokeCircle(station.x, station.y, overviewTradeVisuals.endpointPad);
  }
}

interface LabelBox { left: number; top: number; right: number; bottom: number; }

interface LabelPool {
  acquire(): LabelSlot;
  /** Pretend the most recently acquired slot was never acquired — used when the caller rejects a placement. */
  releaseLastAcquired(slot: LabelSlot): void;
  hideUnused(): void;
  clearAll(): void;
  destroy(): void;
}

/** Owns the pool of pooled label slots that grow monotonically across redraws. */
function createLabelPool(scene: Scene): LabelPool {
  // Pool grows monotonically; excess slots hidden between redraws.
  const labelPool: LabelSlot[] = [];
  let activeLabelCount = 0;

  function acquire(): LabelSlot {
    if (activeLabelCount < labelPool.length) {
      const slot = labelPool[activeLabelCount++];
      slot.background.setVisible(true);
      slot.text.setVisible(true);
      return slot;
    }
    const background = scene.add.graphics();
    background.setDepth(Layer.TradeRouteLabels);
    const text = scene.add.text(0, 0, "", {
      fontFamily: MONO_FONT_FAMILY,
      fontSize: `${overviewTradeVisuals.tradeLabelFontPixels}px`,
      color: "#000000",
      fontStyle: "bold",
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(Layer.TradeRouteLabels + 0.01);
    const slot: LabelSlot = { background, text };
    labelPool.push(slot);
    activeLabelCount++;
    return slot;
  }

  function releaseLastAcquired(slot: LabelSlot): void {
    activeLabelCount--;
    slot.background.setVisible(false);
    slot.text.setVisible(false);
  }

  function hideUnused(): void {
    for (let i = activeLabelCount; i < labelPool.length; i++) {
      labelPool[i].background.setVisible(false);
      labelPool[i].text.setVisible(false);
    }
  }

  function clearAll(): void {
    // Hide active labels but keep them in the pool for the next redraw.
    for (let i = 0; i < activeLabelCount; i++) {
      labelPool[i].background.setVisible(false);
      labelPool[i].text.setVisible(false);
    }
    activeLabelCount = 0;
  }

  function destroy(): void {
    for (const slot of labelPool) {
      slot.background.destroy();
      slot.text.destroy();
    }
    labelPool.length = 0;
    activeLabelCount = 0;
  }

  return { acquire, releaseLastAcquired, hideUnused, clearAll, destroy };
}

function placeLabel(
  pool: LabelPool,
  candidate: LabelCandidate,
  placedBoxes: LabelBox[],
): void {
  const slot = pool.acquire();
  slot.text.setText(candidate.text);
  slot.text.setPosition(candidate.cx, candidate.cy);
  const backgroundWidth = slot.text.width + overviewTradeVisuals.tradeLabelPadX * 2;
  const backgroundHeight = slot.text.height + overviewTradeVisuals.tradeLabelPadY * 2;
  const left = candidate.cx - backgroundWidth / 2;
  const top = candidate.cy - backgroundHeight / 2;
  const right = left + backgroundWidth;
  const bottom = top + backgroundHeight;
  const overlaps = placedBoxes.some((placedBox) =>
    left < placedBox.right && right > placedBox.left && top < placedBox.bottom && bottom > placedBox.top,
  );
  if (overlaps) {
    pool.releaseLastAcquired(slot);
    return;
  }
  slot.background.clear();
  slot.background.fillStyle(overviewTradeVisuals.accentRgb, 1);
  slot.background.fillRoundedRect(left, top, backgroundWidth, backgroundHeight, overviewTradeVisuals.tradeLabelRadius);
  placedBoxes.push({ left, top, right, bottom });
}

/** Sort by activity descending so busier labels place first; lower-activity labels whose box would overlap get dropped. */
function placeLabelsBusiestFirst(pool: LabelPool, labelCandidates: LabelCandidate[]): void {
  labelCandidates.sort((a, b) => b.activity - a.activity);
  const placedBoxes: LabelBox[] = [];
  for (const candidate of labelCandidates) placeLabel(pool, candidate, placedBoxes);
  pool.hideUnused();
}

export function createTradeRouteRender(scene: Scene): TradeRouteRender {
  const linesGraphics = scene.add.graphics();
  linesGraphics.setDepth(Layer.TradeRouteLines);
  linesGraphics.setVisible(false);

  const ringsGraphics = scene.add.graphics();
  ringsGraphics.setDepth(Layer.TradeRouteRings);
  ringsGraphics.setVisible(false);

  const labelPool = createLabelPool(scene);

  function clear(): void {
    linesGraphics.clear();
    ringsGraphics.clear();
    labelPool.clearAll();
  }

  function setVisible(visible: boolean): void {
    linesGraphics.setVisible(visible);
    ringsGraphics.setVisible(visible);
    if (!visible) clear();
  }

  function redraw(
    routes: TradeRouteData[],
    selectedWare: WareSelection,
    stationById: Map<string, StationPosition>,
  ): void {
    linesGraphics.clear();
    ringsGraphics.clear();
    labelPool.clearAll();

    const highlightWare = selectedWare === NONE ? null : (selectedWare as WareId);
    const { greenStations, greenRouteKeys } = computeGreenSelectionSets(routes, highlightWare);

    drawBaselineRoutes(linesGraphics, routes, stationById);

    if (highlightWare !== null) {
      const labelCandidates = drawHighlightedRoutesAndCollectLabels(
        linesGraphics,
        routes,
        { highlightWare, greenRouteKeys },
        stationById,
      );
      placeLabelsBusiestFirst(labelPool, labelCandidates);
    } else {
      labelPool.hideUnused();
    }

    drawStationRings(ringsGraphics, stationById, greenStations);
  }

  function destroy(): void {
    linesGraphics.destroy();
    ringsGraphics.destroy();
    labelPool.destroy();
  }

  return { redraw, setVisible, clear, destroy };
}
