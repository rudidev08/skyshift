// Per-nation expansion state — one entry per buildsStations: true nation,
// holding the station id of any in-flight build (undefined when ready to
// start a new build).
//
// Build type is picked by ware scarcity + nation personality, pre-filtered to
// types with a legal free zone. Sector scoring uses the chosen typeId so
// contracted off-roster builds land in legal sectors.

import type { Sector } from "./sim-map-types";
import type { StationTypeId } from "../data/station-types";
import type { Station } from "./sim-station-types";
import type { Nation } from "./sim-nation";
import type { StationZone } from "./sim-station-zone-types";
import type { NationExpansionSnapshot } from "./sim-save-types";
import { ENVIRONMENT_ALLOWED_TYPES } from "../data/map-environments";
import { allowedStationTypesForZone } from "./sim-map-environments";
import { allNations } from "../data/nations";
import { getStationTemplate } from "./sim-station-template";
import { getWareTemplate } from "./sim-ware-template";
import { sectorScorerByNation } from "../data/nation-personality";
import { isStationProducing } from "./sim-station";
import type { NamePool } from "./sim-name-pool";
import type { StationManager } from "./sim-station-manager";
import { allWares } from "../data/wares";

// Nominal build duration for rate-based scarcity math — spreads in-flight
// build-ware demand across time so scarcity scoring isn't spiked by the
// instantaneous `waresRequired` total.
const NOMINAL_BUILD_DURATION_SECONDS = 40 * 60; // 40 sim-minutes

// All station types any nation can ever build, deduped across environments.
// Computed once since ENVIRONMENT_ALLOWED_TYPES is a frozen authored const.
const ALL_BUILDABLE_STATION_TYPES: StationTypeId[] = Object.keys(ENVIRONMENT_ALLOWED_TYPES)
  .flatMap((environment) => ENVIRONMENT_ALLOWED_TYPES[environment as keyof typeof ENVIRONMENT_ALLOWED_TYPES])
  .filter((typeId, index, all) => all.indexOf(typeId) === index);

/** Shared inputs for scoring every candidate station type in one pickNextBuildType run. */
interface BuildScoringContext {
  nation: Nation;
  scarcity: Map<string, number>;
  ownCountByType: Map<StationTypeId, number>;
  occupiedZoneIds: Set<string>;
}

export class NationManager {
  /** Per-nation in-flight build station id; missing key means no current build. */
  private currentBuildStationIdByNation = new Map<string, string | undefined>();
  /** Runtime zone list built from map.stationZones + sectors. */
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

  /** Initialize expansion state at game start — one building station per nation,
   *  alphabetical by Nation.id so concurrent zone choices are deterministic. */
  startInitialStationBuilds(): void {
    const nations = allNations
      .filter((nation) => nation.buildsStations)
      .sort((leftNation, rightNation) => leftNation.id.localeCompare(rightNation.id));
    for (const nation of nations) {
      const placedId = this.startNextStationBuild(nation);
      this.currentBuildStationIdByNation.set(nation.id, placedId ?? undefined);
    }
  }

  /** Slow tick — driven from game.ts on the dynamic-nations cadence (~5 sim seconds), not every frame. */
  tick(_deltaSeconds: number): void {
    for (const [nationId, currentBuildStationId] of this.currentBuildStationIdByNation) {
      const nation = allNations.find((candidateNation) => candidateNation.id === nationId);
      if (!nation) continue;

      let liveBuildStationId = currentBuildStationId;
      if (liveBuildStationId) {
        const station = this.stationManager.getStation(liveBuildStationId);
        // Build completed (or station vanished) — start the next one.
        if (!station || station.state === "producing") {
          liveBuildStationId = undefined;
        }
      }

      if (!liveBuildStationId) {
        const placedId = this.startNextStationBuild(nation);
        if (placedId) liveBuildStationId = placedId;
      }

      this.currentBuildStationIdByNation.set(nationId, liveBuildStationId);
    }
  }

  /** Pick build type, pick preferred zone, place the building station.
   *  Returns the new station id, or null if no sitable zone exists.
   *  placeBuild emits the "Construction started" log entry. */
  private startNextStationBuild(nation: Nation): string | null {
    // Compute occupied-zone ids once and thread through per-type checks —
    // otherwise pickNextBuildType rescans the roster per candidate type.
    const occupiedZoneIds = this.computeOccupiedZoneIds();

    const decision = this.pickNextBuildType(nation, occupiedZoneIds);
    if (!decision) return null;

    const zone = this.pickPreferredBuildZone(nation, decision.typeId, occupiedZoneIds);
    if (!zone) return null;

    const placement = this.stationManager.placeBuild({
      zoneId: zone.id,
      typeId: decision.typeId,
      size: zone.size,
      nationId: nation.id,
      contractingNationId: decision.contractingNationId,
      x: zone.x,
      y: zone.y,
      name: this.namePool.claimStationName(nation),
    });

    return placement.station.id;
  }

  /** Score sectors via the nation's personality scorer and return the highest-
   *  scoring zone. The first zone of the winning sector is picked since zones
   *  inside a sector are equivalent for scoring purposes. */
  private pickPreferredBuildZone(
    nation: Nation,
    typeId: StationTypeId,
    occupiedZoneIds: Set<string>,
  ): StationZone | null {
    const scorer = sectorScorerByNation[nation.id];
    if (!scorer) return null;

    const ownStations = this.ownStations(nation);
    const candidateZones = this.freeZonesAllowingType(typeId, occupiedZoneIds);
    if (candidateZones.length === 0) return null;

    // Group + sort candidate zones by sector once so the per-sector loop
    // below does O(1) lookups instead of re-filtering per iteration.
    const zonesBySectorId = new Map<string, StationZone[]>();
    for (const zone of candidateZones) {
      const list = zonesBySectorId.get(zone.sector.id);
      if (list) list.push(zone);
      else zonesBySectorId.set(zone.sector.id, [zone]);
    }
    for (const list of zonesBySectorId.values()) {
      list.sort((a, b) => a.id.localeCompare(b.id));
    }

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
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].zone;
  }

  /** Every live station owned by the given nation. */
  private ownStations(nation: Nation): Station[] {
    return this.stationManager.getStations().filter((station) => station.nation.id === nation.id);
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
      const allowed = allowedStationTypesForZone(zone.environmentOverride, zone.sector.environment);
      return allowed.includes(typeId);
    });
  }

  /** Any sitable free zone for this type? Cheaper than freeZonesAllowingType when the caller only needs existence. */
  private hasFreeZoneAllowingType(typeId: StationTypeId, occupiedZoneIds: Set<string>): boolean {
    for (const zone of this.zones) {
      if (occupiedZoneIds.has(zone.id)) continue;
      const allowed = allowedStationTypesForZone(zone.environmentOverride, zone.sector.environment);
      if (allowed.includes(typeId)) return true;
    }
    return false;
  }

  /** Does any nation have the blueprint for this type? */
  private anyNationHasBlueprint(typeId: StationTypeId): boolean {
    return allNations.some((nation) => nation.buildsStations && nation.buildableStationTypeIds.includes(typeId));
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

    const addWareLoad = (station: Station): void => {
      for (const producedWareId of station.stationType.produces) {
        const produced = getWareTemplate(producedWareId);
        if (produced.productionOutput > 0) {
          production.set(
            producedWareId,
            (production.get(producedWareId) ?? 0) + produced.productionOutput * station.sizeMultiplier,
          );
        }
        for (const input of produced.productionInputs) {
          consumption.set(
            input.wareId,
            (consumption.get(input.wareId) ?? 0) + input.unitsPerTick * station.sizeMultiplier,
          );
        }
      }
    };

    const stations = this.stationManager.getStations();
    for (const station of stations) {
      const isOnline = isStationProducing(station);
      const isBuilding = station.state === "building";
      // Online producers' rate plus in-flight builds' eventual production/consumption.
      if (isOnline || isBuilding) addWareLoad(station);
      // Transient build consumption — spread waresRequired across
      // NOMINAL_BUILD_DURATION_SECONDS so scarcity scoring isn't spiked by the
      // instantaneous total. Iterate generically so adding a new build ware
      // doesn't require touching this loop.
      if (isBuilding && station.build) {
        for (const [buildWareId, amount] of Object.entries(station.build.waresRequired)) {
          consumption.set(
            buildWareId,
            (consumption.get(buildWareId) ?? 0) + amount / NOMINAL_BUILD_DURATION_SECONDS,
          );
        }
      }
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

    const stationType = getStationTemplate(typeId);
    const ownCount = ownCountByType.get(typeId) ?? 0;
    const isPrimary = typeId === nation.primaryBuildableStationTypeId;

    // First two primaries get a thumb on the scale so a nation seeds its
    // identity type before chasing scarcity. After that the ×3 scarcity weight
    // dominates — universe needs trump nation flavor.
    const primaryBonus = (isPrimary && ownCount < 2) ? 2 : 0;
    const wareScores = stationType.produces.map((wareId) => scarcity.get(wareId) ?? 0);
    const wareScarcity = wareScores.length > 0
      ? wareScores.reduce((sum, score) => sum + score, 0) / wareScores.length
      : 0;
    const scarcityBonus = 3 * wareScarcity;

    const score = 1 + primaryBonus + scarcityBonus;
    return { score, isBlueprint };
  }

  /** Scarcity-aware build-type picker. Runs at build-start per nation. */
  pickNextBuildType(
    nation: Nation,
    occupiedZoneIds: Set<string>,
  ): { typeId: StationTypeId; contractingNationId?: string } | null {
    const context: BuildScoringContext = {
      nation,
      scarcity: this.computeMapWareScarcity(),
      ownCountByType: this.countOwnStationsByType(nation),
      occupiedZoneIds,
    };

    let best: { typeId: StationTypeId; score: number; isBlueprint: boolean } | null = null;
    for (const typeId of ALL_BUILDABLE_STATION_TYPES) {
      const result = this.scoreStationTypeForNewConstruction(typeId, context);
      if (!result) continue;
      if (!best || result.score > best.score) best = { typeId, ...result };
    }

    if (!best) return null;
    return {
      typeId: best.typeId,
      contractingNationId: best.isBlueprint ? undefined : this.pickContractor(best.typeId, nation.id),
    };
  }

  /** Station id of this nation's in-flight build, or undefined if none. */
  getCurrentBuildStationId(nationId: string): string | undefined {
    return this.currentBuildStationIdByNation.get(nationId);
  }

  toSnapshot(): NationExpansionSnapshot[] {
    const expansions: NationExpansionSnapshot[] = [];
    for (const [nationId, currentBuildStationId] of this.currentBuildStationIdByNation) {
      expansions.push({ nationId, currentBuildStationId });
    }
    return expansions;
  }

  fromSnapshot(expansions: NationExpansionSnapshot[]): void {
    this.currentBuildStationIdByNation.clear();
    for (const snapshot of expansions) {
      this.currentBuildStationIdByNation.set(snapshot.nationId, snapshot.currentBuildStationId);
    }
  }

  reset(): void {
    this.currentBuildStationIdByNation.clear();
  }
}
