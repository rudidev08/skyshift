// Trade save/load codec — (de)serializes a TradeShip plus its action queue and
// reservations to/from the snapshot shapes in sim-save-types. Split out of
// sim-trade-manager.ts: these are pure (de)serializers with zero TradeManager
// coupling — they take a TradeShip or a SnapshotContext (id→object lookups),
// never the manager. The manager keeps only its own module-level snapshot
// (tradeTimeSeconds + scheduled timers); the per-ship/reservation/action codec is here.

import { getInventorySlot, type Station } from "./sim-station";
import type { Ship } from "./sim-ships";
import type { ShipAction } from "./sim-travel-types";
import type { TradeShip, TradeReservation } from "./sim-trade-types";
import type { TradeShipSnapshot, ShipActionSnapshot, ReservationSnapshot } from "./sim-save-types";
import { shipFlyActionToSnapshot, shipFlyActionFromSnapshot } from "./sim-ship-action-fly";
import { shipWaitActionToSnapshot, shipWaitActionFromSnapshot } from "./sim-ship-action-wait";
import {
  shipCargoWithdrawalActionToSnapshot,
  shipCargoWithdrawalActionFromSnapshot,
} from "./sim-ship-action-cargo-withdrawal";
import {
  shipCargoDepositActionToSnapshot,
  shipCargoDepositActionFromSnapshot,
} from "./sim-ship-action-cargo-deposit";
import {
  shipDecommissionActionToSnapshot,
  shipDecommissionActionFromSnapshot,
} from "./sim-ship-action-decommission";

/** id→object lookups passed to TradeShip reconstruction. */
export interface SnapshotContext {
  stations: Map<string, Station>;
  ships: Map<string, Ship>;
}

export function tradeShipToSnapshot(tradeShip: TradeShip): TradeShipSnapshot {
  return {
    shipId: tradeShip.orbitingShipId,
    homeStationId: tradeShip.homeStationId,
    cargo: [...tradeShip.cargoAmountByWareId.entries()].map(([wareId, amount]) => ({
      wareId,
      amount,
    })),
    actionQueue: tradeShip.actionQueue.map(shipActionToSnapshot),
    flight: tradeShip.flight ? { ...tradeShip.flight } : null,
    targetStationId: tradeShip.targetStationId,
    tradeDirection: tradeShip.tradeDirection,
    reservations: tradeShip.reservations.map((reservation) => ({
      stationId: reservation.station.id,
      wareId: reservation.wareId,
      amount: reservation.amount,
      cargoDirection: reservation.cargoDirection,
    })),
    lastFlightHeadingRadians: tradeShip.lastFlightHeadingRadians,
    idleSinceTradeTimeSeconds: tradeShip.idleSinceTradeTimeSeconds,
  };
}

export function tradeShipFromSnapshot(snapshot: TradeShipSnapshot, context: SnapshotContext): TradeShip {
  // Orbiting Ship must resolve — a TradeShip without one is structural
  // corruption (ShipManager rebuilds from the same snapshot).
  if (!context.ships.has(snapshot.shipId))
    throw new Error(`tradeShipFromSnapshot: missing ship ${snapshot.shipId}`);

  return {
    orbitingShipId: snapshot.shipId,
    homeStationId: snapshot.homeStationId,
    cargoAmountByWareId: new Map(snapshot.cargo.map((cargoEntry) => [cargoEntry.wareId, cargoEntry.amount])),
    actionQueue: snapshot.actionQueue.map((actionSnapshot) =>
      shipActionFromSnapshot(actionSnapshot, context),
    ),
    flight: snapshot.flight ? { ...snapshot.flight } : null,
    targetStationId: snapshot.targetStationId,
    tradeDirection: snapshot.tradeDirection,
    reservations: reservationsFromSnapshot(snapshot.reservations, context),
    lastFlightHeadingRadians: snapshot.lastFlightHeadingRadians,
    idleSinceTradeTimeSeconds: snapshot.idleSinceTradeTimeSeconds,
  };
}

function shipActionToSnapshot(action: ShipAction): ShipActionSnapshot {
  switch (action.type) {
    case "fly":
      return shipFlyActionToSnapshot(action);
    case "wait":
      return shipWaitActionToSnapshot(action);
    case "cargo-withdrawal":
      return shipCargoWithdrawalActionToSnapshot(action);
    case "cargo-deposit":
      return shipCargoDepositActionToSnapshot(action);
    case "decommission":
      return shipDecommissionActionToSnapshot(action);
  }
}

function shipActionFromSnapshot(snapshot: ShipActionSnapshot, context: SnapshotContext): ShipAction {
  switch (snapshot.type) {
    case "fly":
      return shipFlyActionFromSnapshot(snapshot, context.stations);
    case "wait":
      return shipWaitActionFromSnapshot(snapshot);
    case "cargo-withdrawal":
      return shipCargoWithdrawalActionFromSnapshot(snapshot, context.stations);
    case "cargo-deposit":
      return shipCargoDepositActionFromSnapshot(snapshot, context.stations);
    case "decommission":
      return shipDecommissionActionFromSnapshot(snapshot, context.stations);
  }
}

/** Reconstruct reservations from snapshot, dropping ones whose station or slot
 *  is gone — a saved reservation can legitimately outlive its target if the
 *  station was demolished post-save; drop on load instead of carrying a
 *  dangling ref. */
function reservationsFromSnapshot(
  snapshots: ReservationSnapshot[],
  context: SnapshotContext,
): TradeReservation[] {
  const reservations: TradeReservation[] = [];
  for (const snapshot of snapshots) {
    const station = context.stations.get(snapshot.stationId);
    if (!station) continue;
    if (!getInventorySlot(station, snapshot.wareId)) continue;
    reservations.push({
      station,
      wareId: snapshot.wareId,
      amount: snapshot.amount,
      cargoDirection: snapshot.cargoDirection,
    });
  }
  return reservations;
}
