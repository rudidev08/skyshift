import { test, assertEqual, assertNotNull } from "./test-utils.ts";
import { makeSector } from "./factories.ts";
import { NationManager } from "../sim-nation-manager.ts";
import { ShipManager } from "../sim-ship-manager.ts";
import { StationManager } from "../sim-station-manager.ts";
import { NamePool } from "../sim-name-pool.ts";
import { withScriptedMathRandom } from "./test-utils.ts";
import { bioNation } from "../../data/nations.ts";
import type { NationTemplate } from "../../data/nation-types.ts";
import type { StationTypeId } from "../../data/station-types.ts";
import type { Sector } from "../sim-map-types.ts";
import type { StationZone } from "../sim-station-zone-types.ts";

// Pins src/sim-nation-manager.ts's zone CHOICE — pickPreferredBuildZone's
// personality roll. PERSONALITY_PICK_CHANCE of builds take the personality-
// scorer argmax (with a random zone inside the winning sector); the rest take a
// uniform-random zone across every legal candidate, deliberately off-pattern.
// Math.random is scripted per test: the first draw is the personality roll,
// then either one uniform zone draw (off-personality branch) or one tieBreak
// per scored sector followed by one within-sector draw (personality branch).

const MAP_MAX_DISTANCE = 100_000;

/** pickPreferredBuildZone is private on NationManager; the cast reaches it
 *  without driving a full build tick (which would also run type selection). */
type ZoneChooser = {
  pickPreferredBuildZone(
    nation: NationTemplate,
    typeId: StationTypeId,
    occupiedZoneIds: Set<string>,
  ): StationZone | null;
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

/** Real StationManager with an empty roster — the chooser only reads it for
 *  the nation's own stations, and zero stations makes every sector's
 *  nearest-own factor identical, so the environment bonus alone decides. */
function makeZoneChooser(args: { zones: StationZone[]; sectors: Sector[] }): ZoneChooser {
  const stationManager = new StationManager({
    shipManager: new ShipManager(new NamePool()),
    rebuildWareIndex: () => {},
  });
  const manager = new NationManager({
    zones: args.zones,
    sectors: args.sectors,
    stationManager,
    mapMaxDistance: MAP_MAX_DISTANCE,
    namePool: new NamePool(),
  });
  return manager as unknown as ZoneChooser;
}

// Both sectors host "habitat"; BIO's scorer prefers the bio-nebula sector, so
// any core pick can only come from the off-personality branch.
function makeBioVsCoreFixture() {
  const bioNebula = makeSector({ id: "bio-sector", x: 1_000, y: 0, environment: "bio-nebula" });
  const core = makeSector({ id: "core-sector", x: 5_000, y: 0, environment: "core" });
  const zones = [makeZone(bioNebula, 1), makeZone(core, 1), makeZone(core, 2)];
  return { chooser: makeZoneChooser({ zones, sectors: [bioNebula, core] }), zones };
}

test("off-personality roll picks uniformly across ALL legal zones, not the scorer argmax", () => {
  const { chooser } = makeBioVsCoreFixture();

  // 0.85 ≥ PERSONALITY_PICK_CHANCE (0.8) → off-personality branch; 0.9 over the
  // flat 3-zone candidate list → floor(0.9 × 3) = 2, the core sector's SECOND
  // zone. A sector-level draw could never weight core's two zones separately,
  // and BIO's scorer would never leave bio-nebula — so this pin fails both if
  // the branch is missing and if the draw is per-sector instead of per-zone.
  withScriptedMathRandom([0.85, 0.9], () => {
    const zone = assertNotNull(
      chooser.pickPreferredBuildZone(bioNation, "habitat", new Set()),
      "off-personality roll should still site the build",
    );
    assertEqual(zone.id, "core-sector-2", "uniform zone draw lands on the off-pattern core zone");
  });
});

test("personality roll keeps the scorer argmax: BIO still takes the bio-nebula sector", () => {
  const { chooser } = makeBioVsCoreFixture();

  // Every draw 0.1: the personality roll passes (0.1 < 0.8), tieBreaks are
  // irrelevant to BIO, and the within-sector draw on a 1-zone bucket is index 0.
  withScriptedMathRandom([0.1], () => {
    const zone = assertNotNull(
      chooser.pickPreferredBuildZone(bioNation, "habitat", new Set()),
      "personality roll should site the build",
    );
    assertEqual(zone.id, "bio-sector-1", "argmax still picks the bio-nebula zone");
  });
});

test("personality branch draws a random zone inside the winning sector, not the first by id", () => {
  const bioNebula = makeSector({ id: "bio-sector", x: 1_000, y: 0, environment: "bio-nebula" });
  const zones = [makeZone(bioNebula, 1), makeZone(bioNebula, 2), makeZone(bioNebula, 3)];
  const chooser = makeZoneChooser({ zones, sectors: [bioNebula] });

  // 0.1 → personality branch; 0.5 → the lone sector's tieBreak; 0.7 over the
  // winning sector's 3-zone bucket → floor(0.7 × 3) = 2, the third zone.
  withScriptedMathRandom([0.1, 0.5, 0.7], () => {
    const zone = assertNotNull(
      chooser.pickPreferredBuildZone(bioNation, "habitat", new Set()),
      "personality roll should site the build",
    );
    assertEqual(zone.id, "bio-sector-3", "within-sector draw follows the roll, not zone-id order");
  });
});
