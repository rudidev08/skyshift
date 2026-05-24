// Per-nation expansion driver. A nation's in-flight build is derived from the
// station roster — the Station with state === "building" and nation.id === N —
// so there's no parallel id map to keep in sync or persist.
//
// Build type is picked by ware scarcity + nation personality, pre-filtered to
// types with a legal free zone. Sector scoring uses the chosen typeId so
// contracted off-roster builds land in legal sectors.

import type { Sector } from "./sim-map-types";
import type { StationTypeId } from "../data/station-types";
import type { Station } from "./sim-station-types";
import type { Nation } from "./sim-nation";
import type { StationZone } from "./sim-station-zone-types";
import { sectorEnvironmentById } from "../data/map-sector-environments";
import { allowedStationTypesForZone } from "./sim-map-sector-environments";
import { allNations } from "../data/nations";
import { getStationTypeTemplate } from "./sim-station-template";
import { getWareTemplate } from "./sim-ware-template";
import { sectorScorerByNation, type SectorScorer } from "../data/nation-personality";
import { isStationProducing } from "./sim-station";
import type { NamePool } from "./sim-name-pool";
import type { StationManager } from "./sim-station-manager";
import { allWares } from "../data/wares";

// Nominal build duration for rate-based scarcity math — spreads in-flight
// build-ware demand across time so scarcity scoring isn't spiked by the
// instantaneous `waresRequired` total.
const NOMINAL_BUILD_DURATION_SECONDS = 40 * 60; // 40 sim-minutes

// All station types any nation can ever build, deduped across sector environments.
// Computed once at module load since sectorEnvironmentById never changes at runtime.
const ALL_BUILDABLE_STATION_TYPES: StationTypeId[] = [
  ...new Set(
    Object.values(sectorEnvironmentById).flatMap(
      (sectorEnvironment) => sectorEnvironment.allowedStationTypeIds,
    ),
  ),
];

/** Shared inputs for scoring every candidate station type in one pickNextBuildType run. */
interface BuildScoringContext {
  nation: Nation;
  scarcity: Map<string, number>;
  ownCountByType: Map<StationTypeId, number>;
  occupiedZoneIds: Set<string>;
}

export class NationManager {
  /** Runtime zone list created from map.stationZones + sectors. */
  private readonly zones: StationZone[];
  private readonly sectors: Sector[];
  private readonly stationManager: StationManager;
  /** Diagonal of the map's bounding box — sector-scorer distance normalization
   *  divides by this so distance terms stay in 0..1 regardless of map size. */
  private readonly mapMaxDistance: number;
  private readonly namePool: NamePool;

  constructor(dependencies: {
    zones: StationZone[];
    sectors: Sector[];
    stationManager: StationManager;
    mapMaxDistance: number;
    namePool: NamePool;
  }) {
    this.zones = dependencies.zones;
    this.sectors = dependencies.sectors;
    this.stationManager = dependencies.stationManager;
    this.mapMaxDistance = dependencies.mapMaxDistance;
    this.namePool = dependencies.namePool;
  }

  /** Nations that build stations, ordered by Nation.id so concurrent zone
   *  choices are deterministic across runs. */
  private buildingNationsInOrder(): Nation[] {
    return allNations
      .filter((nation) => nation.buildsStations)
      .sort((leftNation, rightNation) => leftNation.id.localeCompare(rightNation.id));
  }

  /** Initialize expansion at game start — one building station per nation. */
  startInitialStationBuilds(): void {
    for (const nation of this.buildingNationsInOrder()) {
      this.startNextStationBuild(nation);
    }
  }

  /** Runs on the slow simulation tick (~5 sim seconds), not every frame. Each
   *  building nation with no station currently under construction starts the
   *  next one — the in-flight build is the nation's own "building" station. */
  tick(): void {
    for (const nation of this.buildingNationsInOrder()) {
      if (!this.findBuildingStationFor(nation.id)) {
        this.startNextStationBuild(nation);
      }
    }
  }

  /** This nation's station currently under construction, or undefined if none.
   *  A nation has at most one because the manager starts the next build only
   *  after the previous flips out of "building". */
  private findBuildingStationFor(nationId: string): Station | undefined {
    return this.stationManager
      .getStations()
      .find((station) => station.nation.id === nationId && station.state === "building");
  }

  /** Pick build type, pick preferred zone, place the building station.
   *  Does nothing if no sitable zone exists. */
  private startNextStationBuild(nation: Nation): void {
    // Compute occupied-zone ids once and thread through per-type checks —
    // otherwise hasFreeZoneAllowingType rescans every zone per candidate type.
    const occupiedZoneIds = this.computeOccupiedZoneIds();

    const decision = this.pickNextBuildType(nation, occupiedZoneIds);
    if (!decision) return;

    const zone = this.pickPreferredBuildZone(nation, decision.typeId, occupiedZoneIds);
    if (!zone) return;

    this.stationManager.placeBuild({
      zoneId: zone.id,
      typeId: decision.typeId,
      size: zone.size,
      nationId: nation.id,
      contractingNationId: decision.contractingNationId,
      x: zone.x,
      y: zone.y,
      name: this.namePool.claimStationName(nation),
    });
  }

  /** Score sectors via the nation's personality scorer and return the highest-
   *  scoring zone. The first zone of the winning sector is picked since zones
   *  inside a sector are equivalent for scoring purposes. */
  private pickPreferredBuildZone(
    nation: Nation,
    typeId: StationTypeId,
    occupiedZoneIds: Set<string>,
  ): StationZone | null {
    const scorer = (sectorScorerByNation as Record<string, SectorScorer | undefined>)[nation.id];
    if (!scorer) return null;

    const ownStations = this.ownStations(nation);
    const candidateZones = this.freeZonesAllowingType(typeId, occupiedZoneIds);
    if (candidateZones.length === 0) return null;

    const zonesBySectorId = groupZonesBySectorId(candidateZones);

    const candidates: { zone: StationZone; score: number }[] = [];
    for (const sector of this.sectors) {
      // Skip sectors with no candidate zones before paying for the scorer.
      const zonesInSector = zonesBySectorId.get(sector.id);
      if (!zonesInSector) continue;
      const score = scorer({
        nation,
        sector,
        chosenTypeId: typeId,
        ownStations,
        candidateZones,
        mapMaxDistance: this.mapMaxDistance,
        tieBreak: Math.random(),
      });
      if (score === -Infinity) continue;
      candidates.push({ zone: zonesInSector[0], score });
    }
    if (candidates.length === 0) return null;
    candidates.sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score);
    return candidates[0].zone;
  }

  /** Every live station owned by the given nation. */
  private ownStations(nation: Nation): Station[] {
    return this.stationManager.getStationsForNation(nation.id);
  }

  /** Zone ids currently occupied by any placed station. Computed once per
   *  build tick and threaded through per-type helpers to avoid re-scanning. */
  private computeOccupiedZoneIds(): Set<string> {
    const occupiedZoneIds = new Set<string>();
    for (const station of this.stationManager.getStations()) {
      if (station.zoneId) occupiedZoneIds.add(station.zoneId);
    }
    return occupiedZoneIds;
  }

  /** Free zones (no placed station) that allow the given type. */
  private freeZonesAllowingType(typeId: StationTypeId, occupiedZoneIds: Set<string>): StationZone[] {
    return this.zones.filter((zone) => {
      if (occupiedZoneIds.has(zone.id)) return false;
      const allowed = allowedStationTypesForZone(zone);
      return allowed.includes(typeId);
    });
  }

  /** Any sitable free zone for this type? Cheaper than freeZonesAllowingType when the caller only needs existence. */
  private hasFreeZoneAllowingType(typeId: StationTypeId, occupiedZoneIds: Set<string>): boolean {
    for (const zone of this.zones) {
      if (occupiedZoneIds.has(zone.id)) continue;
      const allowed = allowedStationTypesForZone(zone);
      if (allowed.includes(typeId)) return true;
    }
    return false;
  }

  /** Does any nation have the blueprint for this type? */
  private anyNationHasBlueprint(typeId: StationTypeId): boolean {
    return allNations.some(
      (nation) => nation.buildsStations && nation.buildableStationTypeIds.includes(typeId),
    );
  }

  /** Pick a contractor nation for a type the requester can't self-build —
   *  first match in allNations order, excluding requester and non-building nations. */
  private pickContractor(typeId: StationTypeId, requesterId: string): string | undefined {
    for (const nation of allNations) {
      if (!nation.buildsStations) continue;
      if (nation.id === requesterId) continue;
      if (nation.buildableStationTypeIds.includes(typeId)) return nation.id;
    }
    return undefined;
  }

  /** Walk every station once to compute per-ware production/consumption rates
   *  across the universe. Online producers contribute their rate; in-flight
   *  builds contribute eventual production/consumption plus transient
   *  build-ware demand spread over NOMINAL_BUILD_DURATION_SECONDS. */
  private computeMapWareScarcity(): Map<string, number> {
    const production = new Map<string, number>();
    const consumption = new Map<string, number>();

    for (const station of this.stationManager.getStations()) {
      const isOnline = isStationProducing(station);
      const isBuilding = station.state === "building";
      // Online producers' rate plus in-flight builds' eventual production/consumption.
      if (isOnline || isBuilding) {
        addStationProduction(station, production);
        addStationInputConsumption(station, consumption);
      }
      if (isBuilding) addTransientBuildConsumption(station, consumption);
    }

    const scarcity = new Map<string, number>();
    for (const ware of allWares) {
      const productionRate = production.get(ware.id) ?? 0;
      const consumptionRate = consumption.get(ware.id) ?? 0;
      // 0 = surplus or balanced, 1 = no production. Wares with no demand
      // score 0 — building more producers wouldn't help.
      scarcity.set(ware.id, consumptionRate === 0 ? 0 : Math.max(0, 1 - productionRate / consumptionRate));
    }

    return scarcity;
  }

  /** Per-station-type count for this nation's currently-placed stations. */
  private countOwnStationsByType(nation: Nation): Map<StationTypeId, number> {
    const ownCountByType = new Map<StationTypeId, number>();
    for (const station of this.stationManager.getStations()) {
      if (station.nation.id !== nation.id) continue;
      ownCountByType.set(station.stationType.id, (ownCountByType.get(station.stationType.id) ?? 0) + 1);
    }
    return ownCountByType;
  }

  /** Score one station type for new construction by this nation. Returns null
   *  if the type is ineligible (no blueprint anywhere, or no free zone allows it). */
  private scoreStationTypeForNewConstruction(
    typeId: StationTypeId,
    context: BuildScoringContext,
  ): { score: number; isBlueprint: boolean } | null {
    const { nation, scarcity, ownCountByType, occupiedZoneIds } = context;
    const isBlueprint = nation.buildableStationTypeIds.includes(typeId);
    if (!isBlueprint && !this.anyNationHasBlueprint(typeId)) return null;
    if (!this.hasFreeZoneAllowingType(typeId, occupiedZoneIds)) return null;

    const stationType = getStationTypeTemplate(typeId);
    const ownCount = ownCountByType.get(typeId) ?? 0;
    const isPrimary = typeId === nation.primaryBuildableStationTypeId;

    // First two primaries get a thumb on the scale so a nation seeds its
    // identity type before chasing scarcity. After that the ×3 scarcity weight
    // dominates — universe needs trump nation flavor.
    const primaryBonus = isPrimary && ownCount < 2 ? 2 : 0;
    const wareScores = stationType.produces.map((wareId) => scarcity.get(wareId) ?? 0);
    const wareScarcity =
      wareScores.length > 0 ? wareScores.reduce((sum, score) => sum + score, 0) / wareScores.length : 0;
    const scarcityBonus = 3 * wareScarcity;

    const score = 1 + primaryBonus + scarcityBonus;
    return { score, isBlueprint };
  }

  /** Scarcity-aware build-type picker. Runs at build-start per nation. */
  private pickNextBuildType(
    nation: Nation,
    occupiedZoneIds: Set<string>,
  ): { typeId: StationTypeId; contractingNationId?: string } | null {
    const context: BuildScoringContext = {
      nation,
      scarcity: this.computeMapWareScarcity(),
      ownCountByType: this.countOwnStationsByType(nation),
      occupiedZoneIds,
    };

    let bestCandidate: { typeId: StationTypeId; score: number; isBlueprint: boolean } | null = null;
    for (const typeId of ALL_BUILDABLE_STATION_TYPES) {
      const result = this.scoreStationTypeForNewConstruction(typeId, context);
      if (!result) continue;
      if (!bestCandidate || result.score > bestCandidate.score) bestCandidate = { typeId, ...result };
    }

    if (!bestCandidate) return null;
    return {
      typeId: bestCandidate.typeId,
      contractingNationId: bestCandidate.isBlueprint
        ? undefined
        : this.pickContractor(bestCandidate.typeId, nation.id),
    };
  }

  /** Station id of this nation's in-flight build, or undefined if none.
   *  Derived from the roster — building stations persist in the station
   *  snapshot, so this survives save/load without a parallel id map. */
  getCurrentBuildStationId(nationId: string): string | undefined {
    return this.findBuildingStationFor(nationId)?.id;
  }
}

/** Group candidate zones by sector id once so the per-sector scoring loop
 *  does O(1) lookups instead of re-filtering. Each bucket is sorted by zone id
 *  so the chosen zone (first in the bucket) is deterministic across runs. */
function groupZonesBySectorId(candidateZones: StationZone[]): Map<string, StationZone[]> {
  const zonesBySectorId = new Map<string, StationZone[]>();
  for (const zone of candidateZones) {
    const list = zonesBySectorId.get(zone.sector.id);
    if (list) list.push(zone);
    else zonesBySectorId.set(zone.sector.id, [zone]);
  }
  for (const list of zonesBySectorId.values()) {
    list.sort((leftZone, rightZone) => leftZone.id.localeCompare(rightZone.id));
  }
  return zonesBySectorId;
}

function addStationProduction(station: Station, production: Map<string, number>): void {
  for (const producedWareId of station.stationType.produces) {
    const produced = getWareTemplate(producedWareId);
    if (produced.productionOutput > 0) {
      production.set(
        producedWareId,
        (production.get(producedWareId) ?? 0) + produced.productionOutput * station.sizeMultiplier,
      );
    }
  }
}

function addStationInputConsumption(station: Station, consumption: Map<string, number>): void {
  for (const producedWareId of station.stationType.produces) {
    const produced = getWareTemplate(producedWareId);
    for (const input of produced.productionInputs) {
      consumption.set(
        input.wareId,
        (consumption.get(input.wareId) ?? 0) + input.unitsPerTick * station.sizeMultiplier,
      );
    }
  }
}

/** Spread `waresRequired` across NOMINAL_BUILD_DURATION_SECONDS so scarcity scoring isn't spiked by the instantaneous total. */
function addTransientBuildConsumption(station: Station, consumption: Map<string, number>): void {
  if (!station.build) return;
  for (const [buildWareId, amount] of Object.entries(station.build.waresRequired)) {
    consumption.set(
      buildWareId,
      (consumption.get(buildWareId) ?? 0) + amount / NOMINAL_BUILD_DURATION_SECONDS,
    );
  }
}
