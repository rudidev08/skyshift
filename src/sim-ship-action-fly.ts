// Ship fly action — codec to/from save snapshot.
// Construction lives per-feature: initial deploy in registerShipAsTradeShip,
// trade trips in sim-trade-queue, emigration ferries in sim-emigration-manager.

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";
import type { Station } from "./sim-station";
import { waitPlaceholder } from "./sim-ship-action-shared";

type FlyAction = Extract<ShipAction, { type: "fly" }>;
type FlyActionSnapshot = Extract<ShipActionSnapshot, { type: "fly" }>;

export function shipFlyActionToSnapshot(action: FlyAction): FlyActionSnapshot {
  return {
    type: "fly",
    origin: { ...action.origin },
    destination: { ...action.destination },
    travelMode: action.travelMode,
    deploying: action.deploying,
    label: action.label,
    isTradeFlight: action.isTradeFlight,
  };
}

/** Reconstruct a fly action, or a `waitPlaceholder` when an endpoint is gone. */
export function shipFlyActionFromSnapshot(
  snapshot: FlyActionSnapshot,
  stations: Map<string, Station>,
): ShipAction {
  const originStation = stations.get(snapshot.origin.stationId);
  const destinationStation = stations.get(snapshot.destination.stationId);
  if (!originStation || !destinationStation) {
    return waitPlaceholder(snapshot.label);
  }
  return {
    type: "fly",
    origin: { ...snapshot.origin },
    originStation,
    destination: { ...snapshot.destination },
    destinationStation,
    travelMode: snapshot.travelMode,
    deploying: snapshot.deploying,
    label: snapshot.label,
    isTradeFlight: snapshot.isTradeFlight,
  };
}
