// stations produce or consume wares, and each start with number of ships relative to station size
// trade is driven by station need: percentage of how much ware is needed (for inputs) or stored (for outputs)
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
 *  - "building" — receives provisions + hulls via trade.
 *  - "producing" — fully operational.
 *  - "emigrating" — being decommissioned; trade suspended. */
export const STATION_STATES = ["building", "producing", "emigrating"] as const;
export type StationState = (typeof STATION_STATES)[number];

/** Build cost — provisions + hulls delivered before construction completes. */
export interface BuildWaresRequired {
  provisions: number;
  hulls: number;
}

/** Present while a station is under construction; cleared on flip to "producing". */
export type StationBuild = {
  waresRequired: BuildWaresRequired;
  /** Nation id of the contracting nation; undefined = self-built. */
  contractingNationId?: string;
};

/** Placed station static data — identity, owner, type, size, and lifecycle as
 *  defined for the map. Created by factories and then passed to game engine for final
 *  station object. */
export type PlacedStation = {
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
  /** Present when state === "building", absent otherwise. */
  build?: StationBuild;
  /** Optional zone id the station was placed into (for dynamic builds). */
  zoneId?: string;
};

export type StationTypeTemplate = {
  id: StationTypeId;
  name: string;
  /** Plural display form, always set explicitly (no implicit pluralization):
   *  regular ("Mines"), irregular ("Observatories"), already-plural ("Archives"),
   *  or mass noun ("Water Processing"). */
  namePlural: string;
  produces: WareId[];
  lore: string;
};
