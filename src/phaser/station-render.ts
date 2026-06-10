import { type Scene } from "phaser";
import { ringTwinkles, segmentTwinkles, stationOrbitRingRadius } from "../../data/station-visuals";
import { closeViewAlpha } from "./camera-fade";
import { displaySlotsForRing, drawInventorySegments } from "./inventory-ring-render";
import { LABEL_STYLE } from "./text-styles";
import { isVisibleInViewport } from "./viewport-culling";
import { updateIfDirty } from "../render-dirty-state";
import { GameObjectRenderPool } from "./game-object-render-pool";
import { Layer } from "../../data/visuals-layers";
import { updateStatusBadge, hideStatusBadge } from "./station-render-status-badge";
import type { StationTwinkle, StationVisualBundle } from "./station-visual-bundle";
import type { GameViewMode } from "../game-view-mode";
import type { InventorySlot } from "../sim-station";

/** One frame's worth of render context for a station — grouped so callers don't thread 7 separate args. */
export interface StationRenderFrame {
  timeSeconds: number;
  zoom: number;
  camera: Phaser.Cameras.Scene2D.Camera;
  viewMode: GameViewMode;
  selected: boolean;
  currentTick: number;
}

/** Per-scene station render system — owns the shared twinkle pool and drives per-station render. */
export interface StationRenderPool {
  /** Release pooled twinkles before each frame's render loop. */
  beginFrame(): void;
  updateStationRender(bundle: StationVisualBundle, frame: StationRenderFrame): void;
  /** Free the underlying Phaser objects; call on scene teardown. */
  destroy(): void;
}

/** Build the per-scene station render system. The shared twinkle pool feeds both ring and segment twinkles. */
export function createStationRenderPool(scene: Scene): StationRenderPool {
  const twinklePool = new GameObjectRenderPool<Phaser.GameObjects.Arc>(scene, (poolScene) => {
    const circle = poolScene.add.circle(0, 0, 1, 0xffffff, 1);
    circle.setDepth(Layer.StationBase);
    return circle;
  });

  function beginFrame(): void {
    twinklePool.releaseAll();
  }

  function updateStationRender(bundle: StationVisualBundle, frame: StationRenderFrame): void {
    if (isStationOffScreen(bundle, frame)) {
      renderOffScreenStation(bundle);
      return;
    }
    if (frame.viewMode === "overview") {
      renderOverviewStation(bundle);
      return;
    }
    renderNormalStation(bundle, frame, twinklePool);
  }

  function destroy(): void {
    twinklePool.destroy();
  }

  return { beginFrame, updateStationRender, destroy };
}

function isStationOffScreen(bundle: StationVisualBundle, frame: StationRenderFrame): boolean {
  // Selected stations stay live so the selection ring tracks them off-camera (the camera can be panned away).
  if (frame.selected) return false;
  return !isVisibleInViewport(frame.camera, { x: bundle.station.x, y: bundle.station.y });
}

function renderOffScreenStation(bundle: StationVisualBundle): void {
  bundle.ringImage.setVisible(false);
  bundle.graphics.setVisible(false);
  hideInventoryLabels(bundle);
  hideStatusBadge(bundle);
}

function renderOverviewStation(bundle: StationVisualBundle): void {
  // Overview mode draws its own station rings (green for ware-highlighted, dark otherwise) — hide ours to avoid stacking two rings; icon still shows.
  bundle.ringImage.setVisible(false);
  bundle.graphics.setVisible(false);
  hideInventoryLabels(bundle);
  // A hidden station body means the rewind overlay has the whole live bundle
  // hidden (player scrubbed to a past moment) — keep the badge hidden too
  // instead of re-showing it over the past station set.
  if (!bundle.baseImage.visible) {
    hideStatusBadge(bundle);
    return;
  }
  updateStatusBadge(bundle);
}

function renderNormalStation(
  bundle: StationVisualBundle,
  frame: StationRenderFrame,
  twinklePool: GameObjectRenderPool<Phaser.GameObjects.Arc>,
): void {
  const segmentAlpha = closeViewAlpha(frame.zoom);
  const ringAlpha = 1 - segmentAlpha;

  renderStationRingLayer(bundle, frame, ringAlpha, frame.timeSeconds, twinklePool);
  renderStationSegmentLayer(bundle, frame, segmentAlpha, frame.timeSeconds, twinklePool);

  if (frame.selected && segmentAlpha > 0.5) {
    showInventoryLabels(bundle, frame.currentTick, frame.selected);
  } else {
    hideInventoryLabels(bundle);
  }
  hideStatusBadge(bundle);
}

/** Static pre-rendered ring image plus pooled twinkles. Twinkles skip when the station is selected so the segment ring takes over visually. */
function renderStationRingLayer(
  bundle: StationVisualBundle,
  frame: StationRenderFrame,
  ringAlpha: number,
  timeSeconds: number,
  twinklePool: GameObjectRenderPool<Phaser.GameObjects.Arc>,
): void {
  bundle.ringImage.setVisible(ringAlpha > 0);
  if (ringAlpha <= 0) return;
  bundle.ringImage.setAlpha(ringAlpha);
  if (frame.selected) return;
  drawTwinklesPooled(twinklePool, {
    placement: { centerX: bundle.station.x, centerY: bundle.station.y, radius: stationOrbitRingRadius },
    twinkles: bundle.ringTwinkles,
    timeSeconds,
    alpha: ringAlpha,
    dot: {
      size: ringTwinkles.size,
      color: ringTwinkles.color,
      peakAlpha: ringTwinkles.peakAlpha[bundle.station.size],
    },
  });
}

/** Inventory segment fill (redrawn only when slot values or selection flips), plus pooled twinkles. */
function renderStationSegmentLayer(
  bundle: StationVisualBundle,
  frame: StationRenderFrame,
  segmentAlpha: number,
  timeSeconds: number,
  twinklePool: GameObjectRenderPool<Phaser.GameObjects.Arc>,
): void {
  if (segmentAlpha <= 0) {
    bundle.graphics.setVisible(false);
    return;
  }

  redrawInventorySegmentsIfDirty(bundle, frame);
  bundle.graphics.setAlpha(segmentAlpha);
  bundle.graphics.setVisible(true);

  if (frame.selected) return;
  drawTwinklesPooled(twinklePool, {
    placement: { centerX: bundle.station.x, centerY: bundle.station.y, radius: stationOrbitRingRadius },
    twinkles: bundle.segmentTwinkles,
    timeSeconds,
    alpha: segmentAlpha,
    dot: {
      size: segmentTwinkles.size,
      color: segmentTwinkles.color,
      peakAlpha: segmentTwinkles.peakAlpha[bundle.station.size],
    },
  });
}

function redrawInventorySegmentsIfDirty(bundle: StationVisualBundle, frame: StationRenderFrame): void {
  const slots = bundle.sortedSlots;
  updateIfDirty({
    state: bundle.segmentDirtyState,
    currentTick: frame.currentTick,
    isFocused: frame.selected,
    items: slots,
    getValue: readSlotCurrentAmount,
    forceDirty: frame.selected !== bundle.segmentSelectedLastDraw,
    onDirty: () => {
      bundle.graphics.clear();
      const ringSlots = displaySlotsForRing(slots);
      drawInventorySegments({
        graphics: bundle.graphics,
        x: bundle.station.x,
        y: bundle.station.y,
        radius: stationOrbitRingRadius,
        slots: ringSlots,
        arcs: bundle.segmentArcs,
        alpha: 1,
        selected: frame.selected,
      });
      bundle.segmentSelectedLastDraw = frame.selected;
    },
  });
}

interface TwinkleRenderParams {
  placement: { centerX: number; centerY: number; radius: number };
  twinkles: StationTwinkle[];
  timeSeconds: number;
  alpha: number;
  dot: { size: number; color: number; peakAlpha: number };
}

function computeTwinkleBrightness(timeSeconds: number, twinkle: StationTwinkle): number {
  // Wrap into [0, 1) — single % can return negative when phase is negative; the +1 then % normalizes it.
  const cycle = (((timeSeconds * twinkle.speed + twinkle.phase) % 1) + 1) % 1;
  // Each twinkle is dark for the first half of its cycle and pulses through
  // a single sine bump on the second half — keeps the ring sparse instead
  // of constantly lit.
  if (cycle < 0.5) return 0;
  return Math.sin((cycle - 0.5) * 2 * Math.PI);
}

function paintTwinkleDot(
  circle: Phaser.GameObjects.Arc,
  placement: { centerX: number; centerY: number; radius: number },
  twinkle: StationTwinkle,
  dot: { size: number; color: number; peakAlpha: number },
  alpha: number,
  brightness: number,
): void {
  circle.setPosition(
    placement.centerX + Math.cos(twinkle.angle) * placement.radius,
    placement.centerY + Math.sin(twinkle.angle) * placement.radius,
  );
  if (circle.radius !== dot.size) circle.radius = dot.size;
  circle.setFillStyle(dot.color);
  circle.setAlpha(brightness * dot.peakAlpha * alpha);
}

function drawTwinklesPooled(
  twinklePool: GameObjectRenderPool<Phaser.GameObjects.Arc>,
  params: TwinkleRenderParams,
): void {
  const { placement, twinkles, timeSeconds, alpha, dot } = params;
  for (const twinkle of twinkles) {
    const brightness = computeTwinkleBrightness(timeSeconds, twinkle);
    if (brightness <= 0) continue;
    paintTwinkleDot(twinklePool.acquire(), placement, twinkle, dot, alpha, brightness);
  }
}

// Hoisted so updateIfDirty's snapshot loop doesn't allocate a new closure per call.
const readSlotCurrentAmount = (slot: { current: number }) => slot.current;

interface LabelPlacement {
  x: number;
  y: number;
  originX: number;
  originY: number;
  align: "left" | "right" | "center";
}

function getLabelPlacements(
  stationX: number,
  stationY: number,
  slotCount: number,
  ringRadius: number,
): LabelPlacement[] {
  const labelDistance = ringRadius + 22;
  if (slotCount === 1) {
    return [{ x: stationX, y: stationY - labelDistance, originX: 0.5, originY: 1, align: "center" }];
  }
  if (slotCount === 2) {
    return [
      { x: stationX + labelDistance, y: stationY, originX: 0, originY: 0.5, align: "left" }, // right (produced)
      { x: stationX - labelDistance, y: stationY, originX: 1, originY: 0.5, align: "right" }, // left
    ];
  }
  return [
    { x: stationX, y: stationY - labelDistance, originX: 0.5, originY: 1, align: "center" }, // top (output)
    { x: stationX + labelDistance, y: stationY, originX: 0, originY: 0.5, align: "left" }, // right
    { x: stationX - labelDistance, y: stationY, originX: 1, originY: 0.5, align: "right" }, // left
  ];
}

function hideInventoryLabels(bundle: StationVisualBundle): void {
  for (const label of bundle.inventoryLabels) label.setVisible(false);
}

function showInventoryLabels(bundle: StationVisualBundle, currentTick: number, selected: boolean): void {
  ensureInventoryLabels(bundle);
  refreshInventoryLabelTextIfDirty(bundle, currentTick, selected);
}

/** Lazy-create the per-slot label objects on first show. The slot count never changes for a station, so we only run once. */
function ensureInventoryLabels(bundle: StationVisualBundle): void {
  if (bundle.inventoryLabels.length > 0) return;
  const scene = bundle.graphics.scene;
  const placements = getLabelPlacements(
    bundle.station.x,
    bundle.station.y,
    bundle.segmentArcs.length,
    stationOrbitRingRadius,
  );
  for (const placement of placements) {
    bundle.inventoryLabels.push(createInventoryLabel(scene, placement));
  }
}

function createInventoryLabel(scene: Scene, placement: LabelPlacement): Phaser.GameObjects.Text {
  return scene.add
    .text(placement.x, placement.y, "", {
      ...LABEL_STYLE,
      color: "#cccccc",
      align: placement.align,
    })
    .setOrigin(placement.originX, placement.originY)
    .setResolution(3)
    .setDepth(Layer.InventoryLabel);
}

function refreshInventoryLabelTextIfDirty(
  bundle: StationVisualBundle,
  currentTick: number,
  selected: boolean,
): void {
  const slots = bundle.sortedSlots;
  const dirty = updateIfDirty({
    state: bundle.labelDirtyState,
    currentTick,
    isFocused: selected,
    items: slots,
    getValue: readSlotCurrentAmount,
    forceDirty: false,
    onDirty: () => refreshInventoryLabelText(bundle),
  });
  if (dirty) return;
  for (const label of bundle.inventoryLabels) label.setVisible(true);
}

function showNoWaresPlaceholder(bundle: StationVisualBundle): void {
  bundle.inventoryLabels[0].setText("No Wares");
  bundle.inventoryLabels[0].setVisible(true);
  for (let i = 1; i < bundle.inventoryLabels.length; i++) bundle.inventoryLabels[i].setVisible(false);
}

function refreshInventoryLabelText(bundle: StationVisualBundle): void {
  const slots = bundle.sortedSlots;
  if (slots.length === 0) {
    showNoWaresPlaceholder(bundle);
    return;
  }
  for (let i = 0; i < bundle.inventoryLabels.length; i++) {
    const label = bundle.inventoryLabels[i];
    if (i >= slots.length) {
      label.setVisible(false);
      continue;
    }
    setInventoryLabelTextFromSlot(label, slots[i], bundle.producedIds);
    label.setVisible(true);
  }
}

function setInventoryLabelTextFromSlot(
  label: Phaser.GameObjects.Text,
  slot: InventorySlot,
  producedIds: Set<string>,
): void {
  const percent = slot.max > 0 ? (slot.current / slot.max) * 100 : 0;
  const percentDisplay = percent < 0.01 ? "0" : percent.toFixed(2);
  const arrow = producedIds.has(slot.ware.id) ? "⏶" : "⏷";
  label.setText(`${slot.ware.name}\n${arrow} ${percentDisplay}%`);
}
