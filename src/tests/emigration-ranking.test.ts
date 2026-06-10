import { test, assertEqual, assertThrows, assertTrue } from "./test-utils.ts";
import { makeSector, makeStation } from "./factories.ts";
import {
  largestProximityCluster,
  rankStationsForEmigration,
} from "../sim-emigration-ranking.ts";
import type { GameMap, Sector } from "../sim-map-types.ts";
import type { Station } from "../sim-station-types.ts";

function fakeMap(sectors: Sector[]): GameMap {
  return { sectors, sectorSize: 1500 } as unknown as GameMap;
}

function positionedStation(id: string, x: number, y: number): Station {
  return makeStation({ placement: { id, name: id, x, y } });
}

function stationIds(stations: Station[]): string {
  return stations.map((station) => station.id).join(",");
}

test("largestProximityCluster picks the bigger group", () => {
  const originA = positionedStation("origin-a", 0, 0);
  const originB = positionedStation("origin-b", 40, 0);
  const originC = positionedStation("origin-c", 0, 40);
  const farA = positionedStation("far-a", 5000, 5000);
  const farB = positionedStation("far-b", 5060, 5000);

  const cluster = largestProximityCluster([originA, originB, originC, farA, farB], 100);
  const clusterIds = new Set(cluster.map((station) => station.id));

  assertEqual(cluster.length, 3, "larger origin cluster wins");
  assertTrue(clusterIds.has("origin-a"), "origin-a is in largest cluster");
  assertTrue(clusterIds.has("origin-b"), "origin-b is in largest cluster");
  assertTrue(clusterIds.has("origin-c"), "origin-c is in largest cluster");
});

test("largestProximityCluster is transitive", () => {
  const stationA = positionedStation("a", 0, 0);
  const stationB = positionedStation("b", 90, 0);
  const stationC = positionedStation("c", 180, 0);

  const cluster = largestProximityCluster([stationA, stationB, stationC], 100);

  assertEqual(cluster.length, 3, "A-B and B-C links collect A-B-C");
});

test("largestProximityCluster links a pair sitting at exactly maxDistance", () => {
  // Pin the inclusive `<= maxDistance` boundary in collectCluster. The pair is
  // exactly 100 apart with maxDistance 100. A `< maxDistance` mutation would
  // exclude the boundary, leaving two singleton clusters of length 1 instead of
  // one cluster of length 2.
  const onBoundaryA = positionedStation("on-a", 0, 0);
  const onBoundaryB = positionedStation("on-b", 100, 0);
  const lone = positionedStation("lone", 10000, 0);

  const cluster = largestProximityCluster([onBoundaryA, onBoundaryB, lone], 100);
  const clusterIds = new Set(cluster.map((station) => station.id));

  assertEqual(cluster.length, 2, "the exactly-maxDistance pair forms one cluster");
  assertTrue(clusterIds.has("on-a") && clusterIds.has("on-b"), "both boundary stations cluster together");
});

test("ore ranks farthest-from-Hearth first", () => {
  const map = fakeMap([makeSector({ id: "hearth", x: 5000, y: 5000 })]);
  const near = positionedStation("near", 5100, 5000);
  const middle = positionedStation("middle", 5500, 5000);
  const far = positionedStation("far", 5900, 5000);

  const ranked = rankStationsForEmigration("ore", [near, middle, far], [], map);

  assertEqual(stationIds(ranked), "far,middle,near", "ore ranks by distance from Hearth");
});

test("bio ranks farthest-from-midpoint first", () => {
  const map = fakeMap([
    makeSector({ id: "overgrowth", x: 0, y: 0 }),
    makeSector({ id: "green-silence", x: 0, y: 1000 }),
  ]);
  const near = positionedStation("near", 0, 600);
  const middle = positionedStation("middle", 0, 1000);
  const far = positionedStation("far", 0, 1400);

  const ranked = rankStationsForEmigration("bio", [near, middle, far], [], map);

  assertEqual(stationIds(ranked), "far,middle,near", "bio ranks by distance from landmark midpoint");
});

test("hub ranks the straggler first and excludes it from the center", () => {
  const coreA = positionedStation("core-a", 0, 0);
  const coreB = positionedStation("core-b", 100, 0);
  const coreC = positionedStation("core-c", 0, 100);
  const straggler = positionedStation("straggler", 7000, 0);
  const stations = [coreA, coreB, coreC, straggler];

  const ranked = rankStationsForEmigration("hub", stations, stations, fakeMap([]));

  assertEqual(ranked[0].id, "straggler", "HUB straggler is farthest from core centroid");
});

test("far ranks the closest-paired station first", () => {
  const closeA = positionedStation("close-a", 0, 0);
  const closeB = positionedStation("close-b", 50, 0);
  const farA = positionedStation("far-a", 3000, 0);
  const farB = positionedStation("far-b", 7000, 0);
  const stations = [farA, closeA, farB, closeB];

  const ranked = rankStationsForEmigration("far", stations, stations, fakeMap([]));

  assertTrue(
    ranked[0].id === "close-a" || ranked[0].id === "close-b",
    "one of the closest-paired FAR stations ranks first",
  );
});

test("sky ranks non-deep-space stations first", () => {
  const map = fakeMap([
    makeSector({ id: "deep", x: 0, y: 0, size: 1000, environment: "deep-space" }),
    makeSector({ id: "frontier", x: 2000, y: 0, size: 1000, environment: "frontier" }),
  ]);
  const deepA = positionedStation("deep-a", 0, 0);
  const deepB = positionedStation("deep-b", 100, 0);
  const frontierA = positionedStation("frontier-a", 2000, 0);
  const frontierB = positionedStation("frontier-b", 2100, 0);

  const ranked = rankStationsForEmigration(
    "sky",
    [deepA, frontierA, deepB, frontierB],
    [],
    map,
  );

  assertEqual(
    stationIds(ranked.slice(0, 2)),
    "frontier-a,frontier-b",
    "frontier stations rank ahead of deep-space stations",
  );
});

test("rankStationsForEmigration throws for a nation without a registered ranking", () => {
  const map = fakeMap([makeSector({ id: "deep", x: 0, y: 0, size: 1000, environment: "deep-space" })]);

  assertThrows(
    () => rankStationsForEmigration("ghost", [], [], map),
    "No emigration ranking for nation ghost",
    "an unregistered participating nation fails loudly, not with a bare TypeError",
  );
});
