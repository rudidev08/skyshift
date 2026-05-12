// Lightweight per-frame data captured during a timelapse run. Carries only
// what the renderer (StationDiscPool / StationRewindOverlay) needs — position,
// nation, type, lifecycle state. The editor's diagnostics export captures a
// richer DiagnosticsFrame separately (see editor/timelapse-diagnostics.ts).

import type { StationTypeId } from "../data/station-types";

export interface TimelapseStation {
  id: string;
  position: { x: number; y: number };
  /** NationTemplate.id; matches the string-keyed nation registry. */
  nationId: string;
  typeId: StationTypeId;
  /** `building` → `construction`; everything else (`producing`/`claimed`/`emigrating`) → `operational`. Destroyed stations omitted from the frame. */
  state: "operational" | "construction";
}

export interface TimelapseFrame {
  /** Sim-time at this frame, in seconds, ranging from 0 to durationSeconds. */
  simSeconds: number;
  stations: TimelapseStation[];
}

export interface TimelapseRun {
  presetId: string;
  durationSeconds: number;
  frames: TimelapseFrame[];
  status: "idle" | "running" | "complete";
  currentFrameIndex: number;
  /** Bumped by the tab module on every Run click; in-flight runner callbacks compare against the captured value to drop stale work. */
  generation: number;
}

export type TimelapseStep = "-1d" | "-8h" | "-1h" | "+1h" | "+8h" | "+1d";

// Frames are captured every 1 sim-hour, so each unit shift = 1 frame.
const frameShiftByStep: Record<TimelapseStep, number> = {
  "-1d": -24,
  "-8h": -8,
  "-1h": -1,
  "+1h": 1,
  "+8h": 8,
  "+1d": 24,
};

/** Returns the new index after applying `step`, clamped to `[0, framesLength - 1]`. */
export function stepFrameIndex(currentIndex: number, framesLength: number, step: TimelapseStep): number {
  const next = currentIndex + frameShiftByStep[step];
  if (next < 0) return 0;
  if (next > framesLength - 1) return framesLength - 1;
  return next;
}
