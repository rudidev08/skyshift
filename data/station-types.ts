// Authored station vocabulary — station-type ids, sizes, lifecycle states, and the
// authored shapes (StationTemplate, StationPlacement). Runtime instance types
// (Station, InventorySlot, StationEmigration, etc.) live in src/sim-station-types.ts.

import type { NationTemplate } from "./nation-types";
import type { WareId } from "./ware-types";

export type StationTypeId =
  | "mine"
  | "observatory"
  | "water-processing"
  | "farm"
  | "medical-lab"
  | "metal-forge"
  | "tech-factory"
  | "archives"
  | "habitat"
  | "shipyard"
  | "generational-ship";

export const STATION_SIZES = ["S", "M", "L"] as const;
export type StationSize = (typeof STATION_SIZES)[number];

/** Station lifecycle.
 *  - "claimed" — zone reserved, materials not yet flowing.
 *  - "building" — receives provisions + hulls via trade.
 *  - "producing" — fully operational.
 *  - "emigrating" — being decommissioned; trade suspended. */
export const STATION_STATES = ["claimed", "building", "producing", "emigrating"] as const;
export type StationState = (typeof STATION_STATES)[number];

/** Present iff state === "building". Cleared on flip to "producing". */
export type StationBuild = {
  waresRequired: { provisions: number; hulls: number };
  /** Nation id of the contracting nation; undefined = self-built. */
  contractingNationId?: string;
};

/** Authored placement — what a preset or map-build step produces. `createStation`
 *  reads this to create the runtime `Station`. */
export type StationPlacement = {
  /** Internal registry code, e.g. "HUB-K". */
  id: string;
  /** If omitted, assigned from the nation's namePool at init. */
  name?: string;
  x: number;
  y: number;
  nation: NationTemplate;
  stationTypeId: StationTypeId;
  size: StationSize;
  /** Lifecycle state. Omit for seeded stations (treated as "producing"). */
  state?: StationState;
  /** Present iff state === "building". */
  build?: StationBuild;
  /** Optional zone id the station was placed into (for dynamic builds). */
  zoneId?: string;
};

export type StationTemplate = {
  id: StationTypeId;
  name: string;
  /** Plural display form — defaults to `name + "s"`. Set for irregular plurals
   *  ("Observatories"), already-plural names ("Archives"), or mass nouns
   *  ("Water Processing"). */
  plural?: string;
  produces: WareId[];
  lore: string;
};
