import { test, assertTrue, assertEqual } from "./test-utils.ts";
import { makeSector, makeStation } from "./factories.ts";
import {
  sectorScorerByNation,
  minDistanceToOwnStations,
  type SectorScorerContext,
} from "../sim-nation-personality.ts";
import { hubNation, bioNation, oreNation, skyNation, farNation } from "../../data/nations.ts";
import type { NationTemplate } from "../../data/nation-types.ts";
import type { Sector } from "../sim-map-types.ts";
import type { StationZone } from "../sim-station-zone-types.ts";
import type { Station } from "../sim-station-types.ts";

// Pins src/sim-nation-personality.ts. Each test sets up 2 existing stations of the
// nation plus 3 empty zones (one per sector) and asserts the SCORE ORDERING the
// file's design-intent header promises — exact scores aren't asserted. The
// nation-manager (src/sim-nation-manager.ts) sorts sectors by these scores and
// builds in the winner, so a wrong ordering would silently misplace expansion.

// Large enough that every fixture distance normalizes well inside [0, 1), so the
// 0-or-1 environment bonus and the nearest-own factor never overlap.
const MAP_MAX_DISTANCE = 100_000;

function makeZone(sector: Sector): StationZone {
  return {
    id: `${sector.id}-1`,
    x: sector.x,
    y: sector.y,
    size: "M",
    sector,
    name: `Zone ${sector.id}`,
    nameSuffix: "Alpha",
    code: `${sector.id}-1`,
  };
}

// Two stations clustered near the origin; the nearer of the two sits at (300, 0),
// so a sector on the +x axis at center cx has min-distance |cx - 300|.
function ownStationsNearOrigin(nation: NationTemplate): Station[] {
  return [
    makeStation({ placement: { id: "OWN-1", x: 0, y: 0, nation } }),
    makeStation({ placement: { id: "OWN-2", x: 300, y: 0, nation } }),
  ];
}

function makeContext(
  args: Omit<SectorScorerContext, "mapMaxDistance" | "tieBreak"> & { tieBreak?: number },
): SectorScorerContext {
  return { ...args, mapMaxDistance: MAP_MAX_DISTANCE, tieBreak: args.tieBreak ?? 0 };
}

test("HUB scores nearest-to-own highest: near > mid > far", () => {
  // Three core sectors (all host "habitat") strung out along +x at increasing
  // distance from the clustered own stations.
  const near = makeSector({ id: "near", x: 1_000, y: 0, environment: "core" });
  const mid = makeSector({ id: "mid", x: 5_000, y: 0, environment: "core" });
  const far = makeSector({ id: "far", x: 9_000, y: 0, environment: "core" });
  const zones = [makeZone(near), makeZone(mid), makeZone(far)];
  const ownStations = ownStationsNearOrigin(hubNation);

  const score = (sector: Sector) =>
    sectorScorerByNation.hub(
      makeContext({ nation: hubNation, sector, chosenTypeId: "habitat", ownStations, candidateZones: zones }),
    );
  const scoreNear = score(near);
  const scoreMid = score(mid);
  const scoreFar = score(far);

  assertTrue(scoreNear > scoreMid, `HUB: near (${scoreNear}) should beat mid (${scoreMid})`);
  assertTrue(scoreMid > scoreFar, `HUB: mid (${scoreMid}) should beat far (${scoreFar})`);
});

test("FAR scores farthest-from-own highest: far > mid > near", () => {
  // Same three core sectors; FAR inverts HUB's preference.
  const near = makeSector({ id: "near", x: 1_000, y: 0, environment: "core" });
  const mid = makeSector({ id: "mid", x: 5_000, y: 0, environment: "core" });
  const far = makeSector({ id: "far", x: 9_000, y: 0, environment: "core" });
  const zones = [makeZone(near), makeZone(mid), makeZone(far)];
  const ownStations = ownStationsNearOrigin(farNation);

  const score = (sector: Sector) =>
    sectorScorerByNation.far(
      makeContext({ nation: farNation, sector, chosenTypeId: "habitat", ownStations, candidateZones: zones }),
    );
  const scoreNear = score(near);
  const scoreMid = score(mid);
  const scoreFar = score(far);

  assertTrue(scoreFar > scoreMid, `FAR: far (${scoreFar}) should beat mid (${scoreMid})`);
  assertTrue(scoreMid > scoreNear, `FAR: mid (${scoreMid}) should beat near (${scoreNear})`);
});

test("BIO: a bio-nebula sector beats nearer non-bio sectors; non-bio tiebreak is nearest-own", () => {
  // The bio sector is the FARTHEST from own stations — the environment bonus must
  // still outrank the two nearer core sectors. Among the core pair, nearer wins.
  const bioFar = makeSector({ id: "bio-far", x: 9_000, y: 0, environment: "bio-nebula" });
  const coreNear = makeSector({ id: "core-near", x: 1_000, y: 0, environment: "core" });
  const coreMid = makeSector({ id: "core-mid", x: 5_000, y: 0, environment: "core" });
  const zones = [makeZone(bioFar), makeZone(coreNear), makeZone(coreMid)];
  const ownStations = ownStationsNearOrigin(bioNation);

  const score = (sector: Sector) =>
    sectorScorerByNation.bio(
      makeContext({ nation: bioNation, sector, chosenTypeId: "habitat", ownStations, candidateZones: zones }),
    );
  const scoreBioFar = score(bioFar);
  const scoreCoreNear = score(coreNear);
  const scoreCoreMid = score(coreMid);

  assertTrue(
    scoreBioFar > scoreCoreNear,
    `BIO: far bio-nebula (${scoreBioFar}) should beat nearer core (${scoreCoreNear})`,
  );
  assertTrue(
    scoreCoreNear > scoreCoreMid,
    `BIO: among non-bio, nearer core (${scoreCoreNear}) should beat farther core (${scoreCoreMid})`,
  );
});

test("ORE: a mineral-rich sector beats nearer non-ore sectors; non-ore tiebreak is nearest-own", () => {
  const oreFar = makeSector({ id: "ore-far", x: 9_000, y: 0, environment: "mineral-rich" });
  const coreNear = makeSector({ id: "core-near", x: 1_000, y: 0, environment: "core" });
  const coreMid = makeSector({ id: "core-mid", x: 5_000, y: 0, environment: "core" });
  const zones = [makeZone(oreFar), makeZone(coreNear), makeZone(coreMid)];
  const ownStations = ownStationsNearOrigin(oreNation);

  const score = (sector: Sector) =>
    sectorScorerByNation.ore(
      makeContext({ nation: oreNation, sector, chosenTypeId: "habitat", ownStations, candidateZones: zones }),
    );
  const scoreOreFar = score(oreFar);
  const scoreCoreNear = score(coreNear);
  const scoreCoreMid = score(coreMid);

  assertTrue(
    scoreOreFar > scoreCoreNear,
    `ORE: far mineral-rich (${scoreOreFar}) should beat nearer core (${scoreCoreNear})`,
  );
  assertTrue(
    scoreCoreNear > scoreCoreMid,
    `ORE: among non-ore, nearer core (${scoreCoreNear}) should beat farther core (${scoreCoreMid})`,
  );
});

test("SKY: deep-space wins regardless of tiebreak; non-deep-space ordered by tiebreak, not distance", () => {
  // observatory is hostable in both deep-space and frontier. frontierFar is the
  // farthest sector and frontierNear the closest — if SKY used a nearest-own
  // factor, frontierNear would win. It must not: only the random tiebreak orders
  // non-deep-space sectors.
  const deepSpace = makeSector({ id: "deep", x: 5_000, y: 0, environment: "deep-space" });
  const frontierFar = makeSector({ id: "front-far", x: 9_000, y: 0, environment: "frontier" });
  const frontierNear = makeSector({ id: "front-near", x: 1_000, y: 0, environment: "frontier" });
  const zones = [makeZone(deepSpace), makeZone(frontierFar), makeZone(frontierNear)];
  const ownStations = ownStationsNearOrigin(skyNation);

  const score = (sector: Sector, tieBreak: number) =>
    sectorScorerByNation.sky(
      makeContext({
        nation: skyNation,
        sector,
        chosenTypeId: "observatory",
        ownStations,
        candidateZones: zones,
        tieBreak,
      }),
    );

  // Worst-case tiebreak for deep-space (0) vs best-case for the non-match (→1):
  // the environment bonus must still carry deep-space over the top.
  const scoreDeep = score(deepSpace, 0);
  const scoreFrontierFar = score(frontierFar, 0.9);
  const scoreFrontierNear = score(frontierNear, 0.3);

  assertTrue(
    scoreDeep > scoreFrontierFar,
    `SKY: deep-space @tieBreak=0 (${scoreDeep}) should beat frontier @tieBreak=0.9 (${scoreFrontierFar})`,
  );
  assertTrue(
    scoreFrontierFar > scoreFrontierNear,
    `SKY: far frontier @tieBreak=0.9 (${scoreFrontierFar}) should beat near frontier @tieBreak=0.3 ` +
      `(${scoreFrontierNear}) — distance is ignored, only tiebreak orders non-deep-space`,
  );
});

test("Eligibility gate: a sector whose zones can't host the chosen type scores -Infinity", () => {
  // candidateZones spans both sectors. "mine" is hostable in mineral-rich but not
  // deep-space — the per-sector filter must keep the mineral-rich zone from
  // rescuing the deep-space sector. The nation-manager drops -Infinity sectors.
  const deepSpace = makeSector({ id: "deep", x: 1_000, y: 0, environment: "deep-space" });
  const mineralRich = makeSector({ id: "ore", x: 2_000, y: 0, environment: "mineral-rich" });
  const zones = [makeZone(deepSpace), makeZone(mineralRich)];
  const ownStations = ownStationsNearOrigin(hubNation);

  const scoreDeep = sectorScorerByNation.hub(
    makeContext({ nation: hubNation, sector: deepSpace, chosenTypeId: "mine", ownStations, candidateZones: zones }),
  );
  const scoreMineral = sectorScorerByNation.hub(
    makeContext({ nation: hubNation, sector: mineralRich, chosenTypeId: "mine", ownStations, candidateZones: zones }),
  );

  assertEqual(scoreDeep, -Infinity, "deep-space can't host 'mine' → -Infinity");
  assertTrue(
    Number.isFinite(scoreMineral),
    `mineral-rich can host 'mine' → finite score, got ${scoreMineral}`,
  );
});

test("minDistanceToOwnStations: 0 for the nation's first build, else the nearest station", () => {
  // The scorers' nearest-own factor builds on this helper. Its first call for a
  // nation has no own stations yet (documented zero branch).
  const sector = makeSector({ id: "s", x: 1_000, y: 0 });
  assertEqual(minDistanceToOwnStations(sector, []), 0, "no own stations → 0");

  const ownStations = ownStationsNearOrigin(hubNation);
  // Nearest of {(0,0), (300,0)} to (1000,0) is (300,0) → 700.
  assertEqual(minDistanceToOwnStations(sector, ownStations), 700, "nearest own station distance");
});
