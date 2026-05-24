import { allShips } from "../data/ships";
import type { ShipTypeTemplate, ShipTypeId } from "../data/ship-types";
import type { Ship } from "./sim-ships";
import { templateLookupById } from "./util-template-registry";

export const getShipTypeTemplate = templateLookupById<ShipTypeId, ShipTypeTemplate>(allShips, "ship");

/** Nation code prefix plus ship name, e.g. "HUB Meridian". */
export function shipCodeNameLabel(ship: Ship): string {
  return `${ship.station.nation.codeName} ${ship.shipName}`;
}
