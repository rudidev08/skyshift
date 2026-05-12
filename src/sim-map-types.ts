// Runtime map types — composed by `createMapFromTemplate` (src/sim-map-builder.ts) from
// authored MapTemplate + MapPreset (data/map-types.ts).

import type { Nebula, SectorTemplate } from "../data/map-types";
import type { StationPlacement } from "../data/station-types";
import type { StationZoneTemplate } from "../data/station-zone-types";
import type { Station } from "./sim-station-types";

/** Runtime sector — authored fields plus computed map-space center and side length. */
export type Sector = SectorTemplate & {
  /** Sector center x (map coords). */
  x: number;
  /** Sector center y (map coords). */
  y: number;
  /** Side length — sectors are square. */
  size: number;
};

/** Runtime map the engine consumes — composed from a MapTemplate + MapPreset by `createMapFromTemplate`. */
export type GameMap = {
  presetId: string;
  presetName: string;
  sectors: Sector[];
  nebulas: Nebula[];
  /** Authored placements; live `Station` instances are created from these at game start. */
  stations: StationPlacement[];
  stationZones: StationZoneTemplate[];
  sectorSize: number;
  gridSizeX: number;
  gridSizeY: number;
  cameraStart?: { x: number; y: number; zoom: number };
  /** Seconds to fast-forward the sim before the first visible frame, so the universe starts mid-activity. */
  simulationWarmup?: number;
  /** Override economyConfig.initialStaggerDurationDefaultSeconds — set 0 for instant launch. */
  initialStaggerDuration?: number;
  /** Randomize or rebalance initial inventory after stations are seeded. Mutates the runtime stations in place. */
  seedInitialInventory?: (stations: Station[]) => void;
};

