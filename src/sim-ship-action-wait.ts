// Ship wait action — save snapshot codec (encode + decode).

import type { ShipAction } from "./sim-travel-types";
import type { ShipActionSnapshot } from "./sim-save-types";

type WaitAction = Extract<ShipAction, { type: "wait" }>;
type WaitActionSnapshot = Extract<ShipActionSnapshot, { type: "wait" }>;

export function shipWaitActionToSnapshot(action: WaitAction): WaitActionSnapshot {
  return { type: "wait", duration: action.duration, label: action.label };
}

export function shipWaitActionFromSnapshot(snapshot: WaitActionSnapshot): ShipAction {
  return { type: "wait", duration: snapshot.duration, label: snapshot.label };
}
