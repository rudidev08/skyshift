import type { WareId } from "../data/ware-types";
import type { TravelEndpoint, TravelMode } from "./sim-travel-types";
import type { FlightData } from "./sim-travel";
import type { TradeReservation, TradeDirection } from "./sim-trade-types";
import type { StationTypeId, StationSize, StationState } from "../data/station-types";
import type { StationLifecycleEvent } from "./sim-station-history";

export const SAVE_VERSION = 1;
export const AUTOSAVE_INTERVAL_SECONDS = 120;
export const MANUAL_SLOT_COUNT = 3;
export const AUTO_SLOT_COUNT = 3;

export const SAVE_KEY_PREFIX = "skyshift.save";

// Snapshot shapes are `Pick<>` from runtime types so a new runtime-only field
// can't accidentally land in saves via spread (e.g. `flight: { ...ts.flight }`
// in sim-trade-manager.ts) — TS rejects the spread until the field is opted in here.

export type FlightSnapshot = Pick<
  FlightData,
  | "phase" | "progress"
  | "origin" | "destination"
  | "phaseStartTime" | "totalElapsedTime" | "flightDuration"
  | "departDistanceFraction" | "flightDistanceFraction" | "arriveDistanceFraction"
  | "travelMode"
  | "prevHeading"
>;

export type TravelEndpointSnapshot = Pick<TravelEndpoint, "stationId" | "surfaceOrOrbit">;

export interface ReservationSnapshot {
  stationId: string;
  wareId: TradeReservation["wareId"];
  amount: number;
  cargoDirection: TradeReservation["cargoDirection"];
}

export type SlotKind = "manual" | "auto";
/** One shared slot set across all presets — M1/M2/M3/A1/A2/A3 are reused
 *  regardless of which preset seeded the run. `GameSnapshot.preset` is a
 *  breadcrumb only; nothing routes loads by it. */
export function saveSlotKey(kind: SlotKind, index: number): string {
  return `${SAVE_KEY_PREFIX}.${kind}.${index}`;
}
export function autoSaveNextIndexKey(): string {
  return `${SAVE_KEY_PREFIX}.auto.nextIndex`;
}

export interface GameSnapshot {
  version: typeof SAVE_VERSION;
  savedAt: number;       // Date.now()
  simTick: number;
  source?: "auto" | "manual" | "export";
  /** Preset the run started from ("settled" / "frontier" / "blank"). Breadcrumb
   *  only — used in the export filename in savegame-manager.ts; not used to route loads. */
  preset: string;
  stations: StationSnapshot[];
  ships: ShipSnapshot[];
  tradeShips: TradeShipSnapshot[];
  nationManager: NationExpansionSnapshot[];
  emigrationManager: EmigrationManagerSnapshot;
  tradeModule: TradeModuleSnapshot;
  /** Per-station lifecycle events powering the Stations Timelapse Log.
   *  Persisted in full — typically ~50 events across a 20-day game. */
  stationHistory: StationLifecycleEvent[];
}

/** Trade-module clock + pending wake-ups. The `byOrbitingShipId` and `flying`
 *  indices in sim-trade-manager.ts rebuild from the restored trade ships;
 *  trade-route delivery history is intentionally not persisted (overview restarts at load). */
export interface TradeModuleSnapshot {
  /** Origin clock for scheduledTimers[].fireTime. */
  tradeTime: number;
  /** Pending ship wake-ups, absolute against tradeTime. */
  scheduledTimers: { shipId: string; fireTime: number }[];
}

/** Full-identity station record. After game start, the snapshot is the source of truth;
 *  map-authored stations are only the seed. Static type-level props re-derive at load. */
export interface StationSnapshot {
  id: string;
  nationId: string;            // Nation.id (lowercase 3-letter code, e.g. "hub")
  typeId: StationTypeId;
  size: StationSize;
  name: string;
  x: number;
  y: number;
  zoneId?: string;             // undefined for map-seeded stations not in a zone
  state: StationState;
  build?: {
    waresRequired: { provisions: number; hulls: number };
    contractingNationId?: string;
  };
  inventory: InventorySlotSnapshot[];
  /** Set while state === "emigrating". Render reads it directly. */
  emigrationEvent?: StationEmigrationSnapshot;
  /** Set on a generational-ship station while an emigration event is active. */
  generationalShipBuild?: StationGenerationalShipBuildSnapshot;
  // `didProduceLastTick` and `secondsSinceLastTick` are NOT saved — derived / re-staggered on load.
}

/** Excludes runtime `progressFraction` — sim-emigration-manager.ts recomputes it
 *  on its first post-load tick (and likewise `arrivalFraction` on the generational-ship build below). */
export interface StationEmigrationSnapshot {
  eventId: string;
  destinationName: string;
  initialHomedShipIds: string[];
  totalEmigrants: number;
  launched: number;
  secondsUntilNextLaunch: number;
}

export interface StationGenerationalShipBuildSnapshot {
  eventId: string;
  destinationName: string;
  stationCount: number;
}

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
  inFlight: boolean;
}

export interface TradeShipSnapshot {
  shipId: string;        // matches ShipSnapshot.id
  homeStationId: string;
  cargo: { wareId: WareId; amount: number }[];
  actionQueue: ShipActionSnapshot[];
  flight: FlightSnapshot | null;
  targetStationId: string | null;
  tradeDirection: TradeDirection | null;
  reservations: ReservationSnapshot[];
  lastHeading: number | null;
  idleStartTime: number;
}
// Wake times live in TradeModuleSnapshot.scheduledTimers, not on the ship.

export type ShipActionSnapshot =
  | {
      type: "fly";
      origin: TravelEndpointSnapshot;
      destination: TravelEndpointSnapshot;
      travelMode: TravelMode;
      deploying?: boolean;
      label: string;
      route?: { fromStationId: string; toStationId: string };
    }
  | { type: "wait"; duration: number; label: string }
  | { type: "cargo-withdrawal"; stationId: string; wareId: WareId; amount: number }
  | { type: "cargo-deposit"; stationId: string; wareId: WareId; amount: number }
  | { type: "decommission"; stationId: string; label: string };

export interface NationExpansionSnapshot {
  nationId: string;
  currentBuildStationId: string | undefined;
}

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
  eventStartAt: number;
}

export interface EmigrationManagerSnapshot {
  activeEvent: EmigrationEventSnapshot | null;
  /** Current generational-ship station id, or null if none is present. The
   *  generational ship's Station itself lives in the top-level `stations[]` array. */
  activeGenerationalShipId: string | null;
  mode: "auto" | "manual";
  intensity: "low" | "medium" | "high";
  usedDestinations: string[];
  nextGenerationalShipArrivalAt: number | null; // sim-time of next arrival; null = one is present
  /** Private monotonic clock for event deadlines. Must round-trip or deadlines drift. */
  simTime: number;
  /** WAY-NNN generational-ship id counter. Persisted to avoid post-load id collisions. */
  nextGenerationalShipCounter: number;
  /** {NATION}-EMIG-NNNN emigrant ship id counter. Persisted to avoid post-load id collisions. */
  nextEmigrantShipCounter: number;
  /** EMIG-NNNNNN event id counter. Persisted so post-load events don't reuse an active id. */
  nextEventCounter: number;
}
