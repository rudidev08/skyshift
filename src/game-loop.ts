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
import { AUTOSAVE_INTERVAL_SECONDS } from "./sim-save-types";
import { saveAutoSlot } from "./ui-savegame-manager";

/** Slow tick for build-completion handoff and emigration lifecycle (sim seconds). */
const DYNAMICS_TICK_INTERVAL = 5;

let simSecondsSinceAutoSave = 0;

/** Reset after snapshot load so auto-save doesn't fire immediately after loading. */
export function resetAutoSaveAccumulator(): void {
  simSecondsSinceAutoSave = 0;
}

export function tickSimulation(game: Game, scaledDelta: number, time: number, inOverview: boolean): void {
  if (!inOverview) renderAmbientTraffic(game, scaledDelta, time);
  game.simulation!.tick(scaledDelta);
  tickDynamicsAndOverviewRefresh(game, scaledDelta);
  tickAutoSave(game, scaledDelta);
}

function renderAmbientTraffic(game: Game, scaledDelta: number, time: number): void {
  updateAmbientTraffic(game.ambientTraffic, scaledDelta, time, game.camera);
}

/** Run the slow per-5s dynamics tick when enough sim time has accumulated, then
 *  refresh the overview panels (also covers Nations and Emigration tabs). */
function tickDynamicsAndOverviewRefresh(game: Game, scaledDelta: number): void {
  game.dynamicsTickAccumulator += scaledDelta;
  if (game.dynamicsTickAccumulator < DYNAMICS_TICK_INTERVAL) return;
  const dynamicsDelta = game.dynamicsTickAccumulator;
  game.dynamicsTickAccumulator = 0;
  game.simulation!.tickDynamics(dynamicsDelta);
  game.overviewSystem?.update();
}

function tickAutoSave(game: Game, scaledDelta: number): void {
  simSecondsSinceAutoSave += scaledDelta;
  if (simSecondsSinceAutoSave < AUTOSAVE_INTERVAL_SECONDS) return;
  simSecondsSinceAutoSave = 0;
  try { saveAutoSlot(game); }
  catch (err) { console.warn("Auto-save failed:", err); }
}

export function updateShipVisuals(
  game: Game,
  labelState: { visible: boolean; alpha: number },
  currentTick: number,
): void {
  updateAllShipVisualBundles(
    game,
    game.shipRenders,
    {
      labelVisible: labelState.visible,
      labelAlpha: labelState.alpha,
      zoom: game.camera.zoom,
      camera: game.camera,
      timeSec: game.time.now / 1000,
      currentTick,
    },
    game.selection.target,
    game.simulation!.tradeManager,
    game.shipBundles,
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
