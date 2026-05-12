// Shared fixtures for the trade-* test cluster.
//
// Reservation/cargo unit tests run against a per-test mock TradeManager whose
// stationManager / shipManager methods read from `mockStationsById` /
// `mockShipsById`. Each test calls `withMockManager(...)` to construct one,
// run its body, then dispose it — no shared state across tests, no singleton.

import type { Ship } from "../sim-ships.ts";
import type { InventorySlot } from "../sim-station.ts";
import type { StationPlacement, StationTypeId } from "../../data/station-types.ts";
import type { Station } from "../sim-station-types.ts";
import type { WareId } from "../../data/ware-types.ts";
import { hubNation } from "../../data/nations.ts";
import { TradeManager } from "../sim-trade-manager.ts";
import { type TradeShip } from "../sim-trade-types.ts";
import { makeStation, makeStationPlacement } from "./factories.ts";

let mockStationsById = new Map<string, Station>();
let mockShipsById = new Map<string, Ship>();

/** Run `testBody` against a fresh TradeManager backed by per-test mock station/ship maps. */
export function withMockManager<T>(testBody: (manager: TradeManager) => T): T {
  mockStationsById = new Map();
  mockShipsById = new Map();
  const stationManager = { getStation: (id: string) => mockStationsById.get(id) };
  const shipManager = { getShip: (id: string) => mockShipsById.get(id) };
  const manager = new TradeManager({ stationManager, shipManager });
  try {
    return testBody(manager);
  } finally {
    manager.dispose();
  }
}

/** Minimal trade ship — reservation/cargo tests fill the fields they need. */
export function makeMockTradeShip(): TradeShip {
  // Reservation-lifecycle tests never resolve orbitingShipId / homeStationId,
  // so empty strings are safe — tests that need resolution fill them in.
  return {
    reservations: [],
    cargoAmountByWareId: new Map<WareId, number>(),
    actionQueue: [],
    flight: null,
    targetStationId: null,
    tradeDirection: null,
    lastHeading: null,
    idleStartTime: 0,
    homeStationId: "",
    orbitingShipId: "",
  };
}

let mockStationIdCounter = 0;
/** Mock station auto-registered into the per-test stationManager-backing map. */
export function makeMockStation(inventory: InventorySlot[]): Station {
  mockStationIdCounter++;
  const id = `TEST-MOCK-${mockStationIdCounter}`;
  const station = makeStation({ inventory, placement: { id } });
  mockStationsById.set(id, station);
  return station;
}

/** Authored placement options for `makeMockStationPlacement`. `id` and `stationTypeId` are required; the rest take placement defaults. */
export interface MockPlacementOptions {
  id: string;
  stationTypeId: StationTypeId;
  size?: Station["size"];
  x?: number;
  y?: number;
  nation?: Station["nation"];
}

/** Authored placement with `id` + `stationTypeId` required and other fields defaulted. */
export function makeMockStationPlacement(options: MockPlacementOptions): StationPlacement {
  return makeStationPlacement({
    id: options.id,
    stationTypeId: options.stationTypeId,
    size: options.size ?? "S",
    x: options.x ?? 0,
    y: options.y ?? 0,
    nation: options.nation ?? hubNation,
  });
}
