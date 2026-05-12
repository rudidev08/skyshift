import type { Game } from "./game";
import {
  SAVE_VERSION,
  type GameSnapshot,
  type ShipSnapshot,
  type SlotKind,
  saveSlotKey,
  autoSaveNextIndexKey,
  AUTO_SLOT_COUNT,
  MANUAL_SLOT_COUNT,
} from "./sim-save-types";
import { getNextAutoIndex } from "./storage-save-slots";
import { validateSnapshot, runSnapshotRoundTripTest, type ValidationResult } from "./ui-snapshot-validator";
import { isDevModeEnabled } from "./util-devmode";
import { downloadJsonFile, fileNameTimestamp } from "./ui-download-json";
import { stationToSnapshot, stationFromSnapshot, type Station } from "./sim-station";
import { shipToSnapshot, shipFromSnapshot, type Ship } from "./sim-ships";
import {
  tradeShipToSnapshot,
  tradeShipFromSnapshot,
  type SnapshotContext,
} from "./sim-trade-manager";
import type { TradeShip } from "./sim-trade-types";
import type { Simulation } from "./sim-lifecycle";
import { staggerStationTicks } from "./sim-economy";
import * as saveError from "../data/strings-save";

export { validateSnapshot, type ValidationResult };

export function captureSnapshot(game: Game, source?: GameSnapshot["source"]): GameSnapshot {
  const simulation = game.simulation!;
  const snapshot: GameSnapshot = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    simTick: simulation.economyTimer.tick,
    ...(source !== undefined && { source }),
    preset: game.map.presetId,
    stations: game.stations.map(stationToSnapshot),
    ships: snapshotShipsWithInFlight(game.ships, simulation.tradeManager.tradeShips),
    tradeShips: simulation.tradeManager.tradeShips.map(tradeShipToSnapshot),
    nationManager: simulation.nationManager.toSnapshot(),
    emigrationManager: simulation.emigrationManager.toSnapshot(),
    tradeModule: simulation.tradeManager.toSnapshot(),
    stationHistory: simulation.stationHistory.toSnapshot(),
  };
  // Dev-mode safety net — round-trip every fresh snapshot so schema drift
  // surfaces at capture time, not as a failed load months later.
  if (isDevModeEnabled()) runSnapshotRoundTripTest(snapshot);
  return snapshot;
}

/** Snapshot every ship with `inFlight` derived from the trade manager's flight set
 *  so the snapshot reflects sim truth even though Ship no longer carries the field. */
function snapshotShipsWithInFlight(ships: Ship[], tradeShips: readonly TradeShip[]): ShipSnapshot[] {
  const inFlightShipIds = new Set(
    tradeShips
      .filter((tradeShip) => tradeShip.flight !== null)
      .map((tradeShip) => tradeShip.orbitingShipId),
  );
  return ships.map((ship) => shipToSnapshot(ship, inFlightShipIds.has(ship.id)));
}

export function applySnapshot(game: Game, snapshot: GameSnapshot): void {
  const simulation = game.simulation!;
  // Roster registration with StationManager and ShipManager happens in
  // game-setup.ts via initStationsAndShipsForRestore after we return — keeps
  // manager lifecycle ownership on the runtime side, not here.
  const stationsById = restoreStations(game, simulation, snapshot);
  const shipsById = restoreShips(game, snapshot, stationsById);
  const tradeShipsByShipId = restoreTradeShips(simulation, snapshot, stationsById, shipsById);
  restoreManagerSnapshots(simulation, snapshot, tradeShipsByShipId);
  restoreEconomyTime(game, simulation, snapshot);
  resetPlaybackSpeed(game);
}

/** Snapshot is the sole source of station truth for loaded sessions; the
 *  authored map only seeds fresh-init and isn't consulted here. */
function restoreStations(game: Game, simulation: Simulation, snapshot: GameSnapshot): Map<string, Station> {
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

function restoreShips(game: Game, snapshot: GameSnapshot, stationsById: Map<string, Station>): Map<string, Ship> {
  const ships: Ship[] = [];
  const shipsById = new Map<string, Ship>();
  for (const shipSnapshot of snapshot.ships) {
    const station = stationsById.get(shipSnapshot.stationId);
    if (!station) throw new Error(`applySnapshot: orbiting ship ${shipSnapshot.id} references missing station ${shipSnapshot.stationId}`);
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
    simulation.tradeManager.registerTradeShip(tradeShip);
    tradeShipsByShipId.set(tradeShipSnapshot.shipId, tradeShip);
  }
  return tradeShipsByShipId;
}

function restoreManagerSnapshots(
  simulation: Simulation,
  snapshot: GameSnapshot,
  tradeShipsByShipId: Map<string, TradeShip>,
): void {
  simulation.nationManager.fromSnapshot(snapshot.nationManager);
  simulation.emigrationManager.fromSnapshot(snapshot.emigrationManager);
  simulation.stationHistory.fromSnapshot(snapshot.stationHistory);
  simulation.tradeManager.restoreFromSnapshot(snapshot.tradeModule, tradeShipsByShipId);
}

function restoreEconomyTime(game: Game, simulation: Simulation, snapshot: GameSnapshot): void {
  staggerStationTicks(game.stations);
  simulation.economyTimer.reset();
  simulation.economyTimer.tick = snapshot.simTick;
}

/** Playback always resumes at 1× so loaded saves don't blast through unattended. */
function resetPlaybackSpeed(game: Game): void {
  game.timeScale = 1;
  game.timeController?.setSpeed(1);
}

export function saveToManualSlot(game: Game, index: number): void {
  if (index < 1 || index > MANUAL_SLOT_COUNT) throw new Error(`Invalid manual slot ${index}`);
  const snapshot = captureSnapshot(game, "manual");
  writeSlot("manual", index, snapshot);
}

export function saveAutoSlot(game: Game): void {
  const snapshot = captureSnapshot(game, "auto");
  const nextIndex = getNextAutoIndex();
  writeSlot("auto", nextIndex, snapshot);
  localStorage.setItem(autoSaveNextIndexKey(), String((nextIndex % AUTO_SLOT_COUNT) + 1));
}

/** Read + validate a slot. Does NOT apply — caller triggers remount.
 *  Slots are shared (one universe); snapshot.preset records the seeding
 *  preset but nothing consumes it for routing. */
export function loadFromSlot(kind: SlotKind, index: number): ValidationResult {
  const raw = localStorage.getItem(saveSlotKey(kind, index));
  if (!raw) return { ok: false, reason: "empty", message: saveError.SLOT_EMPTY };
  return validateSnapshot(raw);
}

function writeSlot(kind: SlotKind, index: number, snapshot: GameSnapshot): void {
  try {
    localStorage.setItem(saveSlotKey(kind, index), JSON.stringify(snapshot));
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      throw Object.assign(new Error(saveError.QUOTA), { cause: error });
    }
    throw error;
  }
}

export function exportToFile(game: Game): void {
  const snapshot = captureSnapshot(game, "export");
  const timestamp = fileNameTimestamp(new Date(snapshot.savedAt));
  downloadJsonFile(snapshot, `skyshift-${snapshot.preset}-${timestamp}.json`);
}

/** Read + validate a file. Does NOT apply; caller triggers remount on ok. */
export async function importFromFile(file: File): Promise<ValidationResult> {
  const json = await file.text();
  return validateSnapshot(json);
}
