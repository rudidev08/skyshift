// Scene-boot helpers called once from Game.create(): HUD wiring, initial
// camera placement, and the snapshot-restore vs fresh-seed factories that
// construct an initialized Simulation for the active session.

import type { Game } from "./game";
import type { GameSnapshot } from "./sim-save-types";
import { Simulation, createShipsForStations } from "./sim-lifecycle";
import { restoreSavedGame } from "./ui-savegame-manager";
import { assignStationNames, type NamePool } from "./sim-name-pool";
import type { Ship } from "./sim-ships";
import {
  createShipVisualBundle,
  destroyShipVisualBundle,
  type ShipVisualBundleContext,
} from "./phaser/ship-visual-bundle";
import { createStationVisualBundle, type StationVisualBundle } from "./phaser/station-visual-bundle";
import { createStation } from "./sim-station";
import type { Station } from "./sim-station-types";
import { createStationZoneVisualBundles, setStationZoneOccupied } from "./phaser/station-zone-render";
import { createAmbientTraffic } from "./phaser/ambient-traffic-render";
import { createPausedIndicator } from "./ui-game-paused-indicator";
import { createElapsedTimeLabel } from "./render-elapsed-time-label";
import { addSpeedChangeObserver } from "./phaser/time-controls";
import { ensureStationRender, destroyStationRender } from "./game-loop";

export function setupHudOverlay(game: Game): void {
  resolveHudOverlayElements(game);
  hideInfoPanelForEditorMode(game);
}

function resolveHudOverlayElements(game: Game): void {
  game.selectedObjectElement = document.getElementById("selected-object")!;
  game.selectedTypeElement = document.getElementById("selected-type")!;
  game.infoCardElement = document.getElementById("overlay-info-card")!;
  game.serialCodeElement = document.getElementById("serial-code")!;
  game.descriptionElement = document.getElementById("description")!;
  game.statusBandElement = document.getElementById("status-band")!;
  game.loreElement = document.getElementById("lore")!;
  game.loreTitleElement = document.getElementById("lore-title")!;
  game.infoPanelElement = document.getElementById("overlay-info")!;
  game.hudIconElement = document.getElementById("hud-icon")!;
  game.loreToggleElement = document.getElementById("lore-toggle")!;
  game.logToggleElement = document.getElementById("log-toggle")!;
  game.logContentElement = document.getElementById("log-content")!;
  game.logBoxElement = document.getElementById("log-box")!;
}

/** Editor never populates the selection dossier — hide it so the .id-card chrome doesn't show as an empty "broken" box. */
function hideInfoPanelForEditorMode(game: Game): void {
  if (game.isEditorMode) game.infoPanelElement.style.display = "none";
}

/** Skipped in editor mode — the editor owns sim-speed state through its own controls. */
export function setupGameplaySpeedAndTimeHud(game: Game): void {
  game.pausedIndicator = createPausedIndicator(document);
  game.pausedIndicator.setSpeed(game.timeController.currentSpeed);
  game.unsubscribeSpeedObserver = addSpeedChangeObserver((speed) => {
    game.pausedIndicator?.setSpeed(speed);
  });
  game.elapsedTimeLabel = createElapsedTimeLabel(
    document,
    () => game.simTimeSeconds(),
    {
      offsetSeconds: game.map.simulationWarmupSeconds ?? 0,
    },
  );
}

function setupEntityRenderObservers(game: Game, simulation: Simulation): void {
  const shipContext = createShipVisualBundleContext(game, simulation);
  simulation.shipManager.onAdd((newShips) => {
    for (const ship of newShips) {
      createShipVisualBundle(ship, shipContext);
    }
  });
  simulation.shipManager.onRemove((ship) => {
    const shipRender = game.shipBundleByShipId.get(ship.id);
    if (shipRender) destroyShipVisualBundle(shipRender, shipContext);
  });
  simulation.stationManager.onAdd((newStation) => {
    ensureStationRender(game, newStation);
    setZoneOccupancyForStation(game, newStation, true);
  });
  simulation.stationManager.onRemove((removed) => {
    destroyStationRender(game, removed);
    setZoneOccupancyForStation(game, removed, false);
  });
}

/** Sync a zone's visuals with a station claiming or leaving it — stations
 *  claim zones mid-session (placeBuild) and emigration frees them, and the
 *  dashed "Unclaimed" icon must not stay painted (or selectable) under a live
 *  station. Boot seeding and snapshot restore bypass the onAdd observer, so
 *  both run an explicit pass over their stations. */
function setZoneOccupancyForStation(game: Game, station: Station, occupiedByStation: boolean): void {
  if (!station.zoneId) return;
  const index = game.stationZoneVisualBundles.findIndex(
    (visualBundle) => visualBundle.zone.id === station.zoneId,
  );
  if (index === -1) return;
  setStationZoneOccupied(
    game.stationZoneVisualBundles[index],
    occupiedByStation,
    game.viewMode.getViewMode() === "zones",
  );
  // A selected zone would otherwise keep showing its stale "Unclaimed" dossier.
  if (occupiedByStation && game.selection.selectedTarget === game.stationZoneSelectionTargets[index]) {
    game.selection.deselect();
  }
}

function createShipVisualBundleContext(game: Game, simulation: Simulation): ShipVisualBundleContext {
  return {
    scene: game,
    selection: game.selection,
    tradeManager: simulation.tradeManager,
    orbitSlotAllocator: game.shipOrbitSlotAllocator,
    bundleByShipId: game.shipBundleByShipId,
  };
}

/** Restore a saved game into a new Simulation. The snapshot is the sole source
 *  of station truth — the map template's initial placements are not consulted. */
export function createGameSimulationForSnapshot(game: Game, snapshot: GameSnapshot): Simulation {
  const simulation = new Simulation(game.map);
  game.simulation = simulation;
  setupStationZoneVisuals(game, simulation);
  setupEntityRenderObservers(game, simulation);

  restoreSavedGame(game, snapshot);
  // Snapshot already applied; clear the reference so the snapshot can be freed.
  game.initialSnapshot = undefined;
  game.secondsSinceLastAutoSave = 0;
  // Restored stations and ships already have names — register them so new dynamic spawns don't reuse the same names.
  assignStationNames(simulation.namePool, game.stations);
  registerRestoredShipNames(simulation.namePool, game.ships);
  simulation.seedRosterForSavedGame(game.stations, game.ships);
  for (const station of game.stations) {
    ensureStationRender(game, station);
    // Seeding skips the onAdd observer, so claim restored stations' zones here.
    setZoneOccupancyForStation(game, station, true);
  }
  const shipContext = createShipVisualBundleContext(game, simulation);
  for (const ship of game.ships) {
    createShipVisualBundle(ship, shipContext);
  }
  game.ambientTraffic = createAmbientTraffic(game, game.stations, game.map.sectorSize);
  return simulation;
}

/** Reserve + claim each restored ship's name against its nation's pool —
 *  the ship-side mirror of assignStationNames' predefined-name pass. Restored
 *  ships always carry names, so nothing is drawn here. */
export function registerRestoredShipNames(namePool: NamePool, ships: readonly Ship[]): void {
  for (const ship of ships) {
    namePool.reservePoolName(ship.station.nation.shipNames, ship.shipName);
    namePool.claimName(ship.shipName, ship.station.nation);
  }
}

/** Seed a fresh universe from the map template. Warmup ticks and initial
 *  nation/emigration spawns are applied so the game starts mid-activity. */
export function createGameSimulationForFreshUniverse(game: Game): Simulation {
  const simulation = new Simulation(game.map);
  game.simulation = simulation;
  setupStationZoneVisuals(game, simulation);
  setupEntityRenderObservers(game, simulation);

  assignStationNames(simulation.namePool, game.map.stations);
  game.ambientTraffic = createAmbientTraffic(game, game.map.stations, game.map.sectorSize);
  const stations = game.map.stations.map((placement) => createStation(placement));
  const stationBundleByStation = new Map<Station, StationVisualBundle>();
  for (const station of stations) {
    stationBundleByStation.set(station, createStationVisualBundle(game, station, game.selection));
    // Seeding skips the onAdd observer, so claim preset stations' zones here.
    setZoneOccupancyForStation(game, station, true);
  }
  game.stations = stations;
  game.stationBundleByStation = stationBundleByStation;
  game.map.seedInitialInventory?.(game.stations);

  if (!game.isEditorMode) seedFreshFleet(game, simulation);

  simulation.seedFreshRoster(game.stations, game.ships, game.map.initialStaggerDurationSeconds);
  simulation.runWarmup(game.map.simulationWarmupSeconds ?? 0);
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
    () => game.viewMode.getViewMode() === "zones",
    game.selection,
  );
  game.stationZoneVisualBundles = zoneResult.visualBundles;
  game.stationZoneSelectionTargets = zoneResult.selectionTargets;
}

/** Spawn each station's default fleet, register them with the simulation, and
 *  build their render bundles. Skipped in editor mode — the editor is a static
 *  editing surface with no trade ships or sim ticks. */
function seedFreshFleet(game: Game, simulation: Simulation): void {
  const ships = createShipsForStations(game.stations, simulation.namePool, false);
  game.ships.push(...ships);
  const shipContext = createShipVisualBundleContext(game, simulation);
  for (const ship of ships) {
    createShipVisualBundle(ship, shipContext);
  }
}

export function setInitialCameraView(game: Game): void {
  const initialCameraView = game.map.cameraStart ?? { x: 0, y: 0, zoom: 0.3 };
  const halfSector = game.map.sectorSize / 2;
  game.camera.setZoom(initialCameraView.zoom);
  // Phaser 4 camera centering is zoom-independent (world center = scrollX +
  // width/2). Dividing the offset by zoom here would break clampCamera's
  // bounds symmetry.
  game.camera.scrollX = initialCameraView.x + halfSector - game.camera.width / 2;
  game.camera.scrollY = initialCameraView.y - halfSector - game.camera.height / 2;
  // Repaint the zoom dial — camera.setZoom doesn't notify the zoom-controls
  // helper, so the dial would show stale data without this call.
  game.zoomControls!.updateDisplay();
}
