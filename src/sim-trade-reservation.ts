// Reservation lifecycle for trade ships.
//
// Each inventory slot tracks reservedIncoming (deliveries en route) and
// reservedOutgoing (cargo claimed for pickup) so multiple ships don't chase
// the same shortage. Trade ships record their own reservation entries so
// trip-end cleanup can release whatever didn't transfer.

import type { TradeReservation } from "./sim-trade-types";
import { reserveIncoming, reserveOutgoing, releaseIncoming, releaseOutgoing } from "./sim-station";
import { type TradeShip } from "./sim-trade-types";

function reserveSlot(reservation: TradeReservation): void {
  if (reservation.cargoDirection === "incoming")
    reserveIncoming(reservation.station, reservation.wareId, reservation.amount);
  else reserveOutgoing(reservation.station, reservation.wareId, reservation.amount);
}

function releaseSlot(reservation: TradeReservation): void {
  if (reservation.cargoDirection === "incoming")
    releaseIncoming(reservation.station, reservation.wareId, reservation.amount);
  else releaseOutgoing(reservation.station, reservation.wareId, reservation.amount);
}

export function addReservation(ship: TradeShip, reservation: TradeReservation) {
  reserveSlot(reservation);
  ship.reservations.push({ ...reservation });
}

/** Reduce a reservation when cargo is physically transferred. Fully-settled
 *  entries are pruned so the ship's reservations array doesn't accumulate
 *  zero-amount entries across trips. Partial fulfilment keeps residual —
 *  clearReservations at trip-end releases the rest if the ship never finishes
 *  the leg. */
export function fulfillReservation(ship: TradeShip, reservation: TradeReservation) {
  releaseSlot(reservation);

  let remaining = reservation.amount;
  for (const existing of ship.reservations) {
    if (
      existing.station === reservation.station &&
      existing.wareId === reservation.wareId &&
      existing.cargoDirection === reservation.cargoDirection &&
      existing.amount > 0
    ) {
      const fulfilled = Math.min(existing.amount, remaining);
      existing.amount -= fulfilled;
      remaining -= fulfilled;
      if (remaining <= 0) break;
    }
  }
  removeSettledReservations(ship);
}

function removeSettledReservations(ship: TradeShip): void {
  for (let i = ship.reservations.length - 1; i >= 0; i--) {
    if (ship.reservations[i].amount <= 0) ship.reservations.splice(i, 1);
  }
}

/** Release every still-pending reservation. Called at trip-end so anything
 *  that didn't transfer doesn't leak into the slot counters. Demolished-station
 *  case: the reservation still references the (now-orphan) Station object,
 *  so releasing decrements the orphan's slot counter — harmless since nothing
 *  observes the demolished station's slots anymore. */
export function clearReservations(ship: TradeShip): void {
  for (const reservation of ship.reservations) releaseSlot(reservation);
  ship.reservations.length = 0;
}
