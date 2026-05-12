import type { Game } from "../game";
import type { GameViewMode } from "../game-view-mode";
import { createOverviewGrid, hideSectorGridVisuals, resetAutoSectorGridState, updateSectorCorners } from "./sector-grid";
import { updateStationZoneVisibility, StationZoneSelectionTarget } from "./station-zone-render";
import { hideShipForOverview, restoreShipAfterOverview } from "./ship-visual-bundle";
import { redrawAmbientTraffic } from "./ambient-traffic-render";
import { acquireScopedPause } from "./auto-release-pause";
import { cameraMinZoom, overviewMinZoom } from "../../data/controls-camera";
import type { SelectionKind } from "./selection-input";

/** Single entry point for view-mode changes — fans out to every subsystem so callers don't have to know the list. */
export function applyViewMode(scene: Game, mode: GameViewMode): void {
  const zonesVisible = mode === "zones";
  scene.stationZonesVisibleRef.value = zonesVisible;
  updateStationZoneVisibility(scene.stationZoneVisualBundles, zonesVisible);
  if (!zonesVisible) deselectHiddenZone(scene);

  showInfoPanelForViewMode(scene, mode);

  // Body class suppresses the floating lore-box from CSS — its visibility is
  // otherwise driven by lore-toggle state and persists across view changes.
  document.body.classList.toggle("view-overview", mode === "overview");

  // Restrict proximity selection to stations only while in overview.
  scene.selection.setAllowedKinds(
    mode === "overview" ? new Set<SelectionKind>(["station"]) : null,
  );

  setOverviewPauseForViewMode(scene, mode);
  setMinZoomForViewMode(scene, mode);
  setBackgroundsForViewMode(scene, mode);

  if (mode === "overview") {
    enterOverviewVisuals(scene);
  } else {
    exitOverviewVisuals(scene, mode);
  }

  scene.overviewSystem?.update();
}

/** A selected zone would otherwise show invisible content in the panel. */
function deselectHiddenZone(scene: Game): void {
  if (scene.selection?.target instanceof StationZoneSelectionTarget) {
    scene.selection.deselect();
  }
}

/** Hide the panel in overview (overlay has its own focus UI); editor never
 *  auto-shows the panel (no HUD updates run there). */
function showInfoPanelForViewMode(scene: Game, mode: GameViewMode): void {
  if (scene.isEditorMode) return;
  scene.infoPanelEl.style.display = mode === "overview" ? "none" : (scene.currentSector() ? "" : "none");
}

/** Auto-pause on entering overview; restore on leave if we paused it. */
function setOverviewPauseForViewMode(scene: Game, mode: GameViewMode): void {
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
function setMinZoomForViewMode(scene: Game, mode: GameViewMode): void {
  const viewModeMinZoom = mode === "overview" ? overviewMinZoom : cameraMinZoom;
  scene.cameraControls?.setMinZoom(viewModeMinZoom);
  scene.zoomControls?.setMinZoom(viewModeMinZoom);
}

/** Hide stars + nebulas in overview; restore on exit. */
function setBackgroundsForViewMode(scene: Game, mode: GameViewMode): void {
  const inOverview = mode === "overview";
  scene.bg.starsFar.setVisible(!inOverview);
  scene.bg.starsNear.setVisible(!inOverview);
  for (const image of scene.nebulaImages) image.setVisible(!inOverview);
}

function enterOverviewVisuals(scene: Game): void {
  syncSectorGridVisibilityForViewMode(scene, "overview");
  if (!scene.overviewGrid) {
    scene.overviewGrid = createOverviewGrid(scene, scene.map);
  }
  scene.overviewGrid.setVisible(true);
  // Hide all ship visuals (orbit + flight + UI) and ambient traffic dots.
  for (const shipRender of scene.shipRenders) hideShipForOverview(shipRender);
  scene.ambientTraffic.dotPool.releaseAll();
}

function exitOverviewVisuals(scene: Game, mode: GameViewMode): void {
  scene.overviewGrid?.setVisible(false);
  syncSectorGridVisibilityForViewMode(scene, mode);
  for (const shipRender of scene.shipRenders) restoreShipAfterOverview(shipRender);
  redrawAmbientTraffic(scene.ambientTraffic, performance.now(), scene.camera);
  // Orbit sprite + shipUi don't need explicit restore — updateAllShipVisualBundles rebuilds them next frame.
}

/** Shows or hides the normal sector grid based on view mode (overview hides it) and the player's gridMode preference. */
export function syncSectorGridVisibilityForViewMode(scene: Game, mode: GameViewMode): void {
  // Overview owns the overlay — keep the normal grid hidden even if the
  // player changes the grid preference while the overlay is open.
  if (mode === "overview") {
    hideSectorGridVisuals(scene.gridSystem);
    return;
  }
  if (scene.gridSystem.gridMode === "off") {
    hideSectorGridVisuals(scene.gridSystem);
    return;
  }
  if (scene.gridSystem.gridMode === "on") {
    scene.gridSystem.grid.setVisible(true);
    scene.gridSystem.grid.setAlpha(1);
    for (const sectorLabel of scene.gridSystem.sectorLabels) {
      sectorLabel.setVisible(true);
      sectorLabel.setAlpha(1);
    }
  } else {
    // Overview can leave auto-grid scroll tracking anchored to the
    // pre-overlay camera — reset it like a fresh auto-mode activation
    // before restoring the normal grid.
    resetAutoSectorGridState(scene.gridSystem);
  }
  updateSectorCorners(scene.gridSystem, scene.map.sectors, scene.camera);
}
