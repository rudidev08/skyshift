// Per-ship UI overlay — selection label + cargo ring + cargo amount label.
// Shown only when the player has selected the ship and the orbit/flight
// sprite is interactable; hidden otherwise.

import { type Scene } from "phaser";
import { closeViewAlpha } from "./camera-fade";
import { SHIP_SQUARE } from "../render-ship-hull";
import { type Ship } from "../sim-ships";
import { shipCodeNameLabel } from "../sim-ship-template";
import { LABEL_STYLE } from "./text-styles";
import { updateIfDirty, createRenderDirtyState, type RenderDirtyState } from "../render-dirty-state";
import { Layer } from "../../data/visuals-layers";
import { drawInventorySegments, getSegmentArcsForSlotCount } from "./inventory-ring-render";
import { formatQuantity } from "../util-quantity-format";
import { stationOrbitRingRadius } from "../../data/station-visuals";

// A ship's cargo ring reuses the 3-slot layout's first arc.
const TOP_SEGMENT_ARCS = [getSegmentArcsForSlotCount(3)[0]];

// Gap between the orbit ring and the cargo label above the ship.
const cargoLabelGapPixels = 22;
// Gap below the ship sprite to the selection name label.
const nameLabelGapPixels = 4;

export interface ShipUiBundle {
  label: Phaser.GameObjects.Text;
  cargoRingGraphics: Phaser.GameObjects.Graphics;
  cargoLabel: Phaser.GameObjects.Text;
  ringSlots: { current: number; max: number }[];
  cargoDirtyState: RenderDirtyState;
}

/** Frame-derived state threaded through the ship-render update tree. Camera
 *  and clock values are stable for the duration of one render frame. */
export interface ShipRenderFrame {
  zoom: number;
  camera: Phaser.Cameras.Scene2D.Camera;
  timeSeconds: number;
  currentTick: number;
}

/** Per-frame update inputs for one ship's UI overlay. */
export interface ShipUiUpdate {
  shipUi: ShipUiBundle;
  positionX: number;
  positionY: number;
  cargo: number;
  wareName: string | null;
  selected: boolean;
  isShipInteractable: boolean;
  frame: ShipRenderFrame;
}

export function createShipUi(scene: Scene, ship: Ship, cargoCapacity: number): ShipUiBundle {
  const labelText = shipCodeNameLabel(ship);
  const label = scene.add
    .text(0, 0, labelText, LABEL_STYLE)
    .setOrigin(0.5, 0)
    .setResolution(3)
    .setVisible(false);

  // Higher depth than station overlays so the ring shows when a selected ship orbits its home station.
  const cargoRingGraphics = scene.add.graphics();
  cargoRingGraphics.setDepth(Layer.ShipCargoRing);

  const cargoLabel = scene.add
    .text(0, 0, "", { ...LABEL_STYLE, color: "#cccccc", align: "center" })
    .setOrigin(0.5, 1)
    .setResolution(3)
    .setDepth(Layer.InventoryLabel)
    .setVisible(false);

  return {
    label,
    cargoRingGraphics,
    cargoLabel,
    ringSlots: [{ current: 0, max: cargoCapacity }],
    cargoDirtyState: createRenderDirtyState(),
  };
}

function updateShipLabel(update: ShipUiUpdate) {
  const { shipUi, positionX, positionY, frame } = update;
  const labelAlpha = closeViewAlpha(frame.zoom);
  const labelVisible = labelAlpha > 0;
  if (labelVisible) {
    shipUi.label.setPosition(positionX, positionY + SHIP_SQUARE + nameLabelGapPixels);
    shipUi.label.setAlpha(labelAlpha);
  }
  shipUi.label.setVisible(labelVisible);
}

function updateShipCargoRing(update: ShipUiUpdate) {
  const { shipUi, positionX, positionY, cargo, wareName, frame } = update;
  const segmentAlpha = closeViewAlpha(frame.zoom);
  const ringGraphics = shipUi.cargoRingGraphics;

  if (segmentAlpha <= 0) {
    ringGraphics.setVisible(false);
    shipUi.cargoLabel.setVisible(false);
    return;
  }

  // Draw at origin, use setPosition for movement — avoids per-frame redraw.
  ringGraphics.setPosition(positionX, positionY);

  // Throttled by sim tick and only redraws when cargo amount changed — avoids setText calls every frame.
  shipUi.ringSlots[0].current = cargo;
  updateIfDirty({
    state: shipUi.cargoDirtyState,
    currentTick: frame.currentTick,
    isFocused: true,
    items: shipUi.ringSlots,
    getValue: (slot) => slot.current,
    forceDirty: false,
    onDirty: () => {
      redrawCargoRingSegments(ringGraphics, shipUi);
      setCargoLabelText(shipUi, cargo, wareName);
    },
  });
  ringGraphics.setAlpha(segmentAlpha);
  ringGraphics.setVisible(true);

  const cargoLabelOffsetPixels = stationOrbitRingRadius + cargoLabelGapPixels;
  shipUi.cargoLabel.setPosition(positionX, positionY - cargoLabelOffsetPixels);
  shipUi.cargoLabel.setAlpha(segmentAlpha);
  shipUi.cargoLabel.setVisible(true);
}

function redrawCargoRingSegments(ringGraphics: Phaser.GameObjects.Graphics, shipUi: ShipUiBundle): void {
  ringGraphics.clear();
  drawInventorySegments({
    graphics: ringGraphics,
    x: 0,
    y: 0,
    radius: stationOrbitRingRadius,
    slots: shipUi.ringSlots,
    arcs: TOP_SEGMENT_ARCS,
    alpha: 1,
    selected: true,
  });
}

function setCargoLabelText(shipUi: ShipUiBundle, cargo: number, wareName: string | null): void {
  shipUi.cargoLabel.setText(cargo > 0 && wareName ? `${wareName} (${formatQuantity(cargo)})` : "No cargo");
}

/** Hides the UI when the ship is not selected or not interactable; otherwise updates label and cargo ring position and content. */
export function updateShipUi(update: ShipUiUpdate) {
  if (!update.selected || !update.isShipInteractable) {
    hideShipUi(update.shipUi);
    return;
  }
  updateShipLabel(update);
  updateShipCargoRing(update);
}

export function hideShipUi(shipUi: ShipUiBundle) {
  shipUi.label.setVisible(false);
  shipUi.cargoRingGraphics.setVisible(false);
  shipUi.cargoLabel.setVisible(false);
}

export function destroyShipUi(shipUi: ShipUiBundle) {
  shipUi.label.destroy();
  shipUi.cargoLabel.destroy();
  shipUi.cargoRingGraphics.destroy();
}
