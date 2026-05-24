import { test, assertEqual, assertTrue, withScriptedMathRandom } from "./test-utils.ts";
import {
  selectStationsForEmigration,
  countEligibleStations,
  emptyZoneCount,
  drawAndRecordDestination,
} from "../sim-emigration-decision.ts";
import { hubNation, bioNation, oreNation } from "../../data/nations.ts";
import { createStation } from "../sim-station.ts";
import type { PlacedStation, StationState, StationTypeId } from "../../data/station-types.ts";
import type { Station } from "../sim-station-types.ts";
import type { NationTemplate } from "../../data/nation-types.ts";
import type { GameMap } from "../sim-map-types.ts";
import type { StationManager } from "../sim-station-manager.ts";
import { makeSector } from "./factories.ts";

// Pins emigration decision logic (sim-emigration-decision.ts). Wrong picks
// silently wipe the wrong stations; off-by-one in eligibility guards strands
// a nation in a state the player can't recover from.

function fakeStationManager(stations: Station[]): StationManager {
  return {
    getStations: () => stations,
    getStationsForNation: (nationId: string) =>
      stations.filter((station) => station.nation.id === nationId),
  } as unknown as StationManager;
}

function fakeMap(): GameMap {
  // Sectors the per-nation ranking reads: ore -> hearth, bio -> overgrowth +
  // green-silence. sectorSize feeds the HUB cluster threshold. Most existing
  // test stations sit at (0,0), so distances are uniform and those assertions
  // (counts, guards) do not depend on ranking order.
  return {
    sectors: [
      makeSector({ id: "hearth", x: 5000, y: 5000 }),
      makeSector({ id: "overgrowth", x: 0, y: 0 }),
      makeSector({ id: "green-silence", x: 0, y: 1000 }),
    ],
    sectorSize: 1500,
  } as unknown as GameMap;
}

function makeStation(
  id: string,
  nation: NationTemplate,
  stationTypeId: StationTypeId,
  state: StationState = "producing",
): Station {
  // Uses real createStation so stationType.id matches stationTypeId — needed
  // because the eligibility checks key off candidate.stationType.id, and the
  // shared makeStation factory hardcodes that field to "mine".
  const placement: PlacedStation = {
    id,
    name: id,
    x: 0,
    y: 0,
    nation,
    stationTypeId,
    size: "M",
    state,
    ...(state === "building" && { build: { waresRequired: { provisions: 100, hulls: 100 } } }),
  };
  return createStation(placement, 0);
}

function bioFarm(index: string): Station {
  return makeStation(`BIO-F${index}`, bioNation, "farm");
}

function bioHabitat(index: string): Station {
  return makeStation(`BIO-H${index}`, bioNation, "habitat");
}

function bioMedicalLab(index: string): Station {
  return makeStation(`BIO-L${index}`, bioNation, "medical-lab");
}

function hubHabitat(index: string): Station {
  return makeStation(`HUB-H${index}`, hubNation, "habitat");
}

function hubTechFactory(index: string): Station {
  return makeStation(`HUB-T${index}`, hubNation, "tech-factory");
}

function oreMine(index: string): Station {
  return makeStation(`ORE-M${index}`, oreNation, "mine");
}

function oreMineAtDistance(index: string, distanceFromHearth: number): Station {
  const station = oreMine(index);
  station.x = 5000 + distanceFromHearth;
  station.y = 5000;
  return station;
}

function makeZonedStation(id: string, zoneId: string | undefined): Station {
  return createStation(
    { id, name: id, x: 0, y: 0, nation: bioNation, stationTypeId: "habitat", size: "M", zoneId },
    0,
  );
}

test("eligibility skips a station that would violate G1 (universe's last producer of its type)", () => {
  // Universe holds exactly one farm (BIO-F1), plus extra BIO stations so G2
  // doesn't also block the test. The lone farm must NOT be eligible — losing
  // it would leave the universe with no farm at all.
  const stations: Station[] = [
    bioFarm("1"),
    bioHabitat("1"),
    bioHabitat("2"),
    bioHabitat("3"),
    bioMedicalLab("1"),
    bioMedicalLab("2"),
  ];
  const stationManager = fakeStationManager(stations);
  // countEligibleStations runs the same G1+G2 filter as selectStationsForEmigration.
  const eligible = countEligibleStations(stationManager);

  // BIO-F1 is excluded by G1; the 5 non-farm BIO stations are all eligible
  // (none are last of their type within BIO, and habitat/medical-lab have
  // multiple universe producers each here).
  assertEqual(eligible, 5, "G1 excludes the universe-last farm; the 5 others are eligible");
});

test("G2 blocks the last-copy primary even when G1 wouldn't (peer of same type lives in unprocessed nation)", () => {
  // Pin the `primaryCount <= 1` boundary. Mutating to `< 1` would let the
  // last-copy primary slip through G2; G1 wouldn't trip because ORE-G (a
  // producing farm in ORE) hasn't been picked yet during BIO's iteration.
  // Without `<=`, BIO-F1 ends up selected and ORE-G doesn't.
  const stations: Station[] = [
    bioFarm("1"), // BIO's only farm; BIO primary is "farm"
    bioHabitat("1"), // BIO has another type so it isn't all-primary
    makeStation("ORE-G", oreNation, "farm"), // ORE farm — non-primary for ORE (primary=mine), so G2 doesn't block ORE-G
    oreMine("1"),
    oreMine("2"), // ORE primary — count >=2 so G2 doesn't block these
  ];
  const stationManager = fakeStationManager(stations);
  withScriptedMathRandom([0], () => {
    const result = selectStationsForEmigration(stationManager, "high", fakeMap());
    // Selected stations: ORE-G is the only one that survives both guards.
    // BIO-F1 is blocked by G2 (last BIO farm). ORE-mines survive (G2 primaryCount=2).
    // Pin: BIO-F1 must NOT appear in selected.
    const selectedIds = new Set(result.selected.map((station) => station.id));
    assertTrue(!selectedIds.has("BIO-F1"), "G2 blocks BIO-F1 (nation's primary, last copy)");
  });
});

test("eligibility skips a station that would violate G2 (nation's primary type, last copy in nation)", () => {
  // BIO has farm as primary. With one BIO farm, plus universe-second farm
  // owned by HUB to neutralize G1, G2 alone must exclude the BIO farm.
  // HUB iterates first (allNations order). HUB-G is a farm — not HUB's primary
  // (tech-factory) — so G2 doesn't apply, and G1's universe count is 2 (BIO-F1,
  // HUB-G), so HUB-G is eligible. The walkthrough below traces the full math.
  const stations: Station[] = [
    bioFarm("1"),
    bioHabitat("1"),
    bioHabitat("2"),
    bioMedicalLab("1"),
    bioMedicalLab("2"),
    // HUB-G is a farm to give the universe a second farm (G1 won't trip on BIO-F1).
    // Two HUB tech-factories so HUB has primary stations beyond HUB-G.
    makeStation("HUB-G", hubNation, "farm"),
    makeStation("HUB-T1", hubNation, "tech-factory"),
    makeStation("HUB-T2", hubNation, "tech-factory"),
  ];
  const stationManager = fakeStationManager(stations);
  const eligible = countEligibleStations(stationManager);

  // HUB iterates first (picked=[]). HUB-G: not HUB primary (tech-factory),
  // skip G2. G1: 2 farms universe-wide, 0 picked. Don't trip. Eligible.
  // HUB-T1, HUB-T2: primary, primaryCount=2, don't trip. G1: 2 tech-factories.
  // Don't trip. Eligible. HUB eligible = 3. picked = [HUB-G, HUB-T1, HUB-T2].
  //
  // BIO iterates (picked=3 HUB). BIO-F1: primary, primaryCount=1 (BIO-F1 only).
  // 1≤1 → G2 TRIPS. EXCLUDED. The other 4 BIO stations check G1:
  //   BIO-H1: count habitats universe-wide not picked = 2 (BIO-H1, BIO-H2). >1. Eligible.
  //   BIO-H2: same. Eligible.
  //   BIO-L1: count medical-labs not picked = 2. Eligible.
  //   BIO-L2: same. Eligible.
  // BIO eligible = 4.
  // Total = 3 (HUB) + 4 (BIO) = 7.
  assertEqual(eligible, 7, "G2 alone blocks BIO-F1 (primary, last copy); 7 others eligible");
});

test("eligibility passes when each nation has multiple stations of every type", () => {
  // 3 of each type per nation — so even after the cascade (each nation's
  // eligible-set rolls into alreadyPicked for the next), the next nation's
  // candidates still see plenty of universe producers.
  const stations: Station[] = [
    // BIO: 3 farms (primary), 3 habitats, 3 medical-labs
    bioFarm("1"),
    bioFarm("2"),
    bioFarm("3"),
    bioHabitat("1"),
    bioHabitat("2"),
    bioHabitat("3"),
    bioMedicalLab("1"),
    bioMedicalLab("2"),
    bioMedicalLab("3"),
    // HUB: 3 habitats, 3 tech-factories (primary)
    hubHabitat("1"),
    hubHabitat("2"),
    hubHabitat("3"),
    hubTechFactory("1"),
    hubTechFactory("2"),
    hubTechFactory("3"),
    // ORE: 3 mines (primary)
    oreMine("1"),
    oreMine("2"),
    oreMine("3"),
  ];
  const stationManager = fakeStationManager(stations);
  const eligible = countEligibleStations(stationManager);
  // Every station eligible: G2 primaryCount=3 (>1) for primary types, G1
  // count remains ≥1 even after the cascade because each type has multiple
  // producers within at least one nation.
  assertEqual(eligible, 18, "with 3-of-each-type per nation, all 18 stations are eligible");
});

test("eligibility skips building/emigrating stations (only producing counts)", () => {
  // isStationProducing returns true only for state==="producing". Other states
  // must be filtered out before G1/G2 ever get a chance to apply.
  const buildingHabitat = makeStation("BIO-H-B", bioNation, "habitat", "building");
  const emigratingMedical = makeStation("BIO-L-E", bioNation, "medical-lab", "emigrating");

  const stations: Station[] = [
    bioFarm("1"),
    bioFarm("2"),
    buildingHabitat,
    emigratingMedical,
    bioHabitat("1"),
    bioHabitat("2"),
    bioMedicalLab("1"),
    bioMedicalLab("2"),
  ];
  const stationManager = fakeStationManager(stations);
  const eligible = countEligibleStations(stationManager);
  // 6 producing stations (2 farms, 2 habitats, 2 medical-labs). G2 checks
  // `primaryCount <= 1` against the remaining (non-picked) primaries — with
  // 2 farms total and the candidate not-yet-picked, primaryCount=2, so G2
  // doesn't trip. All 6 producing stations stay eligible.
  assertEqual(eligible, 6, "building/emigrating excluded; 6 producing stations remain eligible");
});

test("selectStationsForEmigration: G1 holds when one nation has 2+ of a sparse type (per-pick recheck regression)", () => {
  // Pin the per-pick G1 recheck. Pre-fix, eligibleStationsForNation took a
  // snapshot of G1 once at the start of each nation's iteration, and the
  // pick loop committed up to `count` stations from that snapshot
  // without re-checking. With 5 medical-labs total — 3 in BIO + 2 in ORE — and
  // high intensity, ORE's iteration could pick BOTH of its medical-labs in one
  // go (snapshot said both were eligible because count=2 > 1 at iter start),
  // wiping the type universe-wide. The post-fix recheck blocks the second ORE
  // pick once the first drops universe count to 1.
  const stations: Station[] = [
    // HUB filler so HUB iterates first and burns picks unrelated to medical-labs.
    makeStation("HUB-T1", hubNation, "tech-factory"),
    makeStation("HUB-T2", hubNation, "tech-factory"),
    makeStation("HUB-T3", hubNation, "tech-factory"),
    makeStation("HUB-W1", hubNation, "water-processing"),
    makeStation("HUB-W2", hubNation, "water-processing"),
    // BIO: 3 medical-labs + filler so BIO's eligible list is large enough that
    // round(0.75 * eligible.length) covers all 3 medical-labs in some pick orders.
    bioFarm("1"),
    bioFarm("2"),
    bioMedicalLab("1"),
    bioMedicalLab("2"),
    bioMedicalLab("3"),
    makeStation("BIO-W1", bioNation, "water-processing"),
    makeStation("BIO-W2", bioNation, "water-processing"),
    // ORE: 2 medical-labs + filler. The bug surfaces here — pre-fix, both ORE
    // medical-labs end up in eligible at snapshot time and both get picked.
    oreMine("1"),
    oreMine("2"),
    oreMine("3"),
    makeStation("ORE-L1", oreNation, "medical-lab"),
    makeStation("ORE-L2", oreNation, "medical-lab"),
  ];
  const stationManager = fakeStationManager(stations);
  // Run many trials so the random rolls cover the bug-prone orderings.
  // The rule must hold for every roll sequence, not statistically.
  for (let trial = 0; trial < 200; trial++) {
    const { selected } = selectStationsForEmigration(stationManager, "high", fakeMap());
    const pickedMedicalLabs = selected.filter((station) => station.stationType.id === "medical-lab").length;
    assertTrue(
      pickedMedicalLabs <= 4,
      `trial ${trial}: G1 violated — ${pickedMedicalLabs} of 5 medical-labs picked, leaves ${5 - pickedMedicalLabs} producing`,
    );
  }
});

test("selectStationsForEmigration: G2 holds when a nation has 3+ of its primary type (per-pick recheck regression)", () => {
  // Mirror of the G1 test, but for G2. Pre-fix, HUB's snapshot eligible list
  // at iteration start contained all 3 of its tech-factories (HUB primary;
  // primaryCount=3 doesn't trip G2 at snapshot time). The fraction-pick loop
  // then committed all 3 without rechecking, leaving HUB with 0 tech-factories.
  // The post-fix recheck blocks the third pick once nationPrimaryCount drops
  // to 1.
  const stations: Station[] = [
    // HUB: 3 tech-factories (primary) + filler. With high intensity and ~6
    // eligible, count = round(0.75*6) = 5 — enough that all 3 tech-factories
    // could land in the picks without the recheck.
    makeStation("HUB-T1", hubNation, "tech-factory"),
    makeStation("HUB-T2", hubNation, "tech-factory"),
    makeStation("HUB-T3", hubNation, "tech-factory"),
    makeStation("HUB-W1", hubNation, "water-processing"),
    makeStation("HUB-W2", hubNation, "water-processing"),
    hubHabitat("1"),
    // Other-nation tech-factories so G1 doesn't independently block HUB's primary picks.
    makeStation("BIO-T1", bioNation, "tech-factory"),
    makeStation("BIO-T2", bioNation, "tech-factory"),
    bioFarm("1"),
    bioFarm("2"),
  ];
  const stationManager = fakeStationManager(stations);
  for (let trial = 0; trial < 200; trial++) {
    const { selected } = selectStationsForEmigration(stationManager, "high", fakeMap());
    const pickedHubTechFactories = selected.filter(
      (station) => station.nation.id === "hub" && station.stationType.id === "tech-factory",
    ).length;
    assertTrue(
      pickedHubTechFactories <= 2,
      `trial ${trial}: G2 violated — ${pickedHubTechFactories} of 3 HUB tech-factories picked, leaves ${3 - pickedHubTechFactories}`,
    );
  }
});

test("intensity-fraction picker rounds to at least 1 station for non-empty eligible lists", () => {
  // Pin the Math.max(1, …) clamp. Mutating to Math.max(0, …) would skip the
  // only eligible station entirely when round(fraction * count) lands on 0.
  // Set up BIO with exactly 1 eligible non-primary station (low intensity:
  // round(0.25 * 1) = 0 → must clamp to 1).
  const stations: Station[] = [
    bioHabitat("1"),
    // Universe-second habitat owned by HUB so G1 doesn't trip on BIO's habitat.
    // HUB also gets two tech-factories so HUB itself has no eligible (each is
    // blocked by G1: only one tech-factory of each per nation here).
    hubHabitat("1"),
  ];
  const stationManager = fakeStationManager(stations);
  // Force every ranked roll to take the top candidate — every Math.random() returns 0.
  withScriptedMathRandom([0], () => {
    const result = selectStationsForEmigration(stationManager, "low", fakeMap());
    // HUB iterates first (allNations order). HUB has 1 eligible (HUB-H1:
    // not primary, G1 universe count = 2 with BIO-H1). round(0.25*1)=0 →
    // clamp to 1; HUB-H1 picked. BIO iterates next: BIO-H1 now fails G1
    // (universe count dropped to 1 after HUB-H1 picked) → 0 eligible. Total
    // selected = 1.
    assertEqual(result.selected.length, 1, "single-eligible × low intensity hits the Math.max(1, …) clamp");
  });
});

test("intensity-fraction picker selects empty when eligible list is empty (no undefined push)", () => {
  // Universe with only 1 farm — G1 strips it. BIO has 0 eligible. The early
  // `continue` must skip BIO, not push `undefined` from picks[0].
  // (Other nations have 0 stations too, so 0 eligible everywhere.)
  const stations: Station[] = [bioFarm("1")];
  const stationManager = fakeStationManager(stations);
  withScriptedMathRandom([0], () => {
    const result = selectStationsForEmigration(stationManager, "high", fakeMap());
    assertEqual(result.selected.length, 0, "no stations selected when every nation has 0 eligible");
    assertEqual(result.nationIds.size, 0, "no nation ids accumulated");
    // Pin the early-continue. Mutating `if (eligible.length === 0) continue`
    // by removing the guard would push picks[0]=undefined into selected.
    for (const station of result.selected) {
      assertTrue(station !== undefined, "no undefined entries in selected");
    }
  });
});

test("per-nation cap honors targetCount (no over-pick) and records the picking nation's id", () => {
  // Pin the per-nation cap (`pickedFromThisNation >= targetCount` break) and
  // the `nationIds.add(nation.id)` record. HUB has 3 non-primary habitats, all
  // staying eligible across picks (universe count = 6 with 3 BIO habitats). At
  // low intensity (0.25), targetCount = round(0.25 * 3) = 1, so exactly one HUB
  // station should be selected. Flipping `>=` to `>` would pick 2; dropping
  // the increment would pick all 3; skipping `nationIds.add` would leave the
  // event UI unable to name the nation that just emigrated.
  const stations: Station[] = [
    hubHabitat("1"),
    hubHabitat("2"),
    hubHabitat("3"),
    bioHabitat("1"),
    bioHabitat("2"),
    bioHabitat("3"),
    // BIO primary filler so BIO itself contributes 0 eligible (only 1 farm and
    // it's last-of-type universe-wide, blocked by G1).
    bioFarm("1"),
    // HUB primary filler — only one HUB tech-factory, blocked by G1.
    hubTechFactory("1"),
  ];
  const stationManager = fakeStationManager(stations);
  withScriptedMathRandom([0], () => {
    const result = selectStationsForEmigration(stationManager, "low", fakeMap());
    const hubPicks = result.selected.filter((station) => station.nation.id === "hub");
    assertEqual(hubPicks.length, 1, "low intensity caps HUB at round(0.25 * 3) = 1");
    assertTrue(result.nationIds.has("hub"), "HUB id recorded in nationIds when HUB pick committed");
  });
});

test("intensity-fraction picker picks distinct counts per intensity (pins low=0.25, medium=0.5, high=0.75)", () => {
  // Pin INTENSITY_FRACTIONS values. With 4 eligible HUB habitats:
  //   low    → round(0.25 * 4) = 1
  //   medium → round(0.5  * 4) = 2
  //   high   → round(0.75 * 4) = 3
  // A mutation to high=0.5 would let high pick the same count as medium (2);
  // a mutation to low=0.5 would pick 2 instead of 1; etc. The 4-station setup
  // is the smallest size where all three fractions resolve to distinct counts.
  const stations: Station[] = [
    hubHabitat("1"),
    hubHabitat("2"),
    hubHabitat("3"),
    hubHabitat("4"),
    bioHabitat("1"),
    bioHabitat("2"),
    bioHabitat("3"),
    bioHabitat("4"),
    // Primary filler so each nation contributes 0 eligible from primary types
    // (single primary is last-of-universe-type, blocked by G1).
    bioFarm("1"),
    hubTechFactory("1"),
  ];
  const stationManager = fakeStationManager(stations);
  // Math.random sequence kept stable across runs so picks are deterministic.
  withScriptedMathRandom([0], () => {
    const lowResult = selectStationsForEmigration(stationManager, "low", fakeMap());
    const lowHubPicks = lowResult.selected.filter((station) => station.nation.id === "hub").length;
    assertEqual(lowHubPicks, 1, "low intensity picks round(0.25 * 4) = 1 from HUB");
  });
  withScriptedMathRandom([0], () => {
    const mediumResult = selectStationsForEmigration(stationManager, "medium", fakeMap());
    const mediumHubPicks = mediumResult.selected.filter((station) => station.nation.id === "hub").length;
    assertEqual(mediumHubPicks, 2, "medium intensity picks round(0.5 * 4) = 2 from HUB");
  });
  withScriptedMathRandom([0], () => {
    const highResult = selectStationsForEmigration(stationManager, "high", fakeMap());
    const highHubPicks = highResult.selected.filter((station) => station.nation.id === "hub").length;
    assertEqual(highHubPicks, 3, "high intensity picks round(0.75 * 4) = 3 from HUB");
  });
});

test("ranked emigration roll hit takes the top of the ranking", () => {
  const farthest = oreMineAtDistance("900", 900);
  const nextFarthest = oreMineAtDistance("600", 600);
  const middle = oreMineAtDistance("300", 300);
  const nearest = oreMineAtDistance("100", 100);
  const stationManager = fakeStationManager([nearest, middle, nextFarthest, farthest]);

  withScriptedMathRandom([0], () => {
    const result = selectStationsForEmigration(stationManager, "medium", fakeMap());
    const selectedIds = result.selected.map((station) => station.id).join(",");

    assertEqual(selectedIds, "ORE-M900,ORE-M600", "hit-only rolls pick farthest-from-Hearth ORE mines");
  });
});

test("ranked emigration roll miss can take an on-pattern station", () => {
  const farthest = oreMineAtDistance("900", 900);
  const nextFarthest = oreMineAtDistance("600", 600);
  const middle = oreMineAtDistance("300", 300);
  const nearest = oreMineAtDistance("100", 100);
  const stationManager = fakeStationManager([nearest, middle, nextFarthest, farthest]);

  withScriptedMathRandom([0.9, 0.99], () => {
    const result = selectStationsForEmigration(stationManager, "medium", fakeMap());
    const selectedIds = new Set(result.selected.map((station) => station.id));

    assertTrue(selectedIds.has("ORE-M100"), "miss roll can pick the most on-pattern ORE mine");
  });
});

test("ranked emigration roll statistically favors out-of-step stations", () => {
  const stations = Array.from({ length: 12 }, (_unused, index) =>
    oreMineAtDistance(String(index + 1), (index + 1) * 100),
  );
  let farthestSelections = 0;
  let nearestSelections = 0;

  for (let trial = 0; trial < 1000; trial++) {
    const stationManager = fakeStationManager(stations);
    const selectedIds = new Set(
      selectStationsForEmigration(stationManager, "medium", fakeMap()).selected.map(
        (station) => station.id,
      ),
    );
    if (selectedIds.has("ORE-M12")) farthestSelections++;
    if (selectedIds.has("ORE-M1")) nearestSelections++;
  }

  assertTrue(farthestSelections > 900, `farthest mine selected ${farthestSelections} times`);
  assertTrue(nearestSelections < 350, `nearest mine selected ${nearestSelections} times`);
});

test("countEligibleStations sums per-nation eligible counts across the producing universe", () => {
  // Pin that countEligibleStations applies the same G1/G2/producing filter
  // selectStationsForEmigration uses, summed across all participating
  // nations. Drift between them would let the panel preview disagree with
  // what triggerEvent actually picks. The "draws from" count is the union
  // of eligible per nation BEFORE the per-nation count cap.
  const stations: Station[] = [
    bioFarm("1"),
    bioFarm("2"),
    bioHabitat("1"),
    bioHabitat("2"),
    bioMedicalLab("1"),
    bioMedicalLab("2"),
    hubHabitat("1"),
    hubTechFactory("1"),
    hubTechFactory("2"),
    oreMine("1"),
    oreMine("2"),
  ];
  const stationManager = fakeStationManager(stations);
  // The assertion is on countEligibleStations vs. the count BIO/HUB/ORE would
  // each calculate, not on which specific stations are picked.
  const totalEligible = countEligibleStations(stationManager);
  // Verify by hand: BIO has 6 producing — F1, F2 (primary, 2 → after-pick 1 doesn't trip
  // G2 if both not yet picked, primaryCount=2 ≤1 false), so both eligible.
  // H1, H2 (not primary, no G2; habitat universe count >= 2 with HUB-H1, no G1).
  // L1, L2 (not primary; medical-lab only in BIO so universe count = 2).
  // BIO eligible = 6. HUB has 3 producing — H1 (no G2 since habitat isn't HUB primary;
  // habitat universe count includes BIO-H1, BIO-H2 = 3 universe-wide so no G1),
  // T1, T2 (primary, 2 universe → G2 primaryCount=2 doesn't trip).
  // HUB eligible = 3. ORE has 2 producing — both mines (primary), G2 primaryCount=2 doesn't trip.
  // ORE eligible = 2. Total = 11.
  assertEqual(totalEligible, 11, "expected eligible across BIO+HUB+ORE matches count");
});

test("emptyZoneCount returns count of zones not occupied by any live station", () => {
  // Build a tiny map with 4 zones; place stations on 2 of them. Non-zone
  // stations don't decrement the count — only zoneId-tagged ones count.
  const map = {
    stationZones: [
      { id: "a-1", x: 0, y: 0, size: "M" as const },
      { id: "a-2", x: 1, y: 1, size: "S" as const },
      { id: "a-3", x: 2, y: 2, size: "L" as const },
      { id: "a-4", x: 3, y: 3, size: "M" as const },
    ],
  } as unknown as GameMap;

  const occupiedA1 = makeZonedStation("BIO-1", "a-1");
  const occupiedA3 = makeZonedStation("BIO-3", "a-3");
  const zonelessTransient = makeZonedStation("BIO-T", undefined);

  const stationManager = fakeStationManager([occupiedA1, occupiedA3, zonelessTransient]);
  // Pin the Math.max(0, …) clamp + zoneId filter. A station without a zoneId
  // shouldn't reduce the empty-zone count.
  assertEqual(emptyZoneCount(map, stationManager), 2, "two zones empty; zoneless transient ignored");
});

test("emptyZoneCount clamps to zero when somehow more stations claim zones than zones exist", () => {
  // Defensive Math.max(0, …) in source. A 1-zone map with 2 station-claims
  // shouldn't return -1.
  const map = {
    stationZones: [{ id: "a-1", x: 0, y: 0, size: "M" as const }],
  } as unknown as GameMap;
  const stationA = makeZonedStation("BIO-1", "a-1");
  const stationB = makeZonedStation("BIO-2", "a-2");
  const stationManager = fakeStationManager([stationA, stationB]);
  assertEqual(emptyZoneCount(map, stationManager), 0, "clamps to 0 instead of returning -1");
});

test("drawAndRecordDestination does not pick the same destination twice within a pool cycle", () => {
  // Pool is 16 names — 16 calls before the reset. Pin the
  // `usedDestinations.includes` filter — dropping it would let the random
  // draw repeat names within a cycle.
  const used: string[] = [];
  const seen = new Set<string>();
  for (let call = 0; call < 16; call++) {
    const pick = drawAndRecordDestination(used);
    assertTrue(!seen.has(pick), `pick "${pick}" must not repeat within a single cycle`);
    seen.add(pick);
  }
  assertEqual(seen.size, 16, "all 16 distinct destinations drawn before reset");
  assertEqual(used.length, 16, "usedDestinations contains all 16 picks");
});

test("drawAndRecordDestination resets the used-set when the pool is exhausted", () => {
  // After 16 picks, the 17th call sees `usedDestinations.length === pool.length`
  // and clears it before drawing. Pin `usedDestinations.length = 0`.
  const used: string[] = [];
  for (let call = 0; call < 16; call++) drawAndRecordDestination(used);
  assertEqual(used.length, 16, "preconditions: pool exhausted");

  drawAndRecordDestination(used);
  // The 17th call: array was cleared at entry, then this pick was pushed.
  // So used.length === 1 after the call.
  assertEqual(used.length, 1, "reset clears the used-set, then pushes the fresh pick");
});

test("drawAndRecordDestination after reset can pick a destination from the prior cycle", () => {
  // After a full reset, every destination is fair game again — including
  // ones picked in the prior cycle. This pins that the reset is an actual
  // length=0, not a "filter out prior picks" half-reset.
  const used: string[] = [];
  const firstCycle = new Set<string>();
  for (let call = 0; call < 16; call++) firstCycle.add(drawAndRecordDestination(used));

  // Force the next pick by seeding Math.random to land on index 0 of the
  // 16-name pool. After reset, that's a valid name (one we've seen before).
  withScriptedMathRandom([0], () => {
    const pick = drawAndRecordDestination(used);
    assertTrue(firstCycle.has(pick), "post-reset pick can come from prior cycle (full reset, not a filter)");
    assertEqual(used.length, 1, "post-reset usedDestinations starts fresh with this single pick");
  });
});
