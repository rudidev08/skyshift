// Editor-only diagnostics payload captured alongside the render TimelapseFrame
// during a tools/Timelapse run. Carries inventory + build fields the player
// can download as JSON for post-mortem analysis ("trade trickle still flowing"
// vs "construction deadlock"). Kept separate from sim-timelapse-state.ts so
// the live game's render-only path doesn't pull in this payload.

import type { Simulation } from "../sim-lifecycle";
import type { WareId } from "../../data/ware-types";
import { toTimelapseStation, type TimelapseStation } from "../sim-timelapse-state";

export interface DiagnosticsInventorySlot {
  wareId: WareId;
  current: number;
  max: number;
}

export interface DiagnosticsStation extends TimelapseStation {
  inventory: DiagnosticsInventorySlot[];
  /** Present iff `state === "construction"`. Wares the station still needs before it becomes operational. */
  build?: { waresRequired: { provisions: number; hulls: number } };
}

export interface DiagnosticsFrame {
  simTimeSeconds: number;
  stations: DiagnosticsStation[];
}

/** Snapshot of every station's inventory levels and remaining construction wares at the given sim time. */
export function captureDiagnosticsFrame(simulation: Simulation, simTimeSeconds: number): DiagnosticsFrame {
  const stations: DiagnosticsStation[] = simulation.stations.map((station) => ({
    ...toTimelapseStation(station),
    inventory: station.inventory.map((slot) => ({
      wareId: slot.ware.id,
      current: slot.current,
      max: slot.max,
    })),
    ...(station.build && { build: { waresRequired: { ...station.build.waresRequired } } }),
  }));
  return { simTimeSeconds, stations };
}
