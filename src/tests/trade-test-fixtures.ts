// Shared fixtures for the trade-* test cluster.
//
// Reservation/cargo unit tests run against a per-test mock TradeManager whose
// stationManager / shipManager methods read from per-call station/ship maps.
// Each test calls `withMockManager(...)`, which constructs and destroys the
// manager and passes a context object with `makeRegisteredStation` bound to
// that test's maps — no module-level shared state.

import type { Ship } from "../sim-ships.ts";
import type { InventorySlot } from "../sim-station.ts";
import type { Station } from "../sim-station-types.ts";
import type { WareId } from "../../data/ware-types.ts";
import { type Simulation } from "../sim-lifecycle.ts";
import { findRoundTradeTrip } from "../sim-trade-decision.ts";
import { TradeManager } from "../sim-trade-manager.ts";
import type { RouteStats } from "../sim-trade-route-statistics.ts";
import { type TradeShip, type TradeTripLeg } from "../sim-trade-types.ts";
import { makeStation } from "./factories.ts";

export interface MockManagerContext {
  manager: TradeManager;
  makeRegisteredStation(inventory: InventorySlot[]): Station;
}

/** Run `testBody` against a fresh TradeManager backed by per-call mock station/ship maps. */
export function withMockManager<T>(testBody: (context: MockManagerContext) => T): T {
  const stationsById = new Map<string, Station>();
  const shipsById = new Map<string, Ship>();
  let nextRegisteredStationId = 0;

  const stationManager = { getStation: (id: string) => stationsById.get(id) };
  const shipManager = { getShip: (id: string) => shipsById.get(id) };
  const manager = new TradeManager({ stationManager, shipManager });

  const makeRegisteredStation = (inventory: InventorySlot[]): Station => {
    nextRegisteredStationId++;
    const id = `TEST-MOCK-${nextRegisteredStationId}`;
    const station = makeStation({ inventory, placement: { id } });
    stationsById.set(id, station);
    return station;
  };

  try {
    return testBody({ manager, makeRegisteredStation });
  } finally {
    manager.destroy();
  }
}

/** Set a ship's cargo to a single ware (or empty when amount <= 0). */
export function loadShipCargo(ship: TradeShip, wareId: WareId, amount: number): void {
  ship.cargoAmountByWareId = amount > 0 ? new Map([[wareId, amount]]) : new Map();
}

/** Sum a route's per-ware activity — the only surviving route-level total. */
export function totalActivity(route: RouteStats): number {
  return route.wares.reduce((sum, ware) => sum + ware.activity, 0);
}

/** Minimal trade ship — reservation/cargo tests fill the fields they need. */
export function makeEmptyTradeShip(): TradeShip {
  // Reservation-lifecycle tests never resolve orbitingShipId / homeStationId,
  // so empty strings are safe — tests that need resolution fill them in.
  return {
    reservations: [],
    cargoAmountByWareId: new Map<WareId, number>(),
    actionQueue: [],
    flight: null,
    targetStationId: null,
    tradeDirection: null,
    lastFlightHeadingRadians: null,
    idleSinceTradeTimeSeconds: 0,
    homeStationId: "",
    orbitingShipId: "",
  };
}

/** First trade ship with a viable round trip (optionally filtered by predicate), with the trip's legs. */
export function findShipWithRoundTrip(
  simulation: Simulation,
  predicate?: (ship: TradeShip, legs: TradeTripLeg[]) => boolean,
): { ship: TradeShip; legs: TradeTripLeg[] } | null {
  for (const candidate of simulation.tradeManager.tradeShips) {
    const tripLegs = findRoundTradeTrip(candidate, simulation.tradeManager);
    if (tripLegs && (!predicate || predicate(candidate, tripLegs))) {
      return { ship: candidate, legs: tripLegs };
    }
  }
  return null;
}

/** First trade ship homed at `homeStationId`, or null. */
export function findShipHomedAt(simulation: Simulation, homeStationId: string): TradeShip | null {
  for (const candidate of simulation.tradeManager.tradeShips) {
    if (candidate.homeStationId === homeStationId) {
      return candidate;
    }
  }
  return null;
}
