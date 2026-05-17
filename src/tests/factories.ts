import type { PlacedStation, StationSize, StationTypeTemplate, StationTypeId } from "../../data/station-types";
import type { InventorySlot, Station } from "../sim-station-types";
import type { WareId } from "../../data/ware-types";
import type { Nebula, SectorTemplate } from "../../data/map-types";
import type { Sector } from "../sim-map-types";
import { hubNation } from "../../data/nations";
import { assembleStation } from "../sim-station";
import { getStationTypeTemplate } from "../sim-station-template";

/** Test-only template; `produces` list need not match any real station type. */
function makeStationTypeTemplate(produces: WareId[]): StationTypeTemplate {
  return { id: "mine" as StationTypeId, name: "Test", namePlural: "Tests", produces, lore: "" };
}

/** `PlacedStation` with safe defaults. */
export function makePlacedStation(overrides: Partial<PlacedStation> = {}): PlacedStation {
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

/** Nebula overlay — `textureKey` + map position. Defaults to a stub key at origin; override for real-texture tests. */
export function makeNebula(overrides: Partial<Nebula> = {}): Nebula {
  return {
    textureKey: "neb-default",
    x: 0,
    y: 0,
    layer: "NebulaLight",
    ...overrides,
  };
}

/** `SectorTemplate` — grid coords + lore, before map x/y/size are derived. */
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

/** Runtime sector: `SectorTemplate` plus map-space x/y and size. */
export function makeSector(overrides: Partial<Sector> = {}): Sector {
  return {
    ...makeSectorTemplate(),
    x: 0,
    y: 0,
    size: 1000,
    ...overrides,
  };
}

/** Runtime `Station` built via `assembleStation` for tests. `producesOverride`
 *  swaps in a fake station type with a custom produces list; otherwise
 *  `placement.stationTypeId` selects a registered type. */
export function makeStation(
  overrides: {
    producesOverride?: WareId[];
    size?: StationSize;
    inventory?: InventorySlot[];
    sizeMultiplier?: number;
    placement?: Partial<PlacedStation>;
  } = {},
): Station {
  const size = overrides.size ?? overrides.placement?.size ?? "M";
  const placement = makePlacedStation({ ...overrides.placement, size });
  const stationType = overrides.producesOverride
    ? makeStationTypeTemplate(overrides.producesOverride)
    : getStationTypeTemplate(placement.stationTypeId);
  const inventory = overrides.inventory ?? [];
  const station = assembleStation(placement, stationType, inventory);
  if (overrides.sizeMultiplier !== undefined) station.sizeMultiplier = overrides.sizeMultiplier;
  return station;
}
