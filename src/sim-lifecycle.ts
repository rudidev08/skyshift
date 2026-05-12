// Top-level Simulation container — owns the manager set, clock, ware index,
// runtime stations + ships, and exposes tick / tickDynamics / dispose. One
// per running simulation: game scene, editor preview, balance solver, CLI
// report each construct their own. Headless — no Phaser dependency.

import type { GameMap } from "./sim-map-types";
import type { StationZone } from "./sim-station-zone-types";
import { createStation, type Station } from "./sim-station";
import { createStationShips, type Ship } from "./sim-ships";
import { EconomyTimer, tickEconomy, staggerStationTicks } from "./sim-economy";
import { NamePool, assignStationNames } from "./sim-name-pool";
import { TradeManager } from "./sim-trade-manager";
import { ShipManager } from "./sim-ship-manager";
import { StationManager } from "./sim-station-manager";
import { NationManager } from "./sim-nation-manager";
import { EmigrationManager } from "./sim-emigration-manager";
import { createStationHistory, type StationHistory, type HistoryStation } from "./sim-station-history";
import { createStationZones } from "./sim-station-zone";

export interface SimulationOptions {
  /** Spawn ships at every station even when the nation's ship class can't
   *  carry any of the station's wares. Editor and report sims set this so
   *  the analysis sees the full fleet. */
  ignoreCargoCompatibility?: boolean;
  /** Override the default stagger duration for initial ship launches. */
  initialStaggerDuration?: number;
}

/** Top-level simulation. Holds the entire sim graph for one running session. */
export class Simulation {
  readonly map: GameMap;
  readonly shipManager: ShipManager;
  readonly stationManager: StationManager;
  readonly tradeManager: TradeManager;
  readonly nationManager: NationManager;
  readonly emigrationManager: EmigrationManager;
  /** Per-station lifecycle event recorder driving the Stations Timelapse Log. */
  readonly stationHistory: StationHistory;
  readonly economyTimer: EconomyTimer;
  readonly stationZones: StationZone[];
  readonly namePool: NamePool;
  /** Seeded by game.ts from snapshot or via createStationShips after construction. */
  stations: Station[] = [];
  ships: Ship[] = [];
  private readonly unsubscribeDecommission: () => void;
  private disposed = false;

  constructor(map: GameMap) {
    this.map = map;
    this.economyTimer = new EconomyTimer();
    this.namePool = new NamePool();
    this.stationZones = createStationZones(map.stationZones, map.sectors);
    // Manager dependency order: shipManager → stationManager → tradeManager →
    // emigrationManager → nationManager. stationManager closes over
    // `this.tradeManager` and resolves it at call-time, after the constructor
    // returns.
    this.shipManager = new ShipManager(this.namePool);
    this.stationManager = this.createStationManager();
    this.tradeManager = new TradeManager({
      stationManager: this.stationManager,
      shipManager: this.shipManager,
    });
    this.emigrationManager = this.createEmigrationManager(map);
    this.nationManager = this.createNationManager(map);
    this.stationHistory = createStationHistory();

    this.unsubscribeDecommission = this.wireSimObservers();
  }

  /** Subtracts warmup so time-zero is the player's first sim tick (the
   *  warmup phase ticks the sim ahead from authored state but isn't shown
   *  on the player-facing history axis). */
  private historyTimeNowSeconds(): number {
    return this.tradeManager.tradeTime - (this.map.simulationWarmup ?? 0);
  }

  private toHistoryStation(station: Station): HistoryStation {
    return {
      id: station.id,
      position: { x: station.x, y: station.y },
      nationId: station.nation.id,
      typeId: station.stationType.id,
      state: station.state === "building" ? "construction" : "operational",
    };
  }

  private createStationManager(): StationManager {
    return new StationManager({
      shipManager: this.shipManager,
      rebuildWareIndex: (stations) => this.tradeManager.rebuildWareStationIndex(stations),
    });
  }

  private createEmigrationManager(map: GameMap): EmigrationManager {
    return new EmigrationManager({
      map,
      stationManager: this.stationManager,
      shipManager: this.shipManager,
      tradeManager: this.tradeManager,
      namePool: this.namePool,
    });
  }

  private createNationManager(map: GameMap): NationManager {
    return new NationManager({
      zones: this.stationZones,
      sectors: map.sectors,
      stationManager: this.stationManager,
      mapMaxDistance: mapDiagonalDistance(map),
      namePool: this.namePool,
    });
  }

  /** Returns the unsubscribe for the one observer that needs it (decommission);
   *  the others live for the life of the simulation. */
  private wireSimObservers(): () => void {
    this.wireShipTradeObservers();
    this.wireStationFlipObserver();
    this.wireStationHistoryObservers();
    this.wireTradeIndexObservers();
    return this.tradeManager.addShipDecommissionObserver((event) => {
      this.shipManager.removeShip(event.orbitingShip);
    });
  }

  private wireShipTradeObservers(): void {
    this.shipManager.onAdd((newShips) => {
      for (const ship of newShips) {
        const homeStation = this.stationManager.getStation(ship.station.id);
        if (homeStation) this.tradeManager.enrollShip(ship, homeStation);
      }
    });
    this.shipManager.onRemove((ship) => {
      this.tradeManager.deregisterShip(ship);
    });
  }

  private wireStationFlipObserver(): void {
    this.stationManager.onFlip((flippedStation, buildShips) => {
      for (const ship of buildShips) this.shipManager.removeShip(ship);
      this.shipManager.spawnFleetForStation(flippedStation);
    });
  }

  private wireStationHistoryObservers(): void {
    this.stationManager.onAdd((station) => {
      this.stationHistory.recordCreated(this.historyTimeNowSeconds(), this.toHistoryStation(station));
    });
    this.stationManager.onRemove((station) => {
      this.stationHistory.recordRemoved(this.historyTimeNowSeconds(), station.id);
    });
    // Mirror the building → producing flip into history as the operational state.
    this.stationManager.onStationStateChange((station, oldState, newState) => {
      if (oldState === "building" && newState === "producing") {
        this.stationHistory.recordStateChanged(this.historyTimeNowSeconds(), station.id, "operational");
      }
    });
  }

  private wireTradeIndexObservers(): void {
    // Any station state change can shift its role between producer, consumer,
    // and excluded — rebuild the trade path cache on every transition.
    this.stationManager.onStationStateChange(() => {
      this.tradeManager.rebuildWareStationIndex(this.stationManager.getStations());
    });
    this.stationManager.onStationStateChangeBatch(() => {
      this.tradeManager.rebuildWareStationIndex(this.stationManager.getStations());
    });
  }

  /** Restore-from-save path: register the rosters but skip economy/trade setup
   *  — `applySnapshot` already restored ticks, ware index, trade ships, and
   *  stagger offsets from the saved state. */
  initStationsAndShipsForRestore(stations: Station[], ships: Ship[]): void {
    this.registerStationsAndShips(stations, ships);
  }

  /** Fresh-universe path: register the rosters, zero the economy clock,
   *  stagger per-station tick offsets, build the trade-path cache, schedule
   *  initial trade departures, and seed the StationHistory recorder. */
  initStationsAndShipsForFresh(stations: Station[], ships: Ship[], staggerDuration?: number): void {
    this.registerStationsAndShips(stations, ships);
    this.economyTimer.reset();
    staggerStationTicks(stations);
    this.tradeManager.rebuildWareStationIndex(stations);
    this.tradeManager.seedInitialTradeFleet(ships, staggerDuration);
    this.recordInitialStationsInHistory(stations);
  }

  private registerStationsAndShips(stations: Station[], ships: Ship[]): void {
    this.stations = stations;
    this.ships = ships;
    this.stationManager.seed(stations);
    this.shipManager.seed(ships);
  }

  /** StationManager.seed deliberately doesn't fire onAdd, so the history's
   *  subscriber misses the preset stations — backfill them so the Stations
   *  Timelapse Log starts at the correct counts on a fresh game. */
  private recordInitialStationsInHistory(stations: Station[]): void {
    const time = this.historyTimeNowSeconds();
    for (const station of stations) {
      this.stationHistory.recordCreated(time, this.toHistoryStation(station));
    }
  }

  /** Run one fast tick: economy production/consumption, then trade routes. */
  tick(deltaSeconds: number): void {
    tickEconomy(this.stations, this.economyTimer, deltaSeconds);
    this.tradeManager.tick(deltaSeconds);
  }

  /** Slow tick over the dynamic-nations managers — flips completed builds,
   *  kicks off next builds, advances emigration. Fires every ~5 sim-seconds
   *  in the game scene. */
  tickDynamics(deltaSeconds: number): void {
    this.stationManager.tick();
    this.nationManager.tick(deltaSeconds);
    this.emigrationManager.tick(deltaSeconds);
  }

  /** Tear down the simulation — unwires observers and resets all managers.
   *  Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeDecommission();
    this.nationManager.reset();
    this.emigrationManager.dispose();
    this.stationManager.reset();
    this.shipManager.reset();
    this.tradeManager.dispose();
    this.stationHistory.reset();
  }
}

/** Map's corner-to-corner span in map units. NationManager divides distances
 *  by this so sector-scorer distance terms stay in 0..1 regardless of map size. */
function mapDiagonalDistance(map: GameMap): number {
  return Math.hypot(map.gridSizeX * map.sectorSize, map.gridSizeY * map.sectorSize);
}

/** Create runtime Station array from the map's authored placements, applying
 *  the preset's optional seedInitialInventory balance pass. */
function createStationsFromMap(map: GameMap): Station[] {
  const stations: Station[] = [];
  for (const placement of map.stations) {
    stations.push(createStation(placement));
  }
  map.seedInitialInventory?.(stations);
  return stations;
}

/** Build the default fleet for each station. `ignoreCargoCompatibility`
 *  spawns ships even when the nation's ship class can't carry any of the
 *  station's wares — used by editor/report sims that want the full fleet. */
function createShipsForStations(
  stations: Station[],
  namePool: NamePool,
  ignoreCargoCompatibility: boolean,
): Ship[] {
  const ships: Ship[] = [];
  // Accumulates across stations so consecutive fleet spawns in this loop see
  // each other's just-generated ids and don't collide on the BIO-042 pool.
  const takenShipIds = new Set<string>();
  for (const station of stations) {
    const stationShips = createStationShips({
      station,
      takenShipIds,
      namePool,
      options: { ignoreCargoCompatibility },
    });
    for (const ship of stationShips) takenShipIds.add(ship.id);
    ships.push(...stationShips);
  }
  return ships;
}

/** Convenience entry point that runs the full fresh-universe boot from
 *  authored map + preset. Used by tests, the CLI trade-simulation report,
 *  and editor tools (fleet summary, timelapse). Game scene uses
 *  src/game-setup.ts instead so it can thread snapshot loading in. */
export function createSimulation(map: GameMap, options?: SimulationOptions): Simulation {
  const ignoreCargoCompatibility = options?.ignoreCargoCompatibility ?? false;

  const simulation = new Simulation(map);
  // assignStationNames pulls from the simulation's namePool — also handles
  // reserving pre-authored names so dynamic draws don't collide.
  assignStationNames(simulation.namePool, map.stations);

  const stations = createStationsFromMap(map);
  const ships = createShipsForStations(stations, simulation.namePool, ignoreCargoCompatibility);

  simulation.initStationsAndShipsForFresh(stations, ships, options?.initialStaggerDuration);

  simulation.nationManager.startInitialStationBuilds();
  simulation.emigrationManager.spawnInitialGenerationalShip();

  return simulation;
}
