// Shared fixtures for the trade-* test cluster.
//
// Reservation/cargo unit tests run against a per-test mock TradeManager whose
// stationManager / shipManager methods read from per-call station/ship maps.
// Each test calls `withMockManager(...)`, which constructs and disposes the
// manager and passes a context object with `makeMockStation` bound to that
// test's maps — no module-level shared state.

import type { Ship } from "../sim-ships.ts";
import type { InventorySlot } from "../sim-station.ts";
import type { Station } from "../sim-station-types.ts";
import type { WareId } from "../../data/ware-types.ts";
import { TradeManager } from "../sim-trade-manager.ts";
import { type TradeShip } from "../sim-trade-types.ts";
import { makeStation } from "./factories.ts";

export interface MockManagerContext {
  manager: TradeManager;
  makeMockStation(inventory: InventorySlot[]): Station;
}

/** Run `testBody` against a fresh TradeManager backed by per-call mock station/ship maps. */
export function withMockManager<T>(testBody: (context: MockManagerContext) => T): T {
  const stationsById = new Map<string, Station>();
  const shipsById = new Map<string, Ship>();
  let mockStationIdCounter = 0;

  const stationManager = { getStation: (id: string) => stationsById.get(id) };
  const shipManager = { getShip: (id: string) => shipsById.get(id) };
  const manager = new TradeManager({ stationManager, shipManager });

  const makeMockStation = (inventory: InventorySlot[]): Station => {
    mockStationIdCounter++;
    const id = `TEST-MOCK-${mockStationIdCounter}`;
    const station = makeStation({ inventory, placement: { id } });
    stationsById.set(id, station);
    return station;
  };

  try {
    return testBody({ manager, makeMockStation });
  } finally {
    manager.dispose();
  }
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
    idleSinceTradeTime: 0,
    homeStationId: "",
    orbitingShipId: "",
  };
}
