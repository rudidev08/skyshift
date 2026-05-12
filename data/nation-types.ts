import type { ShipTypeId } from "./ship-types";
import type { StationTypeId } from "./station-types";

export type NationTemplate = {
  id: string;
  codeName: string;
  shortName: string;
  name: string;
  color: string;
  lore: string;
  namingStyle: string;
  /** Primary fleet ship class. `null` for nations that don't spawn ships (WAY). */
  shipTypeId: ShipTypeId | null;
  /** Station types this nation can self-build (on-list = 1× cost, off-list contracted at 2×).
   *  Also drives the overview panel footer and the seal icon. */
  buildableStationTypeIds: StationTypeId[];
  /** Identity station type — seal icon, stats-line count, G2 floor. Must appear in `buildableStationTypeIds`. */
  primaryBuildableStationTypeId: StationTypeId;
  stationNames: string[];
  shipNames: string[];
  /** Suffixes appended when a name is reused (e.g. "II", "III" or "B", "C"). */
  nameSuffixes: string[];
  /** Status-panel identity phrase. `verb` renders bold; `object` follows in plain text. */
  desire: { verb: string; object: string };
  /** Runs building cycles? True for HUB/BIO/ORE/SKY/FAR, false for WAY. */
  buildsStations: boolean;
  /** Eligible for mass-emigration events? True for HUB/BIO/ORE/SKY/FAR, false for WAY. */
  participatesInEmigration: boolean;
  /** Ship class spawned at a build site to ferry provisions/hulls — always trader, even when
   *  the primary fleet differs. `null` for nations that never build (WAY). */
  stationConstructionShipTypeId: ShipTypeId | null;
};
