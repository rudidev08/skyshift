import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { startTimelapseRun } from "../editor/timelapse-runner.ts";
import type { StationLifecycleEvent } from "../sim-station-history.ts";
import type { TimelapseFrame } from "../sim-timelapse-state.ts";

// Pin that `startTimelapseRun` exposes a `stationHistory` populated by the
// simulation's lifecycle observers, not by walking captured frames.
//
// Pre-change, the runner returned a bare cancel function; the tab rebuilt its
// own `StationHistory` from captured frames in `buildStationHistoryFromFrames`,
// re-walking every captured frame on every UI refresh. Post-change, the runner
// surfaces the simulation's observer-driven `StationHistory` and the tab reads
// it directly.
//
// Frame 0 is captured synchronously inside `startTimelapseRun` (before the
// first setTimeout chunk), so the exposed history can be inspected immediately
// after the call returns without awaiting later frames.

test("startTimelapseRun exposes a stationHistory populated by observer subscription", () => {
  const frames: TimelapseFrame[] = [];
  const handle = startTimelapseRun(
    // 1 sim-hour duration keeps the test cheap; we cancel right after frame 0
    // so the setTimeout chunks never fire. emigration "none" keeps the roster
    // stable so distinct-station counting is unambiguous.
    { presetId: "settled", durationSeconds: 3600, emigrationIntensity: "none" },
    {
      onFrameCaptured: (frame) => frames.push(frame),
      onDiagnosticsFrameCaptured: () => {},
      onProgress: () => {},
      onLivePreview: () => {},
      onComplete: () => {},
    },
  );
  try {
    const events: StationLifecycleEvent[] = handle.stationHistory.toSnapshot();
    const createdEventStationIds = events
      .filter((event): event is Extract<StationLifecycleEvent, { kind: "created" }> => event.kind === "created")
      .map((event) => event.station.id);

    // Frame 0 covers the full initial roster (seed + initial builds);
    // emigration is off so no new stations spawn during the run window.
    assertTrue(frames.length > 0, "frame 0 captured");
    const frameZeroStationIds = new Set(frames[0].stations.map((station) => station.id));
    assertTrue(frameZeroStationIds.size > 0, "settled preset has stations");

    // The observer path emits `created` once per station; the dropped
    // frame-diff path would have repeated `recordCreated` per UI rebuild.
    assertEqual(
      new Set(createdEventStationIds).size,
      frameZeroStationIds.size,
      "one created event per distinct station",
    );
    assertEqual(
      createdEventStationIds.length,
      frameZeroStationIds.size,
      "no duplicate created events",
    );
  } finally {
    handle.cancel();
  }
});
