// The one shared empty base map every game plays on. Empty map includes zones that stations
// can be built on. Two preset maps build on top of this base.
import type { MapTemplate } from "./map-types";
import { assertUniqueIds } from "../src/util-ids";
import { sectors } from "./map-sectors";
import { nebulas } from "./map-nebulas";
import { zones } from "./map-zones";

/** Pixels per sector width and height — the base grid unit for map-space coordinates. */
export const SECTOR_SIZE = 1500;

assertUniqueIds(sectors, "sector");
assertUniqueIds(zones, "zone");

export const map: MapTemplate = {
  sectors,
  nebulas,
  zones,
  sectorSize: SECTOR_SIZE,
  cameraStart: { x: 6000, y: 3000, zoom: 0.3 },
};
