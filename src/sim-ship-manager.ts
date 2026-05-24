// Authoritative ship roster. One per scene; pairs with NationManager /
// StationManager. Owns lifecycle and add/remove observers; ship queues and
// trade behavior live in sim-trade-manager.

import type { Station } from "./sim-station-types";
import type { ShipTypeId } from "../data/ship-types";
import { createStationShips, type Ship } from "./sim-ships";
import type { NamePool } from "./sim-name-pool";

export type ShipAddObserver = (ships: Ship[]) => void;
export type ShipRemoveObserver = (ship: Ship) => void;

export class ShipManager {
  private ships: Ship[] = [];
  private byId = new Map<string, Ship>();
  private addObservers = new Set<ShipAddObserver>();
  private removeObservers = new Set<ShipRemoveObserver>();
  /** Used by spawnFleetForStation to claim unique ship names from the simulation's pool. */
  private readonly namePool: NamePool;

  constructor(namePool: NamePool) {
    this.namePool = namePool;
  }

  /** Seed with the initial fleet at scene boot — does not fire add observers, since seeding pre-dates any subscribers. */
  seed(ships: Ship[]): void {
    this.ships = ships;
    this.byId.clear();
    for (const ship of ships) this.byId.set(ship.id, ship);
  }

  /** Look up a ship by id. sim-trade-manager calls this to resolve a TradeShip's `orbitingShipId` back to a live Ship. */
  getShip(shipId: string): Ship | undefined {
    return this.byId.get(shipId);
  }

  getAllShips(): readonly Ship[] {
    return this.ships;
  }

  /** Every ship whose home is the given station, regardless of in-flight state. */
  getShipsForStation(station: Station): Ship[] {
    return this.ships.filter((ship) => ship.station === station);
  }

  onAdd(callback: ShipAddObserver): () => void {
    this.addObservers.add(callback);
    return () => this.addObservers.delete(callback);
  }
  onRemove(callback: ShipRemoveObserver): () => void {
    this.removeObservers.add(callback);
    return () => this.removeObservers.delete(callback);
  }

  addShips(newShips: Ship[]): void {
    if (newShips.length === 0) return;
    this.ships.push(...newShips);
    for (const ship of newShips) this.byId.set(ship.id, ship);
    for (const callback of this.addObservers) callback(newShips);
  }

  removeShip(ship: Ship): void {
    const index = this.ships.indexOf(ship);
    if (index < 0) return;
    this.ships.splice(index, 1);
    this.byId.delete(ship.id);
    for (const callback of this.removeObservers) callback(ship);
  }

  /** Remove every ship belonging to the given station (e.g. on emigration
   *  demolition). Observers fire once per removed ship. */
  removeShipsForStation(station: Station): Ship[] {
    const toRemove = this.ships.filter((ship) => ship.station === station);
    for (const ship of toRemove) this.removeShip(ship);
    return toRemove;
  }

  /** Spawn the station's default fleet and register it. Caller typically
   *  doesn't need the returned ships — onAdd observers receive the same list. */
  spawnFleetForStation(station: Station, options?: { shipTypeOverride?: ShipTypeId }): Ship[] {
    const ships = createStationShips({
      station,
      takenShipIds: new Set(this.byId.keys()),
      namePool: this.namePool,
      options: { shipTypeOverride: options?.shipTypeOverride },
    });
    this.addShips(ships);
    return ships;
  }

  reset(): void {
    this.ships = [];
    this.byId.clear();
    this.addObservers.clear();
    this.removeObservers.clear();
  }
}
