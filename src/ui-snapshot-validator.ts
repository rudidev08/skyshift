// Narrows arbitrary JSON to a GameSnapshot. Lives apart from ui-savegame-manager.ts
// so the shape walker and verifySnapshotRoundTrip stay independent of the
// scene and localStorage plumbing.

import {
  SAVE_VERSION,
  type GameSnapshot,
  type ShipActionSnapshot,
  type StationSnapshot,
  type TradeShipSnapshot,
} from "./sim-save-types";
import { STATION_SIZES, STATION_STATES } from "../data/station-types";
import { HISTORY_STATION_STATES } from "./sim-timelapse-state";
import { allNations } from "../data/nations";
import { allStationTypes } from "../data/stations";
import { allShips } from "../data/ships";
import { allWares } from "../data/wares";
import { getStationTypeTemplate } from "./sim-station-template";
import { stationTypeInventoryWareIds } from "./sim-station";
import * as saveError from "../data/strings-save";

/** `detail` is populated for "corrupt" (parser message + raw preview, or
 *  failing field path), "version" (found vs expected), and "incompatible"
 *  (which reference couldn't be resolved). Never set for "empty" — nothing
 *  to diagnose. */
export type ValidationResult =
  | { ok: true; snapshot: GameSnapshot }
  | {
      ok: false;
      reason: "empty" | "corrupt" | "version" | "incompatible";
      message: string;
      detail?: string;
    };

export function validateSnapshot(json: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      reason: "corrupt",
      message: saveError.CORRUPT_PARSE,
      detail: formatParseErrorDetail(error, json),
    };
  }

  const shape = checkSnapshotShape(parsed);
  if (!shape.ok) {
    return {
      ok: false,
      reason: "corrupt",
      message: saveError.CORRUPT_SHAPE,
      detail: `Missing or invalid field: ${shape.path}`,
    };
  }

  if (shape.snapshot.version !== SAVE_VERSION) {
    return {
      ok: false,
      reason: "version",
      message: saveError.VERSION,
      detail: `Save has version ${shape.snapshot.version}; this build expects ${SAVE_VERSION}.`,
    };
  }

  const incompatibleDetail = findIncompatibleReference(shape.snapshot);
  if (incompatibleDetail) {
    return {
      ok: false,
      reason: "incompatible",
      message: saveError.INCOMPATIBLE,
      detail: incompatibleDetail,
    };
  }

  return { ok: true, snapshot: shape.snapshot };
}

// Catalog id sets for non-throwing membership tests. getNationById and the
// templateLookupById registries throw on a miss (every id flows from the data
// files, so a miss is a typo there) — but a loaded save carries arbitrary
// strings, so resolve against these sets instead and reject cleanly.
const knownNationIds: ReadonlySet<string> = new Set(allNations.map((nation) => nation.id));
const knownStationTypeIds: ReadonlySet<string> = new Set(allStationTypes.map((type) => type.id));
const knownShipTypeIds: ReadonlySet<string> = new Set(allShips.map((ship) => ship.id));
const knownWareIds: ReadonlySet<string> = new Set(allWares.map((ware) => ware.id));

/** Resolve every catalog reference in the snapshot — nation/station-type/ship-type/ware
 *  ids, each operating station's inventory against the wares its type produces or
 *  consumes, and each trade ship's cargo + cargo actions against the ware catalog.
 *  Returns a precise detail string for the first unresolved reference, or null when
 *  everything resolves. Catches a save built against a different content set before
 *  it throws deep inside load (getNationById, the template registries,
 *  stationFromOperatingSnapshot, getWareTemplate on cargo). Shape validation already
 *  proved these fields exist with the right primitive types, so read them directly. */
function findIncompatibleReference(snapshot: GameSnapshot): string | null {
  for (let i = 0; i < snapshot.stations.length; i++) {
    const stationDetail = findIncompatibleStationReference(snapshot.stations[i], `stations[${i}]`);
    if (stationDetail) return stationDetail;
  }

  for (let i = 0; i < snapshot.ships.length; i++) {
    const ship = snapshot.ships[i];
    if (!knownShipTypeIds.has(ship.shipTypeId)) {
      return `ship ${ship.id} has unknown ship type "${ship.shipTypeId}"`;
    }
  }

  for (let i = 0; i < snapshot.tradeShips.length; i++) {
    const tradeShipDetail = findIncompatibleTradeShipReference(snapshot.tradeShips[i], `tradeShips[${i}]`);
    if (tradeShipDetail) return tradeShipDetail;
  }

  // stationHistory "created" entries carry their own embedded station record
  // (nationId + typeId), distinct from the live stations[] array. Restore keeps
  // them as-is (a bare slice); it's the rewind overlay that resolves the ids
  // through the throwing registries when the player scrubs — so resolve them here.
  for (let i = 0; i < snapshot.stationHistory.length; i++) {
    const entry = snapshot.stationHistory[i];
    if (entry.kind !== "created") continue;
    const station = entry.station;
    if (!knownNationIds.has(station.nationId)) {
      return `stationHistory[${i}].station ${station.id} references unknown nation "${station.nationId}"`;
    }
    if (!knownStationTypeIds.has(station.typeId)) {
      return `stationHistory[${i}].station ${station.id} has unknown station type "${station.typeId}"`;
    }
  }

  return null;
}

/** Resolve one live station's nation, type, and inventory ware ids. Operating
 *  (non-building) stations additionally require every inventory ware to be one
 *  the station type produces or consumes — building stations are already
 *  shape-checked down to provisions/hulls only, so they skip that step. */
function findIncompatibleStationReference(station: StationSnapshot, path: string): string | null {
  if (!knownNationIds.has(station.nationId)) {
    return `${path} ${station.id} references unknown nation "${station.nationId}"`;
  }
  if (!knownStationTypeIds.has(station.typeId)) {
    return `${path} ${station.id} has unknown station type "${station.typeId}"`;
  }

  // Building stations hold only provisions/hulls (already shape-checked), so
  // producibleWareIds is null for them and the produce/consume test is skipped.
  const producibleWareIds =
    station.state === "building" ? null : stationTypeInventoryWareIds(getStationTypeTemplate(station.typeId));
  for (const slot of station.inventory) {
    if (!knownWareIds.has(slot.wareId)) {
      return `${path} ${station.id} inventory references unknown ware "${slot.wareId}"`;
    }
    if (producibleWareIds && !producibleWareIds.has(slot.wareId)) {
      return `${path} ${station.id} inventory holds ware "${slot.wareId}", which station type "${station.typeId}" does not produce or consume`;
    }
  }

  return null;
}

/** Resolve one trade ship's cargo and queued cargo-action ware ids against the
 *  ware catalog. An unknown id here would otherwise pass load and throw later
 *  when the trade log or a cargo action calls getWareTemplate on it. */
function findIncompatibleTradeShipReference(tradeShip: TradeShipSnapshot, path: string): string | null {
  for (const cargo of tradeShip.cargo) {
    if (!knownWareIds.has(cargo.wareId)) {
      return `${path} ${tradeShip.shipId} cargo references unknown ware "${cargo.wareId}"`;
    }
  }
  for (const action of tradeShip.actionQueue) {
    if (
      (action.type === "cargo-withdrawal" || action.type === "cargo-deposit") &&
      !knownWareIds.has(action.wareId)
    ) {
      return `${path} ${tradeShip.shipId} ${action.type} action references unknown ware "${action.wareId}"`;
    }
  }
  return null;
}

/** Diagnostic string shown inside the load-error panel's "Show details" toggle:
 *  parser message + clipped raw preview (first 200 chars). */
function formatParseErrorDetail(error: unknown, json: string): string {
  const parseMessage = error instanceof Error ? error.message : String(error);
  const previewLength = Math.min(200, json.length);
  const preview = json.length > previewLength ? json.slice(0, previewLength) + "…" : json;
  return `${parseMessage}\n\nFirst ${previewLength} chars:\n${preview}`;
}

type SnapshotShapeResult = { ok: true; snapshot: GameSnapshot } | { ok: false; path: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isArray = Array.isArray;
const fail = (path: string): SnapshotShapeResult => ({ ok: false, path });

/** Walk the top-level GameSnapshot shape; return the path of the first
 *  bad field, or narrow input to GameSnapshot on success. Paths use
 *  dotted/bracket form (stationHistory[2].station.state) so they're greppable
 *  against the schema in sim-save-types.ts. */
function checkSnapshotShape(snapshot: unknown): SnapshotShapeResult {
  if (!isObject(snapshot)) return fail("(root)");

  if (typeof snapshot.version !== "number") return fail("version");
  if (typeof snapshot.simulationTick !== "number") return fail("simulationTick");
  if (typeof snapshot.presetId !== "string") return fail("presetId");
  if (!isArray(snapshot.stations)) return fail("stations");
  if (!isArray(snapshot.ships)) return fail("ships");
  if (!isArray(snapshot.tradeShips)) return fail("tradeShips");
  if (!isObject(snapshot.tradeManager)) return fail("tradeManager");

  const stationsError = checkStationEntries(snapshot.stations);
  if (stationsError) return fail(stationsError);

  const shipsError = checkShipEntries(snapshot.ships);
  if (shipsError) return fail(shipsError);

  const tradeShipsError = checkTradeShipEntries(snapshot.tradeShips);
  if (tradeShipsError) return fail(tradeShipsError);

  const emigrationError = checkEmigrationManager(snapshot.emigrationManager);
  if (emigrationError) return fail(emigrationError);

  if (!isArray(snapshot.stationHistory)) return fail("stationHistory");
  const stationHistoryError = checkStationHistoryEntries(snapshot.stationHistory);
  if (stationHistoryError) return fail(stationHistoryError);

  // Explicit unknown-cast: snapshot is narrowed to Record<string, unknown>
  // via isObject, but TS can't infer the full GameSnapshot from field-by-field narrows.
  return { ok: true, snapshot: snapshot as unknown as GameSnapshot };
}

/** Reject impossible station combinations before load reaches them — otherwise
 *  the failure surfaces deep in createStation with no path context. States/sizes
 *  pull from the canonical unions in data/station-types.ts so additions there
 *  keep validation honest. */
function checkStationEntries(entries: unknown[]): string | null {
  const validStates: ReadonlySet<string> = new Set(STATION_STATES);
  const validSizes: ReadonlySet<string> = new Set(STATION_SIZES);
  for (let i = 0; i < entries.length; i++) {
    const station = entries[i];
    if (!isObject(station)) return `stations[${i}]`;
    if (typeof station.id !== "string") return `stations[${i}].id`;
    if (typeof station.typeId !== "string") return `stations[${i}].typeId`;
    if (typeof station.nationId !== "string") return `stations[${i}].nationId`;
    if (typeof station.size !== "string" || !validSizes.has(station.size)) return `stations[${i}].size`;
    if (typeof station.state !== "string" || !validStates.has(station.state)) return `stations[${i}].state`;
    if (!isArray(station.inventory)) return `stations[${i}].inventory`;
    const inventoryError = checkInventorySlots(station.inventory, i);
    if (inventoryError) return inventoryError;
    if (station.state === "building") {
      const buildingError = checkBuildingStation(station, i);
      if (buildingError) return buildingError;
    } else if (station.build !== undefined && station.build !== null) {
      return `stations[${i}].build (must be absent when state !== "building")`;
    }
  }
  return null;
}

/** Each inventory slot is read by the reference resolver (wareId) and by
 *  stationFromSnapshot (current + reserved amounts) — guard the shape so a
 *  corrupt slot returns a path here instead of throwing mid-resolve. */
function checkInventorySlots(inventory: unknown[], stationIndex: number): string | null {
  for (let j = 0; j < inventory.length; j++) {
    const slot = inventory[j];
    if (!isObject(slot)) return `stations[${stationIndex}].inventory[${j}]`;
    if (typeof slot.wareId !== "string") return `stations[${stationIndex}].inventory[${j}].wareId`;
    if (typeof slot.current !== "number") return `stations[${stationIndex}].inventory[${j}].current`;
    if (typeof slot.reservedIncoming !== "number")
      return `stations[${stationIndex}].inventory[${j}].reservedIncoming`;
    if (typeof slot.reservedOutgoing !== "number")
      return `stations[${stationIndex}].inventory[${j}].reservedOutgoing`;
  }
  return null;
}

/** Ship entries are read by the reference resolver (shipTypeId) and by
 *  restoreShips (id, stationId, shipName) — guard each entry so a corrupt array
 *  element returns a path instead of throwing mid-resolve. */
function checkShipEntries(entries: unknown[]): string | null {
  for (let i = 0; i < entries.length; i++) {
    const ship = entries[i];
    if (!isObject(ship)) return `ships[${i}]`;
    if (typeof ship.id !== "string") return `ships[${i}].id`;
    if (typeof ship.stationId !== "string") return `ships[${i}].stationId`;
    if (typeof ship.shipTypeId !== "string") return `ships[${i}].shipTypeId`;
    if (typeof ship.shipName !== "string") return `ships[${i}].shipName`;
  }
  return null;
}

/** Trade-ship cargo and cargo-action ware ids are resolved against the ware
 *  catalog, and restore reads shipId — guard the entry and those nested shapes
 *  so the resolver can read them directly. Action types are checked against the
 *  ShipActionSnapshot union: shipActionFromSnapshot's switch has no default, so
 *  an out-of-set type would restore as undefined and throw mid-session.
 *  (The rest of the TradeShipSnapshot — flight, reservations — is reconstructed
 *  by tradeShipFromSnapshot.) */
function checkTradeShipEntries(entries: unknown[]): string | null {
  // Record keys force this set to track the union exactly — adding or renaming
  // an action type errors here, keeping validation in step with load.
  const validActionTypes: ReadonlySet<string> = new Set(
    Object.keys({
      "fly": true,
      "wait": true,
      "cargo-withdrawal": true,
      "cargo-deposit": true,
      "decommission": true,
    } satisfies Record<ShipActionSnapshot["type"], true>),
  );
  for (let i = 0; i < entries.length; i++) {
    const tradeShip = entries[i];
    if (!isObject(tradeShip)) return `tradeShips[${i}]`;
    if (typeof tradeShip.shipId !== "string") return `tradeShips[${i}].shipId`;
    if (!isArray(tradeShip.cargo)) return `tradeShips[${i}].cargo`;
    for (let j = 0; j < tradeShip.cargo.length; j++) {
      const cargo = tradeShip.cargo[j];
      if (!isObject(cargo)) return `tradeShips[${i}].cargo[${j}]`;
      if (typeof cargo.wareId !== "string") return `tradeShips[${i}].cargo[${j}].wareId`;
      if (typeof cargo.amount !== "number") return `tradeShips[${i}].cargo[${j}].amount`;
    }
    if (!isArray(tradeShip.actionQueue)) return `tradeShips[${i}].actionQueue`;
    for (let j = 0; j < tradeShip.actionQueue.length; j++) {
      const action = tradeShip.actionQueue[j];
      if (!isObject(action)) return `tradeShips[${i}].actionQueue[${j}]`;
      if (typeof action.type !== "string" || !validActionTypes.has(action.type))
        return `tradeShips[${i}].actionQueue[${j}].type`;
      if (
        (action.type === "cargo-withdrawal" || action.type === "cargo-deposit") &&
        typeof action.wareId !== "string"
      ) {
        return `tradeShips[${i}].actionQueue[${j}].wareId`;
      }
    }
  }
  return null;
}

/** Building stations carry a required `build` block and are contractually
 *  restricted to provisions/hulls in their inventory — stationFromSnapshot
 *  derives slot.max from `waresRequired`, so a missing/non-numeric value
 *  would crash apply or silently zero a slot, and other ware ids would
 *  silently get max=0 at the use site. Reject up front. */
function checkBuildingStation(station: Record<string, unknown>, stationIndex: number): string | null {
  if (!isObject(station.build)) {
    return `stations[${stationIndex}].build (required when state === "building")`;
  }
  const required = station.build.waresRequired;
  if (!isObject(required)) return `stations[${stationIndex}].build.waresRequired`;
  if (typeof required.provisions !== "number")
    return `stations[${stationIndex}].build.waresRequired.provisions`;
  if (typeof required.hulls !== "number") return `stations[${stationIndex}].build.waresRequired.hulls`;
  const inventory = station.inventory as unknown[];
  for (let j = 0; j < inventory.length; j++) {
    const slot = inventory[j];
    if (!isObject(slot)) return `stations[${stationIndex}].inventory[${j}]`;
    if (slot.wareId !== "provisions" && slot.wareId !== "hulls") {
      return `stations[${stationIndex}].inventory[${j}].wareId (building stations only hold provisions/hulls)`;
    }
  }
  return null;
}

function checkEmigrationManager(emigrationManager: unknown): string | null {
  if (!isObject(emigrationManager)) return "emigrationManager";
  if (emigrationManager.activeEvent !== null) {
    const activeEventError = checkActiveEmigrationEvent(emigrationManager.activeEvent);
    if (activeEventError) return activeEventError;
  }
  if (
    emigrationManager.activeGenerationalShipId !== null &&
    typeof emigrationManager.activeGenerationalShipId !== "string"
  )
    return "emigrationManager.activeGenerationalShipId";
  if (typeof emigrationManager.mode !== "string") return "emigrationManager.mode";
  if (typeof emigrationManager.intensity !== "string") return "emigrationManager.intensity";
  if (!isArray(emigrationManager.usedDestinations)) return "emigrationManager.usedDestinations";
  if (
    emigrationManager.nextGenerationalShipArrivalAtSeconds !== null &&
    typeof emigrationManager.nextGenerationalShipArrivalAtSeconds !== "number"
  )
    return "emigrationManager.nextGenerationalShipArrivalAtSeconds";
  if (typeof emigrationManager.clockSeconds !== "number") return "emigrationManager.clockSeconds";
  if (typeof emigrationManager.nextGenerationalShipCounter !== "number")
    return "emigrationManager.nextGenerationalShipCounter";
  if (typeof emigrationManager.nextEmigrantShipCounter !== "number")
    return "emigrationManager.nextEmigrantShipCounter";
  if (typeof emigrationManager.nextEventCounter !== "number") return "emigrationManager.nextEventCounter";
  return null;
}

function checkActiveEmigrationEvent(activeEvent: unknown): string | null {
  if (!isObject(activeEvent)) return "emigrationManager.activeEvent";
  if (typeof activeEvent.id !== "string") return "emigrationManager.activeEvent.id";
  if (!isArray(activeEvent.nationIds)) return "emigrationManager.activeEvent.nationIds";
  if (typeof activeEvent.generationalShipId !== "string")
    return "emigrationManager.activeEvent.generationalShipId";
  if (!isArray(activeEvent.stationIds)) return "emigrationManager.activeEvent.stationIds";
  if (typeof activeEvent.shipsArrived !== "number") return "emigrationManager.activeEvent.shipsArrived";
  if (typeof activeEvent.totalExpectedShips !== "number")
    return "emigrationManager.activeEvent.totalExpectedShips";
  if (typeof activeEvent.destinationName !== "string") return "emigrationManager.activeEvent.destinationName";
  return null;
}

function checkStationHistoryEntries(entries: unknown[]): string | null {
  const validStates: ReadonlySet<string> = new Set(HISTORY_STATION_STATES);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isObject(entry)) return `stationHistory[${i}]`;
    if (typeof entry.timeSeconds !== "number") return `stationHistory[${i}].timeSeconds`;
    if (entry.kind === "created") {
      const error = checkHistoryCreated(entry, i, validStates);
      if (error) return error;
    } else if (entry.kind === "state-changed") {
      const error = checkHistoryStateChanged(entry, i, validStates);
      if (error) return error;
    } else if (entry.kind === "removed") {
      const error = checkHistoryRemoved(entry, i);
      if (error) return error;
    } else {
      return `stationHistory[${i}].kind`;
    }
  }
  return null;
}

function checkHistoryCreated(
  entry: Record<string, unknown>,
  entryIndex: number,
  validStates: ReadonlySet<string>,
): string | null {
  if (!isObject(entry.station)) return `stationHistory[${entryIndex}].station`;
  const station = entry.station;
  if (typeof station.id !== "string") return `stationHistory[${entryIndex}].station.id`;
  if (typeof station.nationId !== "string") return `stationHistory[${entryIndex}].station.nationId`;
  if (typeof station.typeId !== "string") return `stationHistory[${entryIndex}].station.typeId`;
  if (typeof station.state !== "string" || !validStates.has(station.state))
    return `stationHistory[${entryIndex}].station.state`;
  if (!isObject(station.position)) return `stationHistory[${entryIndex}].station.position`;
  if (typeof station.position.x !== "number") return `stationHistory[${entryIndex}].station.position.x`;
  if (typeof station.position.y !== "number") return `stationHistory[${entryIndex}].station.position.y`;
  return null;
}

function checkHistoryStateChanged(
  entry: Record<string, unknown>,
  entryIndex: number,
  validStates: ReadonlySet<string>,
): string | null {
  if (typeof entry.stationId !== "string") return `stationHistory[${entryIndex}].stationId`;
  if (typeof entry.newState !== "string" || !validStates.has(entry.newState))
    return `stationHistory[${entryIndex}].newState`;
  return null;
}

function checkHistoryRemoved(entry: Record<string, unknown>, entryIndex: number): string | null {
  if (typeof entry.stationId !== "string") return `stationHistory[${entryIndex}].stationId`;
  return null;
}

/** Dev-mode check that catches capture-vs-validator schema drift at save time
 *  rather than as a failed load later — runs the freshly-captured snapshot
 *  through the same validateSnapshot gate every load passes. One extra
 *  stringify + parse per save, which is acceptable at the auto-save cadence. */
export function verifySnapshotRoundTrip(snapshot: GameSnapshot): boolean {
  const result = validateSnapshot(JSON.stringify(snapshot));
  if (result.ok) return true;
  console.warn(
    `[snapshot-validator] captured snapshot fails validation (${result.reason}): ${result.message}` +
      (result.detail ? `\n${result.detail}` : ""),
  );
  return false;
}
