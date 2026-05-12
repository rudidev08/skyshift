// Per-ship UI overlay — selection label + cargo ring + cargo amount label.
// Shown only when the player has selected the ship and the orbit/flight
// sprite is interactable; hidden otherwise.

import { type Scene } from "phaser";
import { closeViewAlpha } from "./camera-fade";
import { SHIP_SQUARE } from "../render-ship-hull";
import { type Ship } from "../sim-ships";
import { shipCodeNameLabel } from "../sim-ship-template";
import { LABEL_STYLE, updateIfDirty, createRenderDirtyState, type RenderDirtyState } from "./viewport-culling";
import { Layer } from "./depth-layers";
import { createInventoryRing, drawInventorySegments, destroyInventoryRing, TOP_SEGMENT_ARC, type InventoryRing } from "./inventory-ring-render";
import { formatQuantity } from "../util-quantity-format";
import { bodyRadiusBySize } from "../../data/stations";
import { stationVisuals } from "../../data/station-visuals";

const SHIP_RING_RADIUS = bodyRadiusBySize.L + stationVisuals.inventoryRingDistanceFromBody;
const getSlotCurrent = (slot: { current: number }) => slot.current;

export interface ShipUi {
  label: Phaser.GameObjects.Text;
  inventoryRing: InventoryRing;
  cargoLabel: Phaser.GameObjects.Text;
  ringSlots: { current: number; max: number }[];
  cargoDirtyState: RenderDirtyState;
}

/** Frame-derived state threaded through the ship-render update tree. Camera
 *  and clock values are stable for the duration of one render frame. */
export interface ShipRenderFrame {
  labelVisible: boolean;
  labelAlpha: number;
  zoom: number;
  camera: Phaser.Cameras.Scene2D.Camera;
  timeSec: number;
  currentTick: number;
}

/** Per-frame update inputs for one ship's UI overlay. */
export interface ShipUiUpdate {
  shipUi: ShipUi;
  positionX: number;
  positionY: number;
  cargo: number;
  wareName: string | null;
  selected: boolean;
  isShipInteractable: boolean;
  frame: ShipRenderFrame;
}

export function createShipUi(scene: Scene, ship: Ship, cargoCapacity: number): ShipUi {
  const labelText = shipCodeNameLabel(ship);
  const label = scene.add.text(0, 0, labelText, LABEL_STYLE)
    .setOrigin(0.5, 0).setResolution(3).setVisible(false);

  // Higher depth than station overlays so the ring shows when a selected ship orbits its home station.
  const inventoryRing = createInventoryRing(scene, TOP_SEGMENT_ARC, Layer.ShipCargoRing);

  const cargoLabel = scene.add.text(0, 0, "", { ...LABEL_STYLE, color: "#cccccc", align: "center" })
    .setOrigin(0.5, 1).setResolution(3).setDepth(Layer.InventoryLabel).setVisible(false);

  return { label, inventoryRing, cargoLabel, ringSlots: [{ current: 0, max: cargoCapacity }], cargoDirtyState: createRenderDirtyState() };
}

function updateShipLabel(update: ShipUiUpdate) {
  const { shipUi, positionX, positionY, selected, isShipInteractable, frame } = update;
  const showLabel = selected && isShipInteractable && frame.labelVisible;
  if (showLabel) {
    shipUi.label.setPosition(positionX, positionY + SHIP_SQUARE + 4);
    shipUi.label.setAlpha(frame.labelAlpha);
  }
  shipUi.label.setVisible(showLabel);
}

function updateShipCargoRing(update: ShipUiUpdate) {
  const { shipUi, positionX, positionY, cargo, wareName, selected, isShipInteractable, frame } = update;
  const segmentAlpha = (selected && isShipInteractable) ? closeViewAlpha(frame.zoom) : 0;
  const ringGraphics = shipUi.inventoryRing.graphics;

  if (segmentAlpha <= 0) {
    ringGraphics.setVisible(false);
    shipUi.cargoLabel.setVisible(false);
    return;
  }

  // Draw at origin, use setPosition for movement — avoids per-frame redraw.
  ringGraphics.setPosition(positionX, positionY);

  // Only redraw ring + label text on cargo changes.
  shipUi.ringSlots[0].current = cargo;
  updateIfDirty({
    state: shipUi.cargoDirtyState,
    currentTick: frame.currentTick,
    isFocused: true,
    items: shipUi.ringSlots,
    getValue: getSlotCurrent,
    forceReason: false,
    onDirty: () => {
      ringGraphics.clear();
      drawInventorySegments({
        graphics: ringGraphics,
        x: 0,
        y: 0,
        radius: SHIP_RING_RADIUS,
        slots: shipUi.ringSlots,
        arcs: shipUi.inventoryRing.arcs,
        alpha: 1,
        selected: true,
      });
      if (cargo > 0 && wareName) {
        shipUi.cargoLabel.setText(`${wareName} (${formatQuantity(cargo)})`);
      } else {
        shipUi.cargoLabel.setText("No cargo");
      }
    },
  });
  ringGraphics.setAlpha(segmentAlpha);
  ringGraphics.setVisible(true);

  const labelDistance = SHIP_RING_RADIUS + 22;
  shipUi.cargoLabel.setPosition(positionX, positionY - labelDistance);
  shipUi.cargoLabel.setAlpha(segmentAlpha);
  shipUi.cargoLabel.setVisible(true);
}

/** Position UI elements at the given map coords; caller supplies cargo data. */
export function updateShipUi(update: ShipUiUpdate) {
  updateShipLabel(update);
  updateShipCargoRing(update);
}

export function hideShipUi(shipUi: ShipUi) {
  shipUi.label.setVisible(false);
  shipUi.inventoryRing.graphics.setVisible(false);
  shipUi.cargoLabel.setVisible(false);
}

export function destroyShipUi(shipUi: ShipUi) {
  shipUi.label.destroy();
  shipUi.cargoLabel.destroy();
  destroyInventoryRing(shipUi.inventoryRing);
}
