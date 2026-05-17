// Scene-boot helpers called once from Game.create(): HUD wiring, initial
// camera placement, and the snapshot-restore vs fresh-seed factories that
// construct an initialized Simulation for the active session.

import type { Game } from "./game";
import type { GameSnapshot } from "./sim-save-types";
import { Simulation } from "./sim-lifecycle";
import { restoreSavedGame } from "./ui-savegame-manager";
import { assignStationNames } from "./sim-name-pool";
import {
  createShipVisualBundle,
  destroyShipVisualBundle,
  type ShipVisualBundleContext,
} from "./phaser/ship-visual-bundle";
import { createStationVisualBundle, type StationVisualBundle } from "./phaser/station-visual-bundle";
import { createStation } from "./sim-station";
import type { Station } from "./sim-station-types";
import { createStationZoneVisualBundles } from "./phaser/station-zone-render";
import { createAmbientTraffic } from "./phaser/ambient-traffic-render";
import { createPausedIndicator } from "./ui-game-paused-indicator";
import { createElapsedTimeLabel } from "./render-elapsed-time-label";
import { addSpeedChangeObserver } from "./phaser/time-controls";
import { createStationShips } from "./sim-ships";
import { ensureStationRender, destroyStationRender, resetAutoSaveAccumulator } from "./game-loop";

export function setupHudOverlay(game: Game): void {
  resolveHudOverlayElements(game);
  hideInfoPanelForEditorMode(game);
}

function resolveHudOverlayElements(game: Game): void {
  game.selectedObjectEl = document.getElementById("selected-object")!;
  game.selectedTypeEl = document.getElementById("selected-type")!;
  game.infoCardEl = document.getElementById("overlay-info-card")!;
  game.serialCodeEl = document.getElementById("serial-code")!;
  game.descriptionEl = document.getElementById("description")!;
  game.statusBandEl = document.getElementById("status-band")!;
  game.loreEl = document.getElementById("lore")!;
  game.loreTitleEl = document.getElementById("lore-title")!;
  game.infoPanelEl = document.getElementById("overlay-info")!;
  game.hudIconEl = document.getElementById("hud-icon")!;
  game.loreToggleEl = document.getElementById("lore-toggle")!;
  game.logToggleEl = document.getElementById("log-toggle")!;
  game.detailsContentEl = document.getElementById("details-content")!;
  game.detailsBoxEl = document.getElementById("details-box")!;
  game.loreBoxEl = document.getElementById("lore-box")!;
}

/** Editor never populates the selection dossier — hide it so the .id-card chrome doesn't show as an empty "broken" box. */
function hideInfoPanelForEditorMode(game: Game): void {
  if (game.isEditorMode) game.infoPanelEl.style.display = "none";
}

/** Wire up the speed pill and elapsed-time label. Call site skips this in
 *  editor mode — the editor owns sim-speed state through its own controls. */
export function setupGameplaySpeedAndTimeHud(game: Game): void {
  game.pausedIndicator = createPausedIndicator(document);
  game.pausedIndicator.setSpeed(game.timeController.currentSpeed);
  game.unsubscribeSpeedObserver = addSpeedChangeObserver((speed) => {
    game.pausedIndicator?.setSpeed(speed);
  });
  game.elapsedTimeLabel = createElapsedTimeLabel(
    document,
    () => game.simulation?.tradeManager.tradeTime ?? 0,
    {
      offsetSeconds: game.map.simulationWarmupSeconds ?? 0,
    },
  );
}

function setupEntityRenderObservers(game: Game, simulation: Simulation): void {
  const shipContext = createShipVisualBundleContext(game, simulation);
  simulation.shipManager.onAdd((newShips) => {
    for (const ship of newShips) {
      game.shipBundles.push(createShipVisualBundle(ship, shipContext));
    }
  });
  simulation.shipManager.onRemove((ship) => {
    const renderIndex = game.shipBundles.findIndex((shipRender) => shipRender.ship === ship);
    if (renderIndex >= 0) {
      destroyShipVisualBundle(game.shipBundles[renderIndex], shipContext);
      game.shipBundles.splice(renderIndex, 1);
    }
  });
  simulation.stationManager.onAdd((newStation) => {
    ensureStationRender(game, newStation);
  });
  simulation.stationManager.onRemove((removed) => {
    destroyStationRender(game, removed);
  });
}

function createShipVisualBundleContext(game: Game, simulation: Simulation): ShipVisualBundleContext {
  return {
    scene: game,
    selection: game.selection,
    tradeManager: simulation.tradeManager,
    orbitPool: game.shipOrbitPool,
    bundles: game.shipBundlesById,
  };
}

/** Construct the Simulation, set up its zone visuals + render-mirror observers,
 *  then restore from the player's saved snapshot. Returns the initialized
 *  simulation; the saved snapshot is the sole source of station truth, so the
 *  initial map is not consulted for station placements. */
export function createGameSimulationForSnapshot(game: Game, snapshot: GameSnapshot): Simulation {
  const simulation = new Simulation(game.map);
  game.simulation = simulation;
  setupStationZoneVisuals(game, simulation);
  setupEntityRenderObservers(game, simulation);

  restoreSavedGame(game, snapshot);
  // Snapshot already applied; release the reference so it can be GC'd.
  game.initialSnapshot = undefined;
  resetAutoSaveAccumulator();
  // Reserve-only pass — restored stations carry names already; this just
  // registers them so future dynamic spawns don't collide.
  assignStationNames(simulation.namePool, game.stations);
  simulation.seedRosterForSavedGame(game.stations, game.ships);
  for (const station of game.stations) ensureStationRender(game, station);
  const shipContext = createShipVisualBundleContext(game, simulation);
  for (const ship of game.ships) {
    game.shipBundles.push(createShipVisualBundle(ship, shipContext));
  }
  game.ambientTraffic = createAmbientTraffic(game, game.stations, game.map.sectorSize);
  return simulation;
}

/** Construct the Simulation, set up its zone visuals + render-mirror observers,
 *  then seed a fresh universe from the map template. Returns the initialized
 *  simulation, with warmup ticks and initial nation/emigration spawns
 *  applied so the game starts mid-activity. */
export function createGameSimulationForFreshUniverse(game: Game): Simulation {
  const simulation = new Simulation(game.map);
  game.simulation = simulation;
  setupStationZoneVisuals(game, simulation);
  setupEntityRenderObservers(game, simulation);

  assignStationNames(simulation.namePool, game.map.stations);
  game.ambientTraffic = createAmbientTraffic(game, game.map.stations, game.map.sectorSize);
  const stations = game.map.stations.map((placement) => createStation(placement));
  const stationBundles: StationVisualBundle[] = [];
  const stationBundleByStation = new Map<Station, StationVisualBundle>();
  for (const station of stations) {
    const bundle = createStationVisualBundle(game, station, game.selection);
    stationBundles.push(bundle);
    stationBundleByStation.set(station, bundle);
  }
  game.stations = stations;
  game.stationBundles = stationBundles;
  game.stationBundleByStation = stationBundleByStation;
  game.map.seedInitialInventory?.(game.stations);

  if (!game.isEditorMode) seedFreshFleet(game, simulation);

  simulation.seedFreshRoster(game.stations, game.ships, game.map.initialStaggerDurationSeconds);
  runWarmupTicks(simulation, game.map.simulationWarmupSeconds ?? 0);
  // Initial-build expansion runs AFTER warmup so scarcity math sees real
  // inventory rather than the flat 50%-full initial state.
  simulation.nationManager.startInitialStationBuilds();
  simulation.emigrationManager.spawnInitialGenerationalShip();
  return simulation;
}

function setupStationZoneVisuals(game: Game, simulation: Simulation): void {
  const zoneResult = createStationZoneVisualBundles(
    game,
    simulation.stationZones,
    game.stationZonesVisibleRef,
    game.selection,
  );
  game.stationZoneVisualBundles = zoneResult.visualBundles;
  game.stationZoneSelectionTargets = zoneResult.selectionTargets;
}

/** Spawn each station's default fleet, register them with the simulation, and
 *  build their render bundles. Skipped in editor mode — the editor is a static
 *  editing surface with no trade ships or sim ticks. */
function seedFreshFleet(game: Game, simulation: Simulation): void {
  // Shared across stations so per-station fleets don't collide on the
  // BIO-042 id pool with each other.
  const takenShipIds = new Set<string>();
  const shipContext = createShipVisualBundleContext(game, simulation);
  for (const station of game.stations) {
    const ships = createStationShips({
      station,
      takenShipIds,
      namePool: simulation.namePool,
    });
    for (const ship of ships) takenShipIds.add(ship.id);
    game.ships.push(...ships);
    for (const ship of ships) {
      game.shipBundles.push(createShipVisualBundle(ship, shipContext));
    }
  }
}

/** Fast-forward the freshly-seeded universe so it starts mid-activity. */
function runWarmupTicks(simulation: Simulation, warmupSeconds: number): void {
  const warmupStep = 0.5;
  for (let elapsed = 0; elapsed < warmupSeconds; elapsed += warmupStep) {
    simulation.tick(warmupStep);
  }
}

export function setInitialCameraView(game: Game): void {
  const cameraStart = game.map.cameraStart ?? { x: 0, y: 0, zoom: 0.3 };
  const halfSector = game.map.sectorSize / 2;
  game.camera.setZoom(cameraStart.zoom);
  // Phaser 4 camera centering is zoom-independent (world center = scrollX +
  // width/2). Dividing the offset by zoom here would break clampCamera's
  // bounds symmetry.
  game.camera.scrollX = cameraStart.x + halfSector - game.camera.width / 2;
  game.camera.scrollY = cameraStart.y - halfSector - game.camera.height / 2;
  // Resync the zoom dial — we set cameraStart.zoom directly via setZoom,
  // which bypasses the onZoom callback that normally repaints the dial.
  game.zoomControls!.updateDisplay();
}
