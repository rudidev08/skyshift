// Per-nation rules for "where should this nation build its next station?"
//
// During a build attempt, src/sim-nation-manager.ts loops over every sector
// and calls the nation's scorer once per sector. The highest-scoring sector
// wins, and a random candidate zone inside it becomes the build site — zones
// inside the same sector are treated as equivalent for scoring. The manager
// also rolls PERSONALITY_PICK_CHANCE before scoring at all: the losing share
// of builds takes a uniform-random legal zone, so placement stays personality-
// driven rather than personality-perfect.
//
// Every scorer first checks sectorCanHostChosenType and returns -Infinity
// when no zone in the sector allows the chosen station type, so those
// sectors drop out of the running.
//
// Per-nation flavor — what each scorer optimizes for. Bio, ore, and sky each
// prefer a specific sector environment (bio-nebula, mineral-rich, deep-space);
// hub and far ignore environment and score purely by distance to existing
// stations.
//   hub — closest to existing own stations (stewards core systems)
//   bio — prefers bio-nebula sectors, tiebreak by nearest-own (cultivates bio-prosperity)
//   ore — prefers mineral-rich sectors, tiebreak by nearest-own (mines asteroid veins)
//   sky — prefers deep-space sectors, random tiebreak (explores deep space)
//   far — farthest from existing own stations (scatters frontier outposts)

import type { Sector } from "./sim-map-types";
import type { BuildingNationId, NationTemplate } from "../data/nation-types";
import type { StationTypeId } from "../data/station-types";
import type { Station } from "./sim-station-types";
import type { StationZone } from "./sim-station-zone-types";
import type { SectorEnvironmentId } from "../data/map-sector-environments";
import { allowedStationTypesForZone } from "./sim-map-sector-environments";

/** Per-sector input passed to a scorer. The fields after `sector` stay
 *  constant across all sectors of one build attempt; `sector` and `tieBreak`
 *  are the only fields that change between calls. */
export type SectorScorerContext = {
  nation: NationTemplate;
  sector: Sector;
  chosenTypeId: StationTypeId;
  ownStations: Station[];
  candidateZones: StationZone[];
  /** The longest distance between any two points on the map — corner-to-corner
   *  across the bounding box. Distance from a sector to the closest own
   *  station is divided by this so the distance term stays in 0..1, regardless
   *  of how big the map is. */
  mapMaxDistance: number;
  /** Random number in [0, 1). Only the sky scorer uses it, and that scorer
   *  ignores distance — without a tie-breaker every deep-space sector would
   *  score identically and the first one in iteration order would always win.
   *  The caller passes Math.random() so the scorer stays a pure function of
   *  its inputs. */
  tieBreak: number;
};

/** Returns a score for one sector. The caller compares scores across sectors
 *  and picks the highest. -Infinity drops the sector from the running. */
export type SectorScorer = (context: SectorScorerContext) => number;

/** Map-unit distance from a sector to the closest station this nation already
 *  owns. Returns 0 when the nation has no stations yet (first build). */
export function minDistanceToOwnStations(sector: Sector, ownStations: Station[]): number {
  if (ownStations.length === 0) return 0;
  return Math.min(...ownStations.map((station) => Math.hypot(sector.x - station.x, sector.y - station.y)));
}

/** Distance factor in 0..1 for the current sector. With prefer = "near", the
 *  closest-to-own sector scores 1 and the farthest scores 0; "far" inverts. */
function nearestOwnStationFactor(context: SectorScorerContext, prefer: "near" | "far"): number {
  const distance = minDistanceToOwnStations(context.sector, context.ownStations);
  const normalized = distance / (context.mapMaxDistance + 1);
  return prefer === "near" ? 1 - normalized : normalized;
}

/** 1 when the sector's environment matches the nation's preference, 0 otherwise.
 *  Stacked with the 0..1 distance factor, so a matching environment always
 *  beats any non-matching sector regardless of distance. */
function environmentMatchBonus(sector: Sector, preferredSectorEnvironment: SectorEnvironmentId): 0 | 1 {
  return sector.environment === preferredSectorEnvironment ? 1 : 0;
}

/** True when at least one candidate zone in this sector allows the chosen
 *  station type. Every scorer gates on this first and returns -Infinity when
 *  it's false, so unhostable sectors drop out of the running. */
export function sectorCanHostChosenType(context: SectorScorerContext): boolean {
  for (const zone of context.candidateZones) {
    if (zone.sector.id !== context.sector.id) continue;
    const allowed = allowedStationTypesForZone(zone);
    if (allowed.includes(context.chosenTypeId)) return true;
  }
  return false;
}

function scoreSectorForHub(context: SectorScorerContext): number {
  if (!sectorCanHostChosenType(context)) return -Infinity;
  return nearestOwnStationFactor(context, "near");
}

function scoreSectorForBio(context: SectorScorerContext): number {
  if (!sectorCanHostChosenType(context)) return -Infinity;
  return environmentMatchBonus(context.sector, "bio-nebula") + nearestOwnStationFactor(context, "near");
}

function scoreSectorForOre(context: SectorScorerContext): number {
  if (!sectorCanHostChosenType(context)) return -Infinity;
  return environmentMatchBonus(context.sector, "mineral-rich") + nearestOwnStationFactor(context, "near");
}

function scoreSectorForSky(context: SectorScorerContext): number {
  if (!sectorCanHostChosenType(context)) return -Infinity;
  return environmentMatchBonus(context.sector, "deep-space") + context.tieBreak;
}

function scoreSectorForFar(context: SectorScorerContext): number {
  if (!sectorCanHostChosenType(context)) return -Infinity;
  return nearestOwnStationFactor(context, "far");
}

/** Scorer per building nation, keyed by Nation.id. Typed as a full Record so
 *  dropping a scorer for an id in `BuildingNationId` fails the typecheck. The
 *  type can't see a new `buildsStations` nation whose id isn't in that union —
 *  the lookup in sim-nation-manager.ts throws on a missing scorer instead. */
export const sectorScorerByNation: Record<BuildingNationId, SectorScorer> = {
  hub: scoreSectorForHub,
  bio: scoreSectorForBio,
  ore: scoreSectorForOre,
  sky: scoreSectorForSky,
  far: scoreSectorForFar,
};
