import type { Game } from "../game";
import type { GameViewMode } from "../game-view-mode";
import {
  applySectorGridMode,
  createOverviewGrid,
  hideSectorGridVisuals,
  updateSectorCorners,
} from "./sector-grid";
import { updateStationZoneVisibility, StationZoneSelectionTarget } from "./station-zone-render";
import { hideShipForOverview, restoreShipAfterOverview } from "./ship-visual-bundle";
import { redrawAmbientTraffic } from "./ambient-traffic-render";
import { acquireScopedPause } from "./auto-release-pause";
import { cameraMinZoomPhaserClamp, overviewMinZoomPhaserClamp } from "../../data/controls-camera";
import type { SelectionKind } from "./selection-input";

/** Single entry point for view-mode changes — fans out to every subsystem so callers don't have to know the list. */
export function applyViewMode(scene: Game, mode: GameViewMode): void {
  setStationZonesForViewMode(scene, mode);
  showInfoPanel(scene, mode);

  // Body class lets CSS hide the floating lore-box and speed HUD in overview
  // without touching their own visibility state (lore-toggle, sim-running),
  // so the prior state restores when overview exits.
  document.body.classList.toggle("view-overview", mode === "overview");

  scene.selection.setAllowedKinds(mode === "overview" ? new Set<SelectionKind>(["station"]) : null);

  setOverviewPause(scene, mode);
  setMinZoom(scene, mode);
  setBackgroundsForViewMode(scene, mode);

  if (mode === "overview") {
    enterOverviewVisuals(scene);
  } else {
    exitOverviewVisuals(scene, mode);
  }

  scene.overviewMode?.update();
}

function setStationZonesForViewMode(scene: Game, mode: GameViewMode): void {
  const zonesVisible = mode === "zones";
  updateStationZoneVisibility(scene.stationZoneVisualBundles, zonesVisible);
  if (!zonesVisible) deselectHiddenZone(scene);
}

/** A selected zone would otherwise show invisible content in the panel. */
function deselectHiddenZone(scene: Game): void {
  if (scene.selection?.selectedTarget instanceof StationZoneSelectionTarget) {
    scene.selection.deselect();
  }
}

/** Hide the panel in overview (overlay has its own focus UI); editor never
 *  auto-shows the panel (no HUD updates run there). */
function showInfoPanel(scene: Game, mode: GameViewMode): void {
  if (scene.isEditorMode) return;
  scene.infoPanelElement.style.display = mode === "overview" ? "none" : scene.currentSector() ? "" : "none";
}

/** Auto-pause on entering overview; restore on leave if we paused it. */
function setOverviewPause(scene: Game, mode: GameViewMode): void {
  if (mode === "overview") {
    if (!scene.releaseOverviewPause) scene.releaseOverviewPause = acquireScopedPause();
    return;
  }
  if (scene.releaseOverviewPause) {
    scene.releaseOverviewPause();
    scene.releaseOverviewPause = null;
  }
}

/** Overview gets a deeper zoom-out so dense maps fit on screen; on exit
 *  restore the normal floor (camera-controls snaps zoom back up if below). */
function setMinZoom(scene: Game, mode: GameViewMode): void {
  const viewModeMinZoom = mode === "overview" ? overviewMinZoomPhaserClamp : cameraMinZoomPhaserClamp;
  scene.cameraControls?.setMinPhaserZoom(viewModeMinZoom);
  scene.zoomControls?.setMinPhaserZoom(viewModeMinZoom);
}

function setBackgroundsForViewMode(scene: Game, mode: GameViewMode): void {
  const inOverview = mode === "overview";
  scene.background.starsFar.setVisible(!inOverview);
  scene.background.starsNear.setVisible(!inOverview);
  for (const image of scene.background.nebulaImages) image.setVisible(!inOverview);
}

function enterOverviewVisuals(scene: Game): void {
  syncSectorGridVisibility(scene, "overview");
  if (!scene.overviewGrid) {
    scene.overviewGrid = createOverviewGrid(scene, scene.map);
  }
  scene.overviewGrid.setVisible(true);
  for (const shipRender of scene.shipBundleByShipId.values()) hideShipForOverview(shipRender);
  scene.ambientTraffic.dotPool.releaseAll();
}

function exitOverviewVisuals(scene: Game, mode: GameViewMode): void {
  scene.overviewGrid?.setVisible(false);
  syncSectorGridVisibility(scene, mode);
  for (const shipRender of scene.shipBundleByShipId.values()) restoreShipAfterOverview(shipRender);
  redrawAmbientTraffic(scene.ambientTraffic, performance.now(), scene.camera);
  // Orbit sprite + shipUi don't need explicit restore — updateAllShipVisualBundles rebuilds them next frame.
}

/** Shows or hides the normal sector grid based on view mode (overview hides it) and the player's gridMode preference. */
export function syncSectorGridVisibility(scene: Game, mode: GameViewMode): void {
  // Overview owns the overlay — keep the normal grid hidden even if the
  // player changes the grid preference while the overlay is open.
  if (mode === "overview") {
    hideSectorGridVisuals(scene.sectorGrid);
    return;
  }
  // Re-applying the preference resets auto-mode scroll tracking, which is what
  // a fresh auto activation needs after overview left it anchored to the
  // pre-overlay camera.
  applySectorGridMode(scene.sectorGrid, scene.sectorGrid.gridMode);
  updateSectorCorners(scene.sectorGrid, scene.map.sectors, scene.camera);
}
