import { test, assertEqual, assertTrue, assertNotUndefined } from "./test-utils.ts";
import { map } from "../../data/map";
import { sectors } from "../../data/map-sectors";
import { zones } from "../../data/map-zones";
import { presets } from "../../data/map-presets";
import { presetById } from "../util-map-preset";
import { allNations } from "../../data/nations";
import { stationTypes } from "../../data/stations";
import { allShips } from "../../data/ships";
import { allWares, passengers } from "../../data/wares";
import { ENVIRONMENT_ALLOWED_TYPES } from "../../data/map-environments";
import type { WareId } from "../../data/ware-types";
import type { StationTypeId } from "../../data/station-types";

// Pins invariants that hold across authored data in `data/`. The test runtime
// loads real data, not fixtures: a typo or stale reference in `data/` should
// fail one of these tests.

test("every zone.sectorId references an existing sector", () => {
  const sectorIds = new Set(sectors.map((sector) => sector.id));
  for (const zone of zones) {
    assertTrue(sectorIds.has(zone.sectorId), `zone "${zone.id}" references unknown sector "${zone.sectorId}"`);
  }
});

test("every preset station references an existing zoneId", () => {
  const zoneIds = new Set(zones.map((zone) => zone.id));
  for (const preset of presets) {
    for (const station of preset.stations) {
      assertTrue(
        zoneIds.has(station.zoneId),
        `preset "${preset.id}" station "${station.stationId}" references unknown zone "${station.zoneId}"`,
      );
    }
  }
});

test("every preset station references an existing nationId", () => {
  const nationIds = new Set(allNations.map((nation) => nation.id));
  for (const preset of presets) {
    for (const station of preset.stations) {
      assertTrue(
        nationIds.has(station.nationId),
        `preset "${preset.id}" station "${station.stationId}" references unknown nation "${station.nationId}"`,
      );
    }
  }
});

test("every preset station references an existing stationTypeId", () => {
  const stationTypeIds = new Set(stationTypes.map((stationType) => stationType.id));
  for (const preset of presets) {
    for (const station of preset.stations) {
      assertTrue(
        stationTypeIds.has(station.stationTypeId),
        `preset "${preset.id}" station "${station.stationId}" references unknown stationType "${station.stationTypeId}"`,
      );
    }
  }
});

test("every ship.allowedWares wareId exists in allWares", () => {
  const wareIds = new Set(allWares.map((ware) => ware.id));
  for (const ship of allShips) {
    for (const wareId of ship.allowedWares) {
      assertTrue(wareIds.has(wareId), `ship "${ship.id}" allows unknown ware "${wareId}"`);
    }
  }
});

test("every ware.productionInputs[].wareId exists in allWares", () => {
  const wareIds = new Set(allWares.map((ware) => ware.id));
  for (const ware of allWares) {
    for (const input of ware.productionInputs) {
      assertTrue(
        wareIds.has(input.wareId),
        `ware "${ware.id}" has productionInput referencing unknown ware "${input.wareId}"`,
      );
    }
  }
});

test("every nation.buildableStationTypeIds id exists in stationTypes", () => {
  const stationTypeIds = new Set(stationTypes.map((stationType) => stationType.id));
  for (const nation of allNations) {
    for (const stationTypeId of nation.buildableStationTypeIds) {
      assertTrue(
        stationTypeIds.has(stationTypeId),
        `nation "${nation.id}" lists unknown buildable stationType "${stationTypeId}"`,
      );
    }
  }
});

test("every nation.primaryBuildableStationTypeId exists in stationTypes and is in buildableStationTypeIds", () => {
  const stationTypeIds = new Set(stationTypes.map((stationType) => stationType.id));
  for (const nation of allNations) {
    assertTrue(
      stationTypeIds.has(nation.primaryBuildableStationTypeId),
      `nation "${nation.id}" primaryBuildableStationTypeId "${nation.primaryBuildableStationTypeId}" is not a known stationType`,
    );
    // Pin the contract documented on NationTemplate.primaryBuildableStationTypeId — it
    // must appear in buildableStationTypeIds so the seal/footer/G2 floor stay in sync.
    assertTrue(
      nation.buildableStationTypeIds.includes(nation.primaryBuildableStationTypeId),
      `nation "${nation.id}" primary "${nation.primaryBuildableStationTypeId}" is not in buildableStationTypeIds`,
    );
  }
});

test("every nation.shipTypeId is null or exists in allShips", () => {
  const shipIds = new Set(allShips.map((ship) => ship.id));
  for (const nation of allNations) {
    if (nation.shipTypeId === null) continue;
    assertTrue(
      shipIds.has(nation.shipTypeId),
      `nation "${nation.id}" shipTypeId "${nation.shipTypeId}" is not a known ship`,
    );
  }
});

test("every nation.stationConstructionShipTypeId is null or exists in allShips", () => {
  // WAY has stationConstructionShipTypeId: null because it doesn't build stations.
  // Every other nation must reference a real ship template.
  const shipIds = new Set(allShips.map((ship) => ship.id));
  for (const nation of allNations) {
    if (nation.stationConstructionShipTypeId === null) continue;
    assertTrue(
      shipIds.has(nation.stationConstructionShipTypeId),
      `nation "${nation.id}" stationConstructionShipTypeId "${nation.stationConstructionShipTypeId}" is not a known ship`,
    );
  }
});

test("ware production graph is acyclic", () => {
  // Build adjacency: ware → list of input wareIds it depends on. A cycle here
  // would mean a ware (transitively) consumes itself, breaking economy chains.
  const inputsByWare = new Map<WareId, WareId[]>(
    allWares.map((ware) => [ware.id, ware.productionInputs.map((input) => input.wareId)]),
  );
  const visited = new Set<WareId>();
  const onStack = new Set<WareId>();

  function visit(wareId: WareId, path: WareId[]): void {
    if (onStack.has(wareId)) {
      throw new Error(`production cycle detected: ${[...path, wareId].join(" → ")}`);
    }
    if (visited.has(wareId)) return;
    visited.add(wareId);
    onStack.add(wareId);
    for (const inputWareId of inputsByWare.get(wareId) ?? []) {
      visit(inputWareId, [...path, wareId]);
    }
    onStack.delete(wareId);
  }

  for (const ware of allWares) visit(ware.id, []);
});

test("every ware consumed in production has at least one producing station type", () => {
  // Collect every wareId that appears in any other ware's productionInputs[].
  // For each, at least one stationTemplate.produces[] must list it — otherwise
  // the consumer's input can never be supplied through normal play.
  const consumedWareIds = new Set<WareId>();
  for (const ware of allWares) {
    for (const input of ware.productionInputs) consumedWareIds.add(input.wareId);
  }
  const producedWareIds = new Set<WareId>();
  for (const stationType of stationTypes) {
    for (const wareId of stationType.produces) producedWareIds.add(wareId);
  }
  for (const consumedWareId of consumedWareIds) {
    assertTrue(
      producedWareIds.has(consumedWareId),
      `ware "${consumedWareId}" is consumed in some chain but no station type produces it`,
    );
  }
});

test("passengers ware has no producer and no consumer", () => {
  // Pin passengers' role as emigration-only flavor cargo — a producer or
  // consumer would put it into normal trade flows it isn't designed for.
  assertEqual(passengers.productionInputs.length, 0, "passengers must have no productionInputs");
  assertEqual(passengers.productionOutput, 0, "passengers must have productionOutput=0");
  for (const stationType of stationTypes) {
    assertTrue(
      !stationType.produces.includes("passengers"),
      `stationType "${stationType.id}" must not produce passengers`,
    );
  }
  for (const ware of allWares) {
    for (const input of ware.productionInputs) {
      assertTrue(
        input.wareId !== "passengers",
        `ware "${ware.id}" must not consume passengers as a productionInput`,
      );
    }
  }
});

test("ware.productionInputs lists each wareId at most once per ware", () => {
  // Pin the no-duplicate-input invariant. Two entries for the same input
  // ware would double-bill consumption against a single inventory slot,
  // since input slots are keyed by wareId.
  for (const ware of allWares) {
    const inputWareIds = ware.productionInputs.map((input) => input.wareId);
    const uniqueInputWareIds = new Set(inputWareIds);
    assertEqual(
      uniqueInputWareIds.size,
      inputWareIds.length,
      `ware "${ware.id}" lists a duplicate wareId in productionInputs`,
    );
  }
});

test("every nation that buildsStations has at least one buildable zone in the blank preset", () => {
  // Blank preset leaves every zone empty — so a nation with no buildable zone
  // there can never build, in any preset. Verifies the cross-product of:
  // nation buildable types × allowed environments × authored sectors/zones.
  const sectorById = new Map(sectors.map((sector) => [sector.id, sector]));
  for (const nation of allNations) {
    if (!nation.buildsStations) continue;
    let hasBuildableZone = false;
    for (const zone of zones) {
      const sector = assertNotUndefined(sectorById.get(zone.sectorId), `zone "${zone.id}" sector lookup`);
      const environment = zone.environmentOverride ?? sector.environment;
      const allowedTypes = ENVIRONMENT_ALLOWED_TYPES[environment];
      const overlap = nation.buildableStationTypeIds.some((typeId) => allowedTypes.includes(typeId));
      if (overlap) {
        hasBuildableZone = true;
        break;
      }
    }
    assertTrue(hasBuildableZone, `nation "${nation.id}" has no zone in any sector environment that allows its buildable types`);
  }
});

test("every buildable station type is placeable in at least one environment", () => {
  // Collect every stationTypeId any nation can build, then verify
  // ENVIRONMENT_ALLOWED_TYPES has at least one environment that lists it —
  // otherwise the nation can declare it buildable but never actually place it.
  const buildableTypeIds = new Set<StationTypeId>();
  for (const nation of allNations) {
    if (!nation.buildsStations) continue;
    for (const typeId of nation.buildableStationTypeIds) buildableTypeIds.add(typeId);
  }
  for (const buildableTypeId of buildableTypeIds) {
    let placeableSomewhere = false;
    for (const allowedTypes of Object.values(ENVIRONMENT_ALLOWED_TYPES)) {
      if (allowedTypes.includes(buildableTypeId)) {
        placeableSomewhere = true;
        break;
      }
    }
    assertTrue(placeableSomewhere, `buildable stationType "${buildableTypeId}" is not allowed in any environment`);
  }
});

test("every stationType.produces[] references existing wares with no duplicates", () => {
  const wareIds = new Set(allWares.map((ware) => ware.id));
  for (const stationType of stationTypes) {
    const seen = new Set<WareId>();
    for (const wareId of stationType.produces) {
      assertTrue(wareIds.has(wareId), `stationType "${stationType.id}" produces unknown ware "${wareId}"`);
      assertTrue(!seen.has(wareId), `stationType "${stationType.id}" produces "${wareId}" more than once`);
      seen.add(wareId);
    }
  }
});

test("presetById('blank') returns non-null", () => {
  // game-entry's continueUniverse composes restored saves on top of the blank
  // preset's empty-zone layout — a missing 'blank' would crash continue at init.
  const blank = presetById("blank");
  assertTrue(blank !== null, "presetById('blank') must not return null");
  assertEqual(blank?.id, "blank", "blank preset id");
});

test("presetById returns null for unknown id", () => {
  // Pin the negative branch — a typo in a preset URL must not silently fall
  // through to some other preset.
  assertEqual(presetById("not-a-preset"), null, "unknown preset id");
});

test("map.zones references same zones array used by data-integrity tests", () => {
  // Sanity-check the import wiring — if map.zones diverged from
  // ./map/zones.ts, the other tests in this file would silently validate a
  // different dataset than the one the engine consumes.
  assertEqual(map.zones, zones, "map.zones identity");
});
