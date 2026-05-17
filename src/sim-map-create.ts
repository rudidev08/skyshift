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
import { getAllInventorySlots } from "./sim-station";
import { getNationById } from "./sim-nation";
import type { GameSnapshot } from "./sim-save-types";

interface ZoneOccupant {
  readonly zoneId?: string;
}

function occupiedZoneIdsFromOccupants(occupants: readonly ZoneOccupant[]): Set<string> {
  return new Set(occupants.map((occupant) => occupant.zoneId).filter((id): id is string => !!id));
}

function removeOccupiedZones(
  zones: readonly StationZoneTemplate[],
  occupiedZoneIds: ReadonlySet<string>,
): StationZoneTemplate[] {
  return zones.filter((zone) => !occupiedZoneIds.has(zone.id));
}

/** Remove zones whose ids appear on any of the given stations. Used on Continue
 *  so restored saves don't render empty zones under stations the snapshot puts
 *  there. Strict zoneId match — a zoneless station drifting through a zone's
 *  coords doesn't hide it, since its transient position isn't a claim. */
export function filterZonesForOccupants(
  zones: readonly StationZoneTemplate[],
  occupants: readonly ZoneOccupant[],
): StationZoneTemplate[] {
  return removeOccupiedZones(zones, occupiedZoneIdsFromOccupants(occupants));
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
  occupiedZoneIds: Set<string>;
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
    stationZones: removeOccupiedZones(template.zones, seed.occupiedZoneIds),
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

/** Create a playable GameMap from the template plus a preset's initial seeding. Preset stations occupy their zones; those zones are dropped from stationZones so the footprint doesn't render twice. */
export function createMapFromTemplate(template: MapTemplate, preset: MapPreset): GameMap {
  const zoneById = new Map(template.zones.map((zone) => [zone.id, zone]));
  const { stations, occupiedZoneIds } = createPresetPlacedStations(preset, zoneById);

  return createRuntimeMapFromTemplate(template, {
    presetId: preset.id,
    stations,
    occupiedZoneIds,
    simulationWarmupSeconds: preset.simulationWarmupSeconds,
    initialStaggerDurationSeconds: preset.initialStaggerDurationSeconds,
    initialInventoryFillRange: preset.initialInventoryFillRange,
  });
}

/** Recreate the runtime map shell for a saved game. The snapshot owns station
 *  truth, so no preset stations are seeded; occupied zones are hidden before
 *  restoreSavedGame installs the saved station objects. */
export function mapFromSnapshot(template: MapTemplate, snapshot: GameSnapshot): GameMap {
  return createRuntimeMapFromTemplate(template, {
    presetId: snapshot.presetId,
    stations: [],
    occupiedZoneIds: occupiedZoneIdsFromOccupants(snapshot.stations),
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

interface PresetValidationContext {
  preset: MapPreset;
  zoneById: Map<string, StationZoneTemplate>;
  occupiedZoneIds: ReadonlySet<string>;
  usedStationIds: ReadonlySet<string>;
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
  return zone;
}

/** Create runtime PlacedStation values from a preset's presetStations — position and size come from the referenced zone (not from the preset entry), and unknown/duplicate zone/nation/station ids throw at the boundary. */
function createPresetPlacedStations(
  preset: MapPreset,
  zoneById: Map<string, StationZoneTemplate>,
): { stations: PlacedStation[]; occupiedZoneIds: Set<string> } {
  const occupiedZoneIds = new Set<string>();
  const usedStationIds = new Set<string>();
  const stations: PlacedStation[] = [];
  for (const presetStation of preset.presetStations) {
    const zone = validatePresetStation(presetStation, {
      preset,
      zoneById,
      occupiedZoneIds,
      usedStationIds,
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
  return { stations, occupiedZoneIds };
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
