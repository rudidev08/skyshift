// Per-nation sector scorers — each returns higher = better; `-Infinity` means
// unbuildable. Each scorer is authored personality (alongside color, name pool,
// etc.) — kept here in data/ even though it imports runtime types from src/,
// because the per-nation logic IS game data. Phrases in quotes match
// each nation's `desire` string in data/nations.ts.
//
// Design intent:
//   HUB — closest to existing own stations ("stewards core systems")
//   BIO — bio-nebula environment wins, tiebreak by nearest-own ("cultivates bio-prosperity")
//   ORE — mineral-rich environment wins, tiebreak by nearest-own ("mines asteroid veins")
//   SKY — deep-space environment wins, random tiebreak ("explores deep space")
//   FAR — farthest from existing own stations ("scatters frontier outposts")

import type { Sector } from "../src/sim-map-types";
import type { NationTemplate } from "./nation-types";
import type { StationTypeId } from "./station-types";
import type { Station } from "../src/sim-station-types";
import type { StationZone } from "../src/sim-station-zone-types";
import type { EnvironmentId } from "./map-environments";
import { allowedStationTypesForZone } from "../src/sim-map-environments";

export type SectorScorerContext = {
  nation: NationTemplate;
  sector: Sector;
  chosenTypeId: StationTypeId;
  ownStations: Station[];
  candidateZones: StationZone[];
  /** Diagonal of the full map in map units — used as the distance normalizer. */
  mapMaxDistance: number;
  /** Caller-supplied tie-break in [0, 1). Lets the SKY scorer break ties without
   *  reading global mutable state inside an otherwise pure scorer. */
  tieBreak: number;
};

export type SectorScorer = (sectorScorerContext: SectorScorerContext) => number;

/** Normalize a raw distance into [0, 1], then flip if the preference is "far". */
export function distanceFactor(
  distance: number,
  prefer: "near" | "far",
  mapMaxDistance: number,
): number {
  const normalized = distance / (mapMaxDistance + 1);
  return prefer === "near" ? 1 - normalized : normalized;
}

export function minDistanceToOwnStations(
  sector: Sector,
  ownStations: Station[],
): number {
  if (ownStations.length === 0) return 0;
  return Math.min(
    ...ownStations.map((station) =>
      Math.hypot(sector.x - station.x, sector.y - station.y),
    ),
  );
}

function nearestOwnStationFactor(
  sectorScorerContext: SectorScorerContext,
  prefer: "near" | "far",
): number {
  return distanceFactor(
    minDistanceToOwnStations(
      sectorScorerContext.sector,
      sectorScorerContext.ownStations,
    ),
    prefer,
    sectorScorerContext.mapMaxDistance,
  );
}

function environmentMatchBonus(
  sector: Sector,
  preferredEnvironment: EnvironmentId,
): 0 | 1 {
  return sector.environment === preferredEnvironment ? 1 : 0;
}

export function sectorCanHostChosenType(sectorTypeFitContext: {
  sector: Sector;
  chosenTypeId: StationTypeId;
  candidateZones: StationZone[];
}): boolean {
  for (const zone of sectorTypeFitContext.candidateZones) {
    if (zone.sector.id !== sectorTypeFitContext.sector.id) continue;
    const allowed = allowedStationTypesForZone(
      zone.environmentOverride,
      sectorTypeFitContext.sector.environment,
    );
    if (allowed.includes(sectorTypeFitContext.chosenTypeId)) return true;
  }
  return false;
}

function scoreSectorForHub(sectorScorerContext: SectorScorerContext): number {
  if (!sectorCanHostChosenType(sectorScorerContext)) return -Infinity;
  return nearestOwnStationFactor(sectorScorerContext, "near");
}

function scoreSectorForBio(sectorScorerContext: SectorScorerContext): number {
  if (!sectorCanHostChosenType(sectorScorerContext)) return -Infinity;
  return (
    environmentMatchBonus(sectorScorerContext.sector, "bio-nebula") +
    nearestOwnStationFactor(sectorScorerContext, "near")
  );
}

function scoreSectorForOre(sectorScorerContext: SectorScorerContext): number {
  if (!sectorCanHostChosenType(sectorScorerContext)) return -Infinity;
  return (
    environmentMatchBonus(sectorScorerContext.sector, "mineral-rich") +
    nearestOwnStationFactor(sectorScorerContext, "near")
  );
}

function scoreSectorForSky(sectorScorerContext: SectorScorerContext): number {
  if (!sectorCanHostChosenType(sectorScorerContext)) return -Infinity;
  return (
    environmentMatchBonus(sectorScorerContext.sector, "deep-space") +
    sectorScorerContext.tieBreak
  );
}

function scoreSectorForFar(sectorScorerContext: SectorScorerContext): number {
  if (!sectorCanHostChosenType(sectorScorerContext)) return -Infinity;
  return nearestOwnStationFactor(sectorScorerContext, "far");
}

/** Dispatch table keyed by Nation.id. Passing an unknown id returns undefined. */
export const sectorScorerByNation: Record<string, SectorScorer> = {
  hub: scoreSectorForHub,
  bio: scoreSectorForBio,
  ore: scoreSectorForOre,
  sky: scoreSectorForSky,
  far: scoreSectorForFar,
};
