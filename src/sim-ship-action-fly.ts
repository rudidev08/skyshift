// Save-snapshot codec for ship fly actions on TradeShip's action queue.
//
// Construction lives per-feature (initial deploy in registerShipAsTradeShip,
// trade trips in sim-trade-queue, emigration ferries in sim-emigration-manager);
// this file owns just the snapshot codec, which is the only fly logic complex
// enough to warrant its own home.

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";
import type { Station } from "./sim-station";

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
    route: action.route
      ? {
          fromStationId: action.route.fromStation.id,
          toStationId: action.route.toStation.id,
        }
      : undefined,
  };
}

function tradeRouteFromSnapshot(
  snapshotRoute: FlyActionSnapshot["route"],
  stations: Map<string, Station>,
): { fromStation: Station; toStation: Station } | undefined {
  if (!snapshotRoute) return undefined;
  const fromStation = stations.get(snapshotRoute.fromStationId);
  const toStation = stations.get(snapshotRoute.toStationId);
  if (!fromStation || !toStation) return undefined;
  return { fromStation, toStation };
}

/** Reconstruct a fly action. Returns a `wait` placeholder when an endpoint is gone — reachable when emigration demolishes a kept ship's home while the ferry flight to the generational ship is in progress. The flight itself is restored via ship.flight and continues on its pre-computed phase data; this slot just sits at the queue head and does nothing until advanceQueue shifts it off when the flight completes. */
export function shipFlyActionFromSnapshot(
  snapshot: FlyActionSnapshot,
  stations: Map<string, Station>,
): ShipAction {
  const originStation = stations.get(snapshot.origin.stationId);
  const destinationStation = stations.get(snapshot.destination.stationId);
  if (!originStation || !destinationStation) {
    return { type: "wait", duration: 0, label: snapshot.label };
  }
  const route = tradeRouteFromSnapshot(snapshot.route, stations);
  return {
    type: "fly",
    origin: { ...snapshot.origin },
    originStation,
    destination: { ...snapshot.destination },
    destinationStation,
    travelMode: snapshot.travelMode,
    deploying: snapshot.deploying,
    label: snapshot.label,
    route,
  };
}
