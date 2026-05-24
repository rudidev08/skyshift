// Per-frame helpers dispatched from Game.update() — sim tick, ship visual
// refresh, and station render-bundle add/remove hooks invoked by sim observers.

import { economyConfig } from "../data/economy-config";
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

/** Game-time seconds elapsed this frame: 0 while paused (`timeScale <= 0`) or in
 *  the static editor, otherwise the real frame delta scaled by game speed. Both
 *  the sim tick and the render game clock advance by this, so idle ship orbits
 *  freeze on pause and speed up with the game exactly like in-flight ships,
 *  whose position derives from sim-advanced flight progress. */
export function computeGameSecondsThisFrame(
  deltaSeconds: number,
  timeScale: number,
  isEditorMode: boolean,
): number {
  if (isEditorMode || timeScale <= 0) return 0;
  return deltaSeconds * timeScale;
}

export function tickSimulation(game: Game, frameGameSeconds: number, timeMilliseconds: number, inOverview: boolean): void {
  if (!inOverview) updateAmbientTraffic(game.ambientTraffic, frameGameSeconds, timeMilliseconds, game.camera);
  game.simulation!.tick(frameGameSeconds);
  tickSlowSimulation(game, frameGameSeconds);
  tickAutoSave(game, frameGameSeconds);
}

/** Run the slow simulation tick when enough sim time has accumulated, then
 *  refresh the overview panels (also covers Nations and Emigration tabs). */
function tickSlowSimulation(game: Game, frameGameSeconds: number): void {
  game.secondsSinceLastSlowSimulationTick += frameGameSeconds;
  if (game.secondsSinceLastSlowSimulationTick < economyConfig.slowSimulationTickIntervalSeconds) return;
  const accumulatedSlowSimulationSeconds = game.secondsSinceLastSlowSimulationTick;
  game.secondsSinceLastSlowSimulationTick = 0;
  game.simulation!.slowSimulationTick(accumulatedSlowSimulationSeconds);
  game.overviewMode?.update();
}

function tickAutoSave(game: Game, frameGameSeconds: number): void {
  game.secondsSinceLastAutoSave += frameGameSeconds;
  if (game.secondsSinceLastAutoSave < AUTOSAVE_INTERVAL_SECONDS) return;
  game.secondsSinceLastAutoSave = 0;
  try {
    saveAutoSlot(game);
  } catch (error) {
    console.warn("Auto-save failed:", error);
  }
}

export function updateShipVisuals(game: Game, currentTick: number): void {
  updateAllShipVisualBundles(
    game,
    game.shipBundleByShipId,
    {
      zoom: game.camera.zoom,
      camera: game.camera,
      timeSeconds: game.gameClockSeconds,
      currentTick,
    },
    game.selection.selectedTarget,
    game.simulation!.tradeManager,
  );
}

/** Create the station's visual bundle if missing. Called from stationManager.onAdd
 *  and the post-restore loop; safe to call more than once for the same station. */
export function ensureStationRender(game: Game, station: Station): void {
  if (game.stationBundleByStation.has(station)) return;
  game.stationBundleByStation.set(station, createStationVisualBundle(game, station, game.selection));
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
}
