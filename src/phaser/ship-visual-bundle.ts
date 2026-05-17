// Per-ship render bundle — owns the bundle shape, the SelectionTarget, and
// the per-frame update orchestration. Lifecycle helpers (orbit pose,
// flight start/end, ship UI) live in sibling modules and are composed here.

import { type Scene } from "phaser";
import { TEXTURE_SCALE } from "../render-ship-hull";
import { ensureShipTexture } from "./texture-cache";
import { getNationShipTypeTemplate, type Ship } from "../sim-ships";
import { getShipTypeTemplate } from "../sim-ship-template";
import { getWareTemplate } from "../sim-ware-template";
import type { TradeManager } from "../sim-trade-manager";
import { getTotalCargo } from "../sim-trade-types";
import { getTradeShipDescription, getTradeShipStatusLabel, isTradeShipSelectable } from "../sim-trade-log";
import type { Selection, SelectionLabel, SelectionTarget } from "./selection-input";
import {
  type ShipTravelVisualBundle,
  destroyShipTravelVisualBundle,
  updateShipTravelVisualBundle,
} from "./ship-travel-visual-bundle";
import { hexToNumber } from "../util-hex-color";
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
import {
  createOrbitState,
  getOrbitingShipPose,
  type OrbitState,
  type ShipOrbitPool,
} from "./ship-orbit-pool";
import { updateFlightLifecycle } from "./ship-flight-lifecycle";
import type { ShipVisualBundlesByShipId } from "./ship-visual-bundles";

// Safe to share — only one ship selected at a time.
const shipMapPositionScratch = { x: 0, y: 0 };

export interface ShipVisualBundle {
  ship: Ship;
  orbitSprite: Phaser.GameObjects.Image;
  selectionTarget: ShipSelectionTarget;
  shipUi: ShipUiBundle;
  travelBundle: ShipTravelVisualBundle | null;
  /** Render-owned orbit visuals; regenerated per bundle. Sim holds only the
   *  ship's home station + inFlight flag. */
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
    const shipType = getNationShipTypeTemplate(this.ship.station.nation);
    announceShip(this.ship.shipName, shipType.name, this.ship.station.nation);
  }

  exitSelected() {
    this.cachedLabel = null;
    hideShipUi(this.bundle.shipUi);
  }

  isActive() {
    // Auto-clear selection if the ship enters an unselectable state (loading/unloading cargo, decommissioning) — `isTradeShipSelectable` only allows idle or inter-station flight.
    const tradeShip = this.tradeManager.findTradeShip(this.ship);
    if (tradeShip && !isTradeShipSelectable(tradeShip)) return false;
    return true;
  }

  canSelect() {
    const tradeShip = this.tradeManager.findTradeShip(this.ship);
    if (tradeShip && !isTradeShipSelectable(tradeShip)) return false;
    return true;
  }

  /** Refresh `cachedLabel` if the queue length changed (action completed) or
   *  the ship is idle (the description shows a live elapsed timer). Returns
   *  the up-to-date label. */
  private refreshLabelCacheIfStale(): SelectionLabel {
    const tradeShip = this.tradeManager.findTradeShip(this.ship);
    if (!tradeShip) return buildEmptyShipSelectionLabel();

    const queueLength = tradeShip.actionQueue.length;
    if (this.cachedLabel && this.cachedQueueLength === queueLength && queueLength > 0) {
      return this.cachedLabel;
    }
    this.cachedQueueLength = queueLength;

    const nation = this.ship.station.nation;
    const shipType = getNationShipTypeTemplate(nation);
    this.cachedLabel = {
      iconUri: getShipHudIcon(shipType),
      stackLabel: shipType.name,
      name: this.ship.shipName,
      serialCode: this.ship.id,
      description: getTradeShipDescription(tradeShip, this.tradeManager, this.tradeManager.tradeTime),
      loreTypeName: `Ship Type: ${shipType.name}`,
      lore: shipType.lore,
      hasDetails: true,
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

function buildEmptyShipSelectionLabel(): SelectionLabel {
  return {
    iconUri: "",
    stackLabel: "",
    name: "",
    serialCode: "",
    description: "",
    loreTypeName: "",
    lore: "",
    hasDetails: false,
    accentColor: "",
    statusLabel: "",
  };
}

export interface ShipVisualBundleContext {
  scene: Scene;
  selection: Selection;
  tradeManager: TradeManager;
  orbitPool: ShipOrbitPool;
  bundles: ShipVisualBundlesByShipId;
}

export function createShipVisualBundle(ship: Ship, context: ShipVisualBundleContext): ShipVisualBundle {
  const { scene, selection, tradeManager, orbitPool, bundles } = context;
  const shipType = getNationShipTypeTemplate(ship.station.nation);
  const textureKey = ensureShipTexture(scene, shipType);
  const color = hexToNumber(ship.station.nation.color);

  const slotIndex = orbitPool.reserveOrbitSlot(ship.station.id);
  const orbit = createOrbitState(slotIndex);

  const initialAngle = orbit.orbitAngleAtZero + orbit.orbitSpeedRadPerSec * (scene.time.now / 1000);
  const orbitSprite = scene.add.image(
    ship.station.x + Math.cos(initialAngle) * orbit.orbitRadius,
    ship.station.y + Math.sin(initialAngle) * orbit.orbitRadius,
    textureKey,
  );
  orbitSprite.setScale(1 / TEXTURE_SCALE);
  orbitSprite.setTint(color);
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
  const target = new ShipSelectionTarget(ship, bundle, tradeManager);
  bundle.selectionTarget = target;
  selection.register(target);
  bundles.add(bundle);

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
    // Engine visibility is driven by updateEngine based on flight phase.
  }
}

/** Update all ship renders — orbit visuals and flight lifecycle. Each bundle
 *  compares its `selectionTarget` to `selectedTarget` to decide whether to
 *  draw as selected. */
export function updateAllShipVisualBundles(
  scene: Scene,
  shipBundles: ShipVisualBundle[],
  frame: ShipRenderFrame,
  selectedTarget: SelectionTarget | null,
  tradeManager: TradeManager,
  bundles: ShipVisualBundlesByShipId,
) {
  for (const tradeShip of tradeManager.tradeShips) {
    const bundle = bundles.getById(tradeShip.orbitingShipId);
    if (bundle) updateFlightLifecycle(scene, bundle, tradeShip, tradeManager, frame.timeSec);
  }

  for (const shipRender of shipBundles) {
    const selected = shipRender.selectionTarget === selectedTarget;
    updateShipVisualBundle(scene, shipRender, frame, selected, tradeManager);
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

  // Selectable while orbit sprite shows or in flight.
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

/** Compute the ship's position for this frame and apply it to `orbitSprite`.
 *  Flight: read from travel bundle; orbit: compute pose and set rotation. */
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
  const orbitPose = getOrbitingShipPose(bundle.ship, bundle.orbit, frame.timeSec);
  bundle.orbitSprite.setPosition(orbitPose.x, orbitPose.y);
  // Heading is tangent to the orbit circle — radial angle plus or minus 90°
  // depending on rotation direction (so ships always face along their motion).
  bundle.orbitSprite.setRotation(
    orbitPose.angle + (Math.sign(bundle.orbit.orbitSpeedRadPerSec) * Math.PI) / 2,
  );
  return { x: orbitPose.x, y: orbitPose.y };
}

export function destroyShipVisualBundle(bundle: ShipVisualBundle, context: ShipVisualBundleContext) {
  const { selection, orbitPool, bundles } = context;
  // Without this, every emigration ferry leaks its SelectionTarget into the
  // registry — heap-leak-check showed +582 ShipSelectionTarget retained over
  // a 1-hour run despite the ships being decommissioned.
  selection.unregister(bundle.selectionTarget);
  bundle.orbitSprite.destroy();
  destroyShipUi(bundle.shipUi);
  if (bundle.travelBundle) {
    destroyShipTravelVisualBundle(bundle.travelBundle);
  }
  bundles.remove(bundle.ship.id);
  // Release orbit slot so later renders reuse it instead of pushing the base
  // radius ever outward as ships churn.
  orbitPool.releaseOrbitSlot(bundle.ship.station.id);
}
