import { type Scene } from "phaser";
import type { StationSize } from "../../data/station-types";
import type { Station } from "../sim-station-types";
import { closeViewAlpha } from "./camera-fade";
import { getAllInventorySlots, type InventorySlot } from "../sim-station";
import { sortWares } from "../sim-ware-template";
import { bodyRadiusBySize } from "../../data/stations";
import { ringTwinkles, segmentTwinkles, stationVisuals } from "../../data/station-visuals";
import { getSegmentArcsForSlotCount, type WareInventoryArc } from "./inventory-ring-render";
import { hexToNumber } from "../util-hex-color";
import { LABEL_STYLE } from "./text-styles";
import { createRenderDirtyState, type RenderDirtyState } from "../render-dirty-state";
import { ensureStationRingTexture, getStationIconTextureKey, ICON_TEXTURE_SIZE } from "./texture-cache";
import { Layer } from "../../data/visuals-layers";
import { StationSelectionTarget } from "./station-render-selection";
import { destroyStatusBadge } from "./station-render-status-badge";
import type { Selection } from "./selection-input";

/** Gradient-sphere radius — varies by S/M/L so sizes look distinct when zoomed out. The black-disc base uses stationVisuals.iconRadius (size-independent). */
export function getStationBodyRadius(station: { size: StationSize }): number {
  return bodyRadiusBySize[station.size];
}

/** Lighten (positive `brightnessDelta`) or darken (negative) a hex color by
 *  that fraction of full white/black. Returns an `rgb(...)` string. */
function lightenOrDarkenHexColor(hex: string, brightnessDelta: number): string {
  const num = hexToNumber(hex);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * brightnessDelta)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * brightnessDelta)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(255 * brightnessDelta)));
  return `rgb(${r},${g},${b})`;
}

/** One pulsing dot on the inventory ring — angle is fixed, brightness oscillates from phase + speed × time. Render-only. */
export interface StationTwinkle {
  angle: number;
  phase: number;
  speed: number;
}

/** Every Phaser surface a station owns, plus per-station render state. Lets
 *  boot and dynamic-add paths create the full set in one call and
 *  `destroyStationVisualBundle` tear it down symmetrically. */
export interface StationVisualBundle {
  station: Station;
  nameLabel: Phaser.GameObjects.Text;
  baseImage: Phaser.GameObjects.Image;
  overlayImage: Phaser.GameObjects.Image;
  iconImage: Phaser.GameObjects.Image;
  ringImage: Phaser.GameObjects.Image;
  graphics: Phaser.GameObjects.Graphics;
  inventoryLabels: Phaser.GameObjects.Text[];
  selectionTarget: StationSelectionTarget;
  // Per-station canvas textures, removed on teardown. Icon and ring textures are shared and stay loaded.
  baseTextureKey: string;
  overlayTextureKey: string;
  // Sorted produced-then-input, in canonical ware order. Sorted once at creation since slot set and order never change; the slot objects themselves stay live because they're shared with sim.
  sortedSlots: readonly InventorySlot[];
  ringRadius: number;
  ringTwinkles: StationTwinkle[];
  segmentTwinkles: StationTwinkle[];
  segmentArcs: WareInventoryArc[];
  producedIds: Set<string>;
  segmentDirtyState: RenderDirtyState;
  lastSegmentSelected: boolean;
  labelDirtyState: RenderDirtyState;
  statusBadgeCircle?: Phaser.GameObjects.Arc;
  statusBadgeText?: Phaser.GameObjects.Text;
  statusBadgeTween?: Phaser.Tweens.Tween;
  statusBadgeKind?: "warn" | "bad";
}

/** Black disc base plus nation-colored atmosphere ring. Visible when zoomed in. */
function drawStationBaseLayer(
  scene: Scene,
  station: Station,
  hex: string,
  textureSize: number,
): { image: Phaser.GameObjects.Image; textureKey: string } {
  const textureKey = `station-base-${station.id}`;
  const canvas = scene.textures.createCanvas(textureKey, textureSize, textureSize);
  if (canvas) {
    const ctx = canvas.getContext();
    const centerX = textureSize / 2;
    const centerY = textureSize / 2;

    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(centerX, centerY, stationVisuals.iconRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = hex;
    ctx.lineWidth = stationVisuals.atmosphereRingWidth;
    ctx.beginPath();
    ctx.arc(
      centerX,
      centerY,
      stationVisuals.iconRadius + stationVisuals.atmosphereRingWidth / 2,
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    canvas.refresh();
  }
  const image = scene.add.image(station.x, station.y, textureKey).setDepth(Layer.StationBase);
  return { image, textureKey };
}

/** Gradient sphere with per-size radius, so S/M/L look distinct when zoomed out. */
function drawStationOverlayLayer(
  scene: Scene,
  station: Station,
  hex: string,
  textureSize: number,
): { image: Phaser.GameObjects.Image; textureKey: string } {
  const textureKey = `station-overlay-${station.id}`;
  const canvas = scene.textures.createCanvas(textureKey, textureSize, textureSize);
  if (canvas) {
    const ctx = canvas.getContext();
    const centerX = textureSize / 2;
    const centerY = textureSize / 2;
    const radius = getStationBodyRadius(station);

    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, lightenOrDarkenHexColor(hex, 0.25));
    gradient.addColorStop(0.5, hex);
    gradient.addColorStop(1, lightenOrDarkenHexColor(hex, -0.35));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = hex;
    ctx.lineWidth = stationVisuals.atmosphereRingWidth;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + stationVisuals.atmosphereRingWidth / 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 1;
    canvas.refresh();
  }
  const image = scene.add.image(station.x, station.y, textureKey).setDepth(Layer.StationBase);
  return { image, textureKey };
}

/** Nation-colored Lucide icon; fades in when zoomed in. */
function createStationIconImage(
  scene: Scene,
  station: Station,
  nationColor: number,
): Phaser.GameObjects.Image {
  const iconKey = getStationIconTextureKey(station.stationType.id);
  const iconSize = (stationVisuals.iconRadius * stationVisuals.iconScale) / ICON_TEXTURE_SIZE;
  const image = scene.add.image(station.x, station.y, iconKey);
  image.setDepth(Layer.StationBase);
  image.setScale(iconSize);
  image.setTint(nationColor);
  image.setAlpha(0);
  return image;
}

/** Twinkle dots distributed around the inventory ring perimeter. Count varies by station size. */
function createInventoryRingTwinkles(station: Station): StationTwinkle[] {
  const ringCount = ringTwinkles.count[station.size] ?? 1;
  const twinkles: StationTwinkle[] = [];
  for (let i = 0; i < ringCount; i++) {
    twinkles.push({
      angle: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      speed: ringTwinkles.speedMin + Math.random() * (ringTwinkles.speedMax - ringTwinkles.speedMin),
    });
  }
  return twinkles;
}

/** Twinkle dots scattered within each inventory segment arc. Count per segment varies by station size. */
function createInventorySegmentTwinkles(station: Station, segmentArcs: WareInventoryArc[]): StationTwinkle[] {
  const twinkles: StationTwinkle[] = [];
  for (const arc of segmentArcs) {
    const segmentCount = segmentTwinkles.count[station.size] ?? 8;
    for (let i = 0; i < segmentCount; i++) {
      const t = Math.random();
      twinkles.push({
        angle: arc.startAngle + t * (arc.endAngle - arc.startAngle),
        phase: Math.random() * Math.PI * 2,
        speed:
          segmentTwinkles.speedMin + Math.random() * (segmentTwinkles.speedMax - segmentTwinkles.speedMin),
      });
    }
  }
  return twinkles;
}

/** Produced-first sorted slot list, the produced-id set, and the segment-arc geometry.
 *  No-inventory stations (generational ship) still get one segment arc so the empty
 *  ring renders with a "No Wares" label instead of a blank circle. */
function buildInventoryRingLayout(station: Station): {
  sortedSlots: readonly InventorySlot[];
  producedIds: Set<string>;
  segmentArcs: WareInventoryArc[];
} {
  const producedIds = new Set(station.stationType.produces);
  const sortedSlots = [...getAllInventorySlots(station)].sort((a, b) => {
    const aIsOutput = producedIds.has(a.ware.id);
    const bIsOutput = producedIds.has(b.ware.id);
    if (aIsOutput !== bIsOutput) return aIsOutput ? -1 : 1;
    return sortWares(a.ware, b.ware);
  });
  const displayCount = sortedSlots.length === 0 ? 1 : sortedSlots.length;
  const segmentArcs = getSegmentArcsForSlotCount(displayCount);
  return { sortedSlots, producedIds, segmentArcs };
}

/** Y offset from station center to the top of the name label (shared with the editor so dragged stations match production placement). */
export function getStationNameLabelOffsetY(): number {
  return bodyRadiusBySize.L + stationVisuals.inventoryRingDistanceFromBody + 18;
}

/** Two-line station name + type/size label below the inventory ring. */
function createStationNameLabel(scene: Scene, station: Station): Phaser.GameObjects.Text {
  return scene.add
    .text(
      station.x,
      station.y + getStationNameLabelOffsetY(),
      `${station.name!}\n${station.typeAndSizeLabel}`,
      { ...LABEL_STYLE, align: "center", lineSpacing: 2 },
    )
    .setOrigin(0.5, 0)
    .setResolution(3)
    .setDepth(Layer.StationLabel);
}

/** Per-station graphics target for inventory segment fills, drawn under the body. */
function createStationGraphics(scene: Scene): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.setDepth(Layer.StationBase);
  return graphics;
}

/** Inventory ring texture (shared across stations), positioned at the station and hidden by default. */
function createStationRingImage(scene: Scene, station: Station): Phaser.GameObjects.Image {
  const ringImage = scene.add.image(station.x, station.y, ensureStationRingTexture(scene));
  ringImage.setDepth(Layer.StationBase);
  ringImage.setVisible(false);
  return ringImage;
}

/** Build all per-station Phaser objects + render state, register the
 *  station's selection target so it's clickable. Pass an already-created
 *  `Station`. */
export function createStationVisualBundle(
  scene: Scene,
  station: Station,
  selection: Selection,
): StationVisualBundle {
  const hex = station.nation.color;
  const nationColor = hexToNumber(hex);
  // Texture diameter sized for the size-independent black-disc base radius
  // (iconRadius, larger than any S/M/L body) plus a 10px buffer for the
  // atmosphere ring stroke — same canvas reused for all sizes.
  const textureSize = (stationVisuals.iconRadius + 10) * 2;

  const { image: baseImage, textureKey: baseTextureKey } = drawStationBaseLayer(
    scene,
    station,
    hex,
    textureSize,
  );
  baseImage.setData("stationId", station.id);
  const { image: overlayImage, textureKey: overlayTextureKey } = drawStationOverlayLayer(
    scene,
    station,
    hex,
    textureSize,
  );
  const iconImage = createStationIconImage(scene, station, nationColor);

  const nameLabel = createStationNameLabel(scene, station);
  baseImage.setData("label", nameLabel);

  const graphics = createStationGraphics(scene);
  // Ring is always at L body radius + ring distance regardless of station size.
  const ringRadius = bodyRadiusBySize.L + stationVisuals.inventoryRingDistanceFromBody;
  const ringImage = createStationRingImage(scene, station);

  const ringTwinkles = createInventoryRingTwinkles(station);
  const { sortedSlots, producedIds, segmentArcs } = buildInventoryRingLayout(station);
  const segmentTwinkles = createInventorySegmentTwinkles(station, segmentArcs);

  const selectionTarget = new StationSelectionTarget(station);
  selection.register(selectionTarget);

  return {
    station,
    nameLabel,
    baseImage,
    overlayImage,
    iconImage,
    ringImage,
    graphics,
    inventoryLabels: [],
    selectionTarget,
    baseTextureKey,
    overlayTextureKey,
    sortedSlots,
    ringRadius,
    ringTwinkles,
    segmentTwinkles,
    segmentArcs,
    producedIds,
    segmentDirtyState: createRenderDirtyState(),
    lastSegmentSelected: false,
    labelDirtyState: createRenderDirtyState(),
  };
}

/** Tear down all bundle surfaces, unregister from selection, and remove
 *  per-station canvas textures so scene remounts don't leak. */
export function destroyStationVisualBundle(
  scene: Scene,
  selection: Selection,
  bundle: StationVisualBundle,
): void {
  selection.unregister(bundle.selectionTarget);
  bundle.ringImage.destroy();
  bundle.graphics.destroy();
  for (const label of bundle.inventoryLabels) label.destroy();
  destroyStatusBadge(bundle);
  bundle.nameLabel.destroy();
  bundle.baseImage.destroy();
  bundle.overlayImage.destroy();
  bundle.iconImage.destroy();
  if (scene.textures.exists(bundle.baseTextureKey)) scene.textures.remove(bundle.baseTextureKey);
  if (scene.textures.exists(bundle.overlayTextureKey)) scene.textures.remove(bundle.overlayTextureKey);
}

// Zoom-cached state for updateStationDetails + updateStationLabels — alpha is constant per zoom level, so both helpers early-return when zoom is unchanged. One shared cache so the two `lastZoom` cursors can't drift apart.
const zoomedInCache: {
  lastDetailZoom: number | null;
  lastLabelZoom: number | null;
  labelState: { visible: boolean; alpha: number };
} = {
  lastDetailZoom: null,
  lastLabelZoom: null,
  labelState: { visible: false, alpha: 0 },
};

/** Reset cached zoom state. Call on scene recreation. */
export function resetStationZoomDetailCache() {
  zoomedInCache.lastDetailZoom = null;
  zoomedInCache.lastLabelZoom = null;
  zoomedInCache.labelState = { visible: false, alpha: 0 };
}

/** Crossfade gradient sphere (zoomed out) ↔ black disc + icon (zoomed in).
 *  Only updates when zoom changes — alpha is constant per zoom level. */
export function updateStationDetails(stationBundles: StationVisualBundle[], zoom: number) {
  if (zoom === zoomedInCache.lastDetailZoom) return;
  zoomedInCache.lastDetailZoom = zoom;

  const detailAlpha = closeViewAlpha(zoom);

  for (const bundle of stationBundles) {
    bundle.baseImage.setAlpha(detailAlpha);
    bundle.overlayImage.setAlpha(1 - detailAlpha);
    bundle.iconImage.setAlpha(detailAlpha);
  }
}

/** Show station name labels only at close zoom and fade them with the same curve as the icon. Returns the cached visibility state so the caller can skip its own per-bundle setVisible loop when nothing changed. */
export function updateStationLabels(
  stationBundles: StationVisualBundle[],
  zoom: number,
  stationLabelsVisible: boolean,
): { visible: boolean; alpha: number } {
  if (zoom === zoomedInCache.lastLabelZoom) return zoomedInCache.labelState;
  zoomedInCache.lastLabelZoom = zoom;

  const labelAlpha = closeViewAlpha(zoom);
  const showLabels = labelAlpha > 0;
  if (showLabels !== stationLabelsVisible) {
    for (const bundle of stationBundles) bundle.nameLabel.setVisible(showLabels);
  }
  if (showLabels) {
    for (const bundle of stationBundles) bundle.nameLabel.setAlpha(labelAlpha);
  }
  zoomedInCache.labelState.visible = showLabels;
  zoomedInCache.labelState.alpha = labelAlpha;
  return zoomedInCache.labelState;
}
