// Authored map shapes. Runtime types (Sector, GameMap) live in src/sim-map-types.ts.

import type { StationTypeId } from "./station-types";
import type { StationZoneTemplate } from "./station-zone-types";
import type { EnvironmentId } from "./map-environments";

export type Nebula = {
  textureKey: string;
  x: number;
  y: number;
  rotationDegrees?: number;
  dark?: boolean;
  depth?: number;
};

/** Authored sector — grid placement, environment, lore. Runtime Sector
 *  (`src/sim-map-types.ts`) adds computed `x`/`y`/`size` from the map origin
 *  and sectorSize in `createMapFromTemplate` (src/sim-map-builder.ts). */
export type SectorTemplate = {
  id: string;
  name: string;
  lore: string;
  gridX: number;
  gridY: number;
  environment: EnvironmentId;
};

export type InitialInventoryBalance = {
  inventoryLowerBound: number;
  inventoryUpperBound: number;
  universeWareFraction: number;
};

/** Preset-authored station. Position and size come from the referenced zone — the preset only specifies owner and type. */
export interface PresetStation {
  /** References StationZoneTemplate.id. */
  zoneId: string;
  /** Runtime station id (e.g. `BIO-F`). Must be unique within a preset. */
  stationId: string;
  name: string;
  /** References NationTemplate.id (e.g. "hub", "bio"). Resolved at init time. */
  nationId: string;
  stationTypeId: StationTypeId;
}

/** Authored preset layered on top of the shared map template.
 *  Zones not in `stations` start empty (buildable). */
export interface MapPreset {
  /** URL-safe id, matches `/start/:preset`. */
  id: string;
  name: string;
  description: string;
  stations: PresetStation[];
  /** Seconds to fast-forward the sim before the first visible frame. */
  simulationWarmup?: number;
  /** Override economyConfig.initialStaggerDurationDefaultSeconds — set 0 for instant launch (editor preview). */
  initialStaggerDuration?: number;
  /** Randomize inventory within these bounds at seed time, so the economy
   *  doesn't start uniformly empty or full. */
  initialInventoryBalance?: InitialInventoryBalance;
}

/** Shared map base: sectors, nebulas, and zone layout common to every preset. */
export interface MapTemplate {
  sectors: SectorTemplate[];
  nebulas: Nebula[];
  zones: readonly StationZoneTemplate[];
  sectorSize: number;
  cameraStart?: { x: number; y: number; zoom: number };
}
