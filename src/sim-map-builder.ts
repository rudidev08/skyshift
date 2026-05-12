import { SECTOR_SIZE } from "../data/map";
import type { MapTemplate, MapPreset, SectorTemplate, InitialInventoryBalance } from "../data/map-types";
import type { GameMap, Sector } from "./sim-map-types";
import type { StationPlacement } from "../data/station-types";
import type { Station } from "./sim-station-types";
import type { StationZoneTemplate } from "../data/station-zone-types";
import { getAllInventorySlots } from "./sim-station";
import { getNationById } from "./sim-nation";

interface ZoneOccupant {
  readonly zoneId?: string;
}

/** Remove zones whose ids appear on any of the given stations. Used on Continue
 *  so restored saves don't render empty zones under stations the snapshot puts
 *  there. Strict zoneId match — a zoneless station drifting through a zone's
 *  coords doesn't hide it, since its transient position isn't a claim. */
export function filterZonesForOccupants(
  zones: readonly StationZoneTemplate[],
  occupants: readonly ZoneOccupant[],
): StationZoneTemplate[] {
  const occupiedZoneIds = new Set(
    occupants.map((occupant) => occupant.zoneId).filter((id): id is string => !!id),
  );
  return zones.filter((zone) => !occupiedZoneIds.has(zone.id));
}

/** Authored sector coords are flavor-anchored on the Core at (0, 0) and can be negative; map coords shift them so the minimum author coord lands at map (0, 0). */
export function getSectorCenterX(
  gridColumn: number,
  minGridX: number,
  sectorSize: number = SECTOR_SIZE,
): number {
  return (gridColumn - minGridX) * sectorSize + sectorSize / 2;
}

/** See getSectorCenterX — same shift, applied to the Y axis. */
export function getSectorCenterY(
  gridRow: number,
  minGridY: number,
  sectorSize: number = SECTOR_SIZE,
): number {
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

/** Create a playable GameMap from the template plus a preset's initial seeding. Preset stations occupy their zones; those zones are dropped from stationZones so the footprint doesn't render twice. */
export function createMapFromTemplate(template: MapTemplate, preset: MapPreset): GameMap {
  const { minGridX, minGridY, gridSizeX, gridSizeY } = computeGridExtent(template.sectors);

  const zoneById = new Map(template.zones.map((zone) => [zone.id, zone]));
  const { stations, occupiedZoneIds } = placePresetStations(preset, zoneById);

  const stationZones: StationZoneTemplate[] = [];
  for (const zone of template.zones) {
    if (occupiedZoneIds.has(zone.id)) continue;
    stationZones.push(zone);
  }

  const balance = preset.initialInventoryBalance;

  return {
    presetId: preset.id,
    presetName: preset.name,
    sectorSize: template.sectorSize,
    cameraStart: template.cameraStart,
    simulationWarmup: preset.simulationWarmup,
    initialStaggerDuration: preset.initialStaggerDuration,
    nebulas: template.nebulas,
    stations,
    stationZones,
    gridSizeX,
    gridSizeY,
    sectors: placeSectorsInMap(template, minGridX, minGridY),
    seedInitialInventory: balance
      ? (seedStations) => balanceInitialInventory(seedStations, balance)
      : undefined,
  };
}

/** Create runtime Sector from authored sectors by computing each sector's map center
 *  (shifted so the minimum grid coord lands at map origin) and stamping the shared sectorSize. */
function placeSectorsInMap(
  template: MapTemplate,
  minGridX: number,
  minGridY: number,
): Sector[] {
  return template.sectors.map((sector) => ({
    ...sector,
    x: getSectorCenterX(sector.gridX, minGridX, template.sectorSize),
    y: getSectorCenterY(sector.gridY, minGridY, template.sectorSize),
    size: template.sectorSize,
  }));
}

/** Resolve each entry in `preset.stations` against the zone and nation registries,
 *  throwing on unknown zones/nations or duplicate zone/station ids, and create
 *  runtime StationPlacement values (positions and size come from the zone). */
function placePresetStations(
  preset: MapPreset,
  zoneById: Map<string, StationZoneTemplate>,
): { stations: StationPlacement[]; occupiedZoneIds: Set<string> } {
  const occupiedZoneIds = new Set<string>();
  const usedStationIds = new Set<string>();
  const stations: StationPlacement[] = [];
  for (const presetStation of preset.stations) {
    const zone = zoneById.get(presetStation.zoneId);
    if (!zone) {
      throw new Error(
        `Preset "${preset.id}" references unknown zone "${presetStation.zoneId}" for station ${presetStation.stationId}.`,
      );
    }
    let nation;
    try {
      nation = getNationById(presetStation.nationId);
    } catch {
      throw new Error(
        `Preset "${preset.id}" references unknown nation id "${presetStation.nationId}" for station ${presetStation.stationId}.`,
      );
    }
    if (occupiedZoneIds.has(presetStation.zoneId)) {
      throw new Error(
        `Preset "${preset.id}" places two stations on zone "${presetStation.zoneId}" — each zone hosts at most one preset station.`,
      );
    }
    if (usedStationIds.has(presetStation.stationId)) {
      throw new Error(
        `Preset "${preset.id}" defines duplicate stationId "${presetStation.stationId}" — each preset station needs a unique id.`,
      );
    }
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

type WareSlots = { current: number; max: number }[];

/** Group every station's inventory slots by ware id — input shape for the per-ware randomizer. */
function groupInventorySlotsByWare(stations: Station[]): Record<string, WareSlots> {
  const wareSlots: Record<string, WareSlots> = {};
  for (const station of stations) {
    for (const inventorySlot of getAllInventorySlots(station)) {
      if (!wareSlots[inventorySlot.ware.id]) wareSlots[inventorySlot.ware.id] = [];
      wareSlots[inventorySlot.ware.id].push(inventorySlot);
    }
  }
  return wareSlots;
}

/** Randomize each slot's `current` within the configured bounds, then scale so the sum
 *  of currents across these slots hits `balance.universeWareFraction × totalMax`. */
function randomizeSlotsToTarget(slots: WareSlots, balance: InitialInventoryBalance): void {
  const { inventoryLowerBound, inventoryUpperBound, universeWareFraction } = balance;
  const totalMax = slots.reduce((sum, inventorySlot) => sum + inventorySlot.max, 0);
  const targetTotal = Math.floor(totalMax * universeWareFraction);

  const ratioRange = inventoryUpperBound - inventoryLowerBound;
  const ratios = slots.map(() => inventoryLowerBound + Math.random() * ratioRange);

  const rawTotals = slots.map((inventorySlot, index) => inventorySlot.max * ratios[index]);
  const rawSum = rawTotals.reduce((sum, value) => sum + value, 0);

  const scale = targetTotal / rawSum;
  for (let index = 0; index < slots.length; index++) {
    slots[index].current = Math.floor(rawTotals[index] * scale);
  }
}

/** Randomize station fills within bounds while keeping each ware's universe total at the requested percentage. */
export function balanceInitialInventory(stations: Station[], balance: InitialInventoryBalance) {
  const wareSlots = groupInventorySlotsByWare(stations);
  for (const slots of Object.values(wareSlots)) {
    randomizeSlotsToTarget(slots, balance);
  }
}
