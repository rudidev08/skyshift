import { test, assertEqual, assertTrue, assertThrows } from "./test-utils.ts";
import {
  randomizeInitialInventory,
  createMapFromTemplate,
  filterZonesForOccupants,
  mapFromSnapshot,
} from "../sim-map-create.ts";
import type { MapTemplate, MapPreset } from "../../data/map-types.ts";
import { makeSectorTemplate, makeStation } from "./factories.ts";
import { NamePool, assignStationNames } from "../sim-name-pool.ts";
import type { NationTemplate } from "../../data/nation-types.ts";
import type { PlacedStation } from "../../data/station-types.ts";
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
    savedAt: 1,
    simulationTick: 0,
    presetId: "settled",
    stations,
    ships: [],
    tradeShips: [],
    nationManager: [],
    emigrationManager: {
      activeEvent: null,
      activeGenerationalShipId: null,
      mode: "manual",
      intensity: "medium",
      usedDestinations: [],
      nextGenerationalShipArrivalAt: null,
      clockSeconds: 0,
      nextGenerationalShipCounter: 0,
      nextEmigrantShipCounter: 0,
      nextEventCounter: 0,
    },
    tradeManager: { tradeTime: 0, scheduledTimers: [] },
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

test("filterZonesForOccupants is a no-op when there are no occupants", () => {
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
  // Swapping getSectorCenter args (gridY for x, gridX for y) would route middle to (1500, 500) instead of (500, 1500).
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

const namingTestNation: NationTemplate = {
  id: "test-nation",
  codeName: "TST",
  shortName: "Test",
  name: "Test Nation",
  color: "#000000",
  lore: "Test nation for map object naming.",
  namingStyle: "Test names",
  shipTypeId: null,
  buildableStationTypeIds: ["habitat"],
  primaryBuildableStationTypeId: "habitat",
  stationNames: ["Atlas", "Beacon", "Compass"],
  shipNames: [],
  nameSuffixes: ["I", "II", "III"],
  desire: { verb: "tests", object: "things" },
  buildsStations: false,
  participatesInEmigration: false,
  stationConstructionShipTypeId: null,
};

function withStubbedMathRandom(stubReturnValue: number, body: () => void) {
  const originalRandom = Math.random;
  Math.random = () => stubReturnValue;
  try {
    body();
  } finally {
    Math.random = originalRandom;
  }
}

test("assignStationNames removes predefined map names from the remaining station pool", () => {
  withStubbedMathRandom(0, () => {
    const namePool = new NamePool();

    const stations: PlacedStation[] = [
      {
        id: "TST-A",
        name: "Atlas",
        x: 0,
        y: 0,
        nation: namingTestNation,
        stationTypeId: "habitat",
        size: "S",
      },
      { id: "TST-B", x: 10, y: 0, nation: namingTestNation, stationTypeId: "habitat", size: "S" },
      { id: "TST-C", x: 20, y: 0, nation: namingTestNation, stationTypeId: "habitat", size: "S" },
    ];

    assignStationNames(namePool, stations);

    const assignedNames = new Set(stations.map((station) => station.name));
    assertEqual(assignedNames.size, 3, "unique resolved station names");
    assertTrue(assignedNames.has("Atlas"), "predefined map name should stay unchanged");
    assertTrue(assignedNames.has("Beacon"), "unused pool name should still be assigned");
    assertTrue(assignedNames.has("Compass"), "unused pool name should still be assigned");
  });
});

test("assignStationNames assigns suffixes once a name is reused beyond the pool", () => {
  withStubbedMathRandom(0, () => {
    const namePool = new NamePool();

    // Five stations against a three-name pool — two must overflow into suffixes.
    const stations: PlacedStation[] = [
      { id: "TST-1", x: 0, y: 0, nation: namingTestNation, stationTypeId: "habitat", size: "S" },
      { id: "TST-2", x: 10, y: 0, nation: namingTestNation, stationTypeId: "habitat", size: "S" },
      { id: "TST-3", x: 20, y: 0, nation: namingTestNation, stationTypeId: "habitat", size: "S" },
      { id: "TST-4", x: 30, y: 0, nation: namingTestNation, stationTypeId: "habitat", size: "S" },
      { id: "TST-5", x: 40, y: 0, nation: namingTestNation, stationTypeId: "habitat", size: "S" },
    ];

    assignStationNames(namePool, stations);

    const assignedNames = new Set(stations.map((station) => station.name));
    assertEqual(assignedNames.size, 5, "every reused name draws a unique suffix");
    // Suffix pool is "I", "II", "III" — first reuse takes "I".
    const reusedWithSuffix = stations.map((station) => station.name).filter((name) => name?.endsWith(" I"));
    assertTrue(reusedWithSuffix.length >= 1, "at least one reused name should carry the first suffix");
  });
});

test("NamePool.claimName remembers the original claimant nation for later suffixing without one", () => {
  // Pin the nameNation lookup. The first claim records the nation; a later
  // claim without a nation argument must still get nation-flavored suffixes.
  // Skipping the `nameNation.set` side effect would fall through to
  // `suffixes = []`, dropping straight to the numeric "Atlas 2" fallback.
  const namePool = new NamePool();
  namePool.claimName("Atlas", namingTestNation);
  assertEqual(
    namePool.claimName("Atlas"),
    "Atlas I",
    "second claim with no nation reuses recorded nation's suffixes",
  );
});

test("NamePool.claimName lets a later nation argument override the recorded original claimant", () => {
  // Pin precedence: when both the nation argument AND a recorded original claimant
  // are present, the nation argument wins (`nation ?? nameNation.get`). Swapping
  // the nullish-coalesce order to `nameNation.get(baseName) ?? nation` would
  // route the second claim through the recorded nation's suffixes instead.
  const otherNation: NationTemplate = {
    ...namingTestNation,
    id: "other",
    nameSuffixes: ["Prime", "Secundus"],
  };
  const namePool = new NamePool();
  namePool.claimName("Atlas", namingTestNation);
  assertEqual(
    namePool.claimName("Atlas", otherNation),
    "Atlas Prime",
    "explicit nation argument selects its own suffix pool",
  );
});

test("NamePool.claimStationName returns 'Unknown' when the nation's pool is empty", () => {
  // Pin the empty-pool guard. `pool.length === 1` (off-by-one boundary) would
  // skip the early return for a real empty pool and fall into `remaining.pop()`
  // on an empty array, yielding `undefined` as the base name.
  const namePoolForEmptyNation = new NamePool();
  const emptyPoolNation: NationTemplate = { ...namingTestNation, stationNames: [] };
  assertEqual(
    namePoolForEmptyNation.claimStationName(emptyPoolNation),
    "Unknown",
    "empty pool falls back to 'Unknown'",
  );
});

test("NamePool.reservePoolName leaves the pool intact when the name isn't in it", () => {
  // Pin the lastIndexOf !== -1 guard. reservePoolName is called by
  // assignStationNames for every predefined station.name; if a placement carries
  // a name that isn't in the nation's stationNames pool (typo, or carried over
  // from another nation), the guard prevents splice(-1, 1) from silently trimming
  // the LAST entry of the draw pile instead of bailing out.
  const namePool = new NamePool();
  // Build a nation with a tiny pool we can fully drain to observe pool-state changes.
  const twoNamesNation: NationTemplate = { ...namingTestNation, stationNames: ["Atlas", "Beacon"] };
  // Reserve a name that's NOT in the pool. With the guard intact this is a no-op;
  // without the guard, splice(-1, 1) drops the last shuffled name from the draw pile.
  namePool.reservePoolName(twoNamesNation.stationNames, "NotInPool");
  // Drain the pool — both predefined names must still be drawable.
  const draws = new Set<string>([
    namePool.claimStationName(twoNamesNation),
    namePool.claimStationName(twoNamesNation),
  ]);
  assertTrue(draws.has("Atlas"), "Atlas remains drawable after a no-op reserve");
  assertTrue(draws.has("Beacon"), "Beacon remains drawable after a no-op reserve");
});

test("NamePool.claimName falls back to numeric suffix once the suffix pool is exhausted", () => {
  // Drive the numeric fallback directly through the API — no shuffle-order
  // dependency. nameSuffixes is ["I", "II", "III"]; the 5th claim of the same
  // base name (count=4, suffixIndex=3 ≥ suffixes.length=3) falls back to
  // String(count + 1) = "5". A `count` vs `count + 1` slip would print "Atlas 4".
  const namePool = new NamePool();
  assertEqual(namePool.claimName("Atlas", namingTestNation), "Atlas", "1st claim is the bare base name");
  assertEqual(namePool.claimName("Atlas", namingTestNation), "Atlas I", "2nd claim takes the first suffix");
  assertEqual(namePool.claimName("Atlas", namingTestNation), "Atlas II", "3rd claim takes the second suffix");
  assertEqual(
    namePool.claimName("Atlas", namingTestNation),
    "Atlas III",
    "4th claim takes the third (last) suffix",
  );
  assertEqual(
    namePool.claimName("Atlas", namingTestNation),
    "Atlas 5",
    "5th claim falls back to String(count + 1)",
  );
  // Guard against the suffix pool returning undefined past exhaustion —
  // template literal would silently render " undefined" instead of a number.
  const sixthClaim = namePool.claimName("Atlas", namingTestNation);
  assertTrue(
    !sixthClaim.endsWith("undefined"),
    `numeric fallback should not produce 'undefined' suffix, got ${sixthClaim}`,
  );
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
  withStubbedMathRandom(0, () => {
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
  withStubbedMathRandom(1, () => {
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
  withStubbedMathRandom(0.5, () => {
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
