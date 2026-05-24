import type { PlacedStation, StationSize, StationTypeTemplate, StationTypeId } from "../../data/station-types";
import type { InventorySlot, Station } from "../sim-station-types";
import type { WareId } from "../../data/ware-types";
import type { Nebula, SectorTemplate } from "../../data/map-types";
import type { Sector } from "../sim-map-types";
import type { DecommissionEvent } from "../sim-trade-manager";
import type { Simulation } from "../sim-lifecycle";
import type { TimelapseStation } from "../sim-timelapse-state";
import { hubNation } from "../../data/nations";
import { finalizeStation } from "../sim-station";
import { getStationTypeTemplate } from "../sim-station-template";

/** Station type with a custom `produces` list; id is hardcoded to `"mine"`, so tests keying off `stationType.id` will see that value. */
function makeFakeStationType(produces: WareId[]): StationTypeTemplate {
  return { id: "mine" as StationTypeId, name: "Test", namePlural: "Tests", produces, lore: "" };
}

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

/** Uses a stub nation with only `codeName`/`name`/`color` populated — tests that need full nation fields should use `makePlacedStation` directly. */
export function makePlacedStationWithType(
  stationTypeId: StationTypeId,
  size: StationSize = "S",
): PlacedStation {
  return makePlacedStation({
    name: "TestStation",
    stationTypeId,
    size,
    nation: { codeName: "TST", name: "Testers", color: "#fff" } as Station["nation"],
  });
}

export function makeNebula(overrides: Partial<Nebula> = {}): Nebula {
  return {
    textureKey: "neb-default",
    x: 0,
    y: 0,
    layer: "NebulaLight",
    ...overrides,
  };
}

/** Template shape only — map-space `x`/`y` and `size` are derived later; use `makeSector` when those are needed. */
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

/** Shared overrides for makeStation / makeStationWithProduces.
 *  `sizeMultiplier` overwrites the finalized station's `sizeMultiplier` after
 *  `finalizeStation` has already derived it from `size`. */
export interface MakeStationOverrides {
  size?: StationSize;
  inventory?: InventorySlot[];
  sizeMultiplier?: number;
  placement?: Partial<PlacedStation>;
}

function finalizeOverriddenStation(
  stationType: StationTypeTemplate,
  overrides: MakeStationOverrides,
): Station {
  const resolvedSize = overrides.size ?? overrides.placement?.size ?? "M";
  const placement = makePlacedStation({ ...overrides.placement, size: resolvedSize });
  const station = finalizeStation(placement, stationType, overrides.inventory ?? []);
  if (overrides.sizeMultiplier !== undefined) station.sizeMultiplier = overrides.sizeMultiplier;
  return station;
}

export function makeStation(overrides: MakeStationOverrides = {}): Station {
  const stationTypeId = overrides.placement?.stationTypeId ?? "habitat";
  return finalizeOverriddenStation(getStationTypeTemplate(stationTypeId), overrides);
}

/** Like makeStation but uses a synthetic station type with a custom `produces` list — for economy/inventory tests that need a specific output set. */
export function makeStationWithProduces(
  produces: WareId[],
  overrides: MakeStationOverrides = {},
): Station {
  return finalizeOverriddenStation(makeFakeStationType(produces), overrides);
}

export function makeTimelapseStation(
  overrides: Partial<TimelapseStation> = {},
): TimelapseStation {
  return {
    id: "hub-tech-1",
    position: { x: 100, y: 200 },
    nationId: "hub",
    typeId: "tech-factory",
    state: "construction",
    ...overrides,
  };
}

/** `tradeShip` and `orbitingShip` are partial stubs cast via `as never`; sufficient for emigration ferry-decommission tests but not for tests that dereference other fields on those objects. */
export function makeSyntheticDecommissionEvent(
  shipId: string,
  homeStationId: string,
  decommissionStationId: string,
): DecommissionEvent {
  return {
    tradeShip: { orbitingShipId: shipId, homeStationId } as never,
    orbitingShip: { id: shipId } as never,
    orbitingShipId: shipId,
    homeStationId,
    decommissionStationId,
    reason: "decommission-action",
  };
}

/** Pairs with `makeSyntheticDecommissionEvent` to drive the observer fan-out without running the real decommission path. */
export function emitSyntheticDecommission(
  simulation: Simulation,
  event: DecommissionEvent,
): void {
  for (const observer of simulation.tradeManager.decommissionObservers) {
    observer(event);
  }
}
