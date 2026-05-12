// Emigration-cluster runtime substrate — the shared types and tunable
// constants that every cluster sibling (decision, start, manager) imports.
// Pulled out of sim-emigration-manager.ts so siblings can import their shared
// types from a leaf module instead of looping back into the manager.
//
// The EmigrationManager class (in sim-emigration-manager.ts) is the only
// public surface for orchestrating emigration events. Decision logic (who
// emigrates) lives in sim-emigration-decision.ts; ship-launch + ferry logic
// lives in sim-emigration-start.ts. Consumers thread emigrationManager through
// to where they need it.

import type { StationEmigration } from "./sim-station-types";

/** Base emigrant-ship count per station; scales by size (S=1, M=2, L=3). */
export const EMIGRANT_SHIPS_PER_STATION_BASE = 10;

export type TriggerMode = "auto" | "manual";
export type Intensity = "low" | "medium" | "high";

/** Event-scoped values that every per-station setup helper threads together. */
export interface EmigrationEventContext {
  eventId: string;
  destinationName: string;
}

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
  eventStartAt: number;
}

/** Spawn failed — drop the unlaunched budget so totalExpectedShips shrinks
 *  in lockstep and the demolition gate / arrival counter don't stall on
 *  phantom ships that will never arrive. */
export function retireUnlaunched(emigration: StationEmigration, event: EmigrationEvent): void {
  const abandoned = emigration.totalEmigrants - emigration.launched;
  emigration.totalEmigrants = emigration.launched;
  event.totalExpectedShips -= abandoned;
}

/** Compute current per-station emigration progress:
 *    (launched emigrants + departed homed ships) / (total emigrants + initial homed).
 *  Returns 1 if the station had nothing to send. Caller resolves homedStillDocked
 *  by walking trade ships. */
export function computeEmigrationFraction(
  emigration: StationEmigration,
  initialHomedShipIdSet: Set<string>,
  homedStillDocked: number,
): number {
  const totalRequired = emigration.totalEmigrants + initialHomedShipIdSet.size;
  if (totalRequired === 0) return 1;
  const homedDeparted = initialHomedShipIdSet.size - homedStillDocked;
  const completed = emigration.launched + homedDeparted;
  return Math.max(0, Math.min(1, completed / totalRequired));
}
