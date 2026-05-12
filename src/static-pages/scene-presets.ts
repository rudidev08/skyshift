/* Station icons, ship hulls, and nation colors for mountSectorAnimation —
 * all derived from the game's data modules so static pages can't drift. */

import {
  Apple, Compass, Container, Hammer, Stone, VectorSquare,
} from "lucide-static";

import {
  bioNation, farNation, hubNation, oreNation, skyNation, wayNation,
} from "../../data/nations";
import type { ShipTemplate } from "../../data/ship-types";
import {
  jumpship, seedhaul, tanker, trader,
} from "../../data/ships";

import type { SectorShipHull } from "./static-ship-preview";

/** Strips Lucide's outer `<svg>` tag so preloadStationIcon can wrap the inner shape with its own nation-stroked `<svg>`. */
function extractInnerSvg(lucideSvg: string): string {
  const openEnd = lucideSvg.indexOf(">") + 1;
  const closeStart = lucideSvg.lastIndexOf("</svg>");
  return lucideSvg.substring(openEnd, closeStart).trim();
}

/** VectorSquare — SKY archives / observatory. */
export const ICON_ARCHIVES = extractInnerSvg(VectorSquare);
/** Apple — BIO farm. */
export const ICON_FARM     = extractInnerSvg(Apple);
/** Stone — ORE mine. */
export const ICON_MINE     = extractInnerSvg(Stone);
/** Container — HUB tech factory. */
export const ICON_TECH     = extractInnerSvg(Container);
/** Hammer — HUB metal forge. */
export const ICON_FORGE    = extractInnerSvg(Hammer);
/** Compass — WAY generational ship. */
export const ICON_GENERATIONAL_SHIP  = extractInnerSvg(Compass);

export const NATION_COLORS = {
  hub: hubNation.color,
  bio: bioNation.color,
  ore: oreNation.color,
  sky: skyNation.color,
  far: farNation.color,
  way: wayNation.color,
} as const;

/** Builds a SectorShipHull from a ShipTemplate. trailWidth is passed in
 *  rather than scaled from ship.trailWidthMultiplier — the game's multiplier
 *  targets a much larger texture and produces hair-thin trails on these
 *  small static-page canvases. */
function hullFromShip(ship: ShipTemplate, trailWidth: number): SectorShipHull {
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

export const HULL_JUMPSHIP = hullFromShip(jumpship, 9);
export const HULL_SEEDHAUL = hullFromShip(seedhaul, 7.5);
export const HULL_TANKER   = hullFromShip(tanker, 6);
export const HULL_TRADER   = hullFromShip(trader, 5);
