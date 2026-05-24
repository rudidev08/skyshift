// Ship decommission action — codec to/from save snapshot.

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";
import type { Station } from "./sim-station";
import { waitPlaceholder } from "./sim-ship-action-shared";

type DecommissionAction = Extract<ShipAction, { type: "decommission" }>;
type DecommissionActionSnapshot = Extract<ShipActionSnapshot, { type: "decommission" }>;

export function shipDecommissionActionToSnapshot(action: DecommissionAction): DecommissionActionSnapshot {
  return { type: "decommission", stationId: action.station.id, label: action.label };
}

/** Reconstruct a decommission action, or a `waitPlaceholder` when the station is gone. */
export function shipDecommissionActionFromSnapshot(
  snapshot: DecommissionActionSnapshot,
  stations: Map<string, Station>,
): ShipAction {
  const station = stations.get(snapshot.stationId);
  if (!station) return waitPlaceholder(snapshot.label);
  return { type: "decommission", station, label: snapshot.label };
}
