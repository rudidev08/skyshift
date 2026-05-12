import type {
  StationPlacement,
  StationSize,
  StationTemplate,
  StationTypeId,
} from "../../data/station-types";
import type { InventorySlot, Station } from "../sim-station-types";
import type { WareId } from "../../data/ware-types";
import type { Nebula, SectorTemplate } from "../../data/map-types";
import type { Sector } from "../sim-map-types";
import { hubNation } from "../../data/nations";
import { sizeMultiplierBySize } from "../../data/stations";
import { getStationTemplate } from "../sim-station-template";

/** Test-only template; `produces` list need not match any real station type. */
function makeStationTemplate(produces: WareId[]): StationTemplate {
  return { id: "mine" as StationTypeId, name: "Test", produces, lore: "" };
}

/** Authored placement with safe defaults. */
export function makeStationPlacement(overrides: Partial<StationPlacement> = {}): StationPlacement {
  const id = overrides.id ?? "TEST-1";
  return {
    id,
    name: overrides.name ?? id,
    x: 0,
    y: 0,
    nation: hubNation,
    stationTypeId: "habitat",
    size: "M",
    ...overrides,
  };
}

export function makeNebula(overrides: Partial<Nebula> = {}): Nebula {
  return {
    textureKey: "neb-default",
    x: 0,
    y: 0,
    ...overrides,
  };
}

/** Authored sector — grid coords + lore, before map x/y/size are derived. */
export function makeSectorTemplate(overrides: Partial<SectorTemplate> = {}): SectorTemplate {
  return {
    id: "test-sector",
    name: "Test Sector",
    lore: "",
    gridX: 0,
    gridY: 0,
    environment: "deep-space",
    ...overrides,
  };
}

/** Runtime sector: authored shape plus map-space x/y and size. */
export function makeSector(overrides: Partial<Sector> = {}): Sector {
  return {
    ...makeSectorTemplate(overrides),
    x: 0,
    y: 0,
    size: 1000,
    ...overrides,
  };
}

/** Runtime station from authored placement; auto-derives `inventoryByWareId`. Pass `produces` to override the station type. */
export function makeStation(
  overrides: {
    produces?: WareId[];
    size?: StationSize;
    inventory?: InventorySlot[];
    sizeMultiplier?: number;
    placement?: Partial<StationPlacement>;
  } = {},
): Station {
  const size = overrides.size ?? "M";
  const sizeMultiplier = overrides.sizeMultiplier ?? sizeMultiplierBySize[size];
  const inventory = overrides.inventory ?? [];
  const inventoryByWareId = new Map<WareId, InventorySlot>();
  for (const slot of inventory) inventoryByWareId.set(slot.ware.id, slot);
  const stationType = overrides.produces
    ? makeStationTemplate(overrides.produces)
    : getStationTemplate("habitat");
  const placement = makeStationPlacement(overrides.placement);
  return {
    id: placement.id,
    name: placement.name ?? placement.id,
    x: placement.x,
    y: placement.y,
    nation: placement.nation,
    size,
    state: placement.state ?? "producing",
    build: placement.build,
    zoneId: placement.zoneId,
    stationType,
    sizeMultiplier,
    inventory,
    inventoryByWareId,
    secondsSinceLastTick: 0,
    didProduceLastTick: false,
    typeAndSizeLabel: "Test",
    emigrationEvent: null,
    generationalShipBuild: null,
  };
}
