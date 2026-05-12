// Mass-emigration events and WAY generational-ship lifecycle.
//
// Invariants: at most one active event; at most one WAY generational ship (with
// POST_JUMP_GAP_SECONDS between jump and next arrival); selection crosses
// every participatesInEmigration nation.
//
// Per-event flow: trigger picks stations → each spawns BASE × sizeMultiplier
// emigrant ships (one per sim-second, passengers cargo, destination = generational ship);
// pre-existing homed ships get a fly+decommission tail appended; station is
// demolished after launches + departures; WAY jumps once every expected
// arrival has decommissioned.
//
// Cluster split: this file is the public surface (the EmigrationManager class).
// Decision logic (which stations are eligible / picked) lives in
// sim-emigration-decision.ts. Per-station ship-launch + ferry logic lives in
// sim-emigration-start.ts. Shared types + tunables live in
// sim-emigration-types.ts. Consumers thread emigrationManager through.

import type { StationPlacement, StationSize } from "../data/station-types";
import type { Station } from "./sim-station-types";
import type { EmigrationManagerSnapshot, EmigrationEventSnapshot } from "./sim-save-types";
import type { GameMap } from "./sim-map-types";
import type { StationManager } from "./sim-station-manager";
import { wayNation } from "../data/nations";
import { createStation } from "./sim-station";
import { generateCounterId } from "./util-ids";
import type { NamePool } from "./sim-name-pool";
import type { DecommissionEvent, TradePort } from "./sim-trade-manager";
import type { ShipManager } from "./sim-ship-manager";
import type {
  EmigrationEvent,
  EmigrationEventContext,
  Intensity,
  TriggerMode,
} from "./sim-emigration-types";
import { computeEmigrationFraction } from "./sim-emigration-types";
import {
  countEligibleStations,
  drawDestination,
  emptyZoneCount,
  selectStationsForEmigration,
} from "./sim-emigration-decision";
import {
  beginStationEmigration,
  tickEmigrantLaunches,
  type LaunchDependencies,
} from "./sim-emigration-start";

// Sim-seconds from generational-ship jump-out to next arrival; spaces events so the player isn't overwhelmed.
const POST_JUMP_GAP_SECONDS = 3 * 60 * 60;
// Auto-trigger fires when empty zones drop to this fraction of total zones.
const AUTO_TRIGGER_FRACTION = 0.074;
// Generational ships render at size "L" so the body reads as a large vessel at overview zoom.
const GENERATIONAL_SHIP_SIZE: StationSize = "L";

export class EmigrationManager {
  private activeEvent: EmigrationEvent | null = null;
  /** ID-only handle; the Station lives in StationManager. */
  private activeGenerationalShipId: string | null = null;
  private simTime = 0;
  private mode: TriggerMode = "auto";
  private intensity: Intensity = "medium";
  private usedDestinations: string[] = [];
  private nextGenerationalShipArrivalAt: number | null = null;
  private readonly autoTriggerThreshold: number;
  private nextGenerationalShipCounter = 0;
  private nextEmigrantShipCounter = 0;
  private nextEventCounter = 0;
  private readonly stationManager: StationManager;
  private readonly shipManager: ShipManager;
  private readonly tradeManager: TradePort;
  private readonly map: GameMap;
  private readonly namePool: NamePool;
  private unsubscribeDecommission: (() => void) | null = null;
  /** Last toast surfaced by the manager. UI reads + clears via takePendingToast. */
  private pendingToast: string | null = null;

  constructor(dependencies: {
    map: GameMap;
    stationManager: StationManager;
    shipManager: ShipManager;
    tradeManager: TradePort;
    namePool: NamePool;
  }) {
    this.map = dependencies.map;
    this.autoTriggerThreshold = Math.floor(AUTO_TRIGGER_FRACTION * dependencies.map.stationZones.length);
    this.stationManager = dependencies.stationManager;
    this.shipManager = dependencies.shipManager;
    this.tradeManager = dependencies.tradeManager;
    this.namePool = dependencies.namePool;

    // Count every decommission whose home was one of the event's stations
    // toward shipsArrived. WAY jumps when that hits totalExpectedShips.
    this.unsubscribeDecommission = this.tradeManager.addShipDecommissionObserver((event) => {
      this.onShipDecommissioned(event);
    });
  }

  /** Spawn the initial generational ship at game start at a random map position. */
  spawnInitialGenerationalShip(): void {
    const generationalShip = this.createAndRegisterGenerationalShip();
    this.activeGenerationalShipId = generationalShip.id;
  }

  getActiveGenerationalShip(): Station | null {
    if (!this.activeGenerationalShipId) return null;
    return this.stationManager.getStation(this.activeGenerationalShipId) ?? null;
  }

  getActiveEvent(): EmigrationEvent | null { return this.activeEvent; }

  /** Refresh render-visible caches each tick (and post-snapshot): per-station
   *  progressFraction from each station's emigrationEvent. */
  private syncStationCaches(event: EmigrationEvent): void {
    for (const stationId of event.stationIds) {
      const station = this.stationManager.getStation(stationId);
      if (!station || !station.emigrationEvent) continue;
      const initialHomedSet = station.emigrationEvent.initialHomedShipIdSet;
      let homedStillDocked = 0;
      for (const tradeShip of this.tradeManager.getTradeShipsByHomeStationId(stationId)) {
        if (!initialHomedSet.has(tradeShip.orbitingShipId)) continue;
        if (!this.tradeManager.isShipInFlight(tradeShip)) homedStillDocked++;
      }
      station.emigrationEvent.progressFraction = computeEmigrationFraction(
        station.emigrationEvent,
        initialHomedSet,
        homedStillDocked,
      );
    }
  }

  /** Refresh the active generational ship's arrivalFraction cache from
   *  shipsArrived / totalExpectedShips. */
  private syncGenerationalShipArrival(event: EmigrationEvent): void {
    const generationalShip = this.getActiveGenerationalShip();
    if (!generationalShip || !generationalShip.generationalShipBuild) return;
    generationalShip.generationalShipBuild.arrivalFraction = event.totalExpectedShips === 0
      ? 1
      : Math.max(0, Math.min(1, event.shipsArrived / event.totalExpectedShips));
  }

  /** Per-tick handler. When an event is active: advances launches, demolishes
   *  finished stations, refreshes UI fractions, jumps the generational ship
   *  once all arrivals decommissioned. Always: spawns the next generational
   *  ship after the cooldown elapses, and auto-triggers a new event when
   *  empty zones run low. */
  tick(deltaSeconds: number): void {
    this.simTime += deltaSeconds;

    if (this.activeEvent) {
      // Resolved once — body never spawns/jumps the generational ship before tickEmigrantLaunches.
      const generationalShip = this.getActiveGenerationalShip();
      if (generationalShip) {
        tickEmigrantLaunches(this.activeEvent, deltaSeconds, generationalShip, this.launchDependencies());
      }
      this.checkStationDemolition(this.activeEvent);
      // Sync caches before the jump check so render sees up-to-date fractions
      // even on the frame the generational ship vanishes.
      this.syncStationCaches(this.activeEvent);
      this.syncGenerationalShipArrival(this.activeEvent);
      if (this.activeEvent.shipsArrived >= this.activeEvent.totalExpectedShips) {
        this.executeJump(this.activeEvent);
      }
    }

    this.spawnNextGenerationalShipIfDue();
    this.triggerAutoEmigrationEventIfDue();
  }

  private spawnNextGenerationalShipIfDue(): void {
    if (this.activeGenerationalShipId !== null) return;
    if (this.nextGenerationalShipArrivalAt === null) return;
    if (this.simTime < this.nextGenerationalShipArrivalAt) return;
    const generationalShip = this.createAndRegisterGenerationalShip();
    this.activeGenerationalShipId = generationalShip.id;
    this.nextGenerationalShipArrivalAt = null;
  }

  private triggerAutoEmigrationEventIfDue(): void {
    if (this.mode !== "auto") return;
    if (this.activeEvent !== null) return;
    if (this.nextGenerationalShipArrivalAt !== null) return;
    if (emptyZoneCount(this.map, this.stationManager) > this.autoTriggerThreshold) return;
    this.triggerEvent({ intensity: this.intensity });
  }

  /** Fire an emigration event; returns null if nothing eligible. */
  triggerEvent(options: { intensity?: Intensity } = {}): EmigrationEvent | null {
    const intensity = options.intensity ?? this.intensity;
    if (this.activeEvent !== null) return null;   // at-most-one invariant
    const generationalShip = this.getActiveGenerationalShip();
    if (!generationalShip) return null;

    const { selected, nationIds } = selectStationsForEmigration(this.stationManager, intensity);

    if (selected.length === 0) {
      // Zero-eligible — no state change, just surface a toast so the player
      // can retry immediately.
      this.pendingToast = "Nations aren't ready for emigration yet";
      return null;
    }

    // One batched setStationStates call so the trade path cache rebuilds once instead of per-station.
    this.stationManager.setStationStates(selected, "emigrating");

    const context: EmigrationEventContext = {
      eventId: generateCounterId("EMIG", ++this.nextEventCounter, 6),
      destinationName: drawDestination(this.usedDestinations),
    };

    const totalExpectedShips = this.beginAllStationEmigrations(selected, generationalShip, context);

    const event = this.createEmigrationEvent({
      context,
      generationalShipId: generationalShip.id,
      stationIds: selected.map((station) => station.id),
      nationIds: Array.from(nationIds),
      totalExpectedShips,
    });
    this.activeEvent = event;

    this.attachGenerationalShipBuild(generationalShip, event);
    return event;
  }

  /** Wire every selected station into the event and accumulate the per-station
   *  emigrant + homed-ship counts into a single totalExpectedShips. */
  private beginAllStationEmigrations(
    selected: Station[],
    generationalShip: Station,
    context: EmigrationEventContext,
  ): number {
    const launchDeps = this.launchDependencies();
    let totalExpectedShips = 0;
    for (const station of selected) {
      totalExpectedShips += beginStationEmigration(station, generationalShip, context, launchDeps);
    }
    return totalExpectedShips;
  }

  /** Construct the in-memory EmigrationEvent record. Pure — no observers
   *  fired, no station mutated. Caller decides when to commit it as
   *  this.activeEvent. */
  private createEmigrationEvent(parts: {
    context: EmigrationEventContext;
    generationalShipId: string;
    stationIds: string[];
    nationIds: string[];
    totalExpectedShips: number;
  }): EmigrationEvent {
    return {
      id: parts.context.eventId,
      nationIds: parts.nationIds,
      generationalShipId: parts.generationalShipId,
      stationIds: parts.stationIds,
      stationIdSet: new Set(parts.stationIds),
      shipsArrived: 0,
      totalExpectedShips: parts.totalExpectedShips,
      destinationName: parts.context.destinationName,
      eventStartAt: this.simTime,
    };
  }

  /** Stamp the generational-ship's render-visible build state so the WAY
   *  HUD can show the destination, station count, and arrival fraction. */
  private attachGenerationalShipBuild(generationalShip: Station, event: EmigrationEvent): void {
    generationalShip.generationalShipBuild = {
      eventId: event.id,
      destinationName: event.destinationName,
      stationCount: event.stationIds.length,
      arrivalFraction: 0,
    };
  }

  /** Bundle of refs the launch-helper sibling needs (managers + the namePool +
   *  this manager). Built per call rather than stored as a field so the
   *  manager doesn't carry a self-referencing cache. */
  private launchDependencies(): LaunchDependencies {
    return {
      stationManager: this.stationManager,
      shipManager: this.shipManager,
      tradeManager: this.tradeManager,
      namePool: this.namePool,
      emigrationManager: this,
    };
  }

  /** Increment + return the next emigrant-ship counter. Called from the
   *  launch sibling when generating ship ids; the counter stays on the
   *  manager so it's serialized in the snapshot alongside the rest of
   *  the lifecycle state. */
  nextEmigrantShipId(): number {
    return ++this.nextEmigrantShipCounter;
  }

  /** Player-invoked manual trigger. Fires only when a generational ship is
   *  present and no event is active. Zero-eligible surfaces a toast; button
   *  stays enabled so the player can try again. */
  manualTrigger(): EmigrationEvent | null {
    if (this.mode !== "manual") return null;
    return this.triggerEvent();
  }

  /** Manual trigger fireable right now? Generational ship present, no active event. */
  canManualTrigger(): boolean {
    return this.mode === "manual"
      && this.activeEvent === null
      && this.activeGenerationalShipId !== null;
  }

  /** Stations that would be selected if a trigger fired right now. Drives the
   *  panel's preview. */
  countEligibleStations(): number {
    return countEligibleStations(this.stationManager);
  }

  /** Pop the pending toast (if any). UI reads + clears. */
  takePendingToast(): string | null {
    const message = this.pendingToast;
    this.pendingToast = null;
    return message;
  }

  /** Demolish emigrating stations that have finished launches AND whose
   *  pre-existing homed ships have all departed. Ferry ships still mid-flight
   *  survive — they already have a `decommission` action queued and will
   *  remove themselves on arrival at the generational ship. */
  private checkStationDemolition(event: EmigrationEvent): void {
    for (const stationId of event.stationIds) {
      const station = this.stationManager.getStation(stationId);
      if (!station || !station.emigrationEvent) continue; // demolished in a previous tick
      const state = station.emigrationEvent;
      if (state.launched < state.totalEmigrants) continue;

      const initialHomedSet = station.emigrationEvent.initialHomedShipIdSet;
      let anyStillDocked = false;
      for (const tradeShip of this.tradeManager.getTradeShipsByHomeStationId(stationId)) {
        if (!initialHomedSet.has(tradeShip.orbitingShipId)) continue;
        if (!this.tradeManager.isShipInFlight(tradeShip)) {
          anyStillDocked = true;
          break;
        }
      }
      if (anyStillDocked) continue;

      this.stationManager.removeStationForEmigration(stationId);
    }
  }

  /** Decommission observer — count ships whose home was one of the event's
   *  stations as arrivals (fresh emigrants + rerouted pre-existing). */
  private onShipDecommissioned(event: DecommissionEvent): void {
    if (!this.activeEvent) return;
    if (this.activeEvent.stationIdSet.has(event.homeStationId)) {
      this.activeEvent.shipsArrived++;
    }
  }

  /** Execute the jump — remove the generational ship, clear the event, schedule
   *  the next arrival. By the time arrivals complete, every event station has
   *  already been demolished by `checkStationDemolition`. */
  private executeJump(event: EmigrationEvent): void {
    if (this.activeGenerationalShipId === event.generationalShipId) {
      const generationalShip = this.stationManager.getStation(this.activeGenerationalShipId);
      if (generationalShip) generationalShip.generationalShipBuild = null;
      this.stationManager.removeStation(this.activeGenerationalShipId);
      this.activeGenerationalShipId = null;
    }
    this.activeEvent = null;
    this.nextGenerationalShipArrivalAt = this.simTime + POST_JUMP_GAP_SECONDS;
  }

  /** Generate a unique id, build the generational-ship Station, register with
   *  StationManager so the shared render / selection pipeline handles it. */
  private createAndRegisterGenerationalShip(): Station {
    const position = this.randomPositionOutsideStations();
    const id = generateCounterId("WAY", ++this.nextGenerationalShipCounter, 3);
    const name = this.namePool.claimStationName(wayNation);
    const placement: StationPlacement = {
      id,
      name,
      x: position.x,
      y: position.y,
      nation: wayNation,
      stationTypeId: "generational-ship",
      size: GENERATIONAL_SHIP_SIZE,
    };
    const stationData = createStation(placement, 0);
    this.stationManager.addStation(stationData);
    return stationData;
  }

  private randomPositionOutsideStations(): { x: number; y: number } {
    const MIN_DISTANCE = 300;
    const MAX_PLACEMENT_ATTEMPTS = 50;
    const mapWidth = this.map.gridSizeX * this.map.sectorSize;
    const mapHeight = this.map.gridSizeY * this.map.sectorSize;
    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
      const x = Math.random() * mapWidth;
      const y = Math.random() * mapHeight;
      let tooClose = false;
      for (const station of this.stationManager.getStations()) {
        if (Math.hypot(x - station.x, y - station.y) < MIN_DISTANCE) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) return { x, y };
    }
    // Fallback: anywhere in bounds.
    return {
      x: Math.random() * mapWidth,
      y: Math.random() * mapHeight,
    };
  }

  getMode(): TriggerMode { return this.mode; }
  setMode(mode: TriggerMode): void { this.mode = mode; }
  getIntensity(): Intensity { return this.intensity; }
  setIntensity(intensity: Intensity): void { this.intensity = intensity; }
  getNextGenerationalShipArrivalAt(): number | null { return this.nextGenerationalShipArrivalAt; }

  /** Sim-seconds until next generational ship, or 0 if one is already present. */
  getSecondsUntilNextGenerationalShip(): number {
    if (this.nextGenerationalShipArrivalAt === null) return 0;
    return Math.max(0, this.nextGenerationalShipArrivalAt - this.simTime);
  }
  /** Length of the post-jump cooldown — for arrival-progress rendering. */
  getPostJumpGapSeconds(): number { return POST_JUMP_GAP_SECONDS; }
  getAutoTriggerThreshold(): number { return this.autoTriggerThreshold; }
  getSimTime(): number { return this.simTime; }

  toSnapshot(): EmigrationManagerSnapshot {
    return {
      activeEvent: this.activeEvent ? eventToSnapshot(this.activeEvent) : null,
      activeGenerationalShipId: this.activeGenerationalShipId,
      mode: this.mode,
      intensity: this.intensity,
      usedDestinations: [...this.usedDestinations],
      nextGenerationalShipArrivalAt: this.nextGenerationalShipArrivalAt,
      simTime: this.simTime,
      nextGenerationalShipCounter: this.nextGenerationalShipCounter,
      nextEmigrantShipCounter: this.nextEmigrantShipCounter,
      nextEventCounter: this.nextEventCounter,
    };
  }

  fromSnapshot(snapshot: EmigrationManagerSnapshot): void {
    this.activeEvent = snapshot.activeEvent ? eventFromSnapshot(snapshot.activeEvent) : null;
    this.activeGenerationalShipId = snapshot.activeGenerationalShipId;
    this.mode = snapshot.mode;
    this.intensity = snapshot.intensity;
    this.usedDestinations = [...snapshot.usedDestinations];
    this.nextGenerationalShipArrivalAt = snapshot.nextGenerationalShipArrivalAt;
    this.simTime = snapshot.simTime;
    this.nextGenerationalShipCounter = snapshot.nextGenerationalShipCounter;
    this.nextEmigrantShipCounter = snapshot.nextEmigrantShipCounter;
    this.nextEventCounter = snapshot.nextEventCounter;

    // Per-station state rides on StationSnapshot.emigrationEvent — applySnapshot
    // already populated each station's emigrationEvent before this method runs.
    // Note: at this point StationManager.seed has NOT yet happened (Game.create
    // seeds it after applySnapshot returns), so syncStationCaches cannot resolve
    // stations through this.stationManager. progressFraction / arrivalFraction
    // stay at their snapshotted values until the first dynamics tick re-runs
    // syncStationCaches with seeded managers.
  }

  /** Tear down the manager — clear in-memory state and unwire the
   *  decommission subscription. Safe to call more than once; the
   *  unsubscribe is nulled on first run. Terminal (no reuse). */
  dispose(): void {
    this.activeEvent = null;
    this.activeGenerationalShipId = null;
    this.simTime = 0;
    this.mode = "auto";
    this.intensity = "medium";
    this.usedDestinations = [];
    this.nextGenerationalShipArrivalAt = null;
    this.nextGenerationalShipCounter = 0;
    this.nextEmigrantShipCounter = 0;
    this.nextEventCounter = 0;
    this.pendingToast = null;
    this.unsubscribeDecommission?.();
    this.unsubscribeDecommission = null;
  }
}

function eventToSnapshot(event: EmigrationEvent): EmigrationEventSnapshot {
  return {
    id: event.id,
    nationIds: [...event.nationIds],
    generationalShipId: event.generationalShipId,
    stationIds: [...event.stationIds],
    shipsArrived: event.shipsArrived,
    totalExpectedShips: event.totalExpectedShips,
    destinationName: event.destinationName,
    eventStartAt: event.eventStartAt,
  };
}

function eventFromSnapshot(snapshot: EmigrationEventSnapshot): EmigrationEvent {
  const stationIds = [...snapshot.stationIds];
  return {
    id: snapshot.id,
    nationIds: [...snapshot.nationIds],
    generationalShipId: snapshot.generationalShipId,
    stationIds,
    stationIdSet: new Set(stationIds),
    shipsArrived: snapshot.shipsArrived,
    totalExpectedShips: snapshot.totalExpectedShips,
    destinationName: snapshot.destinationName,
    eventStartAt: snapshot.eventStartAt,
  };
}
