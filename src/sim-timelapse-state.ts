// Lightweight per-frame data captured during a timelapse run. Carries only
// what the renderer (StationDiscPool / StationRewindOverlay) needs — position,
// nation, type, lifecycle state. The editor's diagnostics export captures a
// richer DiagnosticsFrame separately (see editor/timelapse-diagnostics.ts).

import type { StationTypeId } from "../data/station-types";
import type { Station } from "./sim-station";

/** The two lifecycle states a station can have in a timelapse frame. Also the
 *  set the save-snapshot validator checks station-history entries against. */
export const HISTORY_STATION_STATES = ["operational", "construction"] as const;
export type TimelapseStationState = (typeof HISTORY_STATION_STATES)[number];

export interface TimelapseStation {
  id: string;
  position: { x: number; y: number };
  /** NationTemplate.id; matches the string-keyed nation registry. */
  nationId: string;
  typeId: StationTypeId;
  /** `building` → `construction`; everything else (`producing`/`emigrating`) → `operational`. Destroyed stations omitted from the frame. */
  state: TimelapseStationState;
}

/** Project a runtime `Station` to its lightweight timelapse summary. The
 *  `building` → `construction` collapse lives here so every capture site
 *  (live sim history, editor runner, editor diagnostics) shares one rule. */
export function toTimelapseStation(station: Station): TimelapseStation {
  return {
    id: station.id,
    position: { x: station.x, y: station.y },
    nationId: station.nation.id,
    typeId: station.stationType.id,
    state: station.state === "building" ? "construction" : "operational",
  };
}

export interface TimelapseFrame {
  /** Sim-time at this frame, in seconds, ranging from 0 to durationSeconds. */
  simTimeSeconds: number;
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

/** The six scrub-step buttons, left-to-right. One ordered source for the
 *  button order, frame-index delta, and seconds delta. Frames are captured
 *  every 1 sim-hour, so `frameShift` is a frame count and one sim-hour each. */
const TIMELAPSE_STEPS: ReadonlyArray<{ step: TimelapseStep; frameShift: number }> = [
  { step: "-1d", frameShift: -24 },
  { step: "-8h", frameShift: -8 },
  { step: "-1h", frameShift: -1 },
  { step: "+1h", frameShift: 1 },
  { step: "+8h", frameShift: 8 },
  { step: "+1d", frameShift: 24 },
];

/** Step buttons in display order (`-1d` … `+1d`). */
export const STEP_ORDER: readonly TimelapseStep[] = TIMELAPSE_STEPS.map((entry) => entry.step);

/** Button face per step — same as the key but with the ASCII hyphen swapped
 *  for a true minus sign (U+2212) so `−1d` aligns visually with `+1d`. */
export const STEP_LABELS: Record<TimelapseStep, string> = Object.fromEntries(
  TIMELAPSE_STEPS.map((entry) => [entry.step, entry.step.replace("-", "−")]),
) as Record<TimelapseStep, string>;

/** Sim-seconds the playhead jumps per step. */
export const STEP_SECONDS: Record<TimelapseStep, number> = Object.fromEntries(
  TIMELAPSE_STEPS.map((entry) => [entry.step, entry.frameShift * 3600]),
) as Record<TimelapseStep, number>;

const frameShiftByStep: Record<TimelapseStep, number> = Object.fromEntries(
  TIMELAPSE_STEPS.map((entry) => [entry.step, entry.frameShift]),
) as Record<TimelapseStep, number>;

/** Returns the new index after applying `step`, clamped to `[0, framesLength - 1]`. */
export function stepFrameIndex(currentIndex: number, framesLength: number, step: TimelapseStep): number {
  const nextIndex = currentIndex + frameShiftByStep[step];
  if (nextIndex < 0) return 0;
  if (nextIndex > framesLength - 1) return framesLength - 1;
  return nextIndex;
}
