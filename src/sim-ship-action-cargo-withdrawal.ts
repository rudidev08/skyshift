// Ship cargo-withdrawal action — codec to/from save snapshot.

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";
import type { Station } from "./sim-station";

type CargoWithdrawalAction = Extract<ShipAction, { type: "cargo-withdrawal" }>;
type CargoWithdrawalActionSnapshot = Extract<ShipActionSnapshot, { type: "cargo-withdrawal" }>;

export function shipCargoWithdrawalActionToSnapshot(action: CargoWithdrawalAction): CargoWithdrawalActionSnapshot {
  return { type: "cargo-withdrawal", stationId: action.station.id, wareId: action.wareId, amount: action.amount };
}

/** Reconstruct a cargo-withdrawal action. Returns a `wait` placeholder when the
 *  station is gone — keeps the queue advancing past it without crashing. */
export function shipCargoWithdrawalActionFromSnapshot(
  snapshot: CargoWithdrawalActionSnapshot,
  stations: Map<string, Station>,
): ShipAction {
  const station = stations.get(snapshot.stationId);
  if (!station) return { type: "wait", duration: 0, label: "Load" };
  return { type: "cargo-withdrawal", station, wareId: snapshot.wareId, amount: snapshot.amount };
}
