// Trade-route overlay for overview mode's Trading tab. Per ware per route: one
// gradient-alpha line plus a consumer-end arrow head; "N shipments" label on
// each highlighted route; station rings (green if on a highlighted route, else
// neutral). Labels reuse a pool of Graphics + Text objects between redraws.

import type { Scene } from "phaser";
import type { WareId } from "../../data/ware-types";
import { overviewTradeVisuals } from "../../data/visuals-overview";
import { Layer } from "../../data/visuals-layers";
import { monoFontFamily } from "../../data/visuals-text";
import { formatTradeMagnitude } from "../util-quantity-format";

// Arrow head geometry scales with line stroke so the head stays proportional.
const ARROW_LENGTH_PIXELS = overviewTradeVisuals.lineStroke * overviewTradeVisuals.arrowLengthMultiplier;
const ARROW_HALF_WIDTH_PIXELS =
  overviewTradeVisuals.lineStroke * overviewTradeVisuals.arrowHalfWidthMultiplier;

/** "none" suppresses the green overlay and green station rings; baseline lines still render. */
export type WareSelection = WareId | "none";
export const NONE = "none";

export interface StationPosition {
  id: string;
  x: number;
  y: number;
}

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
  destroy(): void;
}

/** Pooled label slot — one graphics backdrop and one text child reused across redraws. */
interface LabelSlot {
  background: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
}

function formatShipmentLabel(activity: number): string | null {
  if (activity < 0.05) return null;
  const formatted = formatTradeMagnitude(activity);
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
  unitX: number;
  unitY: number;
  /** Perpendicular unit vector (rotated 90°), used for parallel-line offsetting. */
  perpendicularX: number;
  perpendicularY: number;
  /** From-side endpoint, pulled inward by endpointPad so lines stop at the station ring. */
  startX: number;
  startY: number;
  /** To-side endpoint, pulled inward by endpointPad so lines stop at the station ring. */
  endX: number;
  endY: number;
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
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const lineLength = Math.hypot(dx, dy);
  if (lineLength < 1) return null;
  const unitX = dx / lineLength,
    unitY = dy / lineLength;
  const perpendicularX = -unitY,
    perpendicularY = unitX;
  const startX = from.x + unitX * overviewTradeVisuals.endpointPad;
  const startY = from.y + unitY * overviewTradeVisuals.endpointPad;
  const endX = to.x - unitX * overviewTradeVisuals.endpointPad;
  const endY = to.y - unitY * overviewTradeVisuals.endpointPad;
  return {
    unitX,
    unitY,
    perpendicularX,
    perpendicularY,
    startX,
    startY,
    endX,
    endY,
    wareCount: route.wares.length,
  };
}

interface LineSegment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** Stepped sub-segments give the alpha gradient that brightens into the destination ring, encoding trade direction. `alphaMultiplier` scales the whole gradient (1 = full; <1 dims, e.g. baseline lines while a ware is selected). */
function drawGradientLine(
  linesGraphics: Phaser.GameObjects.Graphics,
  segment: LineSegment,
  color: number,
  alphaMultiplier: number,
): void {
  const segmentDeltaX = segment.endX - segment.startX;
  const segmentDeltaY = segment.endY - segment.startY;
  const segments = overviewTradeVisuals.gradientSegments;
  const alphaMin = overviewTradeVisuals.lineAlphaProducer;
  const alphaMax = overviewTradeVisuals.lineAlphaConsumer;
  for (let i = 0; i < segments; i++) {
    const fractionStart = i / segments;
    const fractionEnd = (i + 1) / segments;
    const alpha =
      (alphaMin + (alphaMax - alphaMin) * ((fractionStart + fractionEnd) / 2)) * alphaMultiplier;
    linesGraphics.lineStyle(overviewTradeVisuals.lineStroke, color, alpha);
    linesGraphics.lineBetween(
      segment.startX + segmentDeltaX * fractionStart,
      segment.startY + segmentDeltaY * fractionStart,
      segment.startX + segmentDeltaX * fractionEnd,
      segment.startY + segmentDeltaY * fractionEnd,
    );
  }
}

/** Filled triangle at the consumer end: tip at (tipX, tipY) along (directionX, directionY); back edge perpendicular at ARROW_LENGTH. `alphaMultiplier` matches the line it caps (1 = full; <1 dims). */
function drawArrowHead(
  linesGraphics: Phaser.GameObjects.Graphics,
  segment: LineSegment,
  lineGeometry: RouteLineGeometry,
  color: number,
  alphaMultiplier: number,
): void {
  const tipX = segment.endX,
    tipY = segment.endY;
  const directionX = lineGeometry.unitX,
    directionY = lineGeometry.unitY;
  const perpendicularX = -directionY,
    perpendicularY = directionX;
  const baseX = tipX - directionX * ARROW_LENGTH_PIXELS;
  const baseY = tipY - directionY * ARROW_LENGTH_PIXELS;
  const leftX = baseX + perpendicularX * ARROW_HALF_WIDTH_PIXELS;
  const leftY = baseY + perpendicularY * ARROW_HALF_WIDTH_PIXELS;
  const rightX = baseX - perpendicularX * ARROW_HALF_WIDTH_PIXELS;
  const rightY = baseY - perpendicularY * ARROW_HALF_WIDTH_PIXELS;
  linesGraphics.fillStyle(color, overviewTradeVisuals.arrowHeadAlpha * alphaMultiplier);
  linesGraphics.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
}

/** Compute the parallel-line offset for the i-th ware out of `wareCount` lanes on a route. */
function laneOffsetFor(laneIndex: number, wareCount: number): number {
  return (
    (laneIndex - (wareCount - 1) / 2) *
    overviewTradeVisuals.lineStroke *
    overviewTradeVisuals.lineGapMultiplier
  );
}

/** The from→to endpoints shifted onto lane `laneIndex` of `geometry.wareCount`
 *  parallel lanes, so a route's wares stack as evenly-spaced parallel lines. */
function offsetLineEndpoints(geometry: RouteLineGeometry, laneIndex: number): LineSegment {
  const laneOffset = laneOffsetFor(laneIndex, geometry.wareCount);
  return {
    startX: geometry.startX + geometry.perpendicularX * laneOffset,
    startY: geometry.startY + geometry.perpendicularY * laneOffset,
    endX: geometry.endX + geometry.perpendicularX * laneOffset,
    endY: geometry.endY + geometry.perpendicularY * laneOffset,
  };
}

/** Gray baseline: one line per ware per route. Shares the gradient and arrow head with accent lines so direction reads everywhere. `alphaMultiplier` dims the whole baseline pass while a ware is selected, so the green accent reads above it. */
function drawBaselineRoutes(
  linesGraphics: Phaser.GameObjects.Graphics,
  routes: TradeRouteData[],
  stationById: Map<string, StationPosition>,
  alphaMultiplier: number,
): void {
  for (const route of routes) {
    const lineGeometry = computeRouteLineGeometry(route, stationById);
    if (lineGeometry === null) continue;
    for (let laneIndex = 0; laneIndex < lineGeometry.wareCount; laneIndex++) {
      const segment = offsetLineEndpoints(lineGeometry, laneIndex);
      drawGradientLine(linesGraphics, segment, overviewTradeVisuals.baselineLineRgb, alphaMultiplier);
      drawArrowHead(
        linesGraphics,
        segment,
        lineGeometry,
        overviewTradeVisuals.baselineLineRgb,
        alphaMultiplier,
      );
    }
  }
}

interface LabelCandidate {
  centerX: number;
  centerY: number;
  text: string;
  activity: number;
}

interface HighlightSelection {
  highlightWare: WareId;
  greenRouteKeys: Set<string>;
}

/** Green overlay: paints over the baseline at the same lane offset so stacking stays aligned. */
function drawHighlightedRoutes(
  linesGraphics: Phaser.GameObjects.Graphics,
  routes: TradeRouteData[],
  selection: HighlightSelection,
  stationById: Map<string, StationPosition>,
): void {
  const { highlightWare, greenRouteKeys } = selection;
  for (const route of routes) {
    if (!greenRouteKeys.has(`${route.fromStationId}::${route.toStationId}`)) continue;
    const laneIndex = route.wares.indexOf(highlightWare);
    if (laneIndex < 0) continue;
    const lineGeometry = computeRouteLineGeometry(route, stationById);
    if (lineGeometry === null) continue;
    const segment = offsetLineEndpoints(lineGeometry, laneIndex);
    drawGradientLine(linesGraphics, segment, overviewTradeVisuals.accentRgb, 1);
    drawArrowHead(linesGraphics, segment, lineGeometry, overviewTradeVisuals.accentRgb, 1);
  }
}

/** Pure: one centered "N shipments" label candidate per highlighted route,
 *  positioned at the midpoint of that route's offset lane line. No Phaser. */
function collectHighlightedRouteLabels(
  routes: TradeRouteData[],
  selection: HighlightSelection,
  stationById: Map<string, StationPosition>,
): LabelCandidate[] {
  const { highlightWare, greenRouteKeys } = selection;
  const labelCandidates: LabelCandidate[] = [];
  for (const route of routes) {
    if (!greenRouteKeys.has(`${route.fromStationId}::${route.toStationId}`)) continue;
    const laneIndex = route.wares.indexOf(highlightWare);
    if (laneIndex < 0) continue;
    const lineGeometry = computeRouteLineGeometry(route, stationById);
    if (lineGeometry === null) continue;
    const segment = offsetLineEndpoints(lineGeometry, laneIndex);
    const activity = route.wareActivity.get(highlightWare) ?? 0;
    const labelText = formatShipmentLabel(activity);
    if (labelText === null) continue;
    labelCandidates.push({
      centerX: (segment.startX + segment.endX) / 2,
      centerY: (segment.startY + segment.endY) / 2,
      text: labelText,
      activity,
    });
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
    const alpha = isGreen ? overviewTradeVisuals.selectedRingAlpha : 0.75;
    ringsGraphics.lineStyle(overviewTradeVisuals.stationRingStroke, color, alpha);
    ringsGraphics.strokeCircle(station.x, station.y, overviewTradeVisuals.endpointPad);
  }
}

interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LabelPool {
  acquire(): LabelSlot;
  /** Pretend the most recently acquired slot was never acquired — used when the caller rejects a placement. */
  releaseLast(slot: LabelSlot): void;
  hideUnused(): void;
  clearAll(): void;
  destroy(): void;
}

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
    background.setDepth(Layer.TradeRouteLabelBackground);
    const text = scene.add.text(0, 0, "", {
      fontFamily: monoFontFamily,
      fontSize: `${overviewTradeVisuals.tradeLabelFontPixels}px`,
      color: "#000000",
      fontStyle: "bold",
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(Layer.TradeRouteLabelText);
    const slot: LabelSlot = { background, text };
    labelPool.push(slot);
    activeLabelCount++;
    return slot;
  }

  function releaseLast(slot: LabelSlot): void {
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

  return { acquire, releaseLast, hideUnused, clearAll, destroy };
}

function placeLabel(pool: LabelPool, candidate: LabelCandidate, placedBoxes: LabelBox[]): void {
  const slot = pool.acquire();
  slot.text.setText(candidate.text);
  slot.text.setPosition(candidate.centerX, candidate.centerY);
  const backgroundWidth = slot.text.width + overviewTradeVisuals.tradeLabelPadX * 2;
  const backgroundHeight = slot.text.height + overviewTradeVisuals.tradeLabelPadY * 2;
  const left = candidate.centerX - backgroundWidth / 2;
  const top = candidate.centerY - backgroundHeight / 2;
  const right = left + backgroundWidth;
  const bottom = top + backgroundHeight;
  const overlaps = placedBoxes.some(
    (placedBox) =>
      left < placedBox.right && right > placedBox.left && top < placedBox.bottom && bottom > placedBox.top,
  );
  if (overlaps) {
    pool.releaseLast(slot);
    return;
  }
  slot.background.clear();
  slot.background.fillStyle(overviewTradeVisuals.accentRgb, 1);
  slot.background.fillRoundedRect(
    left,
    top,
    backgroundWidth,
    backgroundHeight,
    overviewTradeVisuals.tradeLabelRadius,
  );
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
    clear();

    const highlightWare = selectedWare === NONE ? null : selectedWare;
    const { greenStations, greenRouteKeys } = computeGreenSelectionSets(routes, highlightWare);

    // Dim the gray baseline only while a ware is selected, so the green accent
    // overlay isn't competing with full-strength gray.
    const baselineAlphaMultiplier =
      highlightWare === null ? 1 : overviewTradeVisuals.baselineDimMultiplier;
    drawBaselineRoutes(linesGraphics, routes, stationById, baselineAlphaMultiplier);

    if (highlightWare !== null) {
      const selection: HighlightSelection = { highlightWare, greenRouteKeys };
      drawHighlightedRoutes(linesGraphics, routes, selection, stationById);
      placeLabelsBusiestFirst(labelPool, collectHighlightedRouteLabels(routes, selection, stationById));
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

  return { redraw, setVisible, destroy };
}
