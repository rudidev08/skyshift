// Authoritative station roster + build lifecycle (building → producing → emigrating).
//
// Build flow:
//   1. NationManager calls placeBuild → Station created in "building" state with
//      the real station type attached (so produces/UI are correct), plus two
//      temporary inventory slots for provisions + hulls.
//   2. Trade system routes construction wares to those slots.
//   3. tick() checks both slots full; on both done, rebuild canonical inventory,
//      flip state to "producing", swap the orbiting fleet.

import type {
  PlacedStation,
  StationTypeId,
  StationSize,
  StationState,
} from "../data/station-types";
import type { Station } from "./sim-station-types";
import { getNationById, type Nation } from "./sim-nation";
import type { ShipTypeId } from "../data/ship-types";
import {
  finalizeStation,
  createStation,
  createInventorySlot,
  getInventorySlot,
  getAllInventorySlots,
  replaceStationInventoryAndIndex,
} from "./sim-station";
import { getWareTemplate } from "./sim-ware-template";
import { getStationTypeTemplate, computeBuildWares } from "./sim-station-template";
import { generateUniqueId } from "./util-ids";
import type { Ship } from "./sim-ships";
import type { ShipManager } from "./sim-ship-manager";

export interface BuildPlacement {
  zoneId: string;
  typeId: StationTypeId;
  size: StationSize;
  /** Requester; the station belongs to this nation. */
  nationId: string;
  /** If set, build cost doubles and the station carries a contract flavor label. */
  contractingNationId?: string;
  x: number;
  y: number;
  name?: string;
}

export type StationAddObserver = (station: Station, ships: Ship[]) => void;
export type StationRemoveObserver = (station: Station) => void;
/** Fires after building→producing flip. `buildShips` are the build-site ships
 *  to despawn — caller removes them from its orbiting-ship list and tears
 *  down their renders. */
export type StationFlipObserver = (station: Station, buildShips: Ship[]) => void;
/** Fires after a single-station lifecycle state change (setStationState,
 *  transitionFromBuildingToProducingState). Trade path cache subscribes here
 *  so producer/consumer topology stays in sync as stations enter and leave
 *  the trade graph. */
export type StationStateChangeObserver = (
  station: Station,
  oldState: StationState,
  newState: StationState,
) => void;

/** Fires once after a batch of stations transition together via
 *  setStationStates. Carries every real (station, oldState) pair and the
 *  shared newState so subscribers can rebuild caches once for the whole
 *  batch instead of N times. */
export type StationStateChangeBatchObserver = (
  transitions: ReadonlyArray<{ station: Station; oldState: StationState }>,
  newState: StationState,
) => void;

export class StationManager {
  private stations: Station[] = [];
  private byId = new Map<string, Station>();
  private addObservers = new Set<StationAddObserver>();
  private removeObservers = new Set<StationRemoveObserver>();
  private flipObservers = new Set<StationFlipObserver>();
  private stateChangeObservers = new Set<StationStateChangeObserver>();
  private batchStateChangeObservers = new Set<StationStateChangeBatchObserver>();
  private readonly shipManager: ShipManager;
  /** Rebuild the trade-system's producer/consumer index after a roster
   *  mutation. Injected by the lifecycle so StationManager doesn't carry a
   *  TradeManager reference (avoids the circular construction order). */
  private readonly rebuildWareIndex: (stations: readonly Station[]) => void;

  constructor(dependencies: {
    shipManager: ShipManager;
    rebuildWareIndex: (stations: readonly Station[]) => void;
  }) {
    this.shipManager = dependencies.shipManager;
    this.rebuildWareIndex = dependencies.rebuildWareIndex;
  }

  /** Seed the manager with the initial station list at map boot — does not fire add observers. */
  seed(stations: Station[]): void {
    this.stations = stations;
    this.byId.clear();
    for (const station of stations) this.byId.set(station.id, station);
  }

  getStations(): readonly Station[] {
    return this.stations;
  }
  getStation(id: string): Station | undefined {
    return this.byId.get(id);
  }
  getStationsForNation(nationId: string): Station[] {
    return this.stations.filter((station) => station.nation.id === nationId);
  }

  onAdd(callback: StationAddObserver): () => void {
    this.addObservers.add(callback);
    return () => this.addObservers.delete(callback);
  }
  onRemove(callback: StationRemoveObserver): () => void {
    this.removeObservers.add(callback);
    return () => this.removeObservers.delete(callback);
  }
  onFlip(callback: StationFlipObserver): () => void {
    this.flipObservers.add(callback);
    return () => this.flipObservers.delete(callback);
  }
  onStationStateChange(callback: StationStateChangeObserver): () => void {
    this.stateChangeObservers.add(callback);
    return () => this.stateChangeObservers.delete(callback);
  }
  onStationStateChangeBatch(callback: StationStateChangeBatchObserver): () => void {
    this.batchStateChangeObservers.add(callback);
    return () => this.batchStateChangeObservers.delete(callback);
  }

  /** Set lifecycle state + fire observers. For simple transitions (e.g.
   *  →emigrating). Building→producing has to rebuild inventory and fleet, so
   *  transitionFromBuildingToProducingState handles that path and fires the
   *  same observers after. */
  setStationState(station: Station, newState: StationState): void {
    const oldState = station.state;
    if (oldState === newState) return;
    station.state = newState;
    this.fireStateChange(station, oldState, newState);
  }

  /** Batch state change — fires the batch observer once for the whole group
   *  so the trade path cache rebuilds once instead of once per station. */
  setStationStates(stations: readonly Station[], newState: StationState): void {
    const transitions: Array<{ station: Station; oldState: StationState }> = [];
    for (const station of stations) {
      const oldState = station.state;
      if (oldState === newState) continue;
      station.state = newState;
      transitions.push({ station, oldState });
    }
    if (transitions.length === 0) return;
    for (const callback of this.batchStateChangeObservers) callback(transitions, newState);
  }

  private fireStateChange(station: Station, oldState: StationState, newState: StationState): void {
    for (const callback of this.stateChangeObservers) callback(station, oldState, newState);
  }

  /** Register a station, spawn its fleet (optionally overriding ship type for
   *  build-site traders), rebuild the trade path cache, fire add observers. */
  addStation(station: Station, options?: { shipTypeOverride?: ShipTypeId }): Ship[] {
    const id = station.id;
    if (this.byId.has(id)) throw new Error(`addStation: ${id} already registered`);
    this.stations.push(station);
    this.byId.set(id, station);

    const ships = this.shipManager.spawnFleetForStation(station, options);

    this.rebuildWareIndex(this.stations);
    for (const callback of this.addObservers) callback(station, ships);
    return ships;
  }

  /** Remove a station — despawn fleet, clear reservations, fire remove
   *  observers, rebuild trade path cache. */
  removeStation(id: string): Station | undefined {
    const station = this.byId.get(id);
    if (!station) return undefined;
    this.shipManager.removeShipsForStation(station);
    return this.unregisterStation(station);
  }

  /** Remove an emigrated station while leaving its ferry ships in flight —
   *  they have a `decommission` terminal queued and will remove themselves
   *  on arrival at the generational ship. */
  removeStationForEmigration(id: string): Station | undefined {
    const station = this.byId.get(id);
    if (!station) return undefined;
    return this.unregisterStation(station);
  }

  private unregisterStation(station: Station): Station {
    // Zero reservations so trade-manager accounting doesn't count a ghost station.
    for (const slot of getAllInventorySlots(station)) {
      slot.reservedIncoming = 0;
      slot.reservedOutgoing = 0;
    }

    this.byId.delete(station.id);
    const index = this.stations.indexOf(station);
    if (index >= 0) this.stations.splice(index, 1);

    for (const callback of this.removeObservers) callback(station);
    this.rebuildWareIndex(this.stations);
    return station;
  }

  /** Place a new building station. Real StationTypeTemplate is attached so
   *  economy/UI see the right produces list during the build; inventory holds
   *  only the two construction-ware slots until flip. */
  placeBuild(placement: BuildPlacement): { station: Station; ships: Ship[] } {
    const nation = getNationById(placement.nationId);
    const contracted = placement.contractingNationId !== undefined;
    const waresRequired = computeBuildWares(placement.typeId, placement.size, contracted);

    const placedStation: PlacedStation = {
      id: this.generateStationIdForNation(nation),
      name: placement.name,
      x: placement.x,
      y: placement.y,
      nation,
      stationTypeId: placement.typeId,
      size: placement.size,
      state: "building",
      build: { waresRequired, contractingNationId: placement.contractingNationId },
      zoneId: placement.zoneId,
    };

    // Trade/economy/HUD gate off station.state, so attaching the real
    // StationTypeTemplate up front advertises future output while only inbound
    // construction wares are accepted. See `canStationTrade` / `isStationProducing`.
    const station = createStationUnderConstruction(placedStation);

    // Build-site uses the nation's stationConstructionShipTypeId (default
    // "trader") so the fleet can carry both provisions and hulls. On flip
    // these are despawned and the regular fleet spawns.
    const shipTypeOverride = nation.stationConstructionShipTypeId ?? undefined;
    const ships = this.addStation(station, { shipTypeOverride });

    return { station, ships };
  }

  /** Slow-tick: flip building stations to producing once construction is complete. */
  tick(): void {
    for (const station of this.stations) {
      if (this.isBuildComplete(station)) this.transitionFromBuildingToProducingState(station);
    }
  }

  private isBuildComplete(station: Station): boolean {
    if (station.state !== "building") return false;
    const build = station.build;
    if (!build) return false;
    const provisionsSlot = getInventorySlot(station, "provisions");
    const hullsSlot = getInventorySlot(station, "hulls");
    if (!provisionsSlot || !hullsSlot) return false;
    // The `reservedIncoming === 0` gate is defensive — the reservation rule
    // makes it true once `current === max === waresRequired`. It catches drift
    // where a trader would arrive post-flip; that cargo gets silently discarded
    // by applyDepositAction's missing-slot guard.
    return (
      provisionsSlot.current >= build.waresRequired.provisions &&
      provisionsSlot.reservedIncoming === 0 &&
      hullsSlot.current >= build.waresRequired.hulls &&
      hullsSlot.reservedIncoming === 0
    );
  }

  /** Building → producing flip: rebuild inventory at zero stock, carry forward
   *  reservations, clear build state, fire flip + state-change observers. */
  private transitionFromBuildingToProducingState(station: Station): void {
    const rebuilt = this.rebuildStationFromTemplate(station);
    // Capture old state and build-site fleet before mutating.
    const oldState = station.state;
    const buildShips = this.shipManager.getShipsForStation(station);
    this.applyRebuiltStation(station, rebuilt);

    for (const callback of this.flipObservers) callback(station, buildShips);
    // Fire state-change after flip so flip-handler side-effects are visible when downstream caches rebuild.
    this.fireStateChange(station, oldState, "producing");
  }

  private rebuildStationFromTemplate(station: Station): Station {
    const oldInventory = getAllInventorySlots(station);
    const emptyStockFill = 0.0;
    const rebuilt = createStation(placedStationFromStation(station), emptyStockFill);
    // Carry reservations forward across the rebuild.
    for (const oldSlot of oldInventory) {
      const newSlot = getInventorySlot(rebuilt, oldSlot.ware.id);
      if (newSlot) {
        newSlot.reservedIncoming = oldSlot.reservedIncoming;
        newSlot.reservedOutgoing = oldSlot.reservedOutgoing;
      }
    }
    return rebuilt;
  }

  /** Mutate in place — other systems hold references to this Station. */
  private applyRebuiltStation(station: Station, rebuilt: Station): void {
    station.stationType = rebuilt.stationType;
    replaceStationInventoryAndIndex(station, rebuilt.inventory);
    station.sizeMultiplier = rebuilt.sizeMultiplier;
    station.state = "producing";
    station.build = undefined;
  }

  reset(): void {
    this.stations = [];
    this.byId.clear();
    this.addObservers.clear();
    this.removeObservers.clear();
    this.flipObservers.clear();
    this.stateChangeObservers.clear();
    this.batchStateChangeObservers.clear();
  }

  /** Generate a unique nation-prefixed station id (e.g. "BIO-7AZ"). Throws only when 46656 stations of one nation are alive at once — ids return to the pool when a station leaves. */
  private generateStationIdForNation(nation: Nation): string {
    return generateUniqueId({
      prefix: nation.codeName,
      randomSuffix: () =>
        Math.floor(Math.random() * 46656)
          .toString(36)
          .toUpperCase()
          .padStart(3, "0"),
      randomAttempts: 200,
      takenIds: this.byId,
      fallback: () => {
        for (let index = 0; index < 46656; index++) {
          const id = `${nation.codeName}-${index.toString(36).toUpperCase().padStart(3, "0")}`;
          if (!this.byId.has(id)) return id;
        }
        throw new Error(
          `Station id pool exhausted for nation ${nation.codeName}: 46656 stations alive`,
        );
      },
    });
  }
}

/** Re-emit a runtime Station as a PlacedStation. `createStation` expects the
 *  template shape where `stationTypeId` is an id string; the runtime station
 *  holds a resolved template object. */
function placedStationFromStation(station: Station): PlacedStation {
  return {
    id: station.id,
    name: station.name,
    x: station.x,
    y: station.y,
    nation: station.nation,
    size: station.size,
    stationTypeId: station.stationType.id,
    state: station.state,
    build: station.build,
    zoneId: station.zoneId,
  };
}

/** Create a Station for an under-construction placement. Real StationTypeTemplate so rate math
 *  and HUD see the right produces list, but inventory holds only the two
 *  construction-ware slots — full inventory is created on flip. */
function createStationUnderConstruction(placement: PlacedStation): Station {
  const stationType = getStationTypeTemplate(placement.stationTypeId);
  const waresRequired = placement.build!.waresRequired;
  const inventory = [
    createInventorySlot(getWareTemplate("provisions"), 0, waresRequired.provisions),
    createInventorySlot(getWareTemplate("hulls"), 0, waresRequired.hulls),
  ];
  return finalizeStation(placement, stationType, inventory);
}
