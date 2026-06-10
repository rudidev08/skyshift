// Per-nation rules that rank a nation's eligible stations by how likely each is
// to emigrate - most out of step with how the nation builds, first. Consumed by
// the ranked roll in sim-emigration-decision.ts. Pure sim code; no Phaser, no DOM.

import type { Station } from "./sim-station-types";
import type { GameMap, Sector } from "./sim-map-types";
import type { BuildingNationId } from "../data/nation-types";
import { findSectorAtPosition } from "./sim-sector-lookup";

// Two HUB stations join one cluster when within this many sector-widths of each
// other. Wider than ambient traffic's 0.7 - "same core" is a looser grouping
// than "close enough to draw flavor dots between."
const HUB_CLUSTER_DISTANCE_MULTIPLIER = 1.5;

/** Group stations into clusters - two share a cluster when within `maxDistance`
 *  of each other, transitively - and return the largest. The largest cluster of
 *  a non-empty list is itself non-empty. */
export function largestProximityCluster(stations: Station[], maxDistance: number): Station[] {
  const ungrouped = new Set(stations);
  let largest: Station[] = [];
  for (const seed of stations) {
    if (!ungrouped.has(seed)) continue;
    const cluster = collectCluster(seed, ungrouped, maxDistance);
    if (cluster.length > largest.length) largest = cluster;
  }
  return largest;
}

/** Flood-fill one cluster outward from `seed`, removing every station it
 *  reaches from `ungrouped`. */
function collectCluster(seed: Station, ungrouped: Set<Station>, maxDistance: number): Station[] {
  const cluster: Station[] = [];
  const frontier: Station[] = [seed];
  ungrouped.delete(seed);
  for (let station = frontier.pop(); station !== undefined; station = frontier.pop()) {
    cluster.push(station);
    for (const other of ungrouped) {
      if (Math.hypot(other.x - station.x, other.y - station.y) <= maxDistance) {
        ungrouped.delete(other);
        frontier.push(other);
      }
    }
  }
  return cluster;
}

/** Average position of HUB's largest station cluster - its core. `producing` is
 *  non-empty whenever HUB is ranked, so the cluster is non-empty. */
function hubClusterCenter(producing: Station[], sectorSize: number): { x: number; y: number } {
  const cluster = largestProximityCluster(producing, HUB_CLUSTER_DISTANCE_MULTIPLIER * sectorSize);
  let sumX = 0;
  let sumY = 0;
  for (const station of cluster) {
    sumX += station.x;
    sumY += station.y;
  }
  return { x: sumX / cluster.length, y: sumY / cluster.length };
}

/** Sort a copy of `stations` by distance from (x, y), farthest first - the most
 *  out-of-step station leads. */
function sortByDistanceDescending(stations: Station[], x: number, y: number): Station[] {
  return [...stations].sort((a, b) => Math.hypot(b.x - x, b.y - y) - Math.hypot(a.x - x, a.y - y));
}

/** Distance from `station` to the nearest other station in `siblings`. Infinity
 *  when it has no sibling - maximally scattered, least out of step. */
function nearestSiblingDistance(station: Station, siblings: Station[]): number {
  let nearest = Infinity;
  for (const other of siblings) {
    if (other === station) continue;
    nearest = Math.min(nearest, Math.hypot(other.x - station.x, other.y - station.y));
  }
  return nearest;
}

/** 1 when the station sits in a deep-space sector (on pattern for SKY), 0 when
 *  it does not (out of step - sorts first). */
function skySortKey(station: Station, map: GameMap): 0 | 1 {
  const sector = findSectorAtPosition(map.sectors, station.x, station.y);
  return sector?.environment === "deep-space" ? 1 : 0;
}

/** Look up a sector by id, throwing if the map lacks it - the ore and bio
 *  centers depend on named sectors that every real map defines. */
function requireSector(map: GameMap, sectorId: string): Sector {
  const sector = map.sectors.find((candidate) => candidate.id === sectorId);
  if (!sector) throw new Error(`emigration ranking: sector "${sectorId}" not found`);
  return sector;
}

function rankOreStations(eligible: Station[], _producing: Station[], map: GameMap): Station[] {
  // Hearth is ore's visual home - most asteroid fields render there. Ore builds
  // across every mineral-rich sector, but its identity centers on Hearth; the
  // out-of-step measure is distance from Hearth, not the mineral-rich environment.
  const hearth = requireSector(map, "hearth");
  return sortByDistanceDescending(eligible, hearth.x, hearth.y);
}

function rankBioStations(eligible: Station[], _producing: Station[], map: GameMap): Station[] {
  // The Overgrowth/Green Silence midpoint is bio's visual home - the celestial
  // tree sits there. Bio builds across every bio-nebula sector, but its identity
  // centers on that landmark, not the bio-nebula environment.
  const overgrowth = requireSector(map, "overgrowth");
  const greenSilence = requireSector(map, "green-silence");
  return sortByDistanceDescending(
    eligible,
    (overgrowth.x + greenSilence.x) / 2,
    (overgrowth.y + greenSilence.y) / 2,
  );
}

function rankHubStations(eligible: Station[], producing: Station[], map: GameMap): Station[] {
  const center = hubClusterCenter(producing, map.sectorSize);
  return sortByDistanceDescending(eligible, center.x, center.y);
}

function rankFarStations(eligible: Station[], producing: Station[], _map: GameMap): Station[] {
  // Out of step = close to another FAR station; FAR scatters its outposts.
  return [...eligible].sort(
    (a, b) => nearestSiblingDistance(a, producing) - nearestSiblingDistance(b, producing),
  );
}

function rankSkyStations(eligible: Station[], _producing: Station[], map: GameMap): Station[] {
  // Out of step = not in a deep-space sector; deep space is SKY's home.
  return [...eligible].sort((a, b) => skySortKey(a, map) - skySortKey(b, map));
}

type EmigrationRanking = (eligible: Station[], producing: Station[], map: GameMap) => Station[];

/** One ranking per building nation. A full Record so adding a building nation
 *  without a ranking fails the typecheck here. */
const rankingByNation: Record<BuildingNationId, EmigrationRanking> = {
  ore: rankOreStations,
  bio: rankBioStations,
  hub: rankHubStations,
  far: rankFarStations,
  sky: rankSkyStations,
};

/** Rank a nation's eligible stations most-likely-to-emigrate first. `producing`
 *  is the nation's full producing roster - HUB's cluster center and FAR's
 *  nearest-sibling measure span it; `eligible` is the post-guard subset that is
 *  actually ranked and returned. Throws for a nation without a ranking — every
 *  emigration-participating nation must be registered in `rankingByNation`. */
export function rankStationsForEmigration(
  nationId: string,
  eligible: Station[],
  producing: Station[],
  map: GameMap,
): Station[] {
  const ranking = (rankingByNation as Record<string, EmigrationRanking | undefined>)[nationId];
  if (!ranking) throw new Error(`No emigration ranking for nation ${nationId}`);
  return ranking(eligible, producing, map);
}
