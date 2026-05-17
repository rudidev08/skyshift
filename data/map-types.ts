import type { StationTypeId } from "./station-types";
import type { StationZoneTemplate } from "./station-zone-types";
import type { SectorEnvironmentId } from "./map-sector-environments";

export type NebulaLayer = "NebulaDark" | "NebulaLight" | "NebulaOvergrowth";

export type Nebula = {
  textureKey: string;
  x: number;
  y: number;
  /** Which background layer this nebula renders on. Darker nebulas are behind lighter nebulas. */
  layer: NebulaLayer;
  /** Rotation helps reusing nebulas without having them look too similar. */
  rotationDegrees?: number;
};

export type SectorTemplate = {
  id: string;
  name: string;
  lore: string;
  gridX: number;
  gridY: number;
  environment: SectorEnvironmentId;
};

/** Each station inventory slot starts at a random ratio of its max, drawn uniformly from [inventoryLowerBound, inventoryUpperBound]. */
export type InitialInventoryFillRange = {
  inventoryLowerBound: number;
  inventoryUpperBound: number;
};

/** Position and size come from the referenced zone; the preset specifies the station's identity, owner, and type. */
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

/** Layered on top of the shared map template.
 *  Zones not listed in `presetStations` start empty (buildable). */
export interface MapPreset {
  /** URL-safe id, matches `/start/:preset`. */
  id: string;
  name: string;
  description: string;
  presetStations: PresetStation[];
  /** Seconds to fast-forward the sim before the first visible frame, so the universe starts mid-activity.
   *  This helps not have all ships take off in the same time when game starts.
   */
  simulationWarmupSeconds?: number;
  /** Override economyConfig.defaultInitialStaggerDurationSeconds — set 0 for instant launch (editor preview). */
  initialStaggerDurationSeconds?: number;
  /** Randomize inventory within these bounds at seed time, so the economy
   *  doesn't start uniformly empty or full. */
  initialInventoryFillRange?: InitialInventoryFillRange;
}

/** Initial camera placement (map-space center + zoom level). */
export interface CameraStart {
  x: number;
  y: number;
  zoom: number;
}

/** Shared map base: sectors, nebulas, and empty station zone layout common to every preset. */
export interface MapTemplate {
  sectors: SectorTemplate[];
  nebulas: Nebula[];
  zones: readonly StationZoneTemplate[];
  sectorSize: number;
  cameraStart?: CameraStart;
}
