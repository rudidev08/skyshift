/* Station icons, ship hulls, and nation colors for mountSectorAnimation —
 * all derived from the game's data modules so static pages can't drift. */

import { Apple, Compass, Container, Hammer, Stone, VectorSquare } from "lucide-static";

import { bioNation, farNation, hubNation, oreNation, skyNation, wayNation } from "../../data/nations";
import type { ShipTypeTemplate } from "../../data/ship-types";
import { jumpship, seedhaul, tanker, trader } from "../../data/ships";

import { stripLucideSvgWrapper } from "../render-lucide-svg";

import type { SectorShipHull } from "./static-ship-preview";

export const ICON_ARCHIVES = stripLucideSvgWrapper(VectorSquare).trim();
export const ICON_FARM = stripLucideSvgWrapper(Apple).trim();
export const ICON_MINE = stripLucideSvgWrapper(Stone).trim();
export const ICON_TECH = stripLucideSvgWrapper(Container).trim();
export const ICON_FORGE = stripLucideSvgWrapper(Hammer).trim();
export const ICON_GENERATIONAL_SHIP = stripLucideSvgWrapper(Compass).trim();

export const NATION_COLORS = {
  hub: hubNation.color,
  bio: bioNation.color,
  ore: oreNation.color,
  sky: skyNation.color,
  far: farNation.color,
  way: wayNation.color,
} as const;

/** Create a runtime `SectorShipHull` from a `ShipTypeTemplate`.
 *  trailWidth is an explicit parameter rather than scaled from ship.trailWidthMultiplier — the game's multiplier targets a much larger texture and produces hair-thin trails on these small static-page canvases. */
function createSectorHullFromShipTemplate(ship: ShipTypeTemplate, trailWidth: number): SectorShipHull {
  return {
    taperFront: ship.taperFront,
    taperBack: ship.taperBack,
    taperFrontCurve: ship.taperFrontCurve,
    taperBackCurve: ship.taperBackCurve,
    trailWidth,
    trailDepartureAlphaMultiplier: ship.trailDepartureAlphaMultiplier,
    trailArrivalAlphaMultiplier: ship.trailArrivalAlphaMultiplier,
    speed: ship.speed,
  };
}

export const HULL_JUMPSHIP = createSectorHullFromShipTemplate(jumpship, 9);
export const HULL_SEEDHAUL = createSectorHullFromShipTemplate(seedhaul, 7.5);
export const HULL_TANKER = createSectorHullFromShipTemplate(tanker, 6);
export const HULL_TRADER = createSectorHullFromShipTemplate(trader, 5);
