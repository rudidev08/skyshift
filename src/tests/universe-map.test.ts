import { test, assertEqual, assertTrue, assertThrows, withScriptedMathRandom } from "./test-utils.ts";
import {
  randomizeInitialInventory,
  createMapFromTemplate,
  filterZonesForOccupants,
  mapFromSnapshot,
} from "../sim-map-create.ts";
import type { MapTemplate, MapPreset } from "../../data/map-types.ts";
import { makeSectorTemplate, makeStation } from "./factories.ts";
import type { GameSnapshot, StationSnapshot } from "../sim-save-types.ts";
import { SAVE_VERSION } from "../sim-save-types.ts";
import type { InventorySlot, Station } from "../sim-station-types.ts";
import { food } from "../../data/wares.ts";

function makeTwoZoneAlphaTemplate(): MapTemplate {
  return {
    sectors: [makeSectorTemplate({ id: "alpha", name: "Alpha" })],
    nebulas: [],
    zones: [
      { id: "alpha-1", x: 100, y: 100, size: "M" },
      { id: "alpha-2", x: 200, y: 200, size: "L" },
    ],
    sectorSize: 1000,
  };
}

function makePreset(overrides: Partial<MapPreset> = {}): MapPreset {
  return {
    id: "test",
    name: "Test",
    description: "fixture",
    presetStations: [],
    ...overrides,
  };
}

function makeSnapshot(stations: StationSnapshot[]): GameSnapshot {
  return {
    version: SAVE_VERSION,
    savedAtMilliseconds: 1,
    simulationTick: 0,
    presetId: "settled",
    stations,
    ships: [],
    tradeShips: [],
    emigrationManager: {
      activeEvent: null,
      activeGenerationalShipId: null,
      mode: "manual",
      intensity: "medium",
      usedDestinations: [],
      nextGenerationalShipArrivalAtSeconds: null,
      clockSeconds: 0,
      nextGenerationalShipCounter: 0,
      nextEmigrantShipCounter: 0,
      nextEventCounter: 0,
    },
    tradeManager: { tradeTimeSeconds: 0, scheduledTimers: [] },
    stationHistory: [],
  };
}

function makeStationSnapshot(overrides: Partial<StationSnapshot> = {}): StationSnapshot {
  return {
    id: "HUB-1",
    nationId: "hub",
    typeId: "habitat",
    size: "M",
    name: "One",
    x: 100,
    y: 100,
    zoneId: "alpha-1",
    state: "producing",
    inventory: [],
    ...overrides,
  };
}

test("createMapFromTemplate throws on unknown zoneId", () => {
  assertThrows(
    () =>
      createMapFromTemplate(
        makeTwoZoneAlphaTemplate(),
        makePreset({
          presetStations: [
            {
              zoneId: "not-a-real-zone",
              stationId: "HUB-1",
              name: "Imaginary",
              nationId: "hub",
              stationTypeId: "habitat",
            },
          ],
        }),
      ),
    "not-a-real-zone",
    "unknown zoneId",
  );
});

test("createMapFromTemplate throws when two preset stations share a zone", () => {
  assertThrows(
    () =>
      createMapFromTemplate(
        makeTwoZoneAlphaTemplate(),
        makePreset({
          presetStations: [
            {
              zoneId: "alpha-1",
              stationId: "HUB-1",
              name: "First",
              nationId: "hub",
              stationTypeId: "habitat",
            },
            {
              zoneId: "alpha-1",
              stationId: "BIO-1",
              name: "Second",
              nationId: "bio",
              stationTypeId: "farm",
            },
          ],
        }),
      ),
    "alpha-1",
    "duplicate zoneId",
  );
});

test("createMapFromTemplate throws when two preset stations share a stationId", () => {
  assertThrows(
    () =>
      createMapFromTemplate(
        makeTwoZoneAlphaTemplate(),
        makePreset({
          presetStations: [
            {
              zoneId: "alpha-1",
              stationId: "BIO-F",
              name: "Bloomreach",
              nationId: "bio",
              stationTypeId: "farm",
            },
            {
              zoneId: "alpha-2",
              stationId: "BIO-F",
              name: "Dewhollow",
              nationId: "bio",
              stationTypeId: "water-processing",
            },
          ],
        }),
      ),
    "BIO-F",
    "duplicate stationId",
  );
});

test("createMapFromTemplate splits zones between preset stations and empty stationZones", () => {
  const map = createMapFromTemplate(
    makeTwoZoneAlphaTemplate(),
    makePreset({
      presetStations: [
        {
          zoneId: "alpha-1",
          stationId: "HUB-1",
          name: "One",
          nationId: "hub",
          stationTypeId: "habitat",
        },
      ],
    }),
  );
  assertEqual(map.stations.length, 1, "one preset station");
  assertEqual(map.stationZones.length, 1, "one zone left empty");
  assertTrue(map.stationZones[0].id === "alpha-2", "remaining zone should be alpha-2");
});

test("createMapFromTemplate copies zoneId onto preset stations (save round-trip)", () => {
  const map = createMapFromTemplate(
    makeTwoZoneAlphaTemplate(),
    makePreset({
      presetStations: [
        {
          zoneId: "alpha-2",
          stationId: "BIO-1",
          name: "One",
          nationId: "bio",
          stationTypeId: "farm",
        },
      ],
    }),
  );
  assertEqual(map.stations[0].zoneId, "alpha-2", "station should carry zoneId alpha-2");
});

test("mapFromSnapshot seeds no preset stations and hides snapshot-occupied zones", () => {
  const map = mapFromSnapshot(
    makeTwoZoneAlphaTemplate(),
    makeSnapshot([makeStationSnapshot({ zoneId: "alpha-1" })]),
  );
  assertEqual(map.presetId, "settled", "preset breadcrumb comes from the snapshot");
  assertEqual(map.stations.length, 0, "snapshot restore installs stations after map creation");
  assertEqual(map.stationZones.length, 1, "one zone left empty");
  assertEqual(map.stationZones[0].id, "alpha-2", "snapshot-occupied zone is hidden");
});

test("filterZonesForOccupants hides zones occupied by zoneId-carrying stations", () => {
  const zones = [
    { id: "alpha-1", x: 100, y: 100, size: "M" as const },
    { id: "alpha-2", x: 200, y: 200, size: "L" as const },
    { id: "alpha-3", x: 300, y: 300, size: "S" as const },
  ];
  const filtered = filterZonesForOccupants(zones, [{ zoneId: "alpha-1" }, { zoneId: "alpha-3" }]);
  assertEqual(filtered.length, 1, "only alpha-2 should remain");
  assertEqual(filtered[0].id, "alpha-2", "filtered zone id");
});

test("filterZonesForOccupants leaves zones alone for zoneless stations (WAY generational ships)", () => {
  const zones = [
    { id: "alpha-1", x: 100, y: 100, size: "M" as const },
    { id: "alpha-2", x: 200, y: 200, size: "L" as const },
  ];
  const filtered = filterZonesForOccupants(zones, [{ zoneId: undefined }, { zoneId: undefined }]);
  // Match strictly on zoneId — a drifting station on a zone's coordinates
  // must not hide the zone.
  assertEqual(filtered.length, 2, "no zones should be hidden");
});

test("filterZonesForOccupants does nothing when there are no occupants", () => {
  const zones = [
    { id: "alpha-1", x: 100, y: 100, size: "M" as const },
    { id: "alpha-2", x: 200, y: 200, size: "L" as const },
  ];
  assertEqual(filterZonesForOccupants(zones, []).length, 2, "all zones pass through");
});

test("createMapFromTemplate derives sector x/y/size and grid extent from grid coords", () => {
  // Grid spans gridX [-1, 1] and gridY [0, 2] across three sectors.
  // The minimum grid coord shifts to map (0, 0); each sector center sits at
  // (column - minGridX) * sectorSize + sectorSize / 2 — same on Y.
  const template: MapTemplate = {
    sectors: [
      makeSectorTemplate({ id: "left", gridX: -1, gridY: 0 }),
      makeSectorTemplate({ id: "middle", gridX: 0, gridY: 1 }),
      makeSectorTemplate({ id: "right", gridX: 1, gridY: 2 }),
    ],
    nebulas: [],
    zones: [],
    sectorSize: 1000,
  };
  const map = createMapFromTemplate(template, makePreset());

  // Pin grid extent. `maxX - minX + 1` would collapse to 2 if the +1 were dropped.
  assertEqual(map.gridSizeX, 3, "gridSizeX = max - min + 1 across [-1, 1]");
  assertEqual(map.gridSizeY, 3, "gridSizeY = max - min + 1 across [0, 2]");

  const sectorById = new Map(map.sectors.map((sector) => [sector.id, sector]));
  // Pin sector center x/y. `sectorSize / 4` would put left at x=250 instead of 500.
  // Swapping computeSectorCenterX/Y args (gridY for x, gridX for y) would route middle to (1500, 500) instead of (500, 1500).
  const left = sectorById.get("left")!;
  const middle = sectorById.get("middle")!;
  const right = sectorById.get("right")!;
  assertEqual(left.x, 500, "leftmost sector center x at sectorSize/2");
  assertEqual(left.y, 500, "leftmost sector center y at sectorSize/2");
  assertEqual(middle.x, 1500, "middle sector x = (0 - -1) * 1000 + 500");
  assertEqual(middle.y, 1500, "middle sector y = (1 - 0) * 1000 + 500");
  assertEqual(right.x, 2500, "rightmost sector x = (1 - -1) * 1000 + 500");
  assertEqual(right.y, 2500, "rightmost sector y = (2 - 0) * 1000 + 500");
  // Pin sectorSize stamping. A missing template.sectorSize copy would leave the field undefined.
  assertEqual(left.size, 1000, "sector.size carries template.sectorSize");
});

function makeStationWithFoodSlot(stationId: string, slotMax: number): Station {
  const slot: InventorySlot = {
    ware: food,
    current: 0,
    max: slotMax,
    reservedIncoming: 0,
    reservedOutgoing: 0,
  };
  return makeStation({ placement: { id: stationId }, inventory: [slot] });
}

test("randomizeInitialInventory: stubbed random=0 fills every slot at floor(max × lowerBound)", () => {
  withScriptedMathRandom([0], () => {
    const stations = [
      makeStationWithFoodSlot("S1", 1000),
      makeStationWithFoodSlot("S2", 2000),
      makeStationWithFoodSlot("S3", 1500),
    ];
    randomizeInitialInventory(stations, {
      inventoryLowerBound: 0.2,
      inventoryUpperBound: 0.6,
    });
    assertEqual(stations[0].inventory[0].current, Math.floor(1000 * 0.2), "S1 lands at lowerBound × max");
    assertEqual(stations[1].inventory[0].current, Math.floor(2000 * 0.2), "S2 lands at lowerBound × max");
    assertEqual(stations[2].inventory[0].current, Math.floor(1500 * 0.2), "S3 lands at lowerBound × max");
  });
});

test("randomizeInitialInventory: stubbed random=1 fills every slot at floor(max × upperBound)", () => {
  withScriptedMathRandom([1], () => {
    const stations = [makeStationWithFoodSlot("S1", 1000), makeStationWithFoodSlot("S2", 2000)];
    randomizeInitialInventory(stations, {
      inventoryLowerBound: 0.2,
      inventoryUpperBound: 0.6,
    });
    assertEqual(stations[0].inventory[0].current, Math.floor(1000 * 0.6), "S1 lands at upperBound × max");
    assertEqual(stations[1].inventory[0].current, Math.floor(2000 * 0.6), "S2 lands at upperBound × max");
  });
});

test("randomizeInitialInventory: each slot depends only on its own max — no cross-station coordination", () => {
  // Guards removal of the old universe-wide scaling: a slot's current is now
  // purely floor(max × ratio), unaffected by other stations holding the same
  // ware. A tiny slot beside a huge one keeps its own independent fill.
  withScriptedMathRandom([0.5], () => {
    const small = makeStationWithFoodSlot("SMALL", 100);
    const huge = makeStationWithFoodSlot("HUGE", 100000);
    randomizeInitialInventory([small, huge], {
      inventoryLowerBound: 0.3,
      inventoryUpperBound: 0.5,
    });
    const ratio = 0.3 + 0.5 * (0.5 - 0.3); // lower + random × range = 0.4
    assertEqual(small.inventory[0].current, Math.floor(100 * ratio), "SMALL slot independent of HUGE");
    assertEqual(huge.inventory[0].current, Math.floor(100000 * ratio), "HUGE slot independent of SMALL");
  });
});
