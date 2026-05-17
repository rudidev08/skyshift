// Ship cargo-deposit action — codec to/from save snapshot.

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";
import type { Station } from "./sim-station";

type CargoDepositAction = Extract<ShipAction, { type: "cargo-deposit" }>;
type CargoDepositActionSnapshot = Extract<ShipActionSnapshot, { type: "cargo-deposit" }>;

export function shipCargoDepositActionToSnapshot(action: CargoDepositAction): CargoDepositActionSnapshot {
  return {
    type: "cargo-deposit",
    stationId: action.station.id,
    wareId: action.wareId,
    amount: action.amount,
  };
}

/** Reconstruct a cargo-deposit action. Returns a `wait` placeholder when the
 *  station is gone — keeps the queue advancing past it without crashing. */
export function shipCargoDepositActionFromSnapshot(
  snapshot: CargoDepositActionSnapshot,
  stations: Map<string, Station>,
): ShipAction {
  const station = stations.get(snapshot.stationId);
  if (!station) return { type: "wait", duration: 0, label: "Deliver" };
  return { type: "cargo-deposit", station, wareId: snapshot.wareId, amount: snapshot.amount };
}
