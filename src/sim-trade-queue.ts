// Queue-side trade operations: how an idle ship turns trip legs into a sequence
// of fly/wait/withdraw/deposit/decommission actions, the per-action mutations
// to inventory + reservations + cargo holds, and the action-dispatch loop
// (`advanceQueue`) that drives a ship through its queued actions.
//
// Trip lifecycle:
//   1. findRoundTradeTrip (sim-trade-decision) picks the legs.
//   2. startTrip places reservations, builds the queue via buildQueueFromTrip,
//      and kicks the first action through advanceQueue.
//   3. advanceQueue walks the queue, executing instant actions (withdraw,
//      deposit) in a burst until it hits a blocking action (fly, wait) or the
//      queue empties.
//
// Cargo helpers (addCargo / removeCargo) live here because every
// transfer mutation flows through processDepositAction or advanceQueue's
// withdraw branch, both of which sit in the queue layer.

import { economyConfig } from "../data/economy-config";
import type { TradeTripLeg } from "./sim-trade-types";
import type { WareTemplate, WareId } from "../data/ware-types";
import { getInventorySlot, type Station, type InventorySlot } from "./sim-station";
import { stationCodeNameLabel } from "./sim-station-template";
import { getShipTemplate } from "./sim-ship-template";
import {
  createFlightData,
  createSurfaceEndpoint,
  createOrbitEndpoint,
} from "./sim-travel";
import type { ShipAction, TravelEndpoint } from "./sim-travel-types";
import { addReservation, fulfillReservation, clearReservations } from "./sim-trade-reservation";
import { getWareTemplate } from "./sim-ware-template";
import {
  type TradeShip,
  type TradeTransferEvent,
} from "./sim-trade-types";
// Type-only — avoids runtime cycle with sim-trade-manager.
import type { DecommissionEvent, TradeManager } from "./sim-trade-manager";

// --- Cargo helpers ---

function addCargo(ship: TradeShip, ware: WareTemplate, amount: number): void {
  const existing = ship.cargoAmountByWareId.get(ware.id) ?? 0;
  ship.cargoAmountByWareId.set(ware.id, existing + amount);
}

function removeCargo(ship: TradeShip, wareId: WareId, amount: number): void {
  const existing = ship.cargoAmountByWareId.get(wareId);
  if (existing === undefined) return;
  const next = existing - amount;
  if (next <= 0) ship.cargoAmountByWareId.delete(wareId);
  else ship.cargoAmountByWareId.set(wareId, next);
}

// --- Queue building ---

interface TripTransferBuckets {
  homeWithdrawals: ShipAction[];
  targetDeposits: ShipAction[];
  targetWithdrawals: ShipAction[];
  homeDeposits: ShipAction[];
}

function buildTransferAction(
  type: "cargo-withdrawal" | "cargo-deposit",
  station: Station,
  leg: TradeTripLeg,
): ShipAction {
  return { type, station, wareId: leg.wareId, amount: leg.amount };
}

/** Route each leg's endpoints into per-station per-direction buckets. */
function bucketTripTransfers(legs: TradeTripLeg[], home: Station, target: Station): TripTransferBuckets {
  const buckets: TripTransferBuckets = {
    homeWithdrawals: [],
    targetDeposits: [],
    targetWithdrawals: [],
    homeDeposits: [],
  };
  for (const leg of legs) {
    if (leg.fromStation.id === home.id) buckets.homeWithdrawals.push(buildTransferAction("cargo-withdrawal", home, leg));
    if (leg.toStation.id === target.id) buckets.targetDeposits.push(buildTransferAction("cargo-deposit", target, leg));
    if (leg.fromStation.id === target.id) buckets.targetWithdrawals.push(buildTransferAction("cargo-withdrawal", target, leg));
    if (leg.toStation.id === home.id) buckets.homeDeposits.push(buildTransferAction("cargo-deposit", home, leg));
  }
  return buckets;
}

function buildFlyBetweenStations(
  origin: Station,
  destination: Station,
  fromEndpointKind: "surface" | "orbit",
): Extract<ShipAction, { type: "fly" }> {
  const originEndpoint = fromEndpointKind === "orbit" ? createOrbitEndpoint(origin) : createSurfaceEndpoint(origin);
  return {
    type: "fly",
    origin: originEndpoint,
    originStation: origin,
    destination: createSurfaceEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation",
    label: `Fly: ${stationCodeNameLabel(origin)} to ${stationCodeNameLabel(destination)}`,
    route: { fromStation: origin, toStation: destination },
  };
}

function buildLocalHop(
  station: Station,
  origin: TravelEndpoint,
  destination: TravelEndpoint,
  label: string,
): Extract<ShipAction, { type: "fly" }> {
  return {
    type: "fly",
    origin,
    originStation: station,
    destination,
    destinationStation: station,
    travelMode: "local",
    label,
  };
}

function buildDockWait(label: string): Extract<ShipAction, { type: "wait" }> {
  return { type: "wait", duration: economyConfig.groundedDelaySeconds, label: `Dock: ${label}` };
}

/** Build the action queue. Ships travel home → target → home, loading/unloading
 *  at each stop. Deposits queue before withdrawals so the hold empties before
 *  refilling. */
function buildQueueFromTrip(ship: TradeShip, legs: TradeTripLeg[], manager: TradeManager): ShipAction[] {
  const home = manager.requireResolvedStation(ship.homeStationId);
  const firstLeg = legs[0];
  // The non-home station touched by the trip.
  const target = firstLeg.fromStation.id === home.id ? firstLeg.toStation : firstLeg.fromStation;

  const homeLabel = stationCodeNameLabel(home);
  const targetLabel = stationCodeNameLabel(target);

  const buckets = bucketTripTransfers(legs, home, target);
  const targetActions = [...buckets.targetDeposits, ...buckets.targetWithdrawals];

  const queue: ShipAction[] = [];
  const needsHomeLanding = buckets.homeWithdrawals.length > 0;
  // All "in orbit at home" references collapse to one endpoint — render
  // resolves the actual orbital position at flight start.
  const orbitEndpoint = createOrbitEndpoint(home);

  // Placeholder consumed by advanceQueue's leading shift so the first real action survives — never executed.
  queue.push(buildLocalHop(home, orbitEndpoint, createSurfaceEndpoint(home), `Land: ${homeLabel}`));

  if (needsHomeLanding) {
    queue.push(buildDockWait(homeLabel));
    queue.push(...buckets.homeWithdrawals);
    queue.push(buildFlyBetweenStations(home, target, "surface"));
  } else {
    // No cargo to load — fly orbit → destination directly.
    queue.push(buildFlyBetweenStations(home, target, "orbit"));
  }

  queue.push(buildDockWait(targetLabel));
  queue.push(...targetActions);
  queue.push(buildFlyBetweenStations(target, home, "surface"));

  if (buckets.homeDeposits.length > 0) {
    queue.push(buildDockWait(homeLabel));
    queue.push(...buckets.homeDeposits);
  }

  queue.push(buildLocalHop(home, createSurfaceEndpoint(home), orbitEndpoint, `Orbit: ${homeLabel}`));

  return queue;
}

// --- Inventory transfer helpers ---

/** Remove cargo from a slot, clamped to available. Returns amount taken. */
export function withdrawCargo(slot: InventorySlot, maxAmount: number): number {
  const actual = Math.min(maxAmount, slot.current);
  slot.current -= actual;
  return actual;
}

/** Deliver cargo to a slot, clamped to capacity. */
export function depositCargo(slot: InventorySlot, amount: number): number {
  const delivered = Math.min(amount, Math.max(0, slot.max - slot.current));
  slot.current += delivered;
  return delivered;
}

export function processDepositAction(
  ship: TradeShip,
  action: Extract<ShipAction, { type: "cargo-deposit" }>,
  manager: TradeManager,
): void {
  const amount = ship.cargoAmountByWareId.get(action.wareId) ?? 0;
  // Resolve slot at use-time — missing (station flipped building→producing or
  // demolished by emigration) silently discards cargo and still releases the
  // reservation.
  const slot = getInventorySlot(action.station, action.wareId);
  // Emigrating stations show the delivery completing visually but destroy the
  // cargo instead of stocking it. Pickups still work so existing stock can move.
  const isEmigrating = action.station.state === "emigrating";
  const delivered = slot && !isEmigrating ? depositCargo(slot, amount) : 0;
  let incomingReservationToRelease = delivered;
  if (delivered < amount) {
    // Capacity shrank since reservation — release the original reserved
    // amount in full so no phantom incoming claim is left on the slot.
    incomingReservationToRelease = action.amount;
  }
  if (slot) fulfillReservation(ship, { station: action.station, wareId: action.wareId, amount: incomingReservationToRelease, cargoDirection: "incoming" });
  if (delivered > 0) {
    const event: TradeTransferEvent = {
      amount: delivered,
      ship,
      station: action.station,
      cargoDirection: "incoming",
      wareId: action.wareId,
    };
    for (const observer of manager.tradeTransferObservers) observer(event);
  }
  removeCargo(ship, action.wareId, amount);
}

function processWithdrawAction(
  ship: TradeShip,
  action: Extract<ShipAction, { type: "cargo-withdrawal" }>,
  manager: TradeManager,
): void {
  // Resolve at use-time — missing slot (station demolished or flipped) silently does nothing.
  const slot = getInventorySlot(action.station, action.wareId);
  const taken = slot ? withdrawCargo(slot, action.amount) : 0;
  if (taken > 0) addCargo(ship, getWareTemplate(action.wareId), taken);
  if (slot) fulfillReservation(ship, { station: action.station, wareId: action.wareId, amount: taken, cargoDirection: "outgoing" });
  if (taken > 0) {
    const event: TradeTransferEvent = {
      amount: taken,
      ship,
      station: action.station,
      cargoDirection: "outgoing",
      wareId: action.wareId,
    };
    for (const observer of manager.tradeTransferObservers) observer(event);
  }
}

function processDecommissionAction(
  ship: TradeShip,
  action: Extract<ShipAction, { type: "decommission" }>,
  manager: TradeManager,
): void {
  const orbitingShip = manager.requireResolvedShip(ship.orbitingShipId);
  const event: DecommissionEvent = {
    tradeShip: ship,
    orbitingShip,
    orbitingShipId: ship.orbitingShipId,
    homeStationId: ship.homeStationId,
    decommissionStationId: action.station.id,
    reason: "decommission-action",
  };
  for (const observer of manager.decommissionObservers) observer(event);
}

// --- Flight + queue lifecycle ---

/** Append actions and make sure the ship starts executing immediately.
 *
 *  Idle ships need a zero-duration placeholder so advanceQueue's leading-shift
 *  doesn't consume the first appended action — same trick buildQueueFromTrip
 *  uses for fresh trips. Ships in flight or mid-action already have a pending
 *  wake-up; idle ships get their timer canceled and rescheduled at 0. */
export function appendActionsToShip(ship: TradeShip, actions: ShipAction[], manager: TradeManager): void {
  if (actions.length === 0) return;
  const isIdle = ship.actionQueue.length === 0 && !manager.activeTradeShips.isInFlight(ship);
  if (isIdle) {
    ship.actionQueue.push({ type: "wait", duration: 0, label: "—" });
  }
  ship.actionQueue.push(...actions);
  if (manager.activeTradeShips.isInFlight(ship)) return;
  // Cancel any pending random-delay timer so the appended tail starts on the
  // next updateTrade tick.
  manager.activeTradeShips.cancelTimersFor(ship);
  manager.activeTradeShips.scheduleTimer(ship, manager.tradeTime);
}

export function startFlight(
  ship: TradeShip,
  action: Extract<ShipAction, { type: "fly" }>,
  manager: TradeManager,
): void {
  const orbitingShip = manager.requireResolvedShip(ship.orbitingShipId);
  const shipTemplate = getShipTemplate(orbitingShip.shipTypeId);
  // Station refs come from the action so an emigrant's queued ferry can still
  // resolve the source after stationManager has removed it.
  ship.flight = createFlightData({
    origin: action.origin,
    destination: action.destination,
    originStation: action.originStation,
    destinationStation: action.destinationStation,
    ship: shipTemplate,
    travelMode: action.travelMode,
    prevHeading: ship.lastHeading,
  });
}

/** Reset trade state and enter idle. Called when the queue empties or when
 *  preparing for a new trade. */
export function resetTradeState(ship: TradeShip, manager: TradeManager): void {
  clearReservations(ship);
  ship.flight = null;
  ship.targetStationId = null;
  ship.tradeDirection = null;
  ship.cargoAmountByWareId.clear();
  ship.lastHeading = null;
  ship.idleStartTime = manager.tradeTime;
}

/** Commit a trip — place reservations, build the queue, fire the first action. */
export function startTrip(ship: TradeShip, legs: TradeTripLeg[], manager: TradeManager): void {

  for (const leg of legs) {
    const outgoingSlot = getInventorySlot(leg.fromStation, leg.wareId);
    const incomingSlot = getInventorySlot(leg.toStation, leg.wareId);
    if (!outgoingSlot || !incomingSlot) throw new Error(`startTrip: missing inventory slot for ware ${leg.wareId}`);
    addReservation(ship, { station: leg.fromStation, wareId: leg.wareId, amount: leg.amount, cargoDirection: "outgoing" });
    addReservation(ship, { station: leg.toStation, wareId: leg.wareId, amount: leg.amount, cargoDirection: "incoming" });
  }

  ship.actionQueue = buildQueueFromTrip(ship, legs, manager);

  // Target station for UI — non-home end of the first leg.
  const firstLeg = legs[0];
  ship.targetStationId = firstLeg.fromStation.id === ship.homeStationId ? firstLeg.toStation.id : firstLeg.fromStation.id;

  // Derived from firstLeg for existing UI/debug readers.
  ship.tradeDirection = firstLeg.fromStation.id === ship.homeStationId ? "sell" : "buy";

  ship.idleStartTime = manager.tradeTime;

  advanceQueue(ship, manager);
}

// --- Queue dispatcher ---

/** Random wait between trade attempts when no trip is available. */
export function randomTradeDelay(): number {
  const { tradeWaitMinSeconds, tradeWaitMaxSeconds } = economyConfig;
  return tradeWaitMinSeconds + Math.random() * (tradeWaitMaxSeconds - tradeWaitMinSeconds);
}

/** Advance the queue. Processes instant actions (cargo transfers) in a burst
 *  until a blocking action (fly, wait) is reached or the queue empties. */
export function advanceQueue(ship: TradeShip, manager: TradeManager): void {
  // Remove the just-completed action (if any).
  if (ship.actionQueue.length > 0) {
    ship.actionQueue.shift();
  }

  while (ship.actionQueue.length > 0) {
    const action = ship.actionQueue[0];

    switch (action.type) {
      case "fly":
        startFlight(ship, action, manager);
        manager.activeTradeShips.setInFlight(ship);
        return; // blocks until flight completes

      case "wait":
        manager.scheduleTimer(ship, action.duration);
        return; // blocks until timer fires

      case "cargo-withdrawal":
        processWithdrawAction(ship, action, manager);
        ship.actionQueue.shift(); // instant, continue to next action
        break;

      case "cargo-deposit":
        processDepositAction(ship, action, manager);
        ship.actionQueue.shift(); // instant, continue to next action
        break;

      case "decommission":
        // Terminal action — ship arrived at the generational ship (or other
        // target) and leaves the universe via the observer (shipManager.removeShip).
        processDecommissionAction(ship, action, manager);
        ship.actionQueue.shift();
        return;
    }
  }

  // Queue empty — reset trade state and schedule the next trip attempt.
  resetTradeState(ship, manager);
  manager.scheduleTimer(ship, randomTradeDelay());
}
