import type {
  MapTemplate,
  MapPreset,
  PresetStation,
  SectorTemplate,
  InitialInventoryFillRange,
} from "../data/map-types";
import type { GameMap, Sector } from "./sim-map-types";
import type { PlacedStation } from "../data/station-types";
import type { Station } from "./sim-station-types";
import type { StationZoneTemplate } from "../data/station-zone-types";
import { sectorEnvironmentById, type SectorEnvironmentId } from "../data/map-sector-environments";
import { getAllInventorySlots } from "./sim-station";
import { getNationById } from "./sim-nation";
import { sectorIdFromZoneId } from "./sim-station-zone";
import { getPresetById } from "./util-map-preset";
import type { GameSnapshot } from "./sim-save-types";

interface ZoneOccupant {
  readonly zoneId?: string;
}

function occupiedZoneIdsFromOccupants(occupants: readonly ZoneOccupant[]): Set<string> {
  return new Set(occupants.map((occupant) => occupant.zoneId).filter((id): id is string => !!id));
}

/** Zones from `zones` not claimed by any of the given occupants. Backs
 *  `emptyZoneCount`'s zones-with-no-live-station query. Strict zoneId match —
 *  a zoneless station drifting through a zone's coords isn't a claim. */
export function filterZonesForOccupants(
  zones: readonly StationZoneTemplate[],
  occupants: readonly ZoneOccupant[],
): StationZoneTemplate[] {
  const occupiedZoneIds = occupiedZoneIdsFromOccupants(occupants);
  return zones.filter((zone) => !occupiedZoneIds.has(zone.id));
}

/** Sector grid coords are flavor-anchored on the Core at (0, 0) and can be negative; map coords shift them so the minimum grid coord lands at map (0, 0). */
function computeSectorCenterX(gridColumn: number, minGridX: number, sectorSize: number): number {
  return (gridColumn - minGridX) * sectorSize + sectorSize / 2;
}

/** See computeSectorCenterX — same shift, applied to the Y axis. */
function computeSectorCenterY(gridRow: number, minGridY: number, sectorSize: number): number {
  return (gridRow - minGridY) * sectorSize + sectorSize / 2;
}

interface GridExtent {
  minGridX: number;
  minGridY: number;
  gridSizeX: number;
  gridSizeY: number;
}

function computeGridExtent(sectors: SectorTemplate[]): GridExtent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sector of sectors) {
    if (sector.gridX < minX) minX = sector.gridX;
    if (sector.gridX > maxX) maxX = sector.gridX;
    if (sector.gridY < minY) minY = sector.gridY;
    if (sector.gridY > maxY) maxY = sector.gridY;
  }
  return {
    minGridX: minX,
    minGridY: minY,
    gridSizeX: maxX - minX + 1,
    gridSizeY: maxY - minY + 1,
  };
}

interface RuntimeMapSeed {
  presetId: string;
  stations: PlacedStation[];
  simulationWarmupSeconds?: number;
  initialStaggerDurationSeconds?: number;
  initialInventoryFillRange?: InitialInventoryFillRange;
}

function createRuntimeMapFromTemplate(template: MapTemplate, seed: RuntimeMapSeed): GameMap {
  const { minGridX, minGridY, gridSizeX, gridSizeY } = computeGridExtent(template.sectors);
  return {
    presetId: seed.presetId,
    sectorSize: template.sectorSize,
    cameraStart: template.cameraStart,
    simulationWarmupSeconds: seed.simulationWarmupSeconds,
    initialStaggerDurationSeconds: seed.initialStaggerDurationSeconds,
    nebulas: template.nebulas,
    stations: seed.stations,
    // Every template zone is tracked for the whole game — occupancy is a live
    // station's zoneId claim, so a site freed by emigration is buildable again
    // no matter whether a preset or placeBuild first claimed it.
    stationZones: [...template.zones],
    gridSizeX,
    gridSizeY,
    sectors: createSectorsFromTemplate(template, minGridX, minGridY),
    seedInitialInventory: seedInitialInventoryFor(seed.initialInventoryFillRange),
  };
}

function seedInitialInventoryFor(
  fillRange: InitialInventoryFillRange | undefined,
): ((seedStations: Station[]) => void) | undefined {
  if (!fillRange) return undefined;
  return (seedStations) => randomizeInitialInventory(seedStations, fillRange);
}

/** Create a playable GameMap from the template plus a preset's initial seeding.
 *  Preset stations claim their zones by zoneId like any later build — the zones
 *  stay in stationZones, and zone visuals hide while a claim is live. */
export function createMapFromTemplate(template: MapTemplate, preset: MapPreset): GameMap {
  const zoneById = new Map(template.zones.map((zone) => [zone.id, zone]));
  const sectorEnvByZoneId = buildSectorEnvByZoneId(template);
  const stations = createPresetPlacedStations(preset, zoneById, sectorEnvByZoneId);

  return createRuntimeMapFromTemplate(template, {
    presetId: preset.id,
    stations,
    simulationWarmupSeconds: preset.simulationWarmupSeconds,
    initialStaggerDurationSeconds: preset.initialStaggerDurationSeconds,
    initialInventoryFillRange: preset.initialInventoryFillRange,
  });
}

/** Recreate the runtime map shell for a saved game. The snapshot owns station
 *  truth, so no preset stations are seeded — restoreSavedGame installs the
 *  saved station objects, and their zoneId claims drive occupancy exactly as
 *  in the pre-save session. The seeding preset still resolves, for the warmup
 *  clock. */
export function mapFromSnapshot(template: MapTemplate, snapshot: GameSnapshot): GameMap {
  const preset = getPresetById(snapshot.presetId);
  if (!preset) {
    throw new Error(`mapFromSnapshot: snapshot references unknown preset "${snapshot.presetId}".`);
  }
  return createRuntimeMapFromTemplate(template, {
    presetId: preset.id,
    stations: [],
    simulationWarmupSeconds: preset.simulationWarmupSeconds,
  });
}

/** Create runtime Sector from a SectorTemplate — paints map center coords (per computeSectorCenterX) and the shared sectorSize onto each. */
function createSectorsFromTemplate(template: MapTemplate, minGridX: number, minGridY: number): Sector[] {
  return template.sectors.map((sector) => ({
    ...sector,
    x: computeSectorCenterX(sector.gridX, minGridX, template.sectorSize),
    y: computeSectorCenterY(sector.gridY, minGridY, template.sectorSize),
    size: template.sectorSize,
  }));
}

/** Map each zone id to its sector's environment, resolved via `sectorIdFromZoneId`
 *  (the `<sector-id>-<n>` zone-id convention). Lets the preset loader reject a
 *  station whose type the sector's environment doesn't allow. Throws when a
 *  zone id names no sector — a typo'd id must not dodge the environment check
 *  by failing to resolve. */
function buildSectorEnvByZoneId(template: MapTemplate): Map<string, SectorEnvironmentId> {
  const environmentBySectorId = new Map(
    template.sectors.map((sector): [string, SectorEnvironmentId] => [sector.id, sector.environment]),
  );
  const byZoneId = new Map<string, SectorEnvironmentId>();
  for (const zone of template.zones) {
    const sectorId = sectorIdFromZoneId(zone.id);
    const environment = environmentBySectorId.get(sectorId);
    if (environment === undefined) {
      throw new Error(`Zone "${zone.id}" names unknown sector "${sectorId}" — can't resolve its environment.`);
    }
    byZoneId.set(zone.id, environment);
  }
  return byZoneId;
}

interface PresetValidationContext {
  preset: MapPreset;
  zoneById: Map<string, StationZoneTemplate>;
  occupiedZoneIds: ReadonlySet<string>;
  usedStationIds: ReadonlySet<string>;
  sectorEnvByZoneId: ReadonlyMap<string, SectorEnvironmentId>;
}

function validatePresetStation(
  presetStation: PresetStation,
  ctx: PresetValidationContext,
): StationZoneTemplate {
  const zone = ctx.zoneById.get(presetStation.zoneId);
  if (!zone) {
    throw new Error(
      `Preset "${ctx.preset.id}" references unknown zone "${presetStation.zoneId}" for station ${presetStation.stationId}.`,
    );
  }
  if (ctx.occupiedZoneIds.has(presetStation.zoneId)) {
    throw new Error(
      `Preset "${ctx.preset.id}" places two stations on zone "${presetStation.zoneId}" — each zone hosts at most one preset station.`,
    );
  }
  if (ctx.usedStationIds.has(presetStation.stationId)) {
    throw new Error(
      `Preset "${ctx.preset.id}" defines duplicate stationId "${presetStation.stationId}" — each preset station needs a unique id.`,
    );
  }
  // Present for every template zone — buildSectorEnvByZoneId throws on a zone
  // id naming no sector, and the unknown-zone check above already ran.
  const environment = ctx.sectorEnvByZoneId.get(presetStation.zoneId)!;
  const allowedTypeIds = sectorEnvironmentById[environment].allowedStationTypeIds;
  if (!allowedTypeIds.includes(presetStation.stationTypeId)) {
    throw new Error(
      `Preset "${ctx.preset.id}" places ${presetStation.stationTypeId} station ${presetStation.stationId} in zone "${presetStation.zoneId}", but its sector environment "${environment}" allows only [${allowedTypeIds.join(", ")}].`,
    );
  }
  return zone;
}

/** Create runtime PlacedStation values from a preset's presetStations — position and size come from the referenced zone (not from the preset entry), and unknown/duplicate zone/nation/station ids throw at the boundary. */
function createPresetPlacedStations(
  preset: MapPreset,
  zoneById: Map<string, StationZoneTemplate>,
  sectorEnvByZoneId: ReadonlyMap<string, SectorEnvironmentId>,
): PlacedStation[] {
  const occupiedZoneIds = new Set<string>();
  const usedStationIds = new Set<string>();
  const stations: PlacedStation[] = [];
  for (const presetStation of preset.presetStations) {
    const zone = validatePresetStation(presetStation, {
      preset,
      zoneById,
      occupiedZoneIds,
      usedStationIds,
      sectorEnvByZoneId,
    });
    const nation = getNationById(presetStation.nationId);
    occupiedZoneIds.add(presetStation.zoneId);
    usedStationIds.add(presetStation.stationId);
    stations.push({
      id: presetStation.stationId,
      name: presetStation.name,
      nation,
      stationTypeId: presetStation.stationTypeId,
      size: zone.size,
      x: zone.x,
      y: zone.y,
      zoneId: presetStation.zoneId,
    });
  }
  return stations;
}

/** Randomize each station inventory slot's starting fill to a random ratio of its max, drawn uniformly from [lower, upper]. */
export function randomizeInitialInventory(stations: Station[], fillRange: InitialInventoryFillRange) {
  const { inventoryLowerBound, inventoryUpperBound } = fillRange;
  const ratioRange = inventoryUpperBound - inventoryLowerBound;
  for (const station of stations) {
    for (const inventorySlot of getAllInventorySlots(station)) {
      const ratio = inventoryLowerBound + Math.random() * ratioRange;
      inventorySlot.current = Math.floor(inventorySlot.max * ratio);
    }
  }
}
