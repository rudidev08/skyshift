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
import { allNations } from "../data/nations";
import { isStationProducing } from "./sim-station";

// EmigrationIntensity → fraction of each nation's eligible stations to pick at trigger time.
const INTENSITY_FRACTIONS: Record<EmigrationIntensity, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
};

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
 *  stations (G1 + G2 + producing), take a randomized `fraction` slice (at
 *  least 1). Returned `selected` is the union across all participating nations
 *  and feeds back into per-nation eligibility checks to prevent re-picking.
 *
 *  Re-checks G1/G2 before each pick: `eligibleStationsForNation` is a snapshot
 *  at iteration start, but a single nation that holds 2+ of a sparse type can
 *  pick both in one shuffle pass. The per-pick recheck closes that — once an
 *  earlier pick drops a type's universe count to 1, the next candidate of
 *  that type fails G1 and is skipped. Picks counted toward `fraction` only
 *  when committed; under-shoots the target rather than violating invariants. */
export function selectStationsForEmigration(
  stationManager: StationManager,
  intensity: EmigrationIntensity,
): { selected: Station[]; nationIds: Set<string> } {
  const fraction = INTENSITY_FRACTIONS[intensity];
  const selected: Station[] = [];
  const nationIds = new Set<string>();
  for (const nation of allNations.filter((candidate) => candidate.participatesInEmigration)) {
    const eligible = eligibleStationsForNation(stationManager, nation, selected);
    if (eligible.length === 0) continue;
    const targetCount = Math.max(1, Math.round(fraction * eligible.length));
    const picks = [...eligible];
    shuffleInPlace(picks);
    let pickedFromThisNation = 0;
    const alreadyPickedIds = new Set(selected.map((station) => station.id));
    for (const candidate of picks) {
      if (pickedFromThisNation >= targetCount) break;
      if (!isCandidateStillEligible(stationManager, candidate, nation, alreadyPickedIds)) continue;
      selected.push(candidate);
      alreadyPickedIds.add(candidate.id);
      nationIds.add(nation.id);
      pickedFromThisNation++;
    }
  }
  return { selected, nationIds };
}

/** Stations that would be selected if a trigger fired right now. Runs the
 *  same G1 + G2 + producing eligibility filter as `triggerEvent` across
 *  every emigration-participating nation. Drives the panel's preview. */
export function countEligibleStations(stationManager: StationManager): number {
  const picked: Station[] = [];
  for (const nation of allNations.filter((candidate) => candidate.participatesInEmigration)) {
    const eligible = eligibleStationsForNation(stationManager, nation, picked);
    for (const station of eligible) picked.push(station);
  }
  return picked.length;
}

/** Stations eligible for emigration (G1 + G2 + producing). `alreadyPickedInThisEvent`
 *  is the union across nations so far. */
function eligibleStationsForNation(
  stationManager: StationManager,
  nation: Nation,
  alreadyPickedInThisEvent: Station[],
): Station[] {
  const liveStationsForNation = stationManager
    .getStations()
    .filter((station) => station.nation.id === nation.id);
  const producingOfThisNation = liveStationsForNation.filter((station) => isStationProducing(station));
  const alreadyPickedIds = new Set(alreadyPickedInThisEvent.map((station) => station.id));
  return producingOfThisNation.filter((candidate) => {
    if (alreadyPickedIds.has(candidate.id)) return false;
    return isCandidateStillEligible(stationManager, candidate, nation, alreadyPickedIds);
  });
}

/** True if `candidate` passes both G1 (not the universe's last producing
 *  station of its type) and G2 (not the nation's last of its primary type),
 *  given `alreadyPickedIds` already taken in this event. Used by both
 *  `eligibleStationsForNation` (snapshot filter) and `selectStationsForEmigration`
 *  (per-pick recheck). */
function isCandidateStillEligible(
  stationManager: StationManager,
  candidate: Station,
  nation: Nation,
  alreadyPickedIds: Set<string>,
): boolean {
  // G2: not the last of the nation's primary type.
  if (candidate.stationType.id === nation.primaryBuildableStationTypeId) {
    if (countNationPrimaryProducingExcludingPicked(stationManager, nation, alreadyPickedIds) <= 1)
      return false;
  }
  // G1: not the universe's last of its type (across all nations, excluding already-picked).
  if (isUniverseLastOfType(stationManager, candidate, alreadyPickedIds)) return false;
  return true;
}

function countNationPrimaryProducingExcludingPicked(
  stationManager: StationManager,
  nation: Nation,
  alreadyPickedIds: Set<string>,
): number {
  let count = 0;
  for (const station of stationManager.getStations()) {
    if (station.nation.id !== nation.id) continue;
    if (!isStationProducing(station)) continue;
    if (station.stationType.id !== nation.primaryBuildableStationTypeId) continue;
    if (alreadyPickedIds.has(station.id)) continue;
    count++;
  }
  return count;
}

/** Is this candidate the universe's last producing station of its type?
 *  Counts producing stations across all nations, excluding already-picked. */
function isUniverseLastOfType(
  stationManager: StationManager,
  candidate: Station,
  alreadyPickedIds: Set<string>,
): boolean {
  let count = 0;
  for (const station of stationManager.getStations()) {
    if (!isStationProducing(station)) continue;
    if (station.stationType.id !== candidate.stationType.id) continue;
    if (alreadyPickedIds.has(station.id)) continue;
    count++;
  }
  return count <= 1;
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
  const pick = remaining[Math.floor(Math.random() * remaining.length)];
  usedDestinations.push(pick);
  return pick;
}

function shuffleInPlace<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
