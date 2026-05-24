// Trade system — orchestrates ships running routes between stations.
//
// Each orbiting ship wraps in a TradeShip with an action queue. When idle,
// tickTrade calls findRoundTradeTrip() for a 1-or-2-leg route; startTrip
// commits reservations, builds the queue, fires the first action.
// Blocking actions (fly, wait) pause; instant ones (withdraw, deposit)
// execute in a burst until the next blocker. Empty queue → next trip search.
//
// Trade decisions: 75% optimal ware (highest output % or lowest input % at
// home), 25% random. Destination similarly: 75% most-need/most-surplus, 25% random.
//
// Reservations: each inventory slot tracks reservedIncoming (deliveries en
// route) and reservedOutgoing (cargo claimed for pickup) so multiple ships
// don't chase the same shortage.
//
// Cluster shape: this module owns the `TradeManager` class, active-trade-ship
// registry, observer arrays, the per-tick `tickTrade` loop, and the manager's
// own module-level snapshot (tradeTimeSeconds + scheduled timers). Sibling files
// split read-only decision logic (sim-trade-decision), queue construction +
// per-action mutations + the action-dispatch loop (sim-trade-queue), the
// reservation lifecycle (sim-trade-reservation), the TradeShip/reservation/
// action save codec (sim-trade-save-snapshot), HUD formatters
// (sim-trade-log), and per-route delivery statistics
// (sim-trade-route-statistics). The
// sim-trade-types.ts leaf holds the substrate every sibling shares (TradeShip
// type, TradeTransferEvent, getTotalCargo). Resolvers and the trade clock
// are instance methods on TradeManager; siblings receive the manager as an
// explicit parameter. Nothing in the cluster imports back from this manager
// file at runtime, so there is no circular import.

import { economyConfig } from "../data/economy-config";
import { type Station } from "./sim-station";
import { clearReservations } from "./sim-trade-reservation";
import { stationCodeNameLabel } from "./sim-station-template";
import { type Ship } from "./sim-ships";
import { getShipTypeTemplate } from "./sim-ship-template";
import { tickFlightData, createSurfaceEndpoint, createOrbitEndpoint, type FlightData } from "./sim-travel";
import type { ShipAction } from "./sim-travel-types";
import {
  findRoundTradeTrip,
  getPossibleTradeRoutes,
  getShipTransportableWares,
  getTradedRoutes,
} from "./sim-trade-decision";
import { advanceQueue, appendActionsToShip, randomTradeDelaySeconds, startTrip } from "./sim-trade-queue";
import type { WareId } from "../data/ware-types";
import type { TradeManagerSnapshot } from "./sim-save-types";
import { createTradeRouteStatistics, type RouteStats } from "./sim-trade-route-statistics";
import { WareStationIndex } from "./sim-ware-station-index";
import { type TradeShip, type TradeTransferEvent } from "./sim-trade-types";
import { shuffleInPlace } from "./util-shuffle";

/** The narrow trade-system surface emigration depends on. EmigrationManager
 *  takes a `TradePort` instead of the full TradeManager so its tests can
 *  swap in a mock without constructing the rest of the trade machinery.
 *  TradeManager implements this implicitly (the named methods exist). */
export interface TradePort {
  getTradeShipsByHomeStationId(homeStationId: string): ReadonlySet<TradeShip>;
  isShipInFlight(ship: TradeShip): boolean;
  findTradeShip(orbitingShip: Ship): TradeShip | undefined;
  appendActionsToShip(ship: TradeShip, actions: ShipAction[]): void;
  addShipDecommissionObserver(observer: (event: DecommissionEvent) => void): () => void;
  clearTradeRouteHistory(): void;
}

/** Fired when a trade ship's queue terminates with a decommission action. */
export interface DecommissionEvent {
  tradeShip: TradeShip;
  orbitingShip: Ship;
  /** Convenience scalar — equals `orbitingShip.id`. Captured at fire time so
   *  subscribers reading after another observer has removed the ship still
   *  see a stable value. */
  orbitingShipId: string;
  /** Equals `tradeShip.homeStationId` at fire time. */
  homeStationId: string;
  /** The station id of the decommission action's target — typically the
   *  generational ship for emigration. Distinct from `tradeShip.targetStationId`,
   *  which queueFerryToGenerationalShip does NOT update. */
  decommissionStationId: string;
  reason: "decommission-action";
}

/** Trade system coordinator. Owns all per-simulation state — roster, timers,
 *  trade-route stats, observers — as instance fields. */
export class TradeManager {
  private readonly stationManager: { getStation(id: string): Station | undefined };
  private readonly shipManager: { getShip(id: string): Ship | undefined };
  readonly activeTradeShips = new ActiveTradeShips();
  private _tradeTimeSeconds = 0;
  /** Current trade-clock time in seconds since simulation start. */
  get tradeTimeSeconds(): number {
    return this._tradeTimeSeconds;
  }
  /** Roster of trade ships. Read-only view; mutate via registerShip / deregisterShip. */
  get tradeShips(): readonly TradeShip[] {
    return this.activeTradeShips.all();
  }
  /** Advance the trade clock by `deltaSeconds`. Called by `tickTrade`
   *  each tick — external code should not call this directly. */
  advanceTradeTime(deltaSeconds: number): void {
    this._tradeTimeSeconds += deltaSeconds;
  }
  /** Set the trade clock absolutely. Used at init (0) and by snapshot
   *  restore — external code should not call this directly. */
  setTradeTimeSeconds(value: number): void {
    this._tradeTimeSeconds = value;
  }
  /** Reused buffer — refilled each tickTrade() to keep per-tick allocation at zero. */
  private readonly completedFlights: TradeShip[] = [];
  readonly tradeTransferObservers: Array<(event: TradeTransferEvent) => void> = [];
  /** Fired when a trade ship advances into a "decommission" terminal action.
   *  Runtime wires this to `shipManager.removeShip` so the ship leaves the
   *  universe instead of stalling. Payload carries scalar copies of the
   *  trade ship's identity (homeStationId, orbitingShipId) so subscribers
   *  reading after another observer has removed the ship still see stable
   *  values — observer order doesn't matter. */
  readonly decommissionObservers: ((event: DecommissionEvent) => void)[] = [];
  /** Trade-route delivery history. Retention is bounded by
   *  tradeRouteHistoryRetentionSeconds (data/economy-config.ts); the overview
   *  reads a fixed 2h window and an emigration event clears it. */
  readonly tradeRouteStats = createTradeRouteStatistics({
    windowSeconds: economyConfig.tradeRouteHistoryRetentionSeconds,
  });
  readonly routesCacheByWindow = new Map<number, { cachedAtSeconds: number; routes: RouteStats[] }>();
  /** Per-manager producer/consumer index — rebuilt on station roster changes
   *  via rebuildWareStationIndex(stations). Two simulations get isolated
   *  indices; no module-level shared state. */
  readonly wareStationIndex = new WareStationIndex();

  constructor(dependencies: {
    stationManager: { getStation(id: string): Station | undefined };
    shipManager: { getShip(id: string): Ship | undefined };
  }) {
    this.stationManager = dependencies.stationManager;
    this.shipManager = dependencies.shipManager;
    this.tradeTransferObservers.push((event) => recordRouteDeliveryFromTransfer(event, this));
  }

  /** Reset and return the per-instance completedFlights buffer so tickTrade
   *  can refill it without per-tick allocation. */
  takeCompletedFlightsBuffer(): TradeShip[] {
    this.completedFlights.length = 0;
    return this.completedFlights;
  }

  stationResolver(id: string): Station | undefined {
    return this.stationManager.getStation(id);
  }

  shipResolver(id: string): Ship | undefined {
    return this.shipManager.getShip(id);
  }

  /** Resolve a station by id, throwing on miss. */
  requireResolvedStation(id: string): Station {
    const station = this.stationResolver(id);
    if (!station) throw new Error(`trade-manager: station ${id} not resolvable`);
    return station;
  }

  /** Resolve a ship by id, throwing on miss. */
  requireResolvedShip(id: string): Ship {
    const ship = this.shipResolver(id);
    if (!ship) throw new Error(`trade-manager: ship ${id} not resolvable`);
    return ship;
  }

  seedInitialTradeShips(ships: Ship[], staggerDurationSeconds?: number): void {
    seedInitialTradeShips(this, ships, staggerDurationSeconds);
  }

  registerShip(orbitingShip: Ship, homeStation: Station, scheduleDelaySeconds: number = 0): TradeShip {
    return registerShipAsTradeShip(this, orbitingShip, homeStation, scheduleDelaySeconds);
  }

  deregisterShip(orbitingShip: Ship): void {
    deregisterTradeShipForShip(this, orbitingShip);
  }

  addRestoredTradeShip(tradeShip: TradeShip): void {
    this.activeTradeShips.add(tradeShip);
  }

  tick(deltaSeconds: number): void {
    tickTrade(this, deltaSeconds);
  }

  findTradeShip(orbitingShip: Ship): TradeShip | undefined {
    return this.activeTradeShips.findByShipId(orbitingShip.id);
  }

  toSnapshot(): TradeManagerSnapshot {
    return tradeManagerToSnapshot(this);
  }

  restoreFromSnapshot(snapshot: TradeManagerSnapshot, tradeShipsByShipId: Map<string, TradeShip>): void {
    tradeManagerFromSnapshot(this, snapshot, tradeShipsByShipId);
  }

  /** Rebuild the producer/consumer index from a station roster. Call after
   *  station add/remove/state-flip and after save-load. */
  rebuildWareStationIndex(stations: readonly Station[]): void {
    this.wareStationIndex.rebuild(stations);
  }

  clearTradeShips(): void {
    this.activeTradeShips.clear();
  }

  getTradeShipsByHomeStationId(homeStationId: string): ReadonlySet<TradeShip> {
    return this.activeTradeShips.getByHomeStationId(homeStationId);
  }

  isShipInFlight(ship: TradeShip): boolean {
    return this.activeTradeShips.isInFlight(ship);
  }

  /** Append actions to a trade ship's queue, restarting an idle ship's timer
   *  so the queue advances on the next tick. Used by emigration's ferry-queue
   *  and any other dynamic action injection. */
  appendActionsToShip(ship: TradeShip, actions: ShipAction[]): void {
    appendActionsToShip(ship, actions, this);
  }

  /** Subscribe to cargo transfers — fires after every ship↔station withdrawal
   *  or deposit (`TradeTransferEvent`). The route-stats recorder uses this to
   *  build the overview trade-history. Returns an unsubscribe. */
  addTradeTransferObserver(observer: (event: TradeTransferEvent) => void): () => void {
    return subscribeObserver(this.tradeTransferObservers, observer);
  }

  /** Subscribe to ship decommissions — fires when a trade ship's queue ends in
   *  a decommission action (e.g. an emigration ferry reaching the generational
   *  ship). EmigrationManager uses this to count arrivals for the WAY jump.
   *  Returns an unsubscribe. */
  addShipDecommissionObserver(observer: (event: DecommissionEvent) => void): () => void {
    return subscribeObserver(this.decommissionObservers, observer);
  }

  /** Fan a cargo-transfer event out to every subscribed observer, in
   *  subscription order. Called by the queue's withdraw/deposit handlers. */
  notifyTradeTransfer(event: TradeTransferEvent): void {
    for (const observer of this.tradeTransferObservers) observer(event);
  }

  /** Fan a decommission event out to every subscribed observer, in
   *  subscription order. Called by the queue's decommission handler. */
  notifyDecommission(event: DecommissionEvent): void {
    for (const observer of this.decommissionObservers) observer(event);
  }

  // Overview-mode route queries — read by the overview window, not by trade decisions.
  getShipTransportableWares(): WareId[] {
    return getShipTransportableWares(this);
  }

  getPossibleTradeRoutes(): Array<{ fromStationId: string; toStationId: string; wares: WareId[] }> {
    return getPossibleTradeRoutes(this);
  }

  getTradedRoutes(nowSeconds: number, windowSeconds: number): RouteStats[] {
    return getTradedRoutes(this, nowSeconds, windowSeconds);
  }

  /** Wipe all trade-route delivery history and the per-window route cache. */
  clearTradeRouteHistory(): void {
    this.tradeRouteStats.clear();
    this.routesCacheByWindow.clear();
  }

  /** Tear down the manager — forget every trade ship + timer, zero the trade
   *  clock, and drop all route-delivery history + its query cache. Used at
   *  teardown and by seedInitialTradeShips() for a clean slate before
   *  enrolling ships. Safe to call more than once. */
  destroy(): void {
    this.activeTradeShips.clear();
    this.setTradeTimeSeconds(0);
    this.tradeRouteStats.clear();
    this.routesCacheByWindow.clear();
  }

  /** Schedule a wake-up `delaySeconds` seconds from now. Wrapper around the
   *  active-trade-ship registry's absolute-time scheduler so callers don't
   *  have to read `tradeTimeSeconds` themselves. */
  scheduleTimer(ship: TradeShip, delaySeconds: number): void {
    this.activeTradeShips.scheduleTimer(ship, this.tradeTimeSeconds + delaySeconds);
  }
}

/** Register `observer` and return an unsubscribe that removes it. Shared by
 *  the trade-transfer and decommission observer registrations. */
function subscribeObserver<T>(observers: T[], observer: T): () => void {
  observers.push(observer);
  return () => {
    const observerIndex = observers.indexOf(observer);
    if (observerIndex >= 0) observers.splice(observerIndex, 1);
  };
}

interface ScheduledTimer {
  fireTimeSeconds: number;
  ship: TradeShip;
}

const EMPTY_TRADE_SHIP_SET: ReadonlySet<TradeShip> = new Set();

/** Single owner of roster + Ship→TradeShip lookup + home-station index + timer
 *  queue + flight set. Every add/remove/update goes through one place so
 *  these structures stay consistent. */
class ActiveTradeShips {
  private readonly roster: TradeShip[] = [];
  private readonly byOrbitingShipId = new Map<string, TradeShip>();
  /** home-station id → trade ships homed there. Lets callers skip full
   *  trade-ship scans (e.g. emigration's per-station departure gate). */
  private readonly byHomeStationId = new Map<string, Set<TradeShip>>();
  private readonly timerQueue: ScheduledTimer[] = [];
  private timerHead = 0;
  private readonly flying = new Set<TradeShip>();

  /** Register a trade ship. Assumes no existing entry — callers check via
   *  `find` first. Seeds the flight set from `tradeShip.flight` so save-load
   *  restore doesn't need a separate pass. */
  add(tradeShip: TradeShip): void {
    this.roster.push(tradeShip);
    this.byOrbitingShipId.set(tradeShip.orbitingShipId, tradeShip);
    this.indexHomeAdd(tradeShip);
    if (tradeShip.flight) this.flying.add(tradeShip);
  }

  /** Drop all trade state for an orbiting ship id. Returns the removed
   *  TradeShip for post-removal cleanup; does nothing on missing. */
  removeForShipId(orbitingShipId: string): TradeShip | undefined {
    const tradeShip = this.byOrbitingShipId.get(orbitingShipId);
    if (!tradeShip) return undefined;
    this.cancelTimersFor(tradeShip);
    this.flying.delete(tradeShip);
    this.byOrbitingShipId.delete(orbitingShipId);
    this.indexHomeRemove(tradeShip);
    const index = this.roster.indexOf(tradeShip);
    if (index >= 0) this.roster.splice(index, 1);
    return tradeShip;
  }

  all(): readonly TradeShip[] {
    return this.roster;
  }
  findByShipId(orbitingShipId: string): TradeShip | undefined {
    return this.byOrbitingShipId.get(orbitingShipId);
  }
  hasShipId(orbitingShipId: string): boolean {
    return this.byOrbitingShipId.has(orbitingShipId);
  }
  getByHomeStationId(homeStationId: string): ReadonlySet<TradeShip> {
    return this.byHomeStationId.get(homeStationId) ?? EMPTY_TRADE_SHIP_SET;
  }

  setInFlight(tradeShip: TradeShip): void {
    this.flying.add(tradeShip);
  }
  clearFlight(tradeShip: TradeShip): void {
    this.flying.delete(tradeShip);
  }
  isInFlight(tradeShip: TradeShip): boolean {
    return this.flying.has(tradeShip);
  }
  inFlightShips(): ReadonlySet<TradeShip> {
    return this.flying;
  }

  /** Schedule a wake-up at absolute sim time `fireTimeSeconds`. Sorted insert
   *  so the earliest timer fires first. */
  scheduleTimer(tradeShip: TradeShip, fireTimeSeconds: number): void {
    let insertIndex = this.timerQueue.length;
    while (insertIndex > 0 && this.timerQueue[insertIndex - 1].fireTimeSeconds > fireTimeSeconds)
      insertIndex--;
    this.timerQueue.splice(insertIndex, 0, { fireTimeSeconds, ship: tradeShip });
  }

  /** Remove every pending timer for a ship. Keeps `timerHead` aligned when
   *  splicing below it. */
  cancelTimersFor(tradeShip: TradeShip): void {
    for (let i = this.timerQueue.length - 1; i >= 0; i--) {
      if (this.timerQueue[i].ship !== tradeShip) continue;
      this.timerQueue.splice(i, 1);
      if (i < this.timerHead) this.timerHead--;
    }
  }

  /** Fire every timer with fireTimeSeconds <= now. Compacts consumed entries
   *  once they exceed half the queue so memory doesn't grow unbounded. */
  processDueTimers(now: number, handler: (ship: TradeShip) => void): void {
    while (
      this.timerHead < this.timerQueue.length &&
      this.timerQueue[this.timerHead].fireTimeSeconds <= now
    ) {
      const { ship } = this.timerQueue[this.timerHead];
      this.timerHead++;
      handler(ship);
    }
    if (this.timerHead > 0 && this.timerHead >= this.timerQueue.length / 2) {
      this.timerQueue.splice(0, this.timerHead);
      this.timerHead = 0;
    }
  }

  /** Pending (unconsumed) timers for snapshot capture. */
  pendingTimers(): readonly ScheduledTimer[] {
    return this.timerQueue.slice(this.timerHead);
  }

  /** Replace the timer queue (typically from a snapshot). Re-sorts by
   *  fireTimeSeconds so the queue stays ordered regardless of input ordering. */
  restoreTimers(entries: ScheduledTimer[]): void {
    this.timerQueue.length = 0;
    this.timerHead = 0;
    for (const entry of entries) this.timerQueue.push(entry);
    this.timerQueue.sort((a, b) => a.fireTimeSeconds - b.fireTimeSeconds);
  }

  /** Wipe everything. Used at init and at save-load before restore. */
  clear(): void {
    this.roster.length = 0;
    this.byOrbitingShipId.clear();
    this.byHomeStationId.clear();
    this.timerQueue.length = 0;
    this.timerHead = 0;
    this.flying.clear();
  }

  private indexHomeAdd(tradeShip: TradeShip): void {
    let set = this.byHomeStationId.get(tradeShip.homeStationId);
    if (!set) {
      set = new Set();
      this.byHomeStationId.set(tradeShip.homeStationId, set);
    }
    set.add(tradeShip);
  }

  private indexHomeRemove(tradeShip: TradeShip): void {
    const set = this.byHomeStationId.get(tradeShip.homeStationId);
    if (!set) return;
    set.delete(tradeShip);
    if (set.size === 0) this.byHomeStationId.delete(tradeShip.homeStationId);
  }
}

/** Wrap all orbiting ships into trade ships. Ships start grounded and take off
 *  into orbit. Resets trade clock, route stats, and route cache before enrolling. */
function seedInitialTradeShips(manager: TradeManager, ships: Ship[], staggerDurationSeconds?: number): void {
  manager.destroy();

  const eligible = shuffleShipsForStaggeredLaunch(ships);
  const totalStaggerSeconds = staggerDurationSeconds ?? economyConfig.defaultInitialStaggerDurationSeconds;
  const staggerIntervalSeconds = eligible.length > 1 ? totalStaggerSeconds / eligible.length : 0;

  for (let i = 0; i < eligible.length; i++) {
    registerShipAsTradeShip(manager, eligible[i].ship, eligible[i].station, i * staggerIntervalSeconds);
  }
}

/** Shuffle so the staggered launch spreads across the map instead of firing all of one nation's ships first. */
function shuffleShipsForStaggeredLaunch(ships: Ship[]): { ship: Ship; station: Station }[] {
  const eligible: { ship: Ship; station: Station }[] = [];
  for (const orbitingShip of ships) {
    eligible.push({ ship: orbitingShip, station: orbitingShip.station });
  }
  shuffleInPlace(eligible);
  return eligible;
}

/** Initial deploy flight surface→orbit, fired after the schedule delay so a
 *  freshly-enrolled ship takes off from its home station into orbit. */
function createInitialDeployFlyAction(homeStation: Station): Extract<ShipAction, { type: "fly" }> {
  return {
    type: "fly",
    origin: createSurfaceEndpoint(homeStation),
    originStation: homeStation,
    destination: createOrbitEndpoint(homeStation),
    destinationStation: homeStation,
    travelMode: "local",
    deploying: true,
    label: `Deploying to ${stationCodeNameLabel(homeStation)}`,
  };
}

/** Wrap an orbiting ship into a TradeShip and schedule its first wake-up.
 *  Used by init and by dynamic ship-spawn paths (build-site fleets,
 *  post-build regular fleets, emigrant ships).
 *
 *  Callers pass the live Ship + Station for convenience; internally the
 *  TradeShip only stores ids so it stays snapshot-serializable. */
function registerShipAsTradeShip(
  manager: TradeManager,
  orbitingShip: Ship,
  homeStation: Station,
  scheduleDelaySeconds: number = 0,
): TradeShip {
  const existing = manager.activeTradeShips.findByShipId(orbitingShip.id);
  if (existing) return existing;
  const tradeShip: TradeShip = {
    orbitingShipId: orbitingShip.id,
    homeStationId: homeStation.id,
    actionQueue: [createInitialDeployFlyAction(homeStation)],
    flight: null,
    targetStationId: null,
    tradeDirection: null,
    cargoAmountByWareId: new Map(),
    reservations: [],
    lastFlightHeadingRadians: null,
    idleSinceTradeTimeSeconds: 0,
  };
  manager.activeTradeShips.add(tradeShip);
  manager.scheduleTimer(tradeShip, scheduleDelaySeconds);
  return tradeShip;
}

/** Convert an incoming transfer event into a trade-route delivery record. Each
 *  trip touches home plus one non-home target, so cargo arriving at home came
 *  from the target, and cargo arriving at the target came from home. */
function recordRouteDeliveryFromTransfer(event: TradeTransferEvent, manager: TradeManager): void {
  if (event.cargoDirection !== "incoming") return;
  const orbitingShip = manager.shipResolver(event.ship.orbitingShipId);
  if (!orbitingShip) return;
  const toStation = event.station;
  const homeStationId = event.ship.homeStationId;
  const fromStationId = toStation.id === homeStationId ? event.ship.targetStationId : homeStationId;
  const toStationId = toStation.id;
  if (!fromStationId || !toStationId || fromStationId === toStationId) return;
  // Skip emigrating or already-removed endpoints. An emigration clears
  // history; these in-flight deliveries would otherwise redraw the departing
  // stations as ghost routes in the overview.
  if (toStation.state === "emigrating") return;
  const fromStation = manager.stationResolver(fromStationId);
  if (!fromStation || fromStation.state === "emigrating") return;
  const capacity = getShipTypeTemplate(orbitingShip.shipTypeId).cargoCapacity;
  manager.tradeRouteStats.recordDelivery({
    timeSeconds: manager.tradeTimeSeconds,
    fromStationId,
    toStationId,
    wareId: event.wareId,
    fillFraction: capacity > 0 ? event.amount / capacity : 0,
  });
}

/** Update all trade ships — fire expired timers, advance active flights.
 *  Idle ships cost nothing per frame; they wake only on scheduled timers. */
function tickTrade(manager: TradeManager, deltaSeconds: number): void {
  manager.advanceTradeTime(deltaSeconds);
  processDueTradeTimers(manager);
  completeFinishedTradeFlights(manager, deltaSeconds);
}

/** Fire every timer whose fireTimeSeconds has passed; advance the queue for
 *  ships with pending actions, or pick a new trip when the ship is idle. */
function processDueTradeTimers(manager: TradeManager): void {
  manager.activeTradeShips.processDueTimers(manager.tradeTimeSeconds, (ship) => {
    if (ship.actionQueue.length > 0) {
      advanceQueue(ship, manager);
      return;
    }
    const legs = findRoundTradeTrip(ship, manager);
    if (legs) {
      startTrip(ship, legs, manager);
    } else {
      manager.scheduleTimer(ship, randomTradeDelaySeconds());
    }
  });
}

/** Straight-line origin→destination heading seeds the next departure's smooth
 *  turn lerp. Skipped when either endpoint is gone (emigration ferry from a
 *  demolished home): a decommissioning ship never departs again, and the
 *  field stays at its previous value for any other ship that survives. */
function recordDepartureHeadingForNextLeg(ship: TradeShip, flight: FlightData, manager: TradeManager): void {
  const originStation = manager.stationResolver(flight.origin.stationId);
  const destinationStation = manager.stationResolver(flight.destination.stationId);
  if (originStation && destinationStation) {
    ship.lastFlightHeadingRadians = Math.atan2(
      destinationStation.y - originStation.y,
      destinationStation.x - originStation.x,
    );
  }
}

/** Advance active flights and handle completions. Reuses the manager's
 *  scratch buffer so the per-tick allocation stays at zero. */
function completeFinishedTradeFlights(manager: TradeManager, deltaSeconds: number): void {
  const completedFlights = manager.takeCompletedFlightsBuffer();
  for (const ship of manager.activeTradeShips.inFlightShips()) {
    const flight = ship.flight!;
    const done = tickFlightData(flight, deltaSeconds);
    if (done) {
      recordDepartureHeadingForNextLeg(ship, flight, manager);
      ship.flight = null;
      completedFlights.push(ship);
    }
  }
  for (const ship of completedFlights) {
    manager.activeTradeShips.clearFlight(ship);
    advanceQueue(ship, manager);
  }
}

/** Serialize trade module state (tradeTimeSeconds + pending timers). Trade-route
 *  delivery history is runtime-only — saves restart overview history from
 *  the moment the restored session begins. */
function tradeManagerToSnapshot(manager: TradeManager): TradeManagerSnapshot {
  return {
    tradeTimeSeconds: manager.tradeTimeSeconds,
    scheduledTimers: manager.activeTradeShips
      .pendingTimers()
      .map((entry) => ({ shipId: entry.ship.orbitingShipId, fireTimeSeconds: entry.fireTimeSeconds })),
  };
}

/** Restore trade-module state from a snapshot. Call after all trade ships have
 *  been restored via `addRestoredTradeShip` — timers reference those instances. */
function tradeManagerFromSnapshot(
  manager: TradeManager,
  snapshot: TradeManagerSnapshot,
  tradeShipsByShipId: Map<string, TradeShip>,
): void {
  manager.setTradeTimeSeconds(snapshot.tradeTimeSeconds);
  const restored: ScheduledTimer[] = [];
  for (const entry of snapshot.scheduledTimers) {
    const ship = tradeShipsByShipId.get(entry.shipId);
    if (!ship) throw new Error(`tradeManagerFromSnapshot: missing ship ${entry.shipId}`);
    restored.push({ ship, fireTimeSeconds: entry.fireTimeSeconds });
  }
  manager.activeTradeShips.restoreTimers(restored);
}

/** Drop trade-system state for a removed orbiting ship: clear reservations,
 *  cancel timers, drop from flight set, remove the lookup entry. */
function deregisterTradeShipForShip(manager: TradeManager, orbitingShip: Ship): void {
  const tradeShip = manager.activeTradeShips.findByShipId(orbitingShip.id);
  if (!tradeShip) return;
  clearReservations(tradeShip);
  manager.activeTradeShips.removeForShipId(orbitingShip.id);
}
