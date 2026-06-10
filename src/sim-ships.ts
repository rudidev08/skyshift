import type { Station } from "./sim-station-types";
import type { ShipTypeId, ShipTypeTemplate } from "../data/ship-types";
import type { StationBuild } from "../data/station-types";
import type { WareId } from "../data/ware-types";
import type { ShipSnapshot } from "./sim-save-types";
import { shipsPerStationBySize } from "../data/stations";
import { getShipTypeTemplate } from "./sim-ship-template";
import { isStationUnderConstruction } from "./sim-station";
import { getWareTemplate } from "./sim-ware-template";
import { generateUniqueId } from "./util-ids";
import type { NamePool } from "./sim-name-pool";

/** Generate a unique nation-prefixed ship code (e.g. "BIO-042") that doesn't
 *  appear in `takenShipIds`. Random pick first — keeps codes shuffled when the
 *  pool is sparse — then a deterministic 000..999 scan if random gave up.
 *  Throws when the 1000-slot pool is full; codes are released back to the pool
 *  whenever a ship leaves the roster, so this only fires when 1000 ships of
 *  one nation are simultaneously alive. */
function generateUniqueShipCode(nationCode: string, takenShipIds: ReadonlySet<string>): string {
  return generateUniqueId({
    prefix: nationCode,
    randomSuffix: () => String(Math.floor(Math.random() * 1000)).padStart(3, "0"),
    randomAttempts: 100,
    takenIds: takenShipIds,
    fallback: () => {
      for (let i = 0; i < 1000; i++) {
        const code = `${nationCode}-${String(i).padStart(3, "0")}`;
        if (!takenShipIds.has(code)) return code;
      }
      throw new Error(`Ship code pool exhausted for nation ${nationCode}: 1000 ships alive`);
    },
  });
}

/** Runtime ship — sim-authoritative state only. Orbit angle, speed, radius are
 *  render-owned (see ShipVisualBundle). In-flight is derived: read
 *  via tradeManager.isShipInFlight(tradeShip) or `tradeShip.flight !== null`. */
export interface Ship {
  id: string;
  shipTypeId: ShipTypeId;
  shipName: string;
  station: Station;
}

export interface CreateStationShipsOptions {
  /** Keep editor/report force-spawn behavior even when a station cannot trade. */
  ignoreCargoCompatibility?: boolean;
  /** Override the nation's default ship type — for build-site trader fleets
   *  that need a different ship type than the nation's default. */
  shipTypeOverride?: ShipTypeId;
}

/** Build sites' only trade-relevant wares are their construction inputs; the
 *  operational set isn't trade-relevant until the building → producing flip
 *  respawns the regular fleet (see sim-lifecycle.ts onFlip handler). */
function canShipCarryAnyBuildSiteWare(
  station: Station & { build: StationBuild },
  allowedWares: Set<WareId>,
): boolean {
  const requiredWareIds = Object.keys(station.build.waresRequired) as WareId[];
  for (const wareId of requiredWareIds) {
    if (allowedWares.has(wareId)) return true;
  }
  return false;
}

/** Sink wares have no output slot — trade-relevant wares are real outputs plus
 *  every input the station needs replenished. */
function canShipCarryAnyOperationalWare(station: Station, allowedWares: Set<WareId>): boolean {
  for (const producedWareId of station.stationType.produces) {
    const producedWare = getWareTemplate(producedWareId);
    if (producedWare.productionOutput > 0 && allowedWares.has(producedWareId)) {
      return true;
    }
    for (const input of producedWare.productionInputs) {
      if (allowedWares.has(input.wareId)) {
        return true;
      }
    }
  }
  return false;
}

/** Does the ship's `allowedWares` overlap with the station's trade needs?
 *  Operational stations route to the produced output + production inputs;
 *  build sites route to the construction wares in `station.build.waresRequired`. */
function canShipCarryAnyWareThatStationUses(station: Station, shipTemplate: ShipTypeTemplate): boolean {
  const allowedWares = new Set(shipTemplate.allowedWares);
  return isStationUnderConstruction(station)
    ? canShipCarryAnyBuildSiteWare(station, allowedWares)
    : canShipCarryAnyOperationalWare(station, allowedWares);
}

export interface CreateStationShipsInput {
  station: Station;
  /** Ship IDs already in use across the simulation; consecutive calls in a
   *  fleet-spawn loop must add each returned ship's id to their own set so the
   *  next call sees it. */
  takenShipIds: ReadonlySet<string>;
  namePool: NamePool;
  options?: CreateStationShipsOptions;
}

export function createStationShips(input: CreateStationShipsInput): Ship[] {
  const { station, takenShipIds, namePool, options } = input;
  const shipTypeId = options?.shipTypeOverride ?? station.nation.shipTypeId;
  if (!shipTypeId) return [];
  const shipTemplate = getShipTypeTemplate(shipTypeId);
  if (!options?.ignoreCargoCompatibility && !canShipCarryAnyWareThatStationUses(station, shipTemplate)) {
    return [];
  }

  const nationCode = station.nation.codeName;
  const count = shipsPerStationBySize[station.size];
  const ships: Ship[] = [];
  // Copied so the loop's claims don't mutate the caller-provided `takenShipIds`.
  const claimedShipIds = new Set(takenShipIds);

  for (let i = 0; i < count; i++) {
    const id = generateUniqueShipCode(nationCode, claimedShipIds);
    claimedShipIds.add(id);
    const shipName = namePool.claimShipName(station.nation);
    ships.push({ id, shipTypeId, shipName, station });
  }

  return ships;
}

/** Serialize a ship. Parent station referenced by id; orbit visuals are
 *  render-owned and not persisted. Whether a ship is mid-flight is not stored —
 *  it's rebuilt on load from each trade ship's `flight` field. */
export function shipToSnapshot(ship: Ship): ShipSnapshot {
  return {
    id: ship.id,
    stationId: ship.station.id,
    shipTypeId: ship.shipTypeId,
    shipName: ship.shipName,
  };
}

/** Reconstruct a ship from a snapshot. Caller resolves `station` from
 *  `snapshot.stationId` before calling (see `restoreSavedGame` in
 *  `src/ui-savegame-manager.ts`). */
export function shipFromSnapshot(snapshot: ShipSnapshot, station: Station): Ship {
  return {
    id: snapshot.id,
    station,
    shipTypeId: snapshot.shipTypeId,
    shipName: snapshot.shipName,
  };
}
