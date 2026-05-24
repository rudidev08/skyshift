import { test, assertEqual, assertTrue, withScriptedMathRandom } from "./test-utils.ts";
import { NamePool, assignStationNames } from "../sim-name-pool.ts";
import type { NationTemplate } from "../../data/nation-types.ts";
import type { PlacedStation } from "../../data/station-types.ts";

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

function makeHabitatStation(overrides: Partial<PlacedStation> = {}): PlacedStation {
  return {
    id: "TST",
    x: 0,
    y: 0,
    nation: namingTestNation,
    stationTypeId: "habitat",
    size: "S",
    ...overrides,
  };
}

test("assignStationNames removes predefined map names from the remaining station pool", () => {
  withScriptedMathRandom([0], () => {
    const namePool = new NamePool();

    const stations: PlacedStation[] = [
      makeHabitatStation({ id: "TST-A", name: "Atlas" }),
      makeHabitatStation({ id: "TST-B", x: 10 }),
      makeHabitatStation({ id: "TST-C", x: 20 }),
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
  withScriptedMathRandom([0], () => {
    const namePool = new NamePool();

    // Five stations against a three-name pool — two must overflow into suffixes.
    const stations: PlacedStation[] = [
      makeHabitatStation({ id: "TST-1" }),
      makeHabitatStation({ id: "TST-2", x: 10 }),
      makeHabitatStation({ id: "TST-3", x: 20 }),
      makeHabitatStation({ id: "TST-4", x: 30 }),
      makeHabitatStation({ id: "TST-5", x: 40 }),
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
  // Reserve a name that's NOT in the pool. With the guard intact this does nothing;
  // without the guard, splice(-1, 1) drops the last shuffled name from the draw pile.
  namePool.reservePoolName(twoNamesNation.stationNames, "NotInPool");
  // Drain the pool — both predefined names must still be drawable.
  const draws = new Set<string>([
    namePool.claimStationName(twoNamesNation),
    namePool.claimStationName(twoNamesNation),
  ]);
  assertTrue(draws.has("Atlas"), "Atlas remains drawable after a reserve that changes nothing");
  assertTrue(draws.has("Beacon"), "Beacon remains drawable after a reserve that changes nothing");
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
