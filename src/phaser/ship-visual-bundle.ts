// Per-ship render bundle — owns the bundle shape, the SelectionTarget, and
// the per-frame update orchestration. Lifecycle helpers (orbit pose,
// flight start/end, ship UI) live in sibling modules and are composed here.

import { type Scene } from "phaser";
import { TEXTURE_SCALE } from "../render-ship-hull";
import { getOrCreateShipTexture } from "./texture-cache";
import { type Ship } from "../sim-ships";
import { getShipTypeTemplate } from "../sim-ship-template";
import { getWareTemplate } from "../sim-ware-template";
import type { TradeManager } from "../sim-trade-manager";
import { getTotalCargo } from "../sim-trade-types";
import { getTradeShipDescription, getTradeShipStatusLabel, isTradeShipSelectable } from "../sim-trade-log";
import { EMPTY_SELECTION_LABEL } from "./selection-input";
import type { Selection, SelectionLabel, SelectionTarget } from "./selection-input";
import {
  type ShipTravelVisualBundle,
  destroyShipTravelVisualBundle,
  updateShipTravelVisualBundle,
} from "./ship-travel-visual-bundle";
import { hexToColorNumber } from "../util-hex-color";
import { isVisibleInViewport } from "./viewport-culling";
import { getShipHudIcon } from "../render-hud-icon";
import { announceShip } from "../audio-announcer";
import {
  createShipUi,
  destroyShipUi,
  hideShipUi,
  updateShipUi,
  type ShipRenderFrame,
  type ShipUiBundle,
} from "./ship-ui";
import { getOrbitingShipPose, type OrbitState, type ShipOrbitSlotAllocator } from "./ship-orbit-pool";
import { updateFlightLifecycle } from "./ship-flight-lifecycle";

// Safe to share — only one ship selected at a time.
const shipMapPositionScratch = { x: 0, y: 0 };

export interface ShipVisualBundle {
  ship: Ship;
  orbitSprite: Phaser.GameObjects.Image;
  selectionTarget: ShipSelectionTarget;
  shipUi: ShipUiBundle;
  travelBundle: ShipTravelVisualBundle | null;
  /** Render-owned orbit pose (radius, phase, angular speed); regenerated per
   *  bundle. Sim holds only the ship's home station — in-flight is derived
   *  from `tradeShip.flight !== null`. */
  orbit: OrbitState;
}

export class ShipSelectionTarget implements SelectionTarget {
  readonly kind = "ship" as const;
  private cachedLabel: SelectionLabel | null = null;
  private cachedQueueLength = -1;

  constructor(
    readonly ship: Ship,
    private bundle: ShipVisualBundle,
    private tradeManager: TradeManager,
  ) {}

  enterSelected() {
    this.cachedLabel = null;
    const shipType = getShipTypeTemplate(this.ship.shipTypeId);
    announceShip(this.ship.shipName, shipType.name, this.ship.station.nation);
  }

  exitSelected() {
    this.cachedLabel = null;
    hideShipUi(this.bundle.shipUi);
  }

  isActive() {
    return this.isCurrentlySelectable();
  }

  canSelect() {
    return this.isCurrentlySelectable();
  }

  /** Loading/unloading cargo or decommissioning makes the ship unselectable, so
   *  selecting it is blocked and an existing selection auto-clears.
   *  `isTradeShipSelectable` only allows idle or inter-station flight. */
  private isCurrentlySelectable(): boolean {
    const tradeShip = this.tradeManager.findTradeShip(this.ship);
    if (tradeShip && !isTradeShipSelectable(tradeShip)) return false;
    return true;
  }

  /** Refresh `cachedLabel` if the queue length changed (action completed) or
   *  the ship is idle (the description shows a live elapsed timer). Returns
   *  the up-to-date label. */
  private refreshLabelCacheIfStale(): SelectionLabel {
    const tradeShip = this.tradeManager.findTradeShip(this.ship);
    if (!tradeShip) return EMPTY_SELECTION_LABEL;

    const queueLength = tradeShip.actionQueue.length;
    if (this.cachedLabel && this.cachedQueueLength === queueLength && queueLength > 0) {
      return this.cachedLabel;
    }
    this.cachedQueueLength = queueLength;

    const nation = this.ship.station.nation;
    const shipType = getShipTypeTemplate(this.ship.shipTypeId);
    this.cachedLabel = {
      iconUri: getShipHudIcon(shipType),
      stackLabel: shipType.name,
      name: this.ship.shipName,
      serialCode: this.ship.id,
      description: getTradeShipDescription(tradeShip, this.tradeManager, this.tradeManager.tradeTimeSeconds),
      loreTypeName: `Ship Type: ${shipType.name}`,
      lore: shipType.lore,
      hasLog: true,
      accentColor: nation.color,
      statusLabel: getTradeShipStatusLabel(tradeShip),
    };
    return this.cachedLabel;
  }

  getSelectedLabel(): SelectionLabel {
    return this.refreshLabelCacheIfStale();
  }

  getMapPosition() {
    shipMapPositionScratch.x = this.bundle.orbitSprite.x;
    shipMapPositionScratch.y = this.bundle.orbitSprite.y;
    return shipMapPositionScratch;
  }
}

export interface ShipVisualBundleContext {
  scene: Scene;
  selection: Selection;
  tradeManager: TradeManager;
  orbitSlotAllocator: ShipOrbitSlotAllocator;
  bundleByShipId: Map<string, ShipVisualBundle>;
}

export function createShipVisualBundle(ship: Ship, context: ShipVisualBundleContext): ShipVisualBundle {
  const { scene, selection, tradeManager, orbitSlotAllocator, bundleByShipId } = context;
  const shipType = getShipTypeTemplate(ship.shipTypeId);
  const textureKey = getOrCreateShipTexture(scene, shipType);
  const tintColorNumber = hexToColorNumber(ship.station.nation.color);

  const orbit = orbitSlotAllocator.reserveOrbitSlot(ship.station.id);

  const nowSeconds = scene.time.now / 1000;
  const initialPose = getOrbitingShipPose(ship, orbit, nowSeconds);
  const orbitSprite = scene.add.image(initialPose.x, initialPose.y, textureKey);
  orbitSprite.setScale(1 / TEXTURE_SCALE);
  orbitSprite.setTint(tintColorNumber);
  orbitSprite.setVisible(false); // Deploy makes the orbit sprite visible (see updateFlightLifecycle).

  const shipTemplate = getShipTypeTemplate(ship.shipTypeId);
  const shipUi = createShipUi(scene, ship, shipTemplate.cargoCapacity);

  const bundle: ShipVisualBundle = {
    ship,
    orbitSprite,
    selectionTarget: undefined!,
    shipUi,
    travelBundle: null,
    orbit,
  };
  const selectionTarget = new ShipSelectionTarget(ship, bundle, tradeManager);
  bundle.selectionTarget = selectionTarget;
  selection.register(selectionTarget);
  bundleByShipId.set(ship.id, bundle);

  return bundle;
}

/** Hide every ship visual (orbit sprite, flight sprite/engine/trail, shared UI).
 *  Used by overview mode where the overlay owns the scene. */
export function hideShipForOverview(bundle: ShipVisualBundle): void {
  bundle.orbitSprite.setVisible(false);
  hideShipUi(bundle.shipUi);
  const travelBundle = bundle.travelBundle;
  if (travelBundle) {
    travelBundle.sprite.setVisible(false);
    travelBundle.engine.setVisible(false);
    travelBundle.trail.setVisible(false);
    travelBundle.ringPulse?.setVisible(false);
  }
}

/** Restore flight-render visibility after overview mode. Orbit sprite and
 *  shipUi self-heal through updateAllShipVisualBundles; flight sprite, trail, and ringPulse
 *  need an explicit nudge since their per-frame update doesn't touch visibility. */
export function restoreShipAfterOverview(bundle: ShipVisualBundle): void {
  const travelBundle = bundle.travelBundle;
  if (travelBundle) {
    travelBundle.sprite.setVisible(true);
    travelBundle.trail.setVisible(true);
    travelBundle.ringPulse?.setVisible(true);
    // Engine visibility is set each frame by updateShipTravelVisualBundle, so it restores itself.
  }
}

/** Per-frame: advance the flight lifecycle for each trade ship, then update
 *  every bundle's position and UI. A bundle draws as selected when its
 *  `selectionTarget` matches `selectedTarget`. */
export function updateAllShipVisualBundles(
  scene: Scene,
  bundleByShipId: Map<string, ShipVisualBundle>,
  frame: ShipRenderFrame,
  selectedTarget: SelectionTarget | null,
  tradeManager: TradeManager,
) {
  for (const tradeShip of tradeManager.tradeShips) {
    const bundle = bundleByShipId.get(tradeShip.orbitingShipId);
    if (bundle) updateFlightLifecycle(scene, bundle, tradeShip, tradeManager, frame.timeSeconds);
  }

  for (const bundle of bundleByShipId.values()) {
    const selected = bundle.selectionTarget === selectedTarget;
    updateShipVisualBundle(scene, bundle, frame, selected, tradeManager);
  }
}

function updateShipVisualBundle(
  scene: Scene,
  bundle: ShipVisualBundle,
  frame: ShipRenderFrame,
  selected: boolean,
  tradeManager: TradeManager,
) {
  const { x: positionX, y: positionY } = computeShipPosition(scene, bundle, frame);

  // Skip UI updates for off-screen ships (position above already updated).
  if (!selected && !isVisibleInViewport(frame.camera, { x: positionX, y: positionY })) {
    hideShipUi(bundle.shipUi);
    return;
  }

  const isShipInteractable = bundle.orbitSprite.visible || bundle.travelBundle !== null;

  // Cargo for shipUi — sum across all wares; label shows the first ware's name even when the ship carries multiple.
  const tradeShip = selected ? tradeManager.findTradeShip(bundle.ship) : null;
  const cargo = tradeShip ? getTotalCargo(tradeShip) : 0;
  const wareName = cargo > 0 ? getWareTemplate([...tradeShip!.cargoAmountByWareId.keys()][0]).name : null;

  updateShipUi({
    shipUi: bundle.shipUi,
    positionX,
    positionY,
    cargo,
    wareName,
    selected,
    isShipInteractable,
    frame,
  });
}

/** Flight: read position from travel bundle. Orbit: compute pose and set rotation.
 *  Both branches write to `orbitSprite` so callers and the selection ring always
 *  read a current position from the sprite. */
function computeShipPosition(
  scene: Scene,
  bundle: ShipVisualBundle,
  frame: ShipRenderFrame,
): { x: number; y: number } {
  if (bundle.travelBundle) {
    const flightPosition = updateShipTravelVisualBundle(scene, bundle.travelBundle);
    // Selection ring reads bundle.orbitSprite.x/y, so keep the orbit sprite positioned even while flying.
    bundle.orbitSprite.setPosition(flightPosition.x, flightPosition.y);
    return flightPosition;
  }
  const orbitPose = getOrbitingShipPose(bundle.ship, bundle.orbit, frame.timeSeconds);
  bundle.orbitSprite.setPosition(orbitPose.x, orbitPose.y);
  // Heading is tangent to the orbit circle — radial angle plus or minus 90°
  // depending on rotation direction (so ships always face along their motion).
  bundle.orbitSprite.setRotation(
    orbitPose.angle + (Math.sign(bundle.orbit.orbitSpeedRadiansPerSec) * Math.PI) / 2,
  );
  return { x: orbitPose.x, y: orbitPose.y };
}

export function destroyShipVisualBundle(bundle: ShipVisualBundle, context: ShipVisualBundleContext) {
  const { selection, orbitSlotAllocator, bundleByShipId } = context;
  // Without this, every emigration ferry leaks its SelectionTarget into the
  // registry — heap-leak-check showed +582 ShipSelectionTarget retained over
  // a 1-hour run despite the ships being decommissioned.
  selection.unregister(bundle.selectionTarget);
  bundle.orbitSprite.destroy();
  destroyShipUi(bundle.shipUi);
  if (bundle.travelBundle) {
    destroyShipTravelVisualBundle(bundle.travelBundle);
  }
  bundleByShipId.delete(bundle.ship.id);
  // Release orbit slot so later renders reuse it instead of pushing the base
  // radius ever outward as ships churn.
  orbitSlotAllocator.releaseOrbitSlot(bundle.ship.station.id);
}
