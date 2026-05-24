// src/editor/timelapse-runner.ts
//
// Headless runner for the Timelapse tab. Phaser-free.
//
// Drives Simulation.tick(0.5s) every fast tick, accumulates a 5s budget for
// Simulation.slowSimulationTick(accumulated) to mirror src/game-loop.ts's cadence,
// captures a per-station summary frame (position, nation, type, build state — no
// inventory or ships) every sim-hour, and emits callbacks via setTimeout chunks so
// the UI stays responsive without depending on requestAnimationFrame (which
// Chromium throttles aggressively in headless mode and on backgrounded tabs).

import type { Simulation } from "../sim-lifecycle";
import { createSimulation } from "../sim-lifecycle";
import { createMapFromTemplate } from "../sim-map-create";
import { economyConfig } from "../../data/economy-config";
import type { GameMap } from "../sim-map-types";
import { map } from "../../data/map";
import { getPresetById } from "../util-map-preset";
import type { EmigrationIntensity } from "../sim-emigration-types";
import { toTimelapseStation, type TimelapseFrame } from "../sim-timelapse-state";
import type { StationHistory } from "../sim-station-history";
import { captureDiagnosticsFrame, type DiagnosticsFrame } from "./timelapse-diagnostics";

/** Resolves a preset by id and builds its `GameMap` with `simulationWarmupSeconds: 0`
 *  so the timelapse preview/run starts from the initial state, not pre-ticked.
 *  Returns null when the id doesn't resolve. */
export function createTimelapseMapForPresetId(presetId: string): GameMap | null {
  const preset = getPresetById(presetId);
  if (!preset) return null;
  return createMapFromTemplate(map, { ...preset, simulationWarmupSeconds: 0 });
}

/** Read the simulation's current station list into a render-only `TimelapseFrame`. */
export function captureTimelapseFrame(simulation: Simulation, simTimeSeconds: number): TimelapseFrame {
  return { simTimeSeconds, stations: simulation.stations.map(toTimelapseStation) };
}

export interface TimelapseRunCallbacks {
  /** Called for every captured frame, including frame 0. */
  onFrameCaptured: (frame: TimelapseFrame) => void;
  /** Called alongside `onFrameCaptured` with the matching diagnostics payload
   *  (inventory + build) so the JSON download can carry it. */
  onDiagnosticsFrameCaptured: (frame: DiagnosticsFrame) => void;
  /** Progress as a value in [0, 1]. Called once per chunk. */
  onProgress: (progress: number) => void;
  /** Called once per chunk with the latest sim state for live-preview rendering between captured frames. */
  onLivePreview: (frame: TimelapseFrame) => void;
  /** Called once when the run reaches `durationSeconds`. */
  onComplete: () => void;
}

export interface TimelapseRunHandle {
  /** Cancels the run, stops further callbacks, and destroys the underlying simulation. Safe to call more than once. */
  cancel: () => void;
  /** Lifecycle events recorded by the simulation's station-manager observers
   *  while the run is in flight — tab passes this through to the timelapse
   *  control instead of rebuilding history from captured frames each refresh. */
  stationHistory: StationHistory;
}

/** Timelapse-only widening of `EmigrationIntensity` with a "none" sentinel that
 *  disables auto-trigger entirely (mode → manual). The base `EmigrationIntensity`
 *  union has no zero-fraction value because every value is the strength of
 *  a firing event; the "none" sentinel covers not firing at all. */
export type TimelapseEmigrationSetting = "none" | EmigrationIntensity;

export interface TimelapseRunOptions {
  presetId: string;
  durationSeconds: number;
  /** "none" disables emigration auto-trigger; otherwise maps to EmigrationManager
   *  intensity ("low" = 25% / "medium" = 50% / "high" = 75% of eligible stations
   *  emigrate per nation). */
  emigrationIntensity: TimelapseEmigrationSetting;
}

/** Builds and destroys a transient `Simulation` to capture frame 0 (post-init,
 *  including any nation-level builds started by `startInitialStationBuilds`).
 *  Used by the tab to render a preview of the selected preset before the user
 *  presses Run. Returns null if the preset id doesn't resolve. */
export function capturePresetInitialFrame(presetId: string): TimelapseFrame | null {
  const presetMap = createTimelapseMapForPresetId(presetId);
  if (!presetMap) return null;
  const simulation = createSimulation(presetMap);
  try {
    return captureTimelapseFrame(simulation, 0);
  } finally {
    simulation.destroy();
  }
}

// 1 sim-hour per captured frame — matches the smallest step button in the UI.
const FRAME_INTERVAL_SECONDS = 60 * 60;

// ~100 sim-seconds per chunk keeps each chunk well under 16ms wall time so the UI stays responsive.
const CHUNK_INTERVAL_SECONDS = 100;

// ms between chunks. 0 = next macrotask; lets paint + event handlers run between work bursts.
const CHUNK_GAP_MS = 0;

/** Returns a run handle the caller must `cancel()` on tab switch or restart to
 *  stop callbacks and free the simulation. The handle also exposes the
 *  observer-driven `stationHistory` so the tab can render it without rebuilding
 *  history from captured frames. */
export function startTimelapseRun(
  options: TimelapseRunOptions,
  callbacks: TimelapseRunCallbacks,
): TimelapseRunHandle {
  const { presetId, durationSeconds, emigrationIntensity } = options;
  const presetMap = createTimelapseMapForPresetId(presetId);
  if (!presetMap) throw new Error(`unknown preset: ${presetId}`);

  const simulation = createSimulation(presetMap);
  if (emigrationIntensity === "none") {
    simulation.emigrationManager.setMode("manual");
  } else {
    simulation.emigrationManager.setIntensity(emigrationIntensity);
  }

  const tickIntervalSeconds = economyConfig.simulationIntervalSeconds;
  const totalTicks = Math.ceil(durationSeconds / tickIntervalSeconds);
  const ticksPerFrame = Math.round(FRAME_INTERVAL_SECONDS / tickIntervalSeconds);
  const ticksPerChunk = Math.max(1, Math.round(CHUNK_INTERVAL_SECONDS / tickIntervalSeconds));

  let cancelled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let ticksElapsed = 0;
  let secondsSinceLastSlowSimulationTick = 0;

  // Frame 0 = preset state before any tick.
  callbacks.onFrameCaptured(captureTimelapseFrame(simulation, 0));
  callbacks.onDiagnosticsFrameCaptured(captureDiagnosticsFrame(simulation, 0));

  function runTicksUntilTarget(targetTick: number) {
    while (ticksElapsed < targetTick) {
      simulation.tick(tickIntervalSeconds);
      ticksElapsed++;
      secondsSinceLastSlowSimulationTick += tickIntervalSeconds;
      if (secondsSinceLastSlowSimulationTick >= economyConfig.slowSimulationTickIntervalSeconds) {
        simulation.slowSimulationTick(secondsSinceLastSlowSimulationTick);
        secondsSinceLastSlowSimulationTick = 0;
      }
      if (ticksElapsed % ticksPerFrame === 0) {
        const simTimeSeconds = ticksElapsed * tickIntervalSeconds;
        callbacks.onFrameCaptured(captureTimelapseFrame(simulation, simTimeSeconds));
        callbacks.onDiagnosticsFrameCaptured(captureDiagnosticsFrame(simulation, simTimeSeconds));
      }
    }
  }

  function runNextChunk() {
    if (cancelled) return;
    runTicksUntilTarget(Math.min(ticksElapsed + ticksPerChunk, totalTicks));
    callbacks.onProgress(ticksElapsed / totalTicks);
    callbacks.onLivePreview(captureTimelapseFrame(simulation, ticksElapsed * tickIntervalSeconds));
    if (ticksElapsed < totalTicks) {
      timeoutHandle = setTimeout(runNextChunk, CHUNK_GAP_MS);
    } else {
      callbacks.onComplete();
    }
  }

  timeoutHandle = setTimeout(runNextChunk, CHUNK_GAP_MS);

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      simulation.destroy();
    },
    stationHistory: simulation.stationHistory,
  };
}
