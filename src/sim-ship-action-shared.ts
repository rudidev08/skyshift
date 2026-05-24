// Shared piece across the ship-action save codecs.

import type { ShipAction } from "./sim-travel-types";

type WaitAction = Extract<ShipAction, { type: "wait" }>;

/** Placeholder a decode returns when an action's referenced station/endpoint is
 *  gone. Reachable when emigration demolishes a station whose ships have queued
 *  actions still pointing at it (e.g. a kept ship mid-ferry to the generational
 *  ship when its home is demolished). It sits at the queue head doing nothing
 *  until advanceQueue shifts it off — for a fly action the flight itself is
 *  restored via ship.flight and continues on its pre-computed phase data. */
export function waitPlaceholder(label: string): WaitAction {
  return { type: "wait", durationSeconds: 0, label };
}
