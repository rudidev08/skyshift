// Emigration decision logic — given the current map and station roster, compute
// which stations are eligible to emigrate and which the trigger should pick.
//
// Pure read-only logic. Selection respects two guards: G1 (don't pick the
// universe's last producing station of a type) and G2 (don't pick the nation's
// last station of its primary type). `selectStationsForEmigration` and
// `countEligibleStations` use the same eligibility filter so the panel preview
// matches what `triggerEvent` will actually fire.
//
// Destination drawing and empty-zone counting live here too — both are pure
// queries the manager makes during trigger / per-tick decision-making.

import type { Nation } from "./sim-nation";
import type { Station } from "./sim-station-types";
import type { GameMap } from "./sim-map-types";
import type { StationManager } from "./sim-station-manager";
import type { EmigrationIntensity } from "./sim-emigration-types";
import type { BuildingNationId } from "../data/nation-types";
import { allNations } from "../data/nations";
import { isStationProducing } from "./sim-station";
import { rankStationsForEmigration } from "./sim-emigration-ranking";

// Fraction of each nation's eligible stations picked per trigger, keyed by intensity.
const INTENSITY_FRACTIONS: Record<EmigrationIntensity, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
};

// Chance a pick takes the most out-of-step station rather than a uniform-random
// one - the single tuning dial for personality-driven emigration. 0 reproduces
// the old uniform draw; 1 always takes the worst-fitting first.
//
// Worked example - a 12-station nation losing 6 (medium intensity). Chance each
// station is removed, sorted most out of step -> most on pattern:
//
//   100  100  97  88  68  39  18  18  18  18  18  18   (%)
//
// The most out-of-step go near-certainly; on-pattern stations settle near 18%
// each, versus 50% under a uniform draw.
const PERSONALITY_PICK_CHANCE = 0.7;

const DESTINATION_POOL = [
  "The Long Drift",
  "Outer Rim",
  "The Pale Reach",
  "Sector Wake",
  "Beyond the Net",
  "The Hollow Lanes",
  "The Quiet Rim",
  "Last Frequencies",
  "The Unclaimed",
  "Edge of Charts",
  "Deep Wake",
  "The Far Silence",
  "Past the Dials",
  "The Ninth Drift",
  "Open Sky",
  "Null Horizon",
];

/** Pick stations to emigrate, scaled by intensity. Per nation: filter eligible
 *  stations (G1 + G2 + producing), rank them most-likely-to-emigrate first
 *  (sim-emigration-ranking.ts), then fill the intensity-fraction quota with the
 *  ranked roll - PERSONALITY_PICK_CHANCE of each pick takes the top of the
 *  ranking, the rest take a uniform-random station. Re-checks G1/G2 per pick; a
 *  guard-failing candidate is dropped from the pool and the slot re-rolls. */
export function selectStationsForEmigration(
  stationManager: StationManager,
  intensity: EmigrationIntensity,
  map: GameMap,
): { selected: Station[]; nationIds: Set<string> } {
  const fraction = INTENSITY_FRACTIONS[intensity];
  const selected: Station[] = [];
  const nationIds = new Set<string>();
  collectEligibleByNation(stationManager, selected, (nation, eligible) => {
    if (eligible.length === 0) return;
    const targetCount = Math.max(1, Math.round(fraction * eligible.length));
    let pickedFromThisNation = 0;
    const producing = stationManager
      .getStationsForNation(nation.id)
      .filter((station) => isStationProducing(station));
    const pool = rankStationsForEmigration(nation.id as BuildingNationId, eligible, producing, map);
    const alreadyPickedIds = new Set(selected.map((station) => station.id));
    while (pickedFromThisNation < targetCount && pool.length > 0) {
      const index = rollEmigrationPickIndex(pool.length);
      const candidate = pool[index];
      pool.splice(index, 1);
      if (!passesEmigrationGuards(stationManager, candidate, nation, alreadyPickedIds)) continue;
      selected.push(candidate);
      alreadyPickedIds.add(candidate.id);
      nationIds.add(nation.id);
      pickedFromThisNation++;
    }
  });
  return { selected, nationIds };
}

/** Index into the ranked pool for one pick: PERSONALITY_PICK_CHANCE of the time
 *  the top of the ranking (most out of step), otherwise a uniform-random slot. */
function rollEmigrationPickIndex(poolLength: number): number {
  if (Math.random() < PERSONALITY_PICK_CHANCE) return 0;
  return Math.floor(Math.random() * poolLength);
}

/** Total stations passing G1 + G2 + producing across all emigration-participating
 *  nations — before the intensity fraction is applied. Drives the panel's preview. */
export function countEligibleStations(stationManager: StationManager): number {
  const picked: Station[] = [];
  collectEligibleByNation(stationManager, picked, (_nation, eligible) => {
    for (const station of eligible) picked.push(station);
  });
  return picked.length;
}

/** Walk every emigration-participating nation, computing its eligible stations
 *  against the running `accumulator` (so later nations see earlier picks) and
 *  handing them to `visit`. `visit` pushes whatever it picks back into the
 *  same `accumulator`. */
function collectEligibleByNation(
  stationManager: StationManager,
  accumulator: Station[],
  visit: (nation: Nation, eligible: Station[]) => void,
): void {
  for (const nation of allNations.filter((candidate) => candidate.participatesInEmigration)) {
    const eligible = eligibleStationsForNation(stationManager, nation, accumulator);
    visit(nation, eligible);
  }
}

/** Stations eligible for emigration (G1 + G2 + producing). `alreadyPickedInThisEvent`
 *  is the union across nations so far. */
function eligibleStationsForNation(
  stationManager: StationManager,
  nation: Nation,
  alreadyPickedInThisEvent: Station[],
): Station[] {
  const liveStationsForNation = stationManager.getStationsForNation(nation.id);
  const producingOfThisNation = liveStationsForNation.filter((station) => isStationProducing(station));
  const alreadyPickedIds = new Set(alreadyPickedInThisEvent.map((station) => station.id));
  return producingOfThisNation.filter((candidate) => {
    if (alreadyPickedIds.has(candidate.id)) return false;
    return passesEmigrationGuards(stationManager, candidate, nation, alreadyPickedIds);
  });
}

/** True if `candidate` passes both G1 (not the universe's last producing
 *  station of its type) and G2 (not the nation's last of its primary type),
 *  given `alreadyPickedIds` already taken in this event. Used by both
 *  `eligibleStationsForNation` (snapshot filter) and `selectStationsForEmigration`
 *  (per-pick recheck). */
function passesEmigrationGuards(
  stationManager: StationManager,
  candidate: Station,
  nation: Nation,
  alreadyPickedIds: Set<string>,
): boolean {
  // G2: not the last of the nation's primary type.
  if (candidate.stationType.id === nation.primaryBuildableStationTypeId) {
    const nationPrimaryCount = countProducingStations(
      stationManager,
      alreadyPickedIds,
      (station) =>
        station.nation.id === nation.id &&
        station.stationType.id === nation.primaryBuildableStationTypeId,
    );
    if (nationPrimaryCount <= 1) return false;
  }
  // G1: not the universe's last of its type (across all nations, excluding already-picked).
  const universeTypeCount = countProducingStations(
    stationManager,
    alreadyPickedIds,
    (station) => station.stationType.id === candidate.stationType.id,
  );
  if (universeTypeCount <= 1) return false;
  return true;
}

/** Count producing stations not already picked in this event that also match
 *  `predicate`. Backs both G1 (universe-last-of-type) and G2 (nation's last of
 *  its primary type) — each supplies its own station-type predicate. */
function countProducingStations(
  stationManager: StationManager,
  alreadyPickedIds: Set<string>,
  predicate: (station: Station) => boolean,
): number {
  let count = 0;
  for (const station of stationManager.getStations()) {
    if (!isStationProducing(station)) continue;
    if (alreadyPickedIds.has(station.id)) continue;
    if (!predicate(station)) continue;
    count++;
  }
  return count;
}

/** Zones with no live station. The manager auto-triggers an event when this
 *  drops to or below its `autoTriggerThreshold` to free up space. */
export function emptyZoneCount(map: GameMap, stationManager: StationManager): number {
  const occupied = new Set<string>();
  for (const station of stationManager.getStations()) {
    if (station.zoneId) occupied.add(station.zoneId);
  }
  return Math.max(0, map.stationZones.length - occupied.size);
}

/** Pick the next destination name, recycling the pool once exhausted. Mutates
 *  `usedDestinations` in place — caller owns the array (it's lifecycle state
 *  on the manager, included in the snapshot). */
export function drawAndRecordDestination(usedDestinations: string[]): string {
  if (usedDestinations.length === DESTINATION_POOL.length) usedDestinations.length = 0;
  const remaining = DESTINATION_POOL.filter((destination) => !usedDestinations.includes(destination));
  const pickedDestination = remaining[Math.floor(Math.random() * remaining.length)];
  usedDestinations.push(pickedDestination);
  return pickedDestination;
}
