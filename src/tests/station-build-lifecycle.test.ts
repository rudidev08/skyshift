import { test, assertEqual, assertTrue, assertNotUndefined, withScriptedMathRandom } from "./test-utils.ts";
import { type Simulation } from "../sim-lifecycle.ts";
import { filterZonesForOccupants } from "../sim-map-create.ts";
import { type BuildPlacement } from "../sim-station-manager.ts";
import { computeBuildWares } from "../sim-station-template.ts";
import { getInventorySlot } from "../sim-station.ts";
import {
  findRoundTradeTrip,
  getTradeBuyDemand,
  scoreHomeInventoryCandidates,
} from "../sim-trade-decision.ts";
import { getShipTypeTemplate } from "../sim-ship-template.ts";
import type { StationZoneTemplate } from "../../data/station-zone-types.ts";
import type { Station } from "../sim-station-types.ts";
import type { Ship } from "../sim-ships.ts";
import type { TradeShip } from "../sim-trade-types.ts";
import { createSettledSimulation } from "./sim-test-fixtures.ts";

// Pins the full build lifecycle: placeBuild → construction inventory →
// completion flip → ware-station-index rebuild. Existing station.test.ts
// covers slot shapes; this file covers the cross-module chain that a new
// construction triggers.

function placeBuildAtZone(
  simulation: Simulation,
  zone: StationZoneTemplate,
  overrides?: Partial<BuildPlacement>,
): { station: Station; ships: Ship[] } {
  return simulation.stationManager.placeBuild({
    zoneId: zone.id,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
    ...overrides,
  });
}

function placeBuildAtFirstFreeZone(
  simulation: Simulation,
  overrides?: Partial<BuildPlacement>,
): { station: Station; ships: Ship[] } {
  const freeZones = filterZonesForOccupants(
    simulation.map.stationZones,
    simulation.stationManager.getStations(),
  );
  const zone = assertNotUndefined(freeZones[0], "free zone");
  return placeBuildAtZone(simulation, zone, overrides);
}

function fillBuildWaresToMax(station: Station): void {
  const provisionsSlot = assertNotUndefined(
    getInventorySlot(station, "provisions"),
    "provisions slot",
  );
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");
  provisionsSlot.current = provisionsSlot.max;
  hullsSlot.current = hullsSlot.max;
}

function findProvisionsProducerWithCapableShip(
  simulation: Simulation,
): { producer: Station; ship: TradeShip } {
  for (const producer of simulation.tradeManager.wareStationIndex.getProducers("provisions")) {
    const ship = simulation.tradeManager.tradeShips.find(
      (tradeShip) => tradeShip.homeStationId === producer.id,
    );
    if (!ship) continue;
    const orbiting = simulation.tradeManager.requireResolvedShip(ship.orbitingShipId);
    if (!getShipTypeTemplate(orbiting.shipTypeId).allowedWares.includes("provisions")) continue;
    return { producer, ship };
  }
  throw new Error("settled fixture has a provisions producer with a provisions-capable home ship");
}

test("placeBuild: creates a station in 'building' state with only provisions+hulls inventory slots", () => {
  const simulation = createSettledSimulation();
  const { station } = placeBuildAtFirstFreeZone(simulation);

  assertEqual(station.state, "building", "state is building");
  // Pin: inventory has only provisions and hulls — no production wares yet.
  // Mutating createStationUnderConstruction to populate the full template
  // inventory would let trade decisions immediately schedule sell trips.
  assertEqual(station.inventory.length, 2, "exactly 2 slots during construction");
  assertNotUndefined(getInventorySlot(station, "provisions"), "provisions slot present");
  assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot present");
  // Tech-factory's regular output (tech) and inputs (metal, hyperdata) must
  // NOT have slots yet — the ware-station-index test depends on this.
  assertEqual(getInventorySlot(station, "tech"), undefined, "no tech slot during construction");
  assertEqual(getInventorySlot(station, "metal"), undefined, "no metal slot during construction");

  simulation.destroy();
});

test("placeBuild: build slot caps match computeBuildWares output", () => {
  // Pin the wiring between computeBuildWares and inventory slot.max. A drift
  // would let the build complete with the wrong ware count, or never complete
  // because the slot caps are higher than the construction tracker checks.
  const simulation = createSettledSimulation();
  const { station } = placeBuildAtFirstFreeZone(simulation, {
    typeId: "habitat",
    size: "L",
    nationId: "bio",
  });

  const expected = computeBuildWares("habitat", "L", false);
  const provisionsSlot = assertNotUndefined(getInventorySlot(station, "provisions"), "provisions slot");
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");
  assertEqual(provisionsSlot.max, expected.provisions, "provisions slot.max matches computeBuildWares");
  assertEqual(hullsSlot.max, expected.hulls, "hulls slot.max matches computeBuildWares");

  simulation.destroy();
});

test("computeBuildWares: contracted multiplier doubles total cost", () => {
  // Pin the `contracted ? 2 : 1` multiplier in computeBuildWares. Without it,
  // contracted builds (off-list station types) would cost the same as own-list.
  const ownList = computeBuildWares("habitat", "M", false);
  const contracted = computeBuildWares("habitat", "M", true);
  assertEqual(contracted.provisions, ownList.provisions * 2, "contracted provisions = 2× own-list");
  assertEqual(contracted.hulls, ownList.hulls * 2, "contracted hulls = 2× own-list");
});

test("computeBuildWares: per-type flavor splits — provisions-heavy / balanced / hulls-heavy", () => {
  // Pin the PROVISIONS_SHARE flavor mapping. Swapping the returned
  // {provisions, hulls} fields, or flipping a station type's ratio, would
  // silently change which ware build sites need more of — a habitat (life-
  // support) ought to demand more provisions than hulls; a mine (industrial)
  // the reverse. Total stays the same under any of those mutations.
  const habitat = computeBuildWares("habitat", "M", false);
  assertTrue(
    habitat.provisions > habitat.hulls,
    `habitat is provisions-heavy; got provisions=${habitat.provisions}, hulls=${habitat.hulls}`,
  );

  const archives = computeBuildWares("archives", "M", false);
  assertEqual(
    archives.provisions,
    archives.hulls,
    `archives is balanced; got provisions=${archives.provisions}, hulls=${archives.hulls}`,
  );

  const mine = computeBuildWares("mine", "M", false);
  assertTrue(
    mine.hulls > mine.provisions,
    `mine is hulls-heavy; got provisions=${mine.provisions}, hulls=${mine.hulls}`,
  );
});

test("computeBuildWares: scales with size (S=1×, M=2×, L=3×)", () => {
  // Pin sizeMultiplierBySize integration — mutating to flat scale would change
  // build costs and make L-builds finish at S-build speed.
  const small = computeBuildWares("habitat", "S", false);
  const medium = computeBuildWares("habitat", "M", false);
  const large = computeBuildWares("habitat", "L", false);
  // Total cost = base × 2 × sizeMultiplier. Verify the ratio.
  const smallTotal = small.provisions + small.hulls;
  const mediumTotal = medium.provisions + medium.hulls;
  const largeTotal = large.provisions + large.hulls;
  assertEqual(mediumTotal, smallTotal * 2, "M total = 2× S total");
  assertEqual(largeTotal, smallTotal * 3, "L total = 3× S total");
  // Pin BUILD_BASE_PER_WARE_S * 2 absolute total at S non-contracted (= 6000).
  // Mutating the literal `* 2` factor to `* 1` would halve every build cost.
  assertEqual(smallTotal, 6000, "S non-contracted total = base 3000 × 2");
});

test("placeBuild: registers the new station in StationManager and fires onAdd observers", () => {
  const simulation = createSettledSimulation();
  let observedStation: Station | null = null;
  let observedShipCount = 0;
  const unsubscribe = simulation.stationManager.onAdd((station, ships) => {
    observedStation = station;
    observedShipCount = ships.length;
  });

  const { station } = placeBuildAtFirstFreeZone(simulation);
  unsubscribe();

  // Pin the addStation → onAdd observer fan-out. Mutating addStation to skip
  // the observer loop would silently break trade-manager registration of new
  // station ships.
  assertEqual(observedStation, station, "onAdd observer received the new station");
  assertTrue(observedShipCount > 0, "build site spawned at least one construction ship");
  // Verify byId registration.
  assertEqual(simulation.stationManager.getStation(station.id), station, "byId resolves the new station");

  simulation.destroy();
});

test("placeBuild: filterZonesForOccupants now hides the build zone", () => {
  // Pin that occupancy uses station.zoneId. Mutating placeBuild to drop
  // zoneId on the placement would leave the zone showing as buildable while
  // a station sits there.
  const simulation = createSettledSimulation();
  // Snapshot which zones are unoccupied right before placeBuild — preset
  // seeding and sim init already claimed other zones, so the diff should be
  // exactly the one free zone we're about to occupy.
  const filteredBefore = filterZonesForOccupants(
    simulation.map.stationZones,
    simulation.stationManager.getStations(),
  );
  const zone = assertNotUndefined(filteredBefore[0], "free zone");
  const beforeFilteredCount = filteredBefore.length;

  const { station } = placeBuildAtZone(simulation, zone);

  // Apply filterZonesForOccupants with all stations (including the new one).
  const filtered = filterZonesForOccupants(
    simulation.map.stationZones,
    simulation.stationManager.getStations(),
  );
  assertTrue(
    !filtered.some((candidate) => candidate.id === zone.id),
    "zone is filtered out once a station occupies it",
  );
  assertEqual(filtered.length, beforeFilteredCount - 1, "exactly one zone hidden by adding a build");
  assertEqual(station.zoneId, zone.id, "station.zoneId persists the occupancy claim");

  simulation.destroy();
});

test("placeBuild: WareStationIndex lists the building station as a consumer-only entry for provisions+hulls", () => {
  // Pin the rebuildWareIndex call inside addStation. Without it, the index
  // wouldn't see the building station and trade decisions wouldn't route
  // construction wares to it.
  const simulation = createSettledSimulation();
  const { station } = placeBuildAtFirstFreeZone(simulation);

  const provisionsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("provisions");
  const hullsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("hulls");
  assertTrue(
    provisionsConsumers.some((candidate) => candidate.id === station.id),
    "building station is a provisions consumer",
  );
  assertTrue(
    hullsConsumers.some((candidate) => candidate.id === station.id),
    "building station is a hulls consumer",
  );
  // And NOT a producer of anything (its produced ware tech is gated behind
  // isUnderConstruction → isOutputSlot=false for every slot).
  const techProducers = simulation.tradeManager.wareStationIndex.getProducers("tech");
  assertTrue(
    !techProducers.some((candidate) => candidate.id === station.id),
    "building station is NOT in tech producers (still constructing)",
  );

  simulation.destroy();
});

test("scoreHomeInventoryCandidates: building station produces zero sell candidates", () => {
  // Pin scoreHomeInventoryCandidates' skip-produces guard when the station is
  // under construction. Without it, a building shipyard's hulls slot (a
  // construction INPUT) would match produces=['hulls'] and surface as a sell
  // candidate.
  const simulation = createSettledSimulation();
  const { station } = placeBuildAtFirstFreeZone(simulation, {
    typeId: "shipyard",
    size: "S",
    nationId: "sky",
  });
  // Hulls full — would be a bug-bait sell candidate via produces=['hulls'] without layer 1.
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");
  hullsSlot.current = hullsSlot.max;

  const candidates = scoreHomeInventoryCandidates(station, ["hulls", "provisions"]);
  const sellCount = candidates.filter((candidate) => candidate.direction === "sell").length;
  assertEqual(sellCount, 0, "building stations have no sell candidates — construction inputs route INward");

  simulation.destroy();
});

test("getTradeBuyDemand: build sites floor at 1 across the whole 0..max-1 range; operational stations scale with fill", () => {
  // Pin the floor in getTradeBuyDemand. Mutating to drop the floor (return
  // 1 - fill always) lets a near-full build site report low demand, which
  // pickDestinationStation would then deprioritize relative to operational
  // consumers — defeating the whole point of the floor.
  const simulation = createSettledSimulation();
  const { station: buildSite } = placeBuildAtFirstFreeZone(simulation);
  const buildSlot = assertNotUndefined(getInventorySlot(buildSite, "provisions"), "provisions slot");

  // Build site demand stays at 1 across the whole 0 ≤ current < max range.
  buildSlot.current = 0;
  assertEqual(getTradeBuyDemand(buildSite, buildSlot), 1, "empty build slot demands 1");
  buildSlot.current = Math.floor(buildSlot.max / 2);
  assertEqual(getTradeBuyDemand(buildSite, buildSlot), 1, "half-full build slot still demands 1");
  buildSlot.current = buildSlot.max - 1;
  assertEqual(getTradeBuyDemand(buildSite, buildSlot), 1, "near-full build slot still demands 1");

  // Operational station: demand = 1 - fill, scales linearly.
  const operational = assertNotUndefined(
    simulation.stationManager.getStations().find((candidate) => candidate.state === "producing"),
    "found a producing station for comparison",
  );
  const operationalSlot = operational.inventory[0];
  const originalCurrent = operationalSlot.current;
  operationalSlot.current = 0;
  assertEqual(getTradeBuyDemand(operational, operationalSlot), 1, "empty operational slot demands 1");
  operationalSlot.current = operationalSlot.max;
  assertEqual(getTradeBuyDemand(operational, operationalSlot), 0, "full operational slot demands 0");
  operationalSlot.current = originalCurrent;

  simulation.destroy();
});

test("findRoundTradeTrip: producer's home ship distributes destinations across tied build sites (floor + shuffle)", () => {
  // Pins two behaviors at once:
  // 1. The build-site demand floor — without it, all operational provisions
  //    consumers (forced to near-empty by this test's setup) would outrank
  //    the build sites, and neither buildA nor buildB would ever be picked.
  // 2. The tie-shuffle in pickRandomFromMaxScore — without it, the first
  //    iterated build site wins every optimal pick (75% of trials), so the
  //    second only ever sees the 25% random path (~12.5% rate) and fails
  //    the >25% distribution threshold below.
  // Threshold note: the >25% bound discriminates with optimalPickChance=0.75. If
  // economyConfig.optimalPickChance drops to 0.5 or lower, the without-shuffle
  // rate climbs and this test loses sensitivity — re-tune the threshold then.
  const simulation = createSettledSimulation();
  // Snapshot the unoccupied zones — placeBuild is what claims occupancy, so
  // grabbing the slice up front ensures both placements get distinct zones.
  const freeZones = simulation.map.stationZones.filter(
    (zone) => !simulation.stationManager.getStations().some((station) => station.zoneId === zone.id),
  );
  assertTrue(freeZones.length >= 2, `fixture has at least 2 free zones; got ${freeZones.length}`);

  const { station: buildA } = placeBuildAtZone(simulation, freeZones[0]);
  const { station: buildB } = placeBuildAtZone(simulation, freeZones[1]);

  // Force every other operational provisions consumer near-full so they
  // fail the eligibility filter (demand near 0) and don't dilute the
  // distribution-rate count below.
  const provisionsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("provisions");
  for (const candidate of provisionsConsumers) {
    if (candidate.id === buildA.id || candidate.id === buildB.id) continue;
    const slot = getInventorySlot(candidate, "provisions");
    if (slot) slot.current = slot.max;
  }

  const { producer: resolvedProducer, ship: resolvedShip } =
    findProvisionsProducerWithCapableShip(simulation);

  // Pin sell direction: provisions output full, other outputs empty (no sell
  // competition), all input slots full (no buy candidates).
  for (const slot of resolvedProducer.inventory) {
    if (slot.ware.id === "provisions") {
      slot.current = slot.max;
    } else if (resolvedProducer.stationType.produces.includes(slot.ware.id)) {
      slot.current = 0;
    } else {
      slot.current = slot.max;
    }
  }

  let countA = 0;
  let countB = 0;
  // 600 trials, threshold 50: even at the observed-low ~21% build-site landing
  // rate, expected total ~126 — well above the threshold. Earlier 200-trial
  // version flaked at ~7% rate when an unlucky shuffle dropped to 43/200.
  const trialCount = 600;
  for (let i = 0; i < trialCount; i++) {
    const trip = findRoundTradeTrip(resolvedShip, simulation.tradeManager);
    if (!trip) continue;
    for (const leg of trip) {
      if (leg.toStation.id === buildA.id) countA++;
      else if (leg.toStation.id === buildB.id) countB++;
    }
  }

  const totalBuildPicks = countA + countB;
  assertTrue(
    totalBuildPicks > 50,
    `producer's ship picks build sites enough to test distribution; got ${totalBuildPicks}/${trialCount}`,
  );
  assertTrue(
    countA > totalBuildPicks * 0.25,
    `buildA picked >25% of build-site landings; got ${countA}/${totalBuildPicks}`,
  );
  assertTrue(
    countB > totalBuildPicks * 0.25,
    `buildB picked >25% of build-site landings; got ${countB}/${totalBuildPicks}`,
  );

  simulation.destroy();
});

test("completion flip: inventory rebuilt with full template ware slots", () => {
  // Force the build to complete by filling provisions+hulls to capacity, then
  // slowSimulationTick. Pin that the flip rebuilds the inventory using the station
  // template's full produces+inputs.
  const simulation = createSettledSimulation();
  const { station } = placeBuildAtFirstFreeZone(simulation);
  fillBuildWaresToMax(station);
  // tick StationManager.tick which checks isBuildComplete and flips.
  simulation.stationManager.tick();

  assertEqual(station.state, "producing", "state flipped to producing");
  // Pin the inventory rebuild. Mutating applyRebuiltStation to leave the
  // construction inventory in place would have the station "producing" but
  // unable to actually produce tech (no tech slot).
  assertNotUndefined(getInventorySlot(station, "tech"), "tech slot present after flip");
  assertNotUndefined(getInventorySlot(station, "metal"), "metal input slot present after flip");
  assertNotUndefined(getInventorySlot(station, "hyperdata"), "hyperdata input slot present after flip");
  // Build state cleared.
  assertEqual(station.build, undefined, "build cleared post-flip");

  simulation.destroy();
});

test("completion flip: WareStationIndex moves the station from consumer-only to producer for its output ware", () => {
  // Pin the rebuildWareIndex call wired through onStationStateChange.
  // Without it, the now-producing tech-factory wouldn't show up as a tech
  // producer, breaking trade routing for tech.
  const simulation = createSettledSimulation();
  const { station } = placeBuildAtFirstFreeZone(simulation);
  fillBuildWaresToMax(station);
  simulation.stationManager.tick();

  // Post-flip: tech producers list should contain this station.
  const techProducers = simulation.tradeManager.wareStationIndex.getProducers("tech");
  assertTrue(
    techProducers.some((candidate) => candidate.id === station.id),
    "post-flip station is in tech producers",
  );
  // And no longer in provisions/hulls consumers (slots gone, rebuilt without them).
  const provisionsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("provisions");
  const hullsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("hulls");
  assertTrue(
    !provisionsConsumers.some((candidate) => candidate.id === station.id),
    "post-flip station is NOT a provisions consumer",
  );
  assertTrue(
    !hullsConsumers.some((candidate) => candidate.id === station.id),
    "post-flip station is NOT a hulls consumer",
  );
  // But IS a metal consumer now (tech's input).
  const metalConsumers = simulation.tradeManager.wareStationIndex.getConsumers("metal");
  assertTrue(
    metalConsumers.some((candidate) => candidate.id === station.id),
    "post-flip station IS a metal consumer (tech input)",
  );

  simulation.destroy();
});

test("completion flip: fires the flip observer with the build-site ships to despawn", () => {
  // Pin the flipObservers fan-out. Caller wires this to despawn build-site
  // ships and spawn the regular fleet — without the fan-out, build ships
  // would persist forever, drifting around a producing station.
  const simulation = createSettledSimulation();
  let observedFlippedStation: Station | null = null;
  let observedBuildShips: Ship[] = [];
  const unsubscribe = simulation.stationManager.onFlip((flippedStation, buildShips) => {
    observedFlippedStation = flippedStation;
    observedBuildShips = buildShips;
  });

  const { station } = placeBuildAtFirstFreeZone(simulation);
  fillBuildWaresToMax(station);
  simulation.stationManager.tick();
  unsubscribe();

  assertEqual(observedFlippedStation, station, "flip observer received the station");
  assertTrue(observedBuildShips.length > 0, "flip observer received the build-site ships to despawn");

  simulation.destroy();
});

test("removeStation during 'building' state: fires onRemove observer and clears the station from byId", () => {
  // Pin the removeStation path — observers fire even mid-build.
  const simulation = createSettledSimulation();
  const { station, ships: buildShips } = placeBuildAtFirstFreeZone(simulation);
  // Pre-check: ShipManager has the build-site ships before removal.
  assertTrue(buildShips.length > 0, "placeBuild spawned at least one build-site ship");
  for (const ship of buildShips) {
    assertEqual(simulation.shipManager.getShip(ship.id), ship, `ship ${ship.id} present in ShipManager`);
  }

  let observedRemoved: Station | null = null;
  const unsubscribe = simulation.stationManager.onRemove((removed) => {
    observedRemoved = removed;
  });

  simulation.stationManager.removeStation(station.id);
  unsubscribe();

  // Pin the removeShipsForStation call inside removeStation. Mutating to
  // skip the despawn would leave orphaned build-site ships orbiting where
  // a station used to be — visible in render, still enrolled with trade-manager.
  for (const ship of buildShips) {
    assertEqual(
      simulation.shipManager.getShip(ship.id),
      undefined,
      `build ship ${ship.id} despawned with removed station`,
    );
  }

  // Pin the fire-then-deregister sequence. Mutating removeStation to skip
  // the observer would leave subscribers with stale references.
  assertEqual(observedRemoved, station, "onRemove observer received the removed station");
  assertEqual(
    simulation.stationManager.getStation(station.id),
    undefined,
    "byId no longer resolves the removed station",
  );
  // Pin the splice-by-1 in unregisterStation. Mutating to splice(index, 0) would
  // leave the station in the stations array even though byId is cleared.
  assertTrue(
    !simulation.stationManager.getStations().includes(station),
    "stations array no longer contains the removed station",
  );
  // Pin the rebuildWareIndex call inside unregisterStation. Mutating to skip
  // the rebuild would leave the now-removed building station in the
  // provisions/hulls consumers list, so traders would still target the ghost.
  const provisionsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("provisions");
  const hullsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("hulls");
  assertTrue(
    !provisionsConsumers.some((candidate) => candidate.id === station.id),
    "removed station absent from provisions consumers",
  );
  assertTrue(
    !hullsConsumers.some((candidate) => candidate.id === station.id),
    "removed station absent from hulls consumers",
  );

  simulation.destroy();
});

test("setStationStates: does nothing when stations already in target state (batch observer doesn't fire)", () => {
  // Pin the `if (oldState === newState) continue;` short-circuit. Mutating
  // it away would push every station into the transitions array even when
  // nothing actually changed, firing the batch observer with phantom
  // transitions whose oldState equals newState.
  const simulation = createSettledSimulation();
  const producingStations = simulation.stationManager
    .getStations()
    .filter((station) => station.state === "producing");
  assertTrue(producingStations.length > 0, "settled fixture has producing stations");

  let batchFired = 0;
  const unsubscribe = simulation.stationManager.onStationStateChangeBatch(() => {
    batchFired++;
  });
  simulation.stationManager.setStationStates(producingStations, "producing");
  unsubscribe();

  assertEqual(batchFired, 0, "batch observer didn't fire — every station already producing");

  simulation.destroy();
});

test("removeStation at index 0: still spliced from the stations array (index >= 0 boundary)", () => {
  // Pin the `if (index >= 0)` guard. Mutating to `> 0` would leave the
  // station at array index 0 hanging in the stations array even after
  // byId delete and observer fire. The existing build-state test happens
  // to remove a high-index station; this one targets the array head.
  const simulation = createSettledSimulation();
  const firstStation = simulation.stationManager.getStations()[0];
  assertTrue(firstStation !== undefined, "settled fixture has at least one station");
  assertEqual(
    simulation.stationManager.getStations().indexOf(firstStation),
    0,
    "target station is at array index 0",
  );

  simulation.stationManager.removeStation(firstStation.id);

  assertTrue(
    !simulation.stationManager.getStations().includes(firstStation),
    "index-0 station spliced from the stations array",
  );
  assertEqual(
    simulation.stationManager.getStation(firstStation.id),
    undefined,
    "byId no longer resolves the removed index-0 station",
  );

  simulation.destroy();
});

test("generateBuildStationId: id has the nation-code prefix and doesn't collide with existing stations", () => {
  // Pin the unique-id generation. Place 5 builds in a row and verify each
  // gets a distinct id with the right prefix.
  const simulation = createSettledSimulation();
  const ids = new Set<string>();
  let placed = 0;
  for (const zone of simulation.map.stationZones.slice(0, 5)) {
    const { station } = placeBuildAtZone(simulation, zone);
    // Each id has HUB- prefix and is unique across this loop.
    assertTrue(station.id.startsWith("HUB-"), `id starts with nation code; got ${station.id}`);
    assertTrue(!ids.has(station.id), `id is unique; got duplicate ${station.id}`);
    ids.add(station.id);
    placed++;
  }
  assertEqual(placed, 5, "placed all 5 builds");
  assertEqual(ids.size, 5, "all 5 ids are distinct");

  simulation.destroy();
});

test("Simulation.destroy: safe to call twice — second call does not re-run subordinate teardowns", () => {
  // Pin the early-return on this.destroyed. Without it, the second destroy
  // would call stationHistory.reset / tradeManager.destroy a second time.
  // Replace stationHistory.reset with a version that counts calls.
  const simulation = createSettledSimulation();
  let resetCalls = 0;
  const stationHistory = simulation.stationHistory;
  const originalReset = stationHistory.reset.bind(stationHistory);
  stationHistory.reset = () => {
    resetCalls++;
    originalReset();
  };
  simulation.destroy();
  simulation.destroy();
  // Pin: exactly one teardown firing, even after two destroy() calls.
  assertEqual(resetCalls, 1, "stationHistory.reset called exactly once across two destroy calls");
});

test("createSimulation: preset stations are recorded in StationHistory at game start", () => {
  // StationManager.seed (used by the fresh-universe init path) does not fire
  // onAdd, so without an explicit backfill the history's onAdd subscriber
  // misses every preset station. Pin: the chart's getCountsAt sees the same
  // station roster the live game does as soon as the player opens the Log tab.
  const simulation = createSettledSimulation();
  const liveStationIds = new Set(simulation.stations.map((station) => station.id));
  // Use a far-future time so any seed event time (positive, zero, or negative
  // due to simulationWarmupSeconds) is included — the test is about presence, not
  // about the exact event timestamp.
  const farFuture = 100 * 24 * 3600;
  const historicalIds = new Set(
    simulation.stationHistory.getStateAt(farFuture).map((station) => station.id),
  );
  assertEqual(historicalIds.size, liveStationIds.size, "history station count matches live");
  for (const id of liveStationIds) {
    assertTrue(historicalIds.has(id), `live station ${id} present in history`);
  }
  // Per-nation counts feed the chart's stacked bars + counts row.
  const counts = simulation.stationHistory.getCountsAt(farFuture);
  let nonWayNationStationCount = 0;
  for (const value of counts.values()) nonWayNationStationCount += value;
  const liveNonWayNationCount = simulation.stations.filter((station) => station.nation.id !== "way").length;
  assertEqual(nonWayNationStationCount, liveNonWayNationCount, "non-WAY counts match live roster");
  simulation.destroy();
});

test("placeBuild then completion: post-flip station has a regular fleet (build-site ships replaced)", () => {
  // The flip observer wired in sim-lifecycle calls
  // shipManager.spawnFleetForStation(flippedStation). Pin: post-flip ship
  // count includes the regular fleet, not just the build-site ships.
  const simulation = createSettledSimulation();
  const { station, ships: buildShips } = placeBuildAtFirstFreeZone(simulation);
  const buildShipObjectSet = new Set<Ship>(buildShips);

  fillBuildWaresToMax(station);
  simulation.stationManager.tick();

  // Post-flip ships at this station are spawned by the flip handler in lifecycle.
  // Compare by Ship object identity, not id — generateUniqueShipCode picks from
  // a 1000-code pool and freed build-ship codes can be re-issued to fresh
  // spawns, which would fail an id-equality test even when the lifecycle
  // correctly removed the old Ship instances.
  const postFlipShips = simulation.shipManager.getShipsForStation(station);
  assertTrue(postFlipShips.length > 0, "post-flip station has at least one ship");
  for (const ship of postFlipShips) {
    assertTrue(
      !buildShipObjectSet.has(ship),
      `ship ${ship.id} is a fresh post-flip Ship object, not a leftover build-site ship`,
    );
  }

  simulation.destroy();
});

test("Simulation.slowSimulationTick: also drives stationManager.tick — builds complete via the slow simulation tick", () => {
  // Pin the `this.stationManager.tick()` call inside slowSimulationTick. The
  // game scene calls slowSimulationTick every ~5s; if it skipped stationManager.tick,
  // build flips would never fire from the slow simulation path. The test calls
  // slowSimulationTick (not stationManager.tick directly) so that mutation kills
  // this assertion.
  const simulation = createSettledSimulation();
  const { station } = placeBuildAtFirstFreeZone(simulation);
  fillBuildWaresToMax(station);
  // Pin: slowSimulationTick fans through stationManager.tick.
  simulation.slowSimulationTick(1);
  assertEqual(station.state, "producing", "build flipped via slowSimulationTick path");

  simulation.destroy();
});

test("createSimulation: staggers per-station tick offsets across the [-interval, 0] range", () => {
  // Pin the staggerStationTicks call inside seedFreshRoster. Without
  // it, every station's secondsSinceLastTick stays at the createStation
  // default (0) — so production all fires on the same frame. With it, each
  // station gets a unique negative offset spread across one interval.
  const simulation = createSettledSimulation();
  const offsetSet = new Set<number>();
  for (const station of simulation.stationManager.getStations()) {
    offsetSet.add(station.secondsSinceLastTick);
  }
  // Pin: at least 5 distinct offsets after seeding (settled has many
  // stations). Skipping stagger leaves all offsets at 0 → set size 1.
  assertTrue(offsetSet.size > 5, `staggered ticks produce many distinct offsets; got ${offsetSet.size}`);
  // And at least one offset is negative (the stagger pattern places later
  // stations at negative offsets).
  let foundNegative = false;
  for (const offset of offsetSet) {
    if (offset < 0) foundNegative = true;
  }
  assertTrue(foundNegative, "at least one station has a negative tick offset post-stagger");

  simulation.destroy();
});

test("createSimulation: applies preset's seedInitialInventory — per-slot ratios spread across the [lower, upper] range", () => {
  // Pin the `map.seedInitialInventory?.(stations)` call. Without seeding,
  // every producing-state slot stays at exactly the starterFillRatio (0.5).
  // With seeding (mocked random alternating between 0 and 1), each slot's
  // fill ratio lands at either lowerBound or upperBound. Result: many slots
  // land >0.1 from 0.5. Skipping the seeding hook keeps every slot at 0.5.
  // Alternate between 0 (→ lowerBound) and ~1 (→ upperBound) so per-slot
  // fill ratios spread to both ends of the range, away from 0.5.
  let simulation!: Simulation;
  withScriptedMathRandom([0, 0.999], () => {
    simulation = createSettledSimulation();
  });
  let divergedSlotCount = 0;
  let totalSlots = 0;
  for (const station of simulation.stationManager.getStations()) {
    if (station.state !== "producing") continue;
    for (const slot of station.inventory) {
      totalSlots++;
      const ratio = slot.current / slot.max;
      if (Math.abs(ratio - 0.5) > 0.1) divergedSlotCount++;
    }
  }
  assertTrue(totalSlots > 20, "settled universe has many producing-state slots to sample");
  // Pin: with alternating mocked random, every slot lands at either
  // lowerBound (0.35) or upperBound (0.65) — both >0.1 from 0.5. Skipping
  // seedInitialInventory leaves all slots at the 0.5 starter ratio,
  // dropping divergedSlotCount to 0.
  assertTrue(
    divergedSlotCount > totalSlots * 0.6,
    `seeded slots bunch at lower/upper bounds (>0.1 from 0.5); got ${divergedSlotCount}/${totalSlots}`,
  );

  simulation.destroy();
});
