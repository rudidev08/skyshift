// Narrows arbitrary JSON to a GameSnapshot. Lives apart from ui-savegame-manager.ts
// so the shape walker and runSnapshotRoundTripTest stay independent of the
// scene and localStorage plumbing.

import { SAVE_VERSION, type GameSnapshot } from "./sim-save-types";
import { STATION_SIZES, STATION_STATES } from "../data/station-types";
import { HISTORY_STATION_STATES } from "./sim-station-history";
import * as saveError from "../data/strings-save";

/** `detail` is populated for "corrupt" (parser message + raw preview, or
 *  failing field path) and "version" (found vs expected). Never set for
 *  "empty" — nothing to diagnose. */
export type ValidationResult =
  | { ok: true; snapshot: GameSnapshot }
  | { ok: false; reason: "empty" | "corrupt" | "version"; message: string; detail?: string };

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

  if (shape.value.version !== SAVE_VERSION) {
    return {
      ok: false,
      reason: "version",
      message: saveError.VERSION,
      detail: `Save has version ${shape.value.version}; this build expects ${SAVE_VERSION}.`,
    };
  }

  return { ok: true, snapshot: shape.value };
}

/** Diagnostic string shown inside the load-error panel's "Show details" toggle:
 *  parser message + clipped raw preview (first 200 chars). */
function formatParseErrorDetail(error: unknown, json: string): string {
  const parseMessage = error instanceof Error ? error.message : String(error);
  const previewLength = Math.min(200, json.length);
  const preview = json.length > previewLength ? json.slice(0, previewLength) + "…" : json;
  return `${parseMessage}\n\nFirst ${previewLength} chars:\n${preview}`;
}

type SnapshotShapeResult = { ok: true; value: GameSnapshot } | { ok: false; path: string };

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
  if (typeof snapshot.presetId !== "string") return fail("presetId");
  if (!isArray(snapshot.stations)) return fail("stations");
  if (!isArray(snapshot.ships)) return fail("ships");
  if (!isArray(snapshot.tradeShips)) return fail("tradeShips");
  if (!isObject(snapshot.tradeManager)) return fail("tradeManager");
  if (!isArray(snapshot.nationManager)) return fail("nationManager");
  const nationManagerError = checkNationManagerEntries(snapshot.nationManager);
  if (nationManagerError) return fail(nationManagerError);

  const stationsError = checkStationEntries(snapshot.stations);
  if (stationsError) return fail(stationsError);

  const emigrationError = checkEmigrationManager(snapshot.emigrationManager);
  if (emigrationError) return fail(emigrationError);

  if (!isArray(snapshot.stationHistory)) return fail("stationHistory");
  const stationHistoryError = checkStationHistoryEntries(snapshot.stationHistory);
  if (stationHistoryError) return fail(stationHistoryError);

  // Explicit unknown-cast: snapshot is narrowed to Record<string, unknown>
  // via isObject, but TS can't infer the full GameSnapshot from field-by-field narrows.
  return { ok: true, value: snapshot as unknown as GameSnapshot };
}

function checkNationManagerEntries(entries: unknown[]): string | null {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isObject(entry)) return `nationManager[${i}]`;
    if (typeof entry.nationId !== "string") return `nationManager[${i}].nationId`;
    if (entry.currentBuildStationId !== undefined && typeof entry.currentBuildStationId !== "string") {
      return `nationManager[${i}].currentBuildStationId`;
    }
  }
  return null;
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
    if (station.state === "building") {
      const buildingError = checkBuildingStation(station, i);
      if (buildingError) return buildingError;
    } else if (station.build !== undefined && station.build !== null) {
      return `stations[${i}].build (must be absent when state !== "building")`;
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

function checkEmigrationManager(value: unknown): string | null {
  if (!isObject(value)) return "emigrationManager";
  const emigrationManager = value;
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
  if (typeof emigrationManager.clockSeconds !== "number") return "emigrationManager.clockSeconds";
  if (typeof emigrationManager.nextGenerationalShipCounter !== "number")
    return "emigrationManager.nextGenerationalShipCounter";
  if (typeof emigrationManager.nextEmigrantShipCounter !== "number")
    return "emigrationManager.nextEmigrantShipCounter";
  if (typeof emigrationManager.nextEventCounter !== "number") return "emigrationManager.nextEventCounter";
  return null;
}

function checkActiveEmigrationEvent(value: unknown): string | null {
  if (!isObject(value)) return "emigrationManager.activeEvent";
  const activeEvent = value;
  if (typeof activeEvent.id !== "string") return "emigrationManager.activeEvent.id";
  if (!isArray(activeEvent.nationIds)) return "emigrationManager.activeEvent.nationIds";
  if (typeof activeEvent.generationalShipId !== "string")
    return "emigrationManager.activeEvent.generationalShipId";
  if (!isArray(activeEvent.stationIds)) return "emigrationManager.activeEvent.stationIds";
  if (typeof activeEvent.shipsArrived !== "number") return "emigrationManager.activeEvent.shipsArrived";
  if (typeof activeEvent.totalExpectedShips !== "number")
    return "emigrationManager.activeEvent.totalExpectedShips";
  if (typeof activeEvent.destinationName !== "string") return "emigrationManager.activeEvent.destinationName";
  if (typeof activeEvent.startAt !== "number") return "emigrationManager.activeEvent.startAt";
  return null;
}

function checkStationHistoryEntries(entries: unknown[]): string | null {
  const validStates: ReadonlySet<string> = new Set(HISTORY_STATION_STATES);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isObject(entry)) return `stationHistory[${i}]`;
    if (typeof entry.time !== "number") return `stationHistory[${i}].time`;
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

/** Dev-mode round-trip — serialize, validate, and compare against the original.
 *  Catches schema drift at capture time rather than load time. Runs sync
 *  with one extra stringify + parse, acceptable at the auto-save cadence. */
export function runSnapshotRoundTripTest(snapshot: GameSnapshot): boolean {
  const json = JSON.stringify(snapshot);
  const result = validateSnapshot(json);
  if (!result.ok) {
    console.warn(
      `[snapshot-validator] round-trip failed: ${result.reason} — ${result.message}` +
        (result.detail ? `\n${result.detail}` : ""),
    );
    return false;
  }
  // The validator only type-checks fields — deep-compare JSON projections
  // to catch value drift (e.g. a serialized field missing from the walker).
  const reserialized = JSON.stringify(result.snapshot);
  if (reserialized !== json) {
    const minLength = Math.min(json.length, reserialized.length);
    let firstDivergingCharIndex = minLength;
    for (let i = 0; i < minLength; i++) {
      if (json[i] !== reserialized[i]) {
        firstDivergingCharIndex = i;
        break;
      }
    }
    console.warn(
      `[snapshot-validator] round-trip lost or reordered data; ` +
        `first divergence at char ${firstDivergingCharIndex}`,
    );
    return false;
  }
  return true;
}
