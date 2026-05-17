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
import type { TimelapseFrame, TimelapseStation } from "../sim-timelapse-state";
import { captureDiagnosticsFrame, type DiagnosticsFrame } from "./timelapse-diagnostics";

/** Resolves a preset by id and builds its `GameMap` with `simulationWarmupSeconds: 0`
 *  so the timelapse preview/run starts from the initial state, not pre-ticked.
 *  Returns null when the id doesn't resolve. */
export function buildPresetMap(presetId: string): GameMap | null {
  const preset = getPresetById(presetId);
  if (!preset) return null;
  return createMapFromTemplate(map, { ...preset, simulationWarmupSeconds: 0 });
}

/** Read the simulation's current station list into a render-only `TimelapseFrame`. */
export function captureFrame(simulation: Simulation, simSeconds: number): TimelapseFrame {
  const stations: TimelapseStation[] = [];
  for (const station of simulation.stations) {
    stations.push({
      id: station.id,
      position: { x: station.x, y: station.y },
      nationId: station.nation.id,
      typeId: station.stationType.id,
      state: station.state === "building" ? "construction" : "operational",
    });
  }
  return { simSeconds, stations };
}

// Per src/game-loop.ts — slow tick fires every ~5 sim-seconds with the accumulated delta.
const SLOW_SIMULATION_TICK_INTERVAL_SECONDS = 5;

// Frame capture cadence — matches the smallest step button (1 sim-hour).
const FRAME_INTERVAL_SECONDS = 60 * 60;

// Sim-seconds budget per chunk — ~100 keeps each chunk well under 16ms wall time so the UI stays responsive.
const CHUNK_INTERVAL_SECONDS = 100;

// ms between chunks. 0 = next macrotask; lets paint + event handlers run between work bursts.
const CHUNK_GAP_MS = 0;

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

/** Cancels the run, stops further callbacks, and disposes the underlying simulation. Safe to call more than once. */
export type CancelTimelapseRun = () => void;

/** Timelapse-only widening of `EmigrationIntensity` with a "none" sentinel that
 *  disables auto-trigger entirely (mode → manual). The base `EmigrationIntensity`
 *  union has no zero-fraction value because it represents the strength of
 *  an event that *is* firing; "none" means "don't fire at all". */
export type TimelapseEmigrationSetting = "none" | EmigrationIntensity;

export interface TimelapseRunOptions {
  presetId: string;
  durationSeconds: number;
  /** "none" disables emigration auto-trigger; otherwise maps to EmigrationManager
   *  intensity ("low" = 25% / "medium" = 50% / "high" = 75% of eligible stations
   *  emigrate per nation). */
  emigrationIntensity: TimelapseEmigrationSetting;
}

/** Builds and disposes a transient `Simulation` to capture frame 0 (post-init,
 *  including any nation-level builds started by `startInitialStationBuilds`).
 *  Used by the tab to render a preview of the selected preset before the user
 *  presses Run. Returns null if the preset id doesn't resolve. */
export function capturePresetInitialFrame(presetId: string): TimelapseFrame | null {
  const map = buildPresetMap(presetId);
  if (!map) return null;
  const simulation = createSimulation(map);
  try {
    return captureFrame(simulation, 0);
  } finally {
    simulation.dispose();
  }
}

/** Starts a timelapse run for the given preset + duration. Returns a cancel handle that the caller invokes on tab switch or restart. */
export function startTimelapseRun(
  options: TimelapseRunOptions,
  callbacks: TimelapseRunCallbacks,
): CancelTimelapseRun {
  const { presetId, durationSeconds, emigrationIntensity } = options;
  const map = buildPresetMap(presetId);
  if (!map) throw new Error(`unknown preset: ${presetId}`);

  const simulation = createSimulation(map);
  if (emigrationIntensity === "none") {
    simulation.emigrationManager.setMode("manual");
  } else {
    simulation.emigrationManager.setIntensity(emigrationIntensity);
  }

  const tickInterval = economyConfig.simulationIntervalSeconds;
  const totalTicks = Math.ceil(durationSeconds / tickInterval);
  const ticksPerFrame = Math.round(FRAME_INTERVAL_SECONDS / tickInterval);
  const ticksPerChunk = Math.max(1, Math.round(CHUNK_INTERVAL_SECONDS / tickInterval));

  let cancelled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let ticksElapsed = 0;
  let slowSimulationAccumulator = 0;

  // Frame 0 = preset state before any tick.
  callbacks.onFrameCaptured(captureFrame(simulation, 0));
  callbacks.onDiagnosticsFrameCaptured(captureDiagnosticsFrame(simulation, 0));

  function advanceTicksUntilTarget(targetTick: number) {
    while (ticksElapsed < targetTick) {
      simulation.tick(tickInterval);
      ticksElapsed++;
      slowSimulationAccumulator += tickInterval;
      if (slowSimulationAccumulator >= SLOW_SIMULATION_TICK_INTERVAL_SECONDS) {
        simulation.slowSimulationTick(slowSimulationAccumulator);
        slowSimulationAccumulator = 0;
      }
      if (ticksElapsed % ticksPerFrame === 0) {
        const simSeconds = ticksElapsed * tickInterval;
        callbacks.onFrameCaptured(captureFrame(simulation, simSeconds));
        callbacks.onDiagnosticsFrameCaptured(captureDiagnosticsFrame(simulation, simSeconds));
      }
    }
  }

  function runNextChunk() {
    if (cancelled) return;
    advanceTicksUntilTarget(Math.min(ticksElapsed + ticksPerChunk, totalTicks));
    callbacks.onProgress(ticksElapsed / totalTicks);
    callbacks.onLivePreview(captureFrame(simulation, ticksElapsed * tickInterval));
    if (ticksElapsed < totalTicks) {
      timeoutHandle = setTimeout(runNextChunk, CHUNK_GAP_MS);
    } else {
      callbacks.onComplete();
    }
  }

  timeoutHandle = setTimeout(runNextChunk, CHUNK_GAP_MS);

  return () => {
    if (cancelled) return;
    cancelled = true;
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    simulation.dispose();
  };
}
