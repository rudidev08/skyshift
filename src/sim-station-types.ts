// Runtime station types — instances the simulation creates, mutates, and reads each tick.
// Authored types (StationTemplate, StationPlacement, etc.) live in data/station-types.ts.

import type { NationTemplate } from "../data/nation-types";
import type {
  StationBuild,
  StationSize,
  StationState,
  StationTemplate,
} from "../data/station-types";
import type { WareId, WareTemplate } from "../data/ware-types";

/** Per-station emigration state. Present iff state === "emigrating". Owned and
 *  updated by EmigrationManager; read directly by render. */
export interface StationEmigration {
  /** Matches EmigrationEvent.id. */
  eventId: string;
  destinationName: string;
  /** Snapshot of ship ids homed here at event trigger — used each tick to
   *  count how many have departed. */
  initialHomedShipIds: string[];
  /** O(1) lookup mirror of `initialHomedShipIds`. Not serialized; rebuilt at
   *  trigger and after load. */
  initialHomedShipIdSet: Set<string>;
  totalEmigrants: number;
  launched: number;
  secondsUntilNextLaunch: number;
  /** (emigrants launched + homed departed) / total, refreshed once per emigration-manager tick. */
  progressFraction: number;
}

/** Generational-ship event build state. Present on a generational ship while an event is active;
 *  null on shore leave. Owned and updated by EmigrationManager; read by render. */
export interface StationGenerationalShipBuild {
  /** Event whose arrivals this build tracks. */
  eventId: string;
  destinationName: string;
  /** Emigrating stations in this event. */
  stationCount: number;
  /** 0..1 fraction of expected event ships arrived, refreshed once per emigration-manager tick. */
  arrivalFraction: number;
}

/** Runtime inventory slot. `max` is derived (scaled by `station.sizeMultiplier`).
 *  `reservedIncoming` / `reservedOutgoing` track in-flight trade commitments
 *  so cargo isn't double-booked. */
export interface InventorySlot {
  ware: WareTemplate;
  current: number;
  max: number;
  reservedIncoming: number;
  reservedOutgoing: number;
}

/** Runtime station — the merged flat shape simulation operates on. Combines
 *  authored placement fields with live state produced by `createStation`. */
export interface Station {
  id: string;
  name: string;
  x: number;
  y: number;
  nation: NationTemplate;
  size: StationSize;
  /** Lifecycle state. Defaults to "producing" for seeded stations. */
  state: StationState;
  /** Present iff state === "building". */
  build?: StationBuild;
  /** Zone id the station was placed into (for dynamic builds). */
  zoneId?: string;
  /** Resolved station-template reference. `.id` gives the `StationTypeId`. */
  stationType: StationTemplate;
  sizeMultiplier: number;
  inventory: InventorySlot[];
  /** O(1) lookup by ware ID — same slots as inventory[], built once at init. */
  inventoryByWareId: Map<WareId, InventorySlot>;
  /** Wall-clock seconds since this station's last production tick (positive),
   *  or the stagger offset before its first tick (negative). Staggered at init
   *  so production ticks don't all land on the same frame. Not persisted. */
  secondsSinceLastTick: number;
  /** Did the station produce on its last economy tick? Drives UI signals.
   *  Distinct from `state === "producing"` (lifecycle state). */
  didProduceLastTick: boolean;
  typeAndSizeLabel: string;
  /** Set while state === "emigrating"; null otherwise. See {@link StationEmigration}. */
  emigrationEvent: StationEmigration | null;
  /** Set on a generational ship while an emigration event is active; null while idle.
   *  See {@link StationGenerationalShipBuild}. */
  generationalShipBuild: StationGenerationalShipBuild | null;
}

/** Per-cycle production and consumption rates for a station, accounting for size. */
export interface StationRates {
  production: Map<WareId, number>;
  consumption: Map<WareId, number>;
}
