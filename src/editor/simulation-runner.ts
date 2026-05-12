// Runs the live simulation for the editor's "Run Simulation" button. Returns
// per-station per-slot inventory ranges (min, max, final) for the table view.

import type { Nation } from "../sim-nation";
import type { GameMap } from "../sim-map-types";
import type { Station } from "../sim-station";
import { economyConfig } from "../../data/economy-config";
import { createSimulation } from "../sim-lifecycle";
import { getAllInventorySlots } from "../sim-station";
import type { MapEditorState } from "./map-editor-state";
import type { EditorSimulationSession, SlotResult } from "./simulation-session";
import { renderStationTable } from "./stations-panel";
import { renderFleetSummary, simulateFleetTransportByRow } from "./fleet-summary";

function recordCurrentSlotPercents(station: Station, slotResults: SlotResult[]) {
  const slots = getAllInventorySlots(station);
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const slot = slots[slotIndex];
    const percent = slot.max > 0 ? (slot.current / slot.max) * 100 : 0;
    if (percent < slotResults[slotIndex].minPercent) slotResults[slotIndex].minPercent = percent;
    if (percent > slotResults[slotIndex].maxPercent) slotResults[slotIndex].maxPercent = percent;
    slotResults[slotIndex].finalPercent = percent;
  }
}

/** Runs the live simulation for `hours` and collects per-station per-slot
 *  inventory ranges (min, max, final). Disposes the simulation before
 *  returning so callers don't need a finally block. */
function simulateInventoryRangesOverHours(
  map: GameMap,
  hours: number,
): { ranges: Map<string, SlotResult[]>; shipCount: number } {
  const simulation = createSimulation(map, { ignoreCargoCompatibility: true });
  const shipCount = simulation.ships.length;
  const totalSeconds = hours * 3600;
  const secondsPerSimulationTick = economyConfig.simulationIntervalSeconds;

  const ranges = new Map<string, SlotResult[]>();
  for (const station of simulation.stations) {
    ranges.set(station.id, getAllInventorySlots(station).map(slot => {
      const percent = slot.max > 0 ? (slot.current / slot.max) * 100 : 0;
      return { minPercent: percent, maxPercent: percent, finalPercent: 0 };
    }));
  }

  try {
    for (let elapsedSeconds = 0; elapsedSeconds < totalSeconds; elapsedSeconds += secondsPerSimulationTick) {
      simulation.tick(secondsPerSimulationTick);
      for (const station of simulation.stations) {
        recordCurrentSlotPercents(station, ranges.get(station.id)!);
      }
    }
  } finally {
    simulation.dispose();
  }

  return { ranges, shipCount };
}

export interface SimulationRunDependencies {
  mapState: MapEditorState;
  simulationSession: EditorSimulationSession;
  allPlayableNations: Nation[];
  applyReadOnlyMode: () => void;
}

/** Reads the hours input, runs the simulation off-frame so the "Running..." status paints first, then refreshes the fleet + station tables. */
export function runEditorSimulation(dependencies: SimulationRunDependencies) {
  const { mapState, simulationSession, allPlayableNations, applyReadOnlyMode } = dependencies;

  const hoursInput = document.getElementById("simulation-hours") as HTMLInputElement;
  const hours = parseFloat(hoursInput.value);
  if (isNaN(hours) || hours <= 0) return;

  simulationSession.cancelPending();
  const runGeneration = simulationSession.runGeneration;
  simulationSession.setStatus("Running...");

  // The generation token cancels older queued runs on edit / re-click.
  simulationSession.scheduleRun(() => {
    const { ranges, shipCount } = simulateInventoryRangesOverHours(mapState.currentMap(), hours);

    if (runGeneration !== simulationSession.runGeneration) return;

    const fleetTransportByRow = simulateFleetTransportByRow(mapState);
    if (runGeneration !== simulationSession.runGeneration) return;

    simulationSession.setStatus(`Done — ${hours}h simulated (${shipCount} ships)`);
    simulationSession.hasBeenRun = true;
    simulationSession.lastSlotRangesByStationId = ranges;
    simulationSession.lastFleetTransportByRow = fleetTransportByRow;
    simulationSession.fleetTransportIsStale = false;
    renderFleetSummary(mapState, simulationSession, allPlayableNations);
    renderStationTable(mapState, simulationSession, allPlayableNations, applyReadOnlyMode);
  }, runGeneration);
}
