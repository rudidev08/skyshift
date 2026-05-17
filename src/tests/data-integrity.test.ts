import { test, assertEqual, assertTrue, assertNotUndefined } from "./test-utils.ts";
import { map } from "../../data/map";
import { zones } from "../../data/map-zones";
import { createMapFromTemplate } from "../sim-map-create";
import { createStationZones } from "../sim-station-zone";
import { presets } from "../../data/map-presets";
import { getPresetById, getPresetLabel } from "../util-map-preset";
import { allNations } from "../../data/nations";
import { allStationTypes } from "../../data/stations";
import { allShips } from "../../data/ships";
import { allWares, passengers } from "../../data/wares";
import { sectorEnvironmentById } from "../../data/map-sector-environments";
import { allowedStationTypesForZone } from "../sim-map-sector-environments";
import type { StationZone } from "../sim-station-zone-types";
import type { Sector } from "../sim-map-types";
import type { WareId } from "../../data/ware-types";
import type { StationTypeId } from "../../data/station-types";

// Pins invariants that hold across the data files. The test runtime
// loads real data, not fixtures: a typo or stale reference in `data/` should
// fail one of these tests.

// Resolve every zone through the real seed path. createStationZones derives
// each zone's sector from its x/y and throws if a zone is outside every sector
// or lands in one its `<sector-id>-<n>` id prefix doesn't name — so this also
// asserts the data files stay spatially consistent.
function buildRealRuntimeZones(): StationZone[] {
  return createStationZones([...zones], createMapFromTemplate(map, presets[0]).sectors);
}

test("every zone's position resolves to the sector its id prefix names", () => {
  const runtimeZones = buildRealRuntimeZones();
  assertEqual(runtimeZones.length, zones.length, "every zone resolved to a sector");
  for (const zone of runtimeZones) {
    const namedSectorId = zone.id.replace(/-\d+$/, "");
    assertEqual(zone.sector.id, namedSectorId, `zone "${zone.id}" should sit in sector "${namedSectorId}"`);
  }
});

test("every preset station references an existing zoneId", () => {
  const zoneIds = new Set(zones.map((zone) => zone.id));
  for (const preset of presets) {
    for (const station of preset.presetStations) {
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
    for (const station of preset.presetStations) {
      assertTrue(
        nationIds.has(station.nationId),
        `preset "${preset.id}" station "${station.stationId}" references unknown nation "${station.nationId}"`,
      );
    }
  }
});

test("every preset station references an existing stationTypeId", () => {
  const stationTypeIds = new Set(allStationTypes.map((stationType) => stationType.id));
  for (const preset of presets) {
    for (const station of preset.presetStations) {
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

test("every nation.buildableStationTypeIds id exists in allStationTypes", () => {
  const stationTypeIds = new Set(allStationTypes.map((stationType) => stationType.id));
  for (const nation of allNations) {
    for (const stationTypeId of nation.buildableStationTypeIds) {
      assertTrue(
        stationTypeIds.has(stationTypeId),
        `nation "${nation.id}" lists unknown buildable stationType "${stationTypeId}"`,
      );
    }
  }
});

test("every nation.primaryBuildableStationTypeId exists in allStationTypes and is in buildableStationTypeIds", () => {
  const stationTypeIds = new Set(allStationTypes.map((stationType) => stationType.id));
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
  const inputWareIdsByWare = new Map<WareId, WareId[]>(
    allWares.map((ware) => [ware.id, ware.productionInputs.map((input) => input.wareId)]),
  );
  const visited = new Set<WareId>();
  const onStack = new Set<WareId>();

  function walkProductionInputsFrom(wareId: WareId, path: WareId[]): void {
    if (onStack.has(wareId)) {
      throw new Error(`production cycle detected: ${[...path, wareId].join(" → ")}`);
    }
    if (visited.has(wareId)) return;
    visited.add(wareId);
    onStack.add(wareId);
    for (const inputWareId of inputWareIdsByWare.get(wareId) ?? []) {
      walkProductionInputsFrom(inputWareId, [...path, wareId]);
    }
    onStack.delete(wareId);
  }

  for (const ware of allWares) walkProductionInputsFrom(ware.id, []);
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
  for (const stationType of allStationTypes) {
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
  for (const stationType of allStationTypes) {
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

test("every nation that buildsStations has at least one buildable zone on the base map", () => {
  // If a nation has no buildable zone on the base map, it can never build in
  // any preset. Verifies the cross-product of:
  // nation buildable types × allowed environments × resolved sectors/zones.
  const runtimeZones = buildRealRuntimeZones();
  for (const nation of allNations) {
    if (!nation.buildsStations) continue;
    let hasBuildableZone = false;
    for (const zone of runtimeZones) {
      const sectorEnvironment = zone.sector.environment;
      const allowedTypes = sectorEnvironmentById[sectorEnvironment].allowedStationTypeIds;
      const overlap = nation.buildableStationTypeIds.some((typeId) => allowedTypes.includes(typeId));
      if (overlap) {
        hasBuildableZone = true;
        break;
      }
    }
    assertTrue(
      hasBuildableZone,
      `nation "${nation.id}" has no zone in any sector environment that allows its buildable types`,
    );
  }
});

test("every buildable station type is placeable in at least one sector environment", () => {
  // Collect every stationTypeId any nation can build, then verify
  // sectorEnvironmentById has at least one environment that lists it —
  // otherwise the nation can declare it buildable but never actually place it.
  const buildableTypeIds = new Set<StationTypeId>();
  for (const nation of allNations) {
    if (!nation.buildsStations) continue;
    for (const typeId of nation.buildableStationTypeIds) buildableTypeIds.add(typeId);
  }
  for (const buildableTypeId of buildableTypeIds) {
    let placeableSomewhere = false;
    for (const sectorEnvironment of Object.values(sectorEnvironmentById)) {
      if (sectorEnvironment.allowedStationTypeIds.includes(buildableTypeId)) {
        placeableSomewhere = true;
        break;
      }
    }
    assertTrue(
      placeableSomewhere,
      `buildable stationType "${buildableTypeId}" is not allowed in any sector environment`,
    );
  }
});

test("every stationType.produces[] references existing wares with no duplicates", () => {
  const wareIds = new Set(allWares.map((ware) => ware.id));
  for (const stationType of allStationTypes) {
    const seen = new Set<WareId>();
    for (const wareId of stationType.produces) {
      assertTrue(wareIds.has(wareId), `stationType "${stationType.id}" produces unknown ware "${wareId}"`);
      assertTrue(!seen.has(wareId), `stationType "${stationType.id}" produces "${wareId}" more than once`);
      seen.add(wareId);
    }
  }
});

test("getPresetById returns null for unknown id", () => {
  // Pin the negative branch — a typo in a preset URL must not silently fall
  // through to some other preset.
  assertEqual(getPresetById("not-a-preset"), null, "unknown preset id");
});

test("getPresetLabel returns the preset's name and falls back to the id for unknown ids", () => {
  // Pin both branches of the optional-chain fallback. Dropping the `?? presetId`
  // would route unknown ids to `undefined` and UI labels would render as "undefined".
  const firstPreset = presets[0];
  assertNotUndefined(firstPreset, "at least one preset exists");
  assertEqual(getPresetLabel(firstPreset.id), firstPreset.name, "known id returns the preset's display name");
  assertEqual(getPresetLabel("not-a-preset"), "not-a-preset", "unknown id falls back to the raw id string");
});

function makeZoneWithSectorEnvironment(sectorEnvironment: Sector["environment"]): StationZone {
  const sector = {
    id: "test-sector",
    name: "Test Sector",
    lore: "",
    gridX: 0,
    gridY: 0,
    environment: sectorEnvironment,
    x: 0,
    y: 0,
    size: 1000,
  } satisfies Sector;
  return {
    id: "test-sector-1",
    sector,
    x: 0,
    y: 0,
    size: "M",
    name: "Test Zone",
    nameSuffix: "Alpha",
    code: "TST-1",
  };
}

test("allowedStationTypesForZone resolves the allow list from the zone's sector environment", () => {
  // Pin the lookup. Pointing this at the wrong environment would let nations
  // build station types the sector is supposed to forbid.
  const deepSpaceZone = makeZoneWithSectorEnvironment("deep-space");
  const bioNebulaZone = makeZoneWithSectorEnvironment("bio-nebula");
  assertEqual(
    allowedStationTypesForZone(deepSpaceZone),
    sectorEnvironmentById["deep-space"].allowedStationTypeIds,
    "deep-space zone uses the deep-space allow list",
  );
  assertEqual(
    allowedStationTypesForZone(bioNebulaZone),
    sectorEnvironmentById["bio-nebula"].allowedStationTypeIds,
    "bio-nebula zone uses the bio-nebula allow list",
  );
});

test("map.zones references same zones array used by data-integrity tests", () => {
  // Check the import wiring — if map.zones diverged from ./map-zones.ts, the
  // other tests in this file would silently validate a different dataset than
  // the one the engine consumes.
  assertEqual(map.zones, zones, "map.zones identity");
});
