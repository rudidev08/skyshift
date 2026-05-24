// Ship cargo-deposit action — codec to/from save snapshot.

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";
import type { Station } from "./sim-station";
import { waitPlaceholder } from "./sim-ship-action-shared";

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

/** Reconstruct a cargo-deposit action, or a `waitPlaceholder` when the station is gone. */
export function shipCargoDepositActionFromSnapshot(
  snapshot: CargoDepositActionSnapshot,
  stations: Map<string, Station>,
): ShipAction {
  const station = stations.get(snapshot.stationId);
  if (!station) return waitPlaceholder("Deliver");
  return { type: "cargo-deposit", station, wareId: snapshot.wareId, amount: snapshot.amount };
}
