// Mass-emigration events and WAY generational-ship lifecycle.
//
// Always holds: at most one active event; at most one WAY generational ship (with
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

import type { PlacedStation, StationSize } from "../data/station-types";
import type { Station } from "./sim-station-types";
import type { EmigrationManagerSnapshot, EmigrationEventSnapshot } from "./sim-save-types";
import type { GameMap } from "./sim-map-types";
import type { StationManager } from "./sim-station-manager";
import { wayNation } from "../data/nations";
import { createStation } from "./sim-station";
import { generateCounterId } from "./util-ids";
import { clamp01 } from "./util-clamp";
import type { NamePool } from "./sim-name-pool";
import type { DecommissionEvent, TradePort } from "./sim-trade-manager";
import type { ShipManager } from "./sim-ship-manager";
import type { EmigrationEvent, EmigrationIntensity, EmigrationTriggerMode } from "./sim-emigration-types";
import { computeEmigrationFraction } from "./sim-emigration-types";
import {
  countEligibleStations,
  drawAndRecordDestination,
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
  private clockSeconds = 0;
  private mode: EmigrationTriggerMode = "auto";
  private intensity: EmigrationIntensity = "medium";
  private usedDestinations: string[] = [];
  private nextGenerationalShipArrivalAtSeconds: number | null = null;
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
    const generationalShip = this.createGenerationalShip();
    this.activeGenerationalShipId = generationalShip.id;
  }

  getActiveGenerationalShip(): Station | null {
    if (!this.activeGenerationalShipId) return null;
    return this.stationManager.getStation(this.activeGenerationalShipId) ?? null;
  }

  getActiveEvent(): EmigrationEvent | null {
    return this.activeEvent;
  }

  /** Count this station's trade ships from its initial homed set that are
   *  still docked (not in flight). */
  private countHomedShipsStillDocked(stationId: string, initialHomedSet: Set<string>): number {
    let stillDocked = 0;
    for (const tradeShip of this.tradeManager.getTradeShipsByHomeStationId(stationId)) {
      if (!initialHomedSet.has(tradeShip.orbitingShipId)) continue;
      if (!this.tradeManager.isShipInFlight(tradeShip)) stillDocked++;
    }
    return stillDocked;
  }

  /** Refresh per-station progressFraction each tick so render sees current launch progress. */
  private syncStationCaches(event: EmigrationEvent): void {
    for (const stationId of event.stationIds) {
      const station = this.stationManager.getStation(stationId);
      if (!station || !station.emigrationEvent) continue;
      const initialHomedSet = station.emigrationEvent.initialHomedShipIdSet;
      station.emigrationEvent.progressFraction = computeEmigrationFraction(
        station.emigrationEvent,
        initialHomedSet,
        this.countHomedShipsStillDocked(stationId, initialHomedSet),
      );
    }
  }

  /** Refresh the generational ship's arrivalFraction so render sees the updated
   *  fraction even on the tick the ship jumps away. */
  private syncGenerationalShipArrival(event: EmigrationEvent): void {
    const generationalShip = this.getActiveGenerationalShip();
    if (!generationalShip || !generationalShip.generationalShipBuild) return;
    generationalShip.generationalShipBuild.arrivalFraction =
      event.totalExpectedShips === 0 ? 1 : clamp01(event.shipsArrived / event.totalExpectedShips);
  }

  /** Per-tick handler. When an event is active: advances launches, demolishes
   *  finished stations, refreshes UI fractions, jumps the generational ship
   *  once all arrivals decommissioned. Always: spawns the next generational
   *  ship after the cooldown elapses, and auto-triggers a new event when
   *  empty zones run low. */
  tick(deltaSeconds: number): void {
    this.clockSeconds += deltaSeconds;

    if (this.activeEvent) {
      // Captured before any jump so tickEmigrantLaunches gets the ship even if arrivals complete this tick.
      const generationalShip = this.getActiveGenerationalShip();
      if (generationalShip) {
        tickEmigrantLaunches(this.activeEvent, deltaSeconds, generationalShip, this.launchDependencies());
      }
      this.demolishFinishedStations(this.activeEvent);
      // Sync caches before the jump check so render sees up-to-date fractions
      // even on the frame the generational ship vanishes.
      this.syncStationCaches(this.activeEvent);
      this.syncGenerationalShipArrival(this.activeEvent);
      if (this.activeEvent.shipsArrived >= this.activeEvent.totalExpectedShips) {
        this.jumpGenerationalShipAway(this.activeEvent);
      }
    }

    this.spawnNextGenerationalShipIfDue();
    this.triggerAutoEmigrationEventIfDue();
  }

  private spawnNextGenerationalShipIfDue(): void {
    if (this.activeGenerationalShipId !== null) return;
    if (this.nextGenerationalShipArrivalAtSeconds === null) return;
    if (this.clockSeconds < this.nextGenerationalShipArrivalAtSeconds) return;
    const generationalShip = this.createGenerationalShip();
    this.activeGenerationalShipId = generationalShip.id;
    this.nextGenerationalShipArrivalAtSeconds = null;
  }

  private triggerAutoEmigrationEventIfDue(): void {
    if (this.mode !== "auto") return;
    if (this.activeEvent !== null) return;
    if (this.nextGenerationalShipArrivalAtSeconds !== null) return;
    if (emptyZoneCount(this.map, this.stationManager) > this.autoTriggerThreshold) return;
    if (this.triggerEvent({ intensity: this.intensity }) === null) {
      // The only toast reader is the manual-trigger click handler — drop a
      // failed auto attempt's message so it can't surface stale on a later
      // manual trigger.
      this.pendingToast = null;
    }
  }

  /** Fire an emigration event; returns null if nothing eligible. */
  triggerEvent(options: { intensity?: EmigrationIntensity } = {}): EmigrationEvent | null {
    const intensity = options.intensity ?? this.intensity;
    if (this.activeEvent !== null) return null; // only one active event at a time
    const generationalShip = this.getActiveGenerationalShip();
    if (!generationalShip) return null;

    const { selected, nationIds } = selectStationsForEmigration(this.stationManager, intensity, this.map);

    if (selected.length === 0) {
      // Zero-eligible — no state change, just surface a toast so the player
      // can retry immediately.
      this.pendingToast = "Nations aren't ready for emigration yet";
      return null;
    }

    // One batched setStationStates call so the trade path cache rebuilds once instead of per-station.
    this.stationManager.setStationStates(selected, "emigrating");

    // Departing stations must not linger as ghost routes in the overview once
    // they're on their way out — clear trade-route history now so the overview
    // starts fresh. Suppression in recordRouteDeliveryFromTransfer keeps
    // in-flight deliveries from re-adding them.
    this.tradeManager.clearTradeRouteHistory();

    const eventId = generateCounterId("EMIG", ++this.nextEventCounter, 6);
    const destinationName = drawAndRecordDestination(this.usedDestinations);

    const totalExpectedShips = this.beginAllStationEmigrations(
      selected,
      generationalShip,
      eventId,
      destinationName,
    );

    const event = this.createEmigrationEvent({
      eventId,
      destinationName,
      generationalShipId: generationalShip.id,
      stationIds: selected.map((station) => station.id),
      nationIds: Array.from(nationIds),
      totalExpectedShips,
    });
    this.activeEvent = event;

    this.setGenerationalShipBuild(generationalShip, event);
    return event;
  }

  /** Wire every selected station into the event and accumulate the per-station
   *  emigrant + homed-ship counts into a single totalExpectedShips. */
  private beginAllStationEmigrations(
    selected: Station[],
    generationalShip: Station,
    eventId: string,
    destinationName: string,
  ): number {
    const launchDependencies = this.launchDependencies();
    let totalExpectedShips = 0;
    for (const station of selected) {
      totalExpectedShips += beginStationEmigration(
        station,
        generationalShip,
        eventId,
        destinationName,
        launchDependencies,
      );
    }
    return totalExpectedShips;
  }

  /** Construct the in-memory EmigrationEvent record. Pure — no observers
   *  fired, no station mutated. Caller decides when to commit it as
   *  this.activeEvent. */
  private createEmigrationEvent(eventParts: {
    eventId: string;
    destinationName: string;
    generationalShipId: string;
    stationIds: string[];
    nationIds: string[];
    totalExpectedShips: number;
  }): EmigrationEvent {
    return {
      id: eventParts.eventId,
      nationIds: eventParts.nationIds,
      generationalShipId: eventParts.generationalShipId,
      stationIds: eventParts.stationIds,
      stationIdSet: new Set(eventParts.stationIds),
      shipsArrived: 0,
      totalExpectedShips: eventParts.totalExpectedShips,
      destinationName: eventParts.destinationName,
    };
  }

  /** Stamp the generational-ship's render-visible build state so the WAY
   *  HUD can show the destination, station count, and arrival fraction. */
  private setGenerationalShipBuild(generationalShip: Station, event: EmigrationEvent): void {
    generationalShip.generationalShipBuild = {
      eventId: event.id,
      destinationName: event.destinationName,
      emigratingStationCount: event.stationIds.length,
      arrivalFraction: 0,
    };
  }

  /** Bundle of refs the launch-helper sibling needs (managers + the namePool +
   *  this manager). Returned fresh each call rather than stored as a field to
   *  avoid holding a reference to itself on the manager. */
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
    return this.mode === "manual" && this.activeEvent === null && this.activeGenerationalShipId !== null;
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
  private demolishFinishedStations(event: EmigrationEvent): void {
    for (const stationId of event.stationIds) {
      const station = this.stationManager.getStation(stationId);
      if (!station || !station.emigrationEvent) continue; // demolished in a previous tick
      const state = station.emigrationEvent;
      if (state.launched < state.totalEmigrants) continue;

      const initialHomedSet = station.emigrationEvent.initialHomedShipIdSet;
      if (this.countHomedShipsStillDocked(stationId, initialHomedSet) !== 0) continue;

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
   *  already been demolished by `demolishFinishedStations`. */
  private jumpGenerationalShipAway(event: EmigrationEvent): void {
    if (this.activeGenerationalShipId === event.generationalShipId) {
      const generationalShip = this.stationManager.getStation(this.activeGenerationalShipId);
      if (generationalShip) generationalShip.generationalShipBuild = null;
      this.stationManager.removeStation(this.activeGenerationalShipId);
      this.activeGenerationalShipId = null;
    }
    this.activeEvent = null;
    this.nextGenerationalShipArrivalAtSeconds = this.clockSeconds + POST_JUMP_GAP_SECONDS;
  }

  /** Create the generational-ship Station with a unique id and register it with
   *  StationManager so the shared render / selection pipeline handles it. */
  private createGenerationalShip(): Station {
    const position = this.randomPositionOutsideStations();
    const id = generateCounterId("WAY", ++this.nextGenerationalShipCounter, 3);
    const name = this.namePool.claimStationName(wayNation);
    const placement: PlacedStation = {
      id,
      name,
      x: position.x,
      y: position.y,
      nation: wayNation,
      stationTypeId: "generational-ship",
      size: GENERATIONAL_SHIP_SIZE,
    };
    const generationalShip = createStation(placement, 0);
    this.stationManager.addStation(generationalShip);
    return generationalShip;
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

  getMode(): EmigrationTriggerMode {
    return this.mode;
  }
  setMode(mode: EmigrationTriggerMode): void {
    this.mode = mode;
  }
  getIntensity(): EmigrationIntensity {
    return this.intensity;
  }
  setIntensity(intensity: EmigrationIntensity): void {
    this.intensity = intensity;
  }
  getNextGenerationalShipArrivalAt(): number | null {
    return this.nextGenerationalShipArrivalAtSeconds;
  }

  /** Sim-seconds until next generational ship, or 0 if one is already present. */
  getSecondsUntilNextGenerationalShip(): number {
    if (this.nextGenerationalShipArrivalAtSeconds === null) return 0;
    return Math.max(0, this.nextGenerationalShipArrivalAtSeconds - this.clockSeconds);
  }
  /** Length of the post-jump cooldown — for arrival-progress rendering. */
  getPostJumpGapSeconds(): number {
    return POST_JUMP_GAP_SECONDS;
  }
  getAutoTriggerThreshold(): number {
    return this.autoTriggerThreshold;
  }
  getClockSeconds(): number {
    return this.clockSeconds;
  }

  toSnapshot(): EmigrationManagerSnapshot {
    return {
      activeEvent: this.activeEvent ? emigrationEventToSnapshot(this.activeEvent) : null,
      activeGenerationalShipId: this.activeGenerationalShipId,
      mode: this.mode,
      intensity: this.intensity,
      usedDestinations: [...this.usedDestinations],
      nextGenerationalShipArrivalAtSeconds: this.nextGenerationalShipArrivalAtSeconds,
      clockSeconds: this.clockSeconds,
      nextGenerationalShipCounter: this.nextGenerationalShipCounter,
      nextEmigrantShipCounter: this.nextEmigrantShipCounter,
      nextEventCounter: this.nextEventCounter,
    };
  }

  fromSnapshot(snapshot: EmigrationManagerSnapshot): void {
    this.activeEvent = snapshot.activeEvent ? emigrationEventFromSnapshot(snapshot.activeEvent) : null;
    this.activeGenerationalShipId = snapshot.activeGenerationalShipId;
    this.mode = snapshot.mode;
    this.intensity = snapshot.intensity;
    this.usedDestinations = [...snapshot.usedDestinations];
    this.nextGenerationalShipArrivalAtSeconds = snapshot.nextGenerationalShipArrivalAtSeconds;
    this.clockSeconds = snapshot.clockSeconds;
    this.nextGenerationalShipCounter = snapshot.nextGenerationalShipCounter;
    this.nextEmigrantShipCounter = snapshot.nextEmigrantShipCounter;
    this.nextEventCounter = snapshot.nextEventCounter;

    // Per-station state rides on StationSnapshot.emigrationEvent — restoreSavedGame
    // already populated each station's emigrationEvent before this method runs.
    // At this point StationManager.seed has NOT yet happened (Game.create
    // seeds it after restoreSavedGame returns), so syncStationCaches cannot resolve
    // stations through this.stationManager. progressFraction / arrivalFraction
    // restore as 0 (snapshots exclude them — see emigrationFromSnapshot /
    // generationalShipBuildFromSnapshot in sim-station.ts) until the first slow
    // simulation tick re-runs syncStationCaches with seeded managers.
  }

  /** Tear down the manager — clear in-memory state and unwire the
   *  decommission subscription. Safe to call more than once; the
   *  unsubscribe is nulled on first run. Terminal (no reuse). */
  destroy(): void {
    this.activeEvent = null;
    this.activeGenerationalShipId = null;
    this.clockSeconds = 0;
    this.mode = "auto";
    this.intensity = "medium";
    this.usedDestinations = [];
    this.nextGenerationalShipArrivalAtSeconds = null;
    this.nextGenerationalShipCounter = 0;
    this.nextEmigrantShipCounter = 0;
    this.nextEventCounter = 0;
    this.pendingToast = null;
    this.unsubscribeDecommission?.();
    this.unsubscribeDecommission = null;
  }
}

function emigrationEventToSnapshot(event: EmigrationEvent): EmigrationEventSnapshot {
  return {
    id: event.id,
    nationIds: [...event.nationIds],
    generationalShipId: event.generationalShipId,
    stationIds: [...event.stationIds],
    shipsArrived: event.shipsArrived,
    totalExpectedShips: event.totalExpectedShips,
    destinationName: event.destinationName,
  };
}

function emigrationEventFromSnapshot(snapshot: EmigrationEventSnapshot): EmigrationEvent {
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
  };
}
