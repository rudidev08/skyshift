import { allShips } from "../data/ships";
import type { ShipTypeTemplate, ShipTypeId } from "../data/ship-types";
import type { Ship } from "./sim-ships";

const shipTemplatesById = new Map<ShipTypeId, ShipTypeTemplate>(allShips.map((ship) => [ship.id, ship]));

export function getShipTypeTemplate(id: ShipTypeId): ShipTypeTemplate {
  const ship = shipTemplatesById.get(id);
  if (!ship) throw new Error(`Unknown ship: ${id}`);
  return ship;
}

/** Nation code prefix plus ship name, e.g. "HUB Meridian". */
export function shipCodeNameLabel(ship: Ship): string {
  return `${ship.station.nation.codeName} ${ship.shipName}`;
}
