// Per-frame helpers dispatched from Game.update() — sim tick, ship visual
// refresh, and station render-bundle add/remove hooks invoked by sim observers.

import type { Game } from "./game";
import type { Station } from "./sim-station";
import { updateAmbientTraffic } from "./phaser/ambient-traffic-render";
import { updateAllShipVisualBundles } from "./phaser/ship-visual-bundle";
import {
  createStationVisualBundle,
  destroyStationVisualBundle,
  resetStationZoomDetailCache,
} from "./phaser/station-visual-bundle";
import { AUTOSAVE_INTERVAL_SECONDS } from "./sim-save-slots";
import { saveAutoSlot } from "./ui-savegame-manager";

/** Slow tick for build-completion handoff and emigration lifecycle (sim seconds). */
const SLOW_SIMULATION_TICK_INTERVAL_SECONDS = 5;

/** Game-time seconds elapsed this frame: 0 while paused (`timeScale <= 0`) or in
 *  the static editor, otherwise the real frame delta scaled by game speed. Both
 *  the sim tick and the render game clock advance by this, so idle ship orbits
 *  freeze on pause and speed up with the game exactly like in-flight ships,
 *  whose position derives from sim-advanced flight progress. */
export function gameSecondsThisFrame(deltaSeconds: number, timeScale: number, isEditorMode: boolean): number {
  if (isEditorMode || timeScale <= 0) return 0;
  return deltaSeconds * timeScale;
}

let simSecondsSinceAutoSave = 0;

/** Reset after snapshot load so auto-save doesn't fire immediately after loading. */
export function resetAutoSaveAccumulator(): void {
  simSecondsSinceAutoSave = 0;
}

export function tickSimulation(game: Game, frameGameSeconds: number, timeMilliseconds: number, inOverview: boolean): void {
  if (!inOverview) renderAmbientTraffic(game, frameGameSeconds, timeMilliseconds);
  game.simulation!.tick(frameGameSeconds);
  slowSimulationTick(game, frameGameSeconds);
  tickAutoSave(game, frameGameSeconds);
}

function renderAmbientTraffic(game: Game, frameGameSeconds: number, timeMilliseconds: number): void {
  updateAmbientTraffic(game.ambientTraffic, frameGameSeconds, timeMilliseconds, game.camera);
}

/** Run the slow simulation tick when enough sim time has accumulated, then
 *  refresh the overview panels (also covers Nations and Emigration tabs). */
function slowSimulationTick(game: Game, frameGameSeconds: number): void {
  game.secondsSinceLastSlowSimulationTick += frameGameSeconds;
  if (game.secondsSinceLastSlowSimulationTick < SLOW_SIMULATION_TICK_INTERVAL_SECONDS) return;
  const accumulatedSlowSimulationSeconds = game.secondsSinceLastSlowSimulationTick;
  game.secondsSinceLastSlowSimulationTick = 0;
  game.simulation!.slowSimulationTick(accumulatedSlowSimulationSeconds);
  game.overviewMode?.update();
}

function tickAutoSave(game: Game, frameGameSeconds: number): void {
  simSecondsSinceAutoSave += frameGameSeconds;
  if (simSecondsSinceAutoSave < AUTOSAVE_INTERVAL_SECONDS) return;
  simSecondsSinceAutoSave = 0;
  try {
    saveAutoSlot(game);
  } catch (error) {
    console.warn("Auto-save failed:", error);
  }
}

export function updateShipVisuals(
  game: Game,
  labelState: { visible: boolean; alpha: number },
  currentTick: number,
): void {
  updateAllShipVisualBundles(
    game,
    game.shipBundles,
    {
      labelVisible: labelState.visible,
      labelAlpha: labelState.alpha,
      zoom: game.camera.zoom,
      camera: game.camera,
      timeSec: game.gameClockSeconds,
      currentTick,
    },
    game.selection.selectedTarget,
    game.simulation!.tradeManager,
    game.shipBundlesById,
  );
}

/** Create the station's visual bundle if missing. Called from stationManager.onAdd
 *  and the post-restore loop; safe to call more than once for the same station. */
export function ensureStationRender(game: Game, station: Station): void {
  if (game.stationBundleByStation.has(station)) return;
  const bundle = createStationVisualBundle(game, station, game.selection);
  game.stationBundleByStation.set(station, bundle);
  game.stationBundles.push(bundle);
  // Invalidate zoom caches so the next update applies current-zoom alpha
  // and visibility — otherwise labels and icons stick at defaults until
  // the player zooms.
  resetStationZoomDetailCache();
}

export function destroyStationRender(game: Game, station: Station): void {
  const bundle = game.stationBundleByStation.get(station);
  if (!bundle) return;
  game.stationBundleByStation.delete(station);
  destroyStationVisualBundle(game, game.selection, bundle);
  const index = game.stationBundles.indexOf(bundle);
  if (index >= 0) game.stationBundles.splice(index, 1);
}
