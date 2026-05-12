// Reservation lifecycle for trade ships.
//
// Each inventory slot tracks reservedIncoming (deliveries en route) and
// reservedOutgoing (cargo claimed for pickup) so multiple ships don't chase
// the same shortage. Trade ships record their own reservation entries so
// trip-end cleanup can release whatever didn't transfer.

import type { TradeReservation } from "./sim-trade-types";
import { reserveIncoming, reserveOutgoing, releaseIncoming, releaseOutgoing } from "./sim-station";
import { type TradeShip } from "./sim-trade-types";

export function addReservation(ship: TradeShip, reservation: TradeReservation) {
  if (reservation.cargoDirection === "incoming") reserveIncoming(reservation.station, reservation.wareId, reservation.amount);
  else reserveOutgoing(reservation.station, reservation.wareId, reservation.amount);
  ship.reservations.push({ ...reservation });
}

/** Reduce a reservation when cargo is physically transferred. Fully-settled
 *  entries are removed so save capture doesn't trip over stale entries whose
 *  station was demolished. Partial fulfilment keeps residual — clearReservations
 *  at trip-end releases the rest if the ship never finishes the leg. */
export function fulfillReservation(ship: TradeShip, reservation: TradeReservation) {
  let amount = reservation.amount;
  if (reservation.cargoDirection === "incoming") releaseIncoming(reservation.station, reservation.wareId, amount);
  else releaseOutgoing(reservation.station, reservation.wareId, amount);
  for (const existing of ship.reservations) {
    if (existing.station === reservation.station && existing.wareId === reservation.wareId && existing.cargoDirection === reservation.cargoDirection && existing.amount > 0) {
      const fulfilled = Math.min(existing.amount, amount);
      existing.amount -= fulfilled;
      amount -= fulfilled;
      if (amount <= 0) break;
    }
  }
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
  for (const reservation of ship.reservations) {
    if (reservation.amount <= 0) continue;
    if (reservation.cargoDirection === "incoming") releaseIncoming(reservation.station, reservation.wareId, reservation.amount);
    else releaseOutgoing(reservation.station, reservation.wareId, reservation.amount);
  }
  ship.reservations.length = 0;
}
