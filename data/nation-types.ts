import type { ShipTypeId } from "./ship-types";
import type { StationTypeId } from "./station-types";

/** Identifies station-building nations — every nation except WAY (whose
 *  generational ships arrive fully formed and don't appear in builder registries). */
export type BuildingNationId = "hub" | "bio" | "ore" | "sky" | "far";

export type NationTemplate = {
  /** Registry key — `nationById` map lookups, station placements, save snapshots. */
  id: string;
  /** Three-letter tag prefixed to station and ship labels in HUD and reports, seeds station ids like "HUB-001", shown as the nation badge in lore.html and overview cards. */
  codeName: string;
  /** Spoken form — audio announcer voice keys and the station-selection stack label. */
  shortName: string;
  /** Full title — overview nation card heading, lore page heading, balance report. */
  name: string;
  color: string;
  lore: string;
  namingStyle: string;
  /** Primary fleet ship class. `null` for nations that don't spawn ships (WAY). */
  shipTypeId: ShipTypeId | null;
  /** Station types this nation can self-build (on-list = 1× cost, off-list contracted at 2× per sim-station-template.ts). Also rendered as the overview panel's "Builds stations" footer list. */
  buildableStationTypeIds: StationTypeId[];
  /** The nation's identity station type. Shown as the seal icon on the overview nation card; anchors the stats-line primary count ("Farms: N"); the build picker favors it for the nation's first two builds; and emigration won't leave a nation with zero producing primaries. Must appear in `buildableStationTypeIds`. */
  primaryBuildableStationTypeId: StationTypeId;
  stationNames: string[];
  shipNames: string[];
  /** Suffixes appended when a name is reused (e.g. "II", "III" or "B", "C"). */
  nameSuffixes: string[];
  /** Status-panel identity phrase (practically, where does this nation desire to build new stations).
   * `verb` renders bold; `object` follows in plain text. */
  desire: { verb: string; object: string };
  /** Does nation participate in building new stations? WAY nation with generation ship doesn't. */
  buildsStations: boolean;
  /** Does nation participate in map-wide emigration events. WAY nation doesn't. */
  participatesInEmigration: boolean;
  /** Ship class spawned at a build site to ferry provisions/hulls — always trader, even when
   *  the primary fleet differs. `null` for nations that never build (WAY). */
  stationConstructionShipTypeId: ShipTypeId | null;
};
