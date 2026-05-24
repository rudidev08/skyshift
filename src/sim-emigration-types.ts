// Shared emigration-cluster types and tunable constants. Lives as a leaf
// module so siblings (sim-emigration-decision, sim-emigration-start,
// sim-emigration-manager) can import from one place without looping back
// into the manager.

import type { StationEmigration } from "./sim-station-types";
import { clamp01 } from "./util-clamp";

/** Base emigrant-ship count per station; scales by size (S=1, M=2, L=3). */
export const EMIGRANT_SHIPS_PER_STATION_BASE = 10;

export type EmigrationTriggerMode = "auto" | "manual";
export type EmigrationIntensity = "low" | "medium" | "high";

/** Event-scoped metadata. Per-station state lives on station.emigrationEvent;
 *  generational-ship-visible state lives on generationalShip.generationalShipBuild. */
export interface EmigrationEvent {
  id: string;
  nationIds: string[];
  generationalShipId: string;
  stationIds: string[];
  /** O(1) lookup mirror of `stationIds` — not serialized; rebuilt at trigger
   *  and on deserialize. Used by the universe-wide decommission observer. */
  stationIdSet: Set<string>;
  /** Ships from this event that have decommissioned at WAY. WAY jumps once
   *  this reaches `totalExpectedShips`. */
  shipsArrived: number;
  /** Expected decommissions for this event. Locked at trigger as sum of
   *  per-station emigrant budgets + pre-existing homed-ship counts; reduced
   *  by `retireUnlaunched` if a launch budget is abandoned. */
  totalExpectedShips: number;
  destinationName: string;
}

/** Spawn failed — drop the unlaunched budget so totalExpectedShips shrinks
 *  in lockstep and the demolition gate / arrival counter don't stall on
 *  phantom ships that will never arrive. */
export function retireUnlaunched(emigration: StationEmigration, event: EmigrationEvent): void {
  const abandoned = emigration.totalEmigrants - emigration.launched;
  emigration.totalEmigrants = emigration.launched;
  event.totalExpectedShips -= abandoned;
}

/** Compute current per-station emigration progress toward 1.
 *  Returns 1 if the station had nothing to send. Caller supplies homedStillDocked
 *  by walking the station's trade ships. */
export function computeEmigrationFraction(
  emigration: StationEmigration,
  initialHomedShipIdSet: Set<string>,
  homedStillDocked: number,
): number {
  const totalRequired = emigration.totalEmigrants + initialHomedShipIdSet.size;
  if (totalRequired === 0) return 1;
  const homedDeparted = initialHomedShipIdSet.size - homedStillDocked;
  const completed = emigration.launched + homedDeparted;
  return clamp01(completed / totalRequired);
}
