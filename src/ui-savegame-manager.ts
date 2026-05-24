import type { GameMap } from "./sim-map-types";
import { SAVE_VERSION, type GameSnapshot } from "./sim-save-types";
import { type SlotKind, MANUAL_SLOT_COUNT } from "./sim-save-slots";
import { getNextAutoIndex, readSlotBlob, writeSlotJson, advanceAutoIndex } from "./storage-save-slots";
import { validateSnapshot, verifySnapshotRoundTrip, type ValidationResult } from "./ui-snapshot-validator";
import { isDevModeEnabled } from "./util-devmode";
import { downloadJsonFile, fileNameTimestamp } from "./ui-download-json";
import { stationToSnapshot, stationFromSnapshot, type Station } from "./sim-station";
import { shipToSnapshot, shipFromSnapshot, type Ship } from "./sim-ships";
import { tradeShipToSnapshot, tradeShipFromSnapshot, type SnapshotContext } from "./sim-trade-save-snapshot";
import type { TradeShip } from "./sim-trade-types";
import type { Simulation } from "./sim-lifecycle";
import { staggerStationTicks } from "./sim-economy";
import * as saveError from "../data/strings-save";

/** The subset of the running Game that the savegame layer reads and writes.
 *  Game satisfies this structurally; the savegame tests pass a real-Simulation
 *  fixture that satisfies the same contract instead of the full Phaser Game. */
export interface SavegameHost {
  /** Optional to match Game.simulation; capture and restore assert it with `!`. */
  simulation?: Simulation;
  map: GameMap;
  stations: Station[];
  ships: Ship[];
  timeScale: number;
  /** Restore forces playback to 1×; no time/playback state is saved. */
  timeController?: { setSpeed(speed: number): void };
}

export function captureSnapshot(game: SavegameHost, source?: GameSnapshot["source"]): GameSnapshot {
  const simulation = game.simulation!;
  const snapshot: GameSnapshot = {
    version: SAVE_VERSION,
    savedAtMilliseconds: Date.now(),
    simulationTick: simulation.economyTimer.tickCount,
    ...(source !== undefined && { source }),
    presetId: game.map.presetId,
    stations: game.stations.map(stationToSnapshot),
    ships: game.ships.map(shipToSnapshot),
    tradeShips: simulation.tradeManager.tradeShips.map(tradeShipToSnapshot),
    emigrationManager: simulation.emigrationManager.toSnapshot(),
    tradeManager: simulation.tradeManager.toSnapshot(),
    stationHistory: simulation.stationHistory.toSnapshot(),
  };
  // Dev-mode safety net — round-trip every fresh snapshot so schema drift
  // surfaces at capture time, not as a failed load months later.
  if (isDevModeEnabled()) verifySnapshotRoundTrip(snapshot);
  return snapshot;
}

export function restoreSavedGame(game: SavegameHost, snapshot: GameSnapshot): void {
  const simulation = game.simulation!;
  // Roster registration with StationManager and ShipManager happens in
  // game-setup.ts via seedRosterForSavedGame after we return — keeps
  // manager lifecycle ownership on the runtime side, not here.
  const stationsById = restoreStations(game, simulation, snapshot);
  const shipsById = restoreShips(game, snapshot, stationsById);
  const tradeShipsByShipId = restoreTradeShips(simulation, snapshot, stationsById, shipsById);
  restoreManagerSnapshots(simulation, snapshot, tradeShipsByShipId);
  restoreEconomyTime(game, simulation, snapshot);
  resetPlaybackSpeed(game);
}

/** Snapshot is the sole source of station truth for loaded sessions; the
 *  map template only seeds fresh-init and isn't consulted here. */
function restoreStations(game: SavegameHost, simulation: Simulation, snapshot: GameSnapshot): Map<string, Station> {
  const stationsById = new Map<string, Station>();
  const rebuilt: Station[] = [];
  for (const stationSnapshot of snapshot.stations) {
    const station = stationFromSnapshot(stationSnapshot);
    rebuilt.push(station);
    stationsById.set(stationSnapshot.id, station);
  }
  game.stations = rebuilt;
  // Rebuild the producer/consumer index — stations are fresh objects, the old index points at orphans.
  simulation.tradeManager.rebuildWareStationIndex(game.stations);
  return stationsById;
}

function restoreShips(
  game: SavegameHost,
  snapshot: GameSnapshot,
  stationsById: Map<string, Station>,
): Map<string, Ship> {
  const ships: Ship[] = [];
  const shipsById = new Map<string, Ship>();
  for (const shipSnapshot of snapshot.ships) {
    const station = stationsById.get(shipSnapshot.stationId);
    if (!station)
      throw new Error(
        `restoreSavedGame: orbiting ship ${shipSnapshot.id} references missing station ${shipSnapshot.stationId}`,
      );
    const ship = shipFromSnapshot(shipSnapshot, station);
    ships.push(ship);
    shipsById.set(ship.id, ship);
  }
  game.ships = ships;
  return shipsById;
}

function restoreTradeShips(
  simulation: Simulation,
  snapshot: GameSnapshot,
  stationsById: Map<string, Station>,
  shipsById: Map<string, Ship>,
): Map<string, TradeShip> {
  // Trade ships need both station and ship maps to resolve route + carrier refs.
  const snapshotContext: SnapshotContext = { stations: stationsById, ships: shipsById };
  simulation.tradeManager.clearTradeShips();
  const tradeShipsByShipId = new Map<string, TradeShip>();
  for (const tradeShipSnapshot of snapshot.tradeShips) {
    const tradeShip = tradeShipFromSnapshot(tradeShipSnapshot, snapshotContext);
    simulation.tradeManager.addRestoredTradeShip(tradeShip);
    tradeShipsByShipId.set(tradeShipSnapshot.shipId, tradeShip);
  }
  return tradeShipsByShipId;
}

function restoreManagerSnapshots(
  simulation: Simulation,
  snapshot: GameSnapshot,
  tradeShipsByShipId: Map<string, TradeShip>,
): void {
  simulation.emigrationManager.fromSnapshot(snapshot.emigrationManager);
  simulation.stationHistory.fromSnapshot(snapshot.stationHistory);
  simulation.tradeManager.restoreFromSnapshot(snapshot.tradeManager, tradeShipsByShipId);
}

function restoreEconomyTime(game: SavegameHost, simulation: Simulation, snapshot: GameSnapshot): void {
  staggerStationTicks(game.stations);
  simulation.economyTimer.reset();
  simulation.economyTimer.tickCount = snapshot.simulationTick;
}

/** Playback always resumes at 1× so loaded saves don't blast through unattended. */
function resetPlaybackSpeed(game: SavegameHost): void {
  game.timeScale = 1;
  game.timeController?.setSpeed(1);
}

export function saveToManualSlot(game: SavegameHost, index: number): void {
  if (index < 1 || index > MANUAL_SLOT_COUNT) throw new Error(`Invalid manual slot ${index}`);
  const snapshot = captureSnapshot(game, "manual");
  writeSlot("manual", index, snapshot);
}

export function saveAutoSlot(game: SavegameHost): void {
  const snapshot = captureSnapshot(game, "auto");
  const nextIndex = getNextAutoIndex();
  writeSlot("auto", nextIndex, snapshot);
  advanceAutoIndex(nextIndex);
}

/** Read + validate a slot. Does NOT apply — caller triggers remount.
 *  Slots are shared (one universe); snapshot.presetId records the seeding
 *  preset but nothing consumes it for routing. */
export function readSlot(kind: SlotKind, index: number): ValidationResult {
  const raw = readSlotBlob(kind, index);
  if (!raw) return { ok: false, reason: "empty", message: saveError.SLOT_EMPTY };
  return validateSnapshot(raw);
}

function writeSlot(kind: SlotKind, index: number, snapshot: GameSnapshot): void {
  writeSlotJson(kind, index, JSON.stringify(snapshot));
}

export function exportToFile(game: SavegameHost): void {
  const snapshot = captureSnapshot(game, "export");
  const timestamp = fileNameTimestamp(new Date(snapshot.savedAtMilliseconds));
  downloadJsonFile(snapshot, `skyshift-${snapshot.presetId}-${timestamp}.json`);
}

/** Read + validate a file. Does NOT apply; caller triggers remount on ok. */
export async function readSnapshotFile(file: File): Promise<ValidationResult> {
  const json = await file.text();
  return validateSnapshot(json);
}
