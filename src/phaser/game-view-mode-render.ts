import type { Game } from "../game";
import type { GameViewMode } from "../game-view-mode";
import {
  createOverviewGrid,
  hideSectorGridVisuals,
  showSectorGridFullAlpha,
  resetAutoSectorGridState,
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

  // Restrict proximity selection to stations only while in overview.
  scene.selection.setAllowedKinds(mode === "overview" ? new Set<SelectionKind>(["station"]) : null);

  setOverviewPause(scene, mode);
  setMinZoom(scene, mode);
  setBackgrounds(scene, mode);

  if (mode === "overview") {
    enterOverviewVisuals(scene);
  } else {
    exitOverviewVisuals(scene, mode);
  }

  scene.overviewMode?.update();
}

function setStationZonesForViewMode(scene: Game, mode: GameViewMode): void {
  const zonesVisible = mode === "zones";
  scene.stationZonesVisibleRef.value = zonesVisible;
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
  scene.infoPanelEl.style.display = mode === "overview" ? "none" : scene.currentSector() ? "" : "none";
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
  scene.cameraControls?.setMinZoom(viewModeMinZoom);
  scene.zoomControls?.setMinZoom(viewModeMinZoom);
}

/** Hide stars + nebulas in overview; restore on exit. */
function setBackgrounds(scene: Game, mode: GameViewMode): void {
  const inOverview = mode === "overview";
  scene.background.starsFar.setVisible(!inOverview);
  scene.background.starsNear.setVisible(!inOverview);
  for (const image of scene.nebulaImages) image.setVisible(!inOverview);
}

function enterOverviewVisuals(scene: Game): void {
  syncSectorGridVisibility(scene, "overview");
  if (!scene.overviewGrid) {
    scene.overviewGrid = createOverviewGrid(scene, scene.map);
  }
  scene.overviewGrid.setVisible(true);
  for (const shipRender of scene.shipBundles) hideShipForOverview(shipRender);
  scene.ambientTraffic.dotPool.releaseAll();
}

function exitOverviewVisuals(scene: Game, mode: GameViewMode): void {
  scene.overviewGrid?.setVisible(false);
  syncSectorGridVisibility(scene, mode);
  for (const shipRender of scene.shipBundles) restoreShipAfterOverview(shipRender);
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
  if (scene.sectorGrid.gridMode === "off") {
    hideSectorGridVisuals(scene.sectorGrid);
    return;
  }
  if (scene.sectorGrid.gridMode === "on") {
    showSectorGridFullAlpha(scene.sectorGrid);
  } else {
    // Overview can leave auto-grid scroll tracking anchored to the
    // pre-overlay camera — reset it like a fresh auto-mode activation
    // before restoring the normal grid.
    resetAutoSectorGridState(scene.sectorGrid);
  }
  updateSectorCorners(scene.sectorGrid, scene.map.sectors, scene.camera);
}
