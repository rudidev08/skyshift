// Runtime map types — composed by `createMapFromTemplate` (src/sim-map-create.ts) from
// MapTemplate + MapPreset (data/map-types.ts).

import type { CameraStart, Nebula, SectorTemplate } from "../data/map-types";
import type { PlacedStation } from "../data/station-types";
import type { StationZoneTemplate } from "../data/station-zone-types";
import type { Station } from "./sim-station-types";

/** Runtime sector — `SectorTemplate` fields plus computed map-space center and side length. */
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
  sectors: Sector[];
  nebulas: Nebula[];
  /** `PlacedStation` values; live `Station` instances are created from these at game start. */
  stations: PlacedStation[];
  stationZones: StationZoneTemplate[];
  sectorSize: number;
  gridSizeX: number;
  gridSizeY: number;
  cameraStart?: CameraStart;
  /** Seconds to fast-forward the sim before the first visible frame, so the universe starts mid-activity. */
  simulationWarmupSeconds?: number;
  /** Override economyConfig.defaultInitialStaggerDurationSeconds — set 0 for instant launch. */
  initialStaggerDurationSeconds?: number;
  /** Randomize or rebalance initial inventory after stations are seeded. Mutates the runtime stations in place. */
  seedInitialInventory?: (stations: Station[]) => void;
};
