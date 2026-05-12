// Editor-only diagnostics payload captured alongside the render TimelapseFrame
// during a tools/Timelapse run. Carries inventory + build fields the player
// can download as JSON for post-mortem analysis ("trade trickle still flowing"
// vs "construction deadlock"). Kept separate from sim-timelapse-state.ts so
// the live game's render-only path doesn't pull in this payload.

import type { Simulation } from "../sim-lifecycle";
import type { StationTypeId } from "../../data/station-types";
import type { WareId } from "../../data/ware-types";
import type { HistoryStationState } from "../sim-station-history";

export interface DiagnosticsInventorySlot {
  ware: WareId;
  current: number;
  max: number;
}

export interface DiagnosticsStation {
  id: string;
  position: { x: number; y: number };
  nationId: string;
  typeId: StationTypeId;
  state: HistoryStationState;
  inventory: DiagnosticsInventorySlot[];
  /** Present iff `state === "construction"`. Wares the station consumes to flip from `building` → `producing`. */
  build?: { waresRequired: { provisions: number; hulls: number } };
}

export interface DiagnosticsFrame {
  simSeconds: number;
  stations: DiagnosticsStation[];
}

/** Read the simulation's current station list into a `DiagnosticsFrame` —
 *  inventory levels per slot + per-build wares required. */
export function captureDiagnosticsFrame(simulation: Simulation, simSeconds: number): DiagnosticsFrame {
  const stations: DiagnosticsStation[] = [];
  for (const station of simulation.stations) {
    const captured: DiagnosticsStation = {
      id: station.id,
      position: { x: station.x, y: station.y },
      nationId: station.nation.id,
      typeId: station.stationType.id,
      state: station.state === "building" ? "construction" : "operational",
      inventory: station.inventory.map((slot) => ({
        ware: slot.ware.id,
        current: slot.current,
        max: slot.max,
      })),
    };
    if (station.build) {
      captured.build = { waresRequired: { ...station.build.waresRequired } };
    }
    stations.push(captured);
  }
  return { simSeconds, stations };
}
