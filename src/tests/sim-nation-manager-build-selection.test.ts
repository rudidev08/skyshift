import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { makeSector, makeStation } from "./factories.ts";
import { NationManager } from "../sim-nation-manager.ts";
import { ShipManager } from "../sim-ship-manager.ts";
import { StationManager } from "../sim-station-manager.ts";
import { NamePool } from "../sim-name-pool.ts";
import { getStationTypeTemplate } from "../sim-station-template.ts";
import { oreNation, farNation, hubNation } from "../../data/nations.ts";
import type { NationTemplate } from "../../data/nation-types.ts";
import type { StationTypeId } from "../../data/station-types.ts";
import type { Sector } from "../sim-map-types.ts";
import type { StationZone } from "../sim-station-zone-types.ts";
import type { Station } from "../sim-station-types.ts";

// Pins src/sim-nation-manager.ts's station-type SELECTION scoring — the chain
// computeMapWareScarcity → scoreStationTypeForNewConstruction → pickNextBuildType
// → pickContractor. No behavioral test covered this before.
//
// Each scenario seeds a roster that drives exactly one ware scarce map-wide
// (a producing consumer of that ware, with no producer of it), then asserts the
// type the picker chooses is one that RELIEVES that scarcity (produces the
// scarce ware) — and that the contractor for an off-roster pick is a nation that
// actually holds the blueprint. These would flip if the scarcity term were
// dropped, so they fail under a "ignore scarcity" mutation rather than passing
// trivially.

const MAP_MAX_DISTANCE = 100_000;

/** pickNextBuildType is the picker under test — private on NationManager, so the
 *  cast reaches it without the all-nations fan-out of the public tick(). Its
 *  result is exactly the {typeId, contractingNationId} selection decision. */
type BuildTypePicker = {
  pickNextBuildType(
    nation: NationTemplate,
    occupiedZoneIds: Set<string>,
  ): { typeId: StationTypeId; contractingNationId?: string } | null;
};

function makeZone(sector: Sector, index: number): StationZone {
  const code = `${sector.id}-${index}`;
  return {
    id: code,
    x: sector.x,
    y: sector.y,
    size: "M",
    sector,
    name: `Zone ${code}`,
    nameSuffix: "Alpha",
    code,
  };
}

/** Real StationManager wired to a real ShipManager — the picker reads the live
 *  roster through it, so seeded stations feed scarcity for real. rebuildWareIndex
 *  is a no-op: nothing here builds a trade graph. */
function makeStationManager(seedStations: Station[]): StationManager {
  const stationManager = new StationManager({
    shipManager: new ShipManager(new NamePool()),
    rebuildWareIndex: () => {},
  });
  stationManager.seed(seedStations);
  return stationManager;
}

function makePicker(args: {
  zones: StationZone[];
  sectors: Sector[];
  stationManager: StationManager;
}): BuildTypePicker {
  const manager = new NationManager({
    zones: args.zones,
    sectors: args.sectors,
    stationManager: args.stationManager,
    mapMaxDistance: MAP_MAX_DISTANCE,
    namePool: new NamePool(),
  });
  return manager as unknown as BuildTypePicker;
}

/** Produces are taken from the real station catalog, so the scarcity math the
 *  picker runs sees the same recipe the game does. */
function produces(typeId: StationTypeId): readonly string[] {
  return getStationTypeTemplate(typeId).produces;
}

test("ORE picks metal-forge over its primary mine when only metal is scarce", () => {
  // A producing tech-factory consumes metal (4/tick) and hyperdata (1/tick) and
  // produces tech. With no metal/hyperdata producer anywhere, both read as fully
  // scarce; tech itself has no consumer, so it isn't. Of the types ORE can build,
  // only metal-forge relieves metal — mine produces ice+mineral (neither scarce).
  const consumer = makeStation({ placement: { id: "TF-1", stationTypeId: "tech-factory", nation: hubNation } });
  const stationManager = makeStationManager([consumer]);

  // One mineral-rich sector — hosts mine, metal-forge, water-processing, habitat,
  // so the eligibility gate keeps both ORE blueprints in the running and the
  // choice turns purely on scarcity, not on which type happens to have a free zone.
  const mineralRich = makeSector({ id: "ore-sector", x: 1_000, y: 0, environment: "mineral-rich" });
  const zones = [makeZone(mineralRich, 1)];
  const picker = makePicker({ zones, sectors: [mineralRich], stationManager });

  const decision = picker.pickNextBuildType(oreNation, new Set());

  assertTrue(decision !== null, "ORE should find a buildable type");
  assertEqual(decision!.typeId, "metal-forge", "ORE picks the metal-relieving type, not its primary mine");
  assertTrue(
    produces("metal-forge").includes("metal"),
    "sanity: the chosen type actually produces the scarce ware",
  );
  // metal-forge is ORE's own blueprint, so it self-builds (no contractor).
  assertEqual(decision!.contractingNationId, undefined, "self-buildable type carries no contractor");
  assertTrue(
    oreNation.buildableStationTypeIds.includes("metal-forge"),
    "sanity: the builder permits the chosen type's blueprint",
  );
});

test("FAR contracts water-processing to HUB when only water is scarce", () => {
  // A producing farm consumes water (4/tick) and produces food. No water producer
  // anywhere → water is fully scarce; food has no consumer, so nothing else is.
  // FAR builds only observatories (deep-space/frontier), which a core zone can't
  // host — so the picker reaches for the off-roster type that relieves water.
  const consumer = makeStation({ placement: { id: "FARM-1", stationTypeId: "farm", nation: hubNation } });
  const stationManager = makeStationManager([consumer]);

  // One core sector — hosts habitat, tech-factory, shipyard, medical-lab,
  // water-processing, but NOT observatory. Of those, only water-processing
  // relieves the scarce ware.
  const core = makeSector({ id: "core-sector", x: 1_000, y: 0, environment: "core" });
  const zones = [makeZone(core, 1)];
  const picker = makePicker({ zones, sectors: [core], stationManager });

  const decision = picker.pickNextBuildType(farNation, new Set());

  assertTrue(decision !== null, "FAR should find a buildable type");
  assertEqual(decision!.typeId, "water-processing", "FAR picks the water-relieving type");
  assertTrue(
    produces("water-processing").includes("water"),
    "sanity: the chosen type actually produces the scarce ware",
  );
  // FAR has no water-processing blueprint, so the build is contracted out. HUB is
  // the only building nation that holds it.
  assertEqual(decision!.contractingNationId, "hub", "FAR contracts the off-roster type to HUB");
  assertTrue(
    !farNation.buildableStationTypeIds.includes("water-processing"),
    "sanity: FAR can't self-build the chosen type",
  );
  assertTrue(
    hubNation.buildableStationTypeIds.includes("water-processing"),
    "sanity: the chosen contractor permits the chosen type's blueprint",
  );
});

test("with nothing scarce, ORE falls back to its primary mine (scarcity term is what flips the ORE test)", () => {
  // No consumers seeded → every ware's scarcity is 0, so the ×3 scarcity term is
  // 0 for every candidate and only the primary-type thumb (+2) separates them.
  // ORE picks its primary, mine — the mirror of the first test, confirming that
  // it was scarcity, not some constant bias toward metal-forge, doing the work
  // there. A mutant that ignored scarcity would pick mine in BOTH tests and so
  // fail the first one.
  const stationManager = makeStationManager([]);
  const mineralRich = makeSector({ id: "ore-sector", x: 1_000, y: 0, environment: "mineral-rich" });
  const zones = [makeZone(mineralRich, 1)];
  const picker = makePicker({ zones, sectors: [mineralRich], stationManager });

  const decision = picker.pickNextBuildType(oreNation, new Set());

  assertTrue(decision !== null, "ORE should still find a buildable type with nothing scarce");
  assertEqual(decision!.typeId, "mine", "ORE defaults to its primary mine when no ware is scarce");
});
