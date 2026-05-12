// Ship decommission action — codec to/from save snapshot.

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";
import type { Station } from "./sim-station";

type DecommissionAction = Extract<ShipAction, { type: "decommission" }>;
type DecommissionActionSnapshot = Extract<ShipActionSnapshot, { type: "decommission" }>;

export function shipDecommissionActionToSnapshot(action: DecommissionAction): DecommissionActionSnapshot {
  return { type: "decommission", stationId: action.station.id, label: action.label };
}

/** Reconstruct a decommission action. Returns a `wait` placeholder when the
 *  station is gone — the ship returns to idle when the queue empties. */
export function shipDecommissionActionFromSnapshot(
  snapshot: DecommissionActionSnapshot,
  stations: Map<string, Station>,
): ShipAction {
  const station = stations.get(snapshot.stationId);
  if (!station) return { type: "wait", duration: 0, label: snapshot.label };
  return { type: "decommission", station, label: snapshot.label };
}
