import { test, assertEqual, assertTrue, assertNotUndefined } from "./test-utils.ts";
import { createSimulation, type Simulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate, filterZonesForOccupants } from "../sim-map-builder.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { computeBuildWares } from "../sim-station-manager.ts";
import { getInventorySlot } from "../sim-station.ts";
import { findRoundTradeTrip, getTradeBuyDemand, scoreHomeInventoryCandidates } from "../sim-trade-decision.ts";
import { getShipTemplate } from "../sim-ship-template.ts";
import type { Station } from "../sim-station-types.ts";
import type { Ship } from "../sim-ships.ts";
import type { TradeShip } from "../sim-trade-types.ts";

// Pins the full build lifecycle: placeBuild → construction inventory →
// completion flip → ware-station-index rebuild. Existing station.test.ts
// covers slot shapes; this file covers the cross-module chain that a new
// construction triggers.

function freshSim(): Simulation {
  return createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDuration: 0,
  });
}

function findFreeZone(simulation: Simulation): { zoneId: string; x: number; y: number; size: "S" | "M" | "L" } | undefined {
  // Pick a buildable zone that no station currently occupies.
  for (const zone of simulation.map.stationZones) {
    return { zoneId: zone.id, x: zone.x, y: zone.y, size: zone.size };
  }
  return undefined;
}

test("placeBuild: creates a station in 'building' state with only provisions+hulls inventory slots", () => {
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });

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

  simulation.dispose();
});

test("placeBuild: build slot caps match computeBuildWares output", () => {
  // Pin the wiring between computeBuildWares and inventory slot.max. A drift
  // would let the build complete with the wrong ware count, or never complete
  // because the slot caps are higher than the construction tracker checks.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "habitat",
    size: "L",
    nationId: "bio",
    x: zone.x,
    y: zone.y,
  });

  const expected = computeBuildWares("habitat", "L", false);
  const provisionsSlot = assertNotUndefined(getInventorySlot(station, "provisions"), "provisions slot");
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");
  assertEqual(provisionsSlot.max, expected.provisions, "provisions slot.max matches computeBuildWares");
  assertEqual(hullsSlot.max, expected.hulls, "hulls slot.max matches computeBuildWares");

  simulation.dispose();
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
  assertTrue(habitat.provisions > habitat.hulls, `habitat is provisions-heavy; got provisions=${habitat.provisions}, hulls=${habitat.hulls}`);

  const archives = computeBuildWares("archives", "M", false);
  assertEqual(archives.provisions, archives.hulls, `archives is balanced; got provisions=${archives.provisions}, hulls=${archives.hulls}`);

  const mine = computeBuildWares("mine", "M", false);
  assertTrue(mine.hulls > mine.provisions, `mine is hulls-heavy; got provisions=${mine.provisions}, hulls=${mine.hulls}`);
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
  const simulation = freshSim();
  let observedStation: Station | null = null;
  let observedShipCount = 0;
  const unsubscribe = simulation.stationManager.onAdd((station, ships) => {
    observedStation = station;
    observedShipCount = ships.length;
  });

  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });
  unsubscribe();

  // Pin the addStation → onAdd observer fan-out. Mutating addStation to skip
  // the observer loop would silently break trade-manager registration of new
  // station ships.
  assertEqual(observedStation, station, "onAdd observer received the new station");
  assertTrue(observedShipCount > 0, "build site spawned at least one construction ship");
  // Verify byId registration.
  assertEqual(simulation.stationManager.getStation(station.id), station, "byId resolves the new station");

  simulation.dispose();
});

test("placeBuild: filterZonesForOccupants now hides the build zone", () => {
  // Pin that occupancy uses station.zoneId. Mutating placeBuild to drop
  // zoneId on the placement would leave the zone showing as buildable while
  // a station sits there.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  // Confirm the zone is in the unoccupied list before placeBuild.
  assertTrue(
    simulation.map.stationZones.some((candidate) => candidate.id === zone.zoneId),
    "zone is in stationZones (unoccupied) before placeBuild",
  );
  // Snapshot which zones are unoccupied right before placeBuild — sim init
  // already placed initial-station builds in some other zones, so the diff
  // should be exactly the one zone we're about to occupy.
  const filteredBefore = filterZonesForOccupants(simulation.map.stationZones, simulation.stationManager.getStations());
  const beforeFilteredCount = filteredBefore.length;

  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });

  // Apply filterZonesForOccupants with all stations (including the new one).
  const filtered = filterZonesForOccupants(simulation.map.stationZones, simulation.stationManager.getStations());
  assertTrue(
    !filtered.some((candidate) => candidate.id === zone.zoneId),
    "zone is filtered out once a station occupies it",
  );
  assertEqual(filtered.length, beforeFilteredCount - 1, "exactly one zone hidden by adding a build");
  assertEqual(station.zoneId, zone.zoneId, "station.zoneId persists the occupancy claim");

  simulation.dispose();
});

test("placeBuild: WareStationIndex lists the building station as a consumer-only entry for provisions+hulls", () => {
  // Pin the rebuildWareIndex call inside addStation. Without it, the index
  // wouldn't see the building station and trade decisions wouldn't route
  // construction wares to it.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });

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

  simulation.dispose();
});

test("scoreHomeInventoryCandidates: building station produces zero sell candidates", () => {
  // Pin layer 1 of the construction-ware-no-sell defense — scoreHomeInventoryCandidates
  // skips home.stationType.produces when isStationUnderConstruction(home).
  // Without this, a building shipyard's hulls slot (a construction INPUT)
  // would match produces=['hulls'] and surface as a sell candidate.
  //
  // Direct unit test because the integration path through findRoundTradeTrip
  // hides this regression: layer 2 (findEligibleCounterStations'
  // `score > homeScore` filter combined with the build-site demand floor of 1)
  // currently makes the bad sell unbuildable downstream. But that's
  // trade-balance tuning, not an invariant — a future tweak to the floor or
  // the comparison operator would re-expose layer 1 as load-bearing, and
  // the integration test would still pass vacuously.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "shipyard",
    size: "S",
    nationId: "sky",
    x: zone.x,
    y: zone.y,
  });
  // Hulls full — would be a bug-bait sell candidate via produces=['hulls'] without layer 1.
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");
  hullsSlot.current = hullsSlot.max;

  const candidates = scoreHomeInventoryCandidates(station, ["hulls", "provisions"]);
  const sellCount = candidates.filter((candidate) => candidate.direction === "sell").length;
  assertEqual(sellCount, 0, "building stations have no sell candidates — construction inputs route INward");

  simulation.dispose();
});

test("getTradeBuyDemand: build sites floor at 1 across the whole 0..max-1 range; operational stations scale with fill", () => {
  // Pin the floor in getTradeBuyDemand. Mutating to drop the floor (return
  // 1 - fill always) lets a near-full build site report low demand, which
  // pickDestinationStation would then deprioritize relative to operational
  // consumers — defeating the whole point of the floor.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station: buildSite } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });
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

  simulation.dispose();
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
  // Threshold note: the >25% bound discriminates with optimalChance=0.75. If
  // economyConfig.optimalChance drops to 0.5 or lower, the without-shuffle
  // rate climbs and this test loses sensitivity — re-tune the threshold then.
  const simulation = freshSim();
  // Snapshot the unoccupied zones — placeBuild is what claims occupancy, so
  // grabbing the slice up front ensures both placements get distinct zones.
  const freeZones = simulation.map.stationZones.filter(
    (zone) => !simulation.stationManager.getStations().some((station) => station.zoneId === zone.id),
  );
  assertTrue(freeZones.length >= 2, `fixture has at least 2 free zones; got ${freeZones.length}`);

  const { station: buildA } = simulation.stationManager.placeBuild({
    zoneId: freeZones[0].id,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: freeZones[0].x,
    y: freeZones[0].y,
  });
  const { station: buildB } = simulation.stationManager.placeBuild({
    zoneId: freeZones[1].id,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: freeZones[1].x,
    y: freeZones[1].y,
  });

  // Force every other operational provisions consumer near-full so they
  // fail the eligibility filter (demand near 0) and don't dilute the
  // distribution-rate count below.
  const provisionsConsumers = simulation.tradeManager.wareStationIndex.getConsumers("provisions");
  for (const candidate of provisionsConsumers) {
    if (candidate.id === buildA.id || candidate.id === buildB.id) continue;
    const slot = getInventorySlot(candidate, "provisions");
    if (slot) slot.current = slot.max;
  }

  // Find a provisions producer whose home ship can carry provisions.
  const provisionsProducers = simulation.tradeManager.wareStationIndex.getProducers("provisions");
  let producer: Station | undefined;
  let producerShip: TradeShip | undefined;
  for (const candidate of provisionsProducers) {
    const candidateShip = simulation.tradeManager.tradeShips.find(
      (tradeShip) => tradeShip.homeStationId === candidate.id,
    );
    if (!candidateShip) continue;
    const orbiting = simulation.tradeManager.requireResolvedShip(candidateShip.orbitingShipId);
    if (!getShipTemplate(orbiting.shipTypeId).allowedWares.includes("provisions")) continue;
    producer = candidate;
    producerShip = candidateShip;
    break;
  }
  const resolvedProducer = assertNotUndefined(producer, "settled fixture has a provisions producer with a provisions-capable home ship");
  const resolvedShip = assertNotUndefined(producerShip, "producer has a home ship");

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
  assertTrue(totalBuildPicks > 50, `producer's ship picks build sites enough to test distribution; got ${totalBuildPicks}/${trialCount}`);
  assertTrue(countA > totalBuildPicks * 0.25, `buildA picked >25% of build-site landings; got ${countA}/${totalBuildPicks}`);
  assertTrue(countB > totalBuildPicks * 0.25, `buildB picked >25% of build-site landings; got ${countB}/${totalBuildPicks}`);

  simulation.dispose();
});

test("completion flip: inventory rebuilt with full template ware slots", () => {
  // Force the build to complete by filling provisions+hulls to capacity, then
  // tickDynamics. Pin that the flip rebuilds the inventory using the station
  // template's full produces+inputs.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });
  // Fill construction wares to full.
  const provisionsSlot = assertNotUndefined(getInventorySlot(station, "provisions"), "provisions slot");
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");
  provisionsSlot.current = provisionsSlot.max;
  hullsSlot.current = hullsSlot.max;
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

  simulation.dispose();
});

test("completion flip: WareStationIndex moves the station from consumer-only to producer for its output ware", () => {
  // Pin the rebuildWareIndex call wired through onStationStateChange.
  // Without it, the now-producing tech-factory wouldn't show up as a tech
  // producer, breaking trade routing for tech.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });
  const provisionsSlot = assertNotUndefined(getInventorySlot(station, "provisions"), "provisions slot");
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");
  provisionsSlot.current = provisionsSlot.max;
  hullsSlot.current = hullsSlot.max;
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

  simulation.dispose();
});

test("completion flip: fires the flip observer with the build-site ships to despawn", () => {
  // Pin the flipObservers fan-out. Caller wires this to despawn build-site
  // ships and spawn the regular fleet — without the fan-out, build ships
  // would persist forever, drifting around a producing station.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  let observedFlippedStation: Station | null = null;
  let observedBuildShips: Ship[] = [];
  const unsubscribe = simulation.stationManager.onFlip((flippedStation, buildShips) => {
    observedFlippedStation = flippedStation;
    observedBuildShips = buildShips;
  });

  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });
  const provisionsSlot = assertNotUndefined(getInventorySlot(station, "provisions"), "provisions");
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls");
  provisionsSlot.current = provisionsSlot.max;
  hullsSlot.current = hullsSlot.max;
  simulation.stationManager.tick();
  unsubscribe();

  assertEqual(observedFlippedStation, station, "flip observer received the station");
  assertTrue(observedBuildShips.length > 0, "flip observer received the build-site ships to despawn");

  simulation.dispose();
});

test("removeStation during 'building' state: fires onRemove observer and clears the station from byId", () => {
  // Pin the removeStation path — observers fire even mid-build.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });

  let observedRemoved: Station | null = null;
  const unsubscribe = simulation.stationManager.onRemove((removed) => {
    observedRemoved = removed;
  });

  simulation.stationManager.removeStation(station.id);
  unsubscribe();

  // Pin the fire-then-deregister sequence. Mutating removeStation to skip
  // the observer would leave subscribers with stale references.
  assertEqual(observedRemoved, station, "onRemove observer received the removed station");
  assertEqual(simulation.stationManager.getStation(station.id), undefined, "byId no longer resolves the removed station");
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

  simulation.dispose();
});

test("generateBuildStationId: id has the nation-code prefix and doesn't collide with existing stations", () => {
  // Pin the unique-id generation. Place 5 builds in a row and verify each
  // gets a distinct id with the right prefix.
  const simulation = freshSim();
  const ids = new Set<string>();
  let placed = 0;
  for (const zone of simulation.map.stationZones.slice(0, 5)) {
    const { station } = simulation.stationManager.placeBuild({
      zoneId: zone.id,
      typeId: "tech-factory",
      size: "M",
      nationId: "hub",
      x: zone.x,
      y: zone.y,
    });
    // Each id has HUB- prefix and is unique across this loop.
    assertTrue(station.id.startsWith("HUB-"), `id starts with nation code; got ${station.id}`);
    assertTrue(!ids.has(station.id), `id is unique; got duplicate ${station.id}`);
    ids.add(station.id);
    placed++;
  }
  assertEqual(placed, 5, "placed all 5 builds");
  assertEqual(ids.size, 5, "all 5 ids are distinct");

  simulation.dispose();
});

test("Simulation.dispose: idempotent — second call does not re-run subordinate teardowns", () => {
  // Pin the early-return on this.disposed. Without it, the second dispose
  // would call stationHistory.reset / nationManager.reset / tradeManager.dispose
  // a second time. Patch stationHistory.reset to count calls.
  const simulation = freshSim();
  let resetCalls = 0;
  const stationHistory = simulation.stationHistory;
  const originalReset = stationHistory.reset.bind(stationHistory);
  stationHistory.reset = () => {
    resetCalls++;
    originalReset();
  };
  simulation.dispose();
  simulation.dispose();
  // Pin: exactly one teardown firing, even after two dispose() calls.
  assertEqual(resetCalls, 1, "stationHistory.reset called exactly once across two dispose calls");
});

test("createSimulation: preset stations are recorded in StationHistory at game start", () => {
  // StationManager.seed (used by the fresh-universe init path) does not fire
  // onAdd, so without an explicit backfill the history's onAdd subscriber
  // misses every preset station. Pin: the chart's getCountsAt sees the same
  // station roster the live game does as soon as the player opens the Log tab.
  const simulation = freshSim();
  const liveStationIds = new Set(simulation.stations.map((s) => s.id));
  // Use a far-future time so any seed event time (positive, zero, or negative
  // due to simulationWarmup) is included — the test is about presence, not
  // about the exact event timestamp.
  const farFuture = 100 * 24 * 3600;
  const historicalIds = new Set(simulation.stationHistory.getStateAt(farFuture).stations.map((s) => s.id));
  assertEqual(historicalIds.size, liveStationIds.size, "history station count matches live");
  for (const id of liveStationIds) {
    assertTrue(historicalIds.has(id), `live station ${id} present in history`);
  }
  // Per-nation counts feed the chart's stacked bars + counts row.
  const counts = simulation.stationHistory.getCountsAt(farFuture);
  let totalNonWayCounted = 0;
  for (const value of counts.values()) totalNonWayCounted += value;
  const liveNonWayCount = simulation.stations.filter((s) => s.nation.id !== "way").length;
  assertEqual(totalNonWayCounted, liveNonWayCount, "non-WAY counts match live roster");
  simulation.dispose();
});

test("placeBuild then completion: post-flip station has a regular fleet (build-site ships replaced)", () => {
  // The flip observer wired in sim-lifecycle calls
  // shipManager.spawnFleetForStation(flippedStation). Pin: post-flip ship
  // count includes the regular fleet, not just the build-site ships.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station, ships: buildShips } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });
  const buildShipObjectSet = new Set<Ship>(buildShips);

  const provisionsSlot = assertNotUndefined(getInventorySlot(station, "provisions"), "provisions");
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls");
  provisionsSlot.current = provisionsSlot.max;
  hullsSlot.current = hullsSlot.max;
  simulation.stationManager.tick();

  // Post-flip ships at this station are spawned by the flip handler in lifecycle.
  // Compare by Ship object identity, not id — generateUniqueShipCode picks from
  // a 1000-code pool and freed build-ship codes can be re-issued to fresh
  // spawns, which would fail an id-equality test even when the lifecycle
  // correctly removed the old Ship instances.
  const postFlipShips = simulation.shipManager.getShipsForStation(station);
  assertTrue(postFlipShips.length > 0, "post-flip station has at least one ship");
  for (const ship of postFlipShips) {
    assertTrue(!buildShipObjectSet.has(ship), `ship ${ship.id} is a fresh post-flip Ship object, not a leftover build-site ship`);
  }

  simulation.dispose();
});

test("Simulation.tickDynamics: also drives stationManager.tick — builds complete via the dynamics tick", () => {
  // Pin the `this.stationManager.tick()` call inside tickDynamics. The
  // game scene calls tickDynamics every ~5s; if it skipped stationManager.tick,
  // build flips would never fire from the dynamics path. The test calls
  // tickDynamics (not stationManager.tick directly) so that mutation kills
  // this assertion.
  const simulation = freshSim();
  const zone = assertNotUndefined(findFreeZone(simulation), "free zone");
  const { station } = simulation.stationManager.placeBuild({
    zoneId: zone.zoneId,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: zone.x,
    y: zone.y,
  });
  const provisionsSlot = assertNotUndefined(getInventorySlot(station, "provisions"), "provisions");
  const hullsSlot = assertNotUndefined(getInventorySlot(station, "hulls"), "hulls");
  provisionsSlot.current = provisionsSlot.max;
  hullsSlot.current = hullsSlot.max;
  // Pin: tickDynamics fans through stationManager.tick.
  simulation.tickDynamics(1);
  assertEqual(station.state, "producing", "build flipped via tickDynamics path");

  simulation.dispose();
});

test("createSimulation: staggers per-station tick offsets across the [-interval, 0] range", () => {
  // Pin the staggerStationTicks call inside seedStationsAndShips. Without
  // it, every station's secondsSinceLastTick stays at the createStation
  // default (0) — so production all fires on the same frame. With it, each
  // station gets a unique negative offset spread across one interval.
  const simulation = freshSim();
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

  simulation.dispose();
});

test("createSimulation: applies preset's seedInitialInventory — per-slot ratios spread across the [lower, upper] range", () => {
  // Pin the `map.seedInitialInventory?.(stations)` call. Without seeding,
  // every producing-state slot stays at exactly the starterFillRatio (0.5).
  // With seeding (mocked random alternating between 0 and 1), per-slot
  // ratios diverge to either lowerBound or upperBound while the universe
  // sum still hits universeWareFraction × totalMax. Result: many slots
  // land >0.1 from 0.5. Skipping the seeding hook keeps every slot at 0.5.
  const originalRandom = Math.random;
  let randomCallCounter = 0;
  Math.random = () => {
    // Alternate between 0 (lowerBound) and 1 (upperBound) so per-slot
    // ratios diverge while the average still ≈ 0.5 (so scale ≈ 1).
    return (randomCallCounter++) % 2 === 0 ? 0 : 0.999;
  };
  let simulation: Simulation;
  try {
    simulation = freshSim();
  } finally {
    Math.random = originalRandom;
  }
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

  simulation.dispose();
});
