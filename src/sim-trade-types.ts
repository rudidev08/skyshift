// Trade-cluster runtime substrate — the shared types every cluster sibling
// (decision, queue, reservation, log, manager) imports. Pulled out so siblings
// import their shared types from this module instead of looping back into
// sim-trade-manager.ts (which would create a runtime circular import).
//
// The TradeManager class (in sim-trade-manager.ts) is the only public surface
// for trade operations. Resolvers, the trade clock, observer registration,
// and the active-trade-ship registry are all instance methods on that class.
// Consumers thread tradeManager through to where they need it.

import type { WareId } from "../data/ware-types";
import type { Station } from "./sim-station-types";
import type { FlightData } from "./sim-travel";
import type { ShipAction } from "./sim-travel-types";

/** Direction of cargo flow at a station's inventory slot for a trade reservation.
 *  - `incoming` — slot space reserved for a delivery currently en route.
 *  - `outgoing` — slot stock reserved for a pickup currently en route. */
export type TradeCargoDirection = "incoming" | "outgoing";

/** Direction of a trade ship's current trip relative to its home station.
 *  - `sell` — home → target leg (home produces the ware; target buys it).
 *  - `buy`  — target → home leg (target produces; home buys). */
export type TradeDirection = "sell" | "buy";

/** A trade ship's reservation against a station's inventory slot. Carried on
 *  `TradeShip.reservations`. The snapshot codec converts `station` ↔ `station.id`
 *  at capture/restore so the runtime keeps a live ref while saves stay portable. */
export interface TradeReservation {
  station: Station;
  wareId: WareId;
  amount: number;
  cargoDirection: TradeCargoDirection;
}

/** A single cargo flow within a trip: move `amount` of `wareId` from `fromStation` to `toStation`. */
export interface TradeTripLeg {
  wareId: WareId;
  amount: number;
  fromStation: Station;
  toStation: Station;
}

export interface TradeShip {
  /** Orbiting ship this wraps. Resolve via tradeManager.shipResolver(id) for the live Ship. */
  orbitingShipId: string;
  /** Home station id. Resolve via tradeManager.stationResolver(id) when a live Station is
   *  needed (e.g. labels); most paths just compare ids. */
  homeStationId: string;
  /** Pending actions executed in order — fly, wait, cargo-withdrawal, cargo-deposit, decommission. */
  actionQueue: ShipAction[];
  /** Active flight while in transit; null while orbiting or queued. */
  flight: FlightData | null;
  /** Non-home endpoint of the current trip. */
  targetStationId: string | null;
  /** Direction of the current trip leg; null while idle/orbiting. */
  tradeDirection: TradeDirection | null;
  /** Loaded amounts keyed by ware id. Insertion order tracks which ware was loaded first
   *  (used by the trade-log "primary loaded ware" read). 0 to ship capacity across 1-2 wares. */
  cargoAmountByWareId: Map<WareId, number>;
  /** Open cargo holds at remote stations — withdrawn at pickup, fulfilled on deposit. */
  reservations: TradeReservation[];
  idleSinceTradeTimeSeconds: number;
}

export interface TradeTransferEvent {
  amount: number;
  ship: TradeShip;
  station: Station;
  cargoDirection: TradeCargoDirection;
  wareId: WareId;
}

export function getTotalCargo(ship: TradeShip): number {
  let total = 0;
  for (const amount of ship.cargoAmountByWareId.values()) total += amount;
  return total;
}
