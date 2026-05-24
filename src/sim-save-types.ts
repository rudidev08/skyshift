import type { WareId } from "../data/ware-types";
import type { TravelEndpoint, TravelMode } from "./sim-travel-types";
import type { FlightData } from "./sim-travel";
import type { TradeReservation, TradeDirection } from "./sim-trade-types";
import type { StationBuild, StationTypeId, StationSize, StationState } from "../data/station-types";
import type { StationEmigration, StationGenerationalShipBuild } from "./sim-station-types";
import type { StationLifecycleEvent } from "./sim-station-history";

/** Save schema is permanently 1 during pre-release development — edit snapshot
 *  shapes in place rather than bumping this. `captureSnapshot`'s `version`
 *  field and `validateSnapshot`'s rejection check both come from this constant,
 *  so a bump would round-trip cleanly inside one process. The pin in
 *  `src/tests/save-slots.test.ts` catches drift. */
export const SAVE_VERSION = 1;

/** How a save slot was written: an auto-save tick, a manual save, or an explicit export. */
export type SaveSource = "auto" | "manual" | "export";

// Snapshot shapes are `Pick<>` from runtime types so a new runtime-only field
// can't accidentally land in saves via spread (e.g. `flight: { ...ts.flight }`
// in sim-trade-manager.ts) — TS rejects the spread until the field is opted in here.

export type FlightSnapshot = Pick<
  FlightData,
  | "phase"
  | "progress"
  | "origin"
  | "destination"
  | "phaseStartSeconds"
  | "totalElapsedSeconds"
  | "flightDurationSeconds"
  | "departDistanceFraction"
  | "flightDistanceFraction"
  | "arriveDistanceFraction"
  | "travelMode"
  | "previousHeadingRadians"
>;

export type TravelEndpointSnapshot = Pick<TravelEndpoint, "stationId" | "surfaceOrOrbit">;

export type ReservationSnapshot = Omit<TradeReservation, "station"> & { stationId: string };

export interface GameSnapshot {
  version: typeof SAVE_VERSION;
  savedAtMilliseconds: number;
  simulationTick: number;
  source?: SaveSource;
  /** Preset id the run started from ("settled" / "frontier"). Display breadcrumb
   *  only — shown in the slot label and export filename; not used to route loads. */
  presetId: string;
  stations: StationSnapshot[];
  ships: ShipSnapshot[];
  tradeShips: TradeShipSnapshot[];
  emigrationManager: EmigrationManagerSnapshot;
  tradeManager: TradeManagerSnapshot;
  /** Per-station lifecycle events powering the Stations Timelapse Log.
   *  Persisted in full — typically ~50 events across a 20-day game. */
  stationHistory: StationLifecycleEvent[];
}

/** Trade-module clock + pending wake-ups. The `byOrbitingShipId` and `flying`
 *  indices in sim-trade-manager.ts rebuild from the restored trade ships;
 *  trade-route delivery history is intentionally not persisted (overview restarts at load). */
export interface TradeManagerSnapshot {
  /** Origin clock for scheduledTimers[].fireTimeSeconds. */
  tradeTimeSeconds: number;
  /** Pending ship wake-ups, absolute against tradeTimeSeconds. */
  scheduledTimers: { shipId: string; fireTimeSeconds: number }[];
}

/** Full-identity station record. After game start, the snapshot is the source of truth;
 *  stations from the map template are only the seed. Static type-level props re-derive at load. */
export interface StationSnapshot {
  id: string;
  nationId: string; // Nation.id (lowercase 3-letter code, e.g. "hub")
  typeId: StationTypeId;
  size: StationSize;
  name: string;
  x: number;
  y: number;
  zoneId?: string; // undefined for map-seeded stations not in a zone
  state: StationState;
  build?: StationBuildSnapshot;
  inventory: InventorySlotSnapshot[];
  /** Set while state === "emigrating". Render reads it directly. */
  emigrationEvent?: StationEmigrationSnapshot;
  /** Set on a generational-ship station while an emigration event is active. */
  generationalShipBuild?: StationGenerationalShipBuildSnapshot;
  // `didProduceLastTick` and `secondsSinceLastTick` are NOT saved — both restart at 0 with a fresh stagger on load.
}

/** Excludes runtime `progressFraction` — sim-emigration-manager.ts recomputes it
 *  on its first post-load tick (and likewise `arrivalFraction` on the generational-ship build below).
 *  `initialHomedShipIdSet` serializes as an array since JSON has no Set. */
export type StationEmigrationSnapshot = Pick<
  StationEmigration,
  "eventId" | "destinationName" | "totalEmigrants" | "launched" | "secondsUntilNextLaunch"
> & { initialHomedShipIds: string[] };

export type StationBuildSnapshot = Pick<StationBuild, "waresRequired" | "contractingNationId">;

export type StationGenerationalShipBuildSnapshot = Pick<
  StationGenerationalShipBuild,
  "eventId" | "destinationName" | "emigratingStationCount"
>;

/** Inventory slot persistence. `max` is re-derived on load (or, for building
 *  stations, from `build.waresRequired`) so capacities follow the current
 *  `economyConfig.targetFillTimeSeconds` and never go stale. */
export interface InventorySlotSnapshot {
  wareId: WareId;
  current: number;
  reservedIncoming: number;
  reservedOutgoing: number;
}

export interface ShipSnapshot {
  id: string;
  stationId: string;
  shipTypeId: string;
  shipName: string;
}

export interface TradeShipSnapshot {
  shipId: string; // matches ShipSnapshot.id
  homeStationId: string;
  cargo: { wareId: WareId; amount: number }[];
  actionQueue: ShipActionSnapshot[];
  flight: FlightSnapshot | null;
  targetStationId: string | null;
  tradeDirection: TradeDirection | null;
  reservations: ReservationSnapshot[];
  lastFlightHeadingRadians: number | null;
  idleSinceTradeTimeSeconds: number;
}

export type ShipActionSnapshot =
  | {
      type: "fly";
      origin: TravelEndpointSnapshot;
      destination: TravelEndpointSnapshot;
      travelMode: TravelMode;
      deploying?: boolean;
      label: string;
      isTradeFlight?: boolean;
    }
  | { type: "wait"; durationSeconds: number; label: string }
  | { type: "cargo-withdrawal"; stationId: string; wareId: WareId; amount: number }
  | { type: "cargo-deposit"; stationId: string; wareId: WareId; amount: number }
  | { type: "decommission"; stationId: string; label: string };

export interface EmigrationEventSnapshot {
  id: string;
  nationIds: string[];
  generationalShipId: string;
  stationIds: string[];
  /** Ships from this event already decommissioned at WAY. WAY jumps when this hits `totalExpectedShips`. */
  shipsArrived: number;
  /** Total ships expected at the generational ship. Locked at trigger; reduced by retireUnlaunched if a launch budget is abandoned. */
  totalExpectedShips: number;
  destinationName: string;
}

export interface EmigrationManagerSnapshot {
  activeEvent: EmigrationEventSnapshot | null;
  /** Current generational-ship station id, or null if none is present. The
   *  generational ship's Station itself lives in the top-level `stations[]` array. */
  activeGenerationalShipId: string | null;
  mode: "auto" | "manual";
  intensity: "low" | "medium" | "high";
  usedDestinations: string[];
  nextGenerationalShipArrivalAtSeconds: number | null; // null = one is already present
  /** Monotonic clock for event deadlines. Must round-trip or deadlines drift. */
  clockSeconds: number;
  /** WAY-NNN generational-ship id counter. Persisted to avoid post-load id collisions. */
  nextGenerationalShipCounter: number;
  /** {NATION}-EMIG-NNNN emigrant ship id counter. Persisted to avoid post-load id collisions. */
  nextEmigrantShipCounter: number;
  /** EMIG-NNNNNN event id counter. Persisted so post-load events don't reuse an active id. */
  nextEventCounter: number;
}
