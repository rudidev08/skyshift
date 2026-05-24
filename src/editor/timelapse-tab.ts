// DOM wiring + orchestration for the Timelapse tab. Owns:
//   - the in-memory TimelapseRun (frames + index + status + generation),
//   - cancel-on-restart with simulation.destroy() via the runner's run handle,
//   - lazy Phaser scene mount (created on first activation, destroyed on tab destroy),
//   - the Run/Pause toolbar transition (Run prominent → Pause less prominent
//     while running → both hidden when complete; changing any setting drops
//     back to the idle state and re-shows Run).
//
// The chart + per-nation counts row + step buttons are rendered by the shared
// `StationsTimelapseControl` (also used by the live game's Stations Timelapse
// Log tab). Tools wraps the component with the existing time-or-blurb label
// and progress bar.

import Phaser from "phaser";
import { Download } from "lucide-static";
import { formatElapsed } from "../render-elapsed-time-label";
import { setTextIfChanged } from "../ui-dom-cache";
import { downloadJsonFile, fileNameTimestamp } from "../ui-download-json";
import { TimelapseScene } from "./timelapse-scene";
import {
  createTimelapseMapForPresetId,
  capturePresetInitialFrame,
  startTimelapseRun,
  type TimelapseEmigrationSetting,
  type TimelapseRunCallbacks,
  type TimelapseRunHandle,
} from "./timelapse-runner";
import type { DiagnosticsFrame } from "./timelapse-diagnostics";
import {
  stepFrameIndex,
  type TimelapseFrame,
  type TimelapseRun,
} from "../sim-timelapse-state";
import {
  createStationsTimelapseControl,
  type StationsTimelapseControl,
} from "../ui-stations-timelapse-control";

const PRE_RUN_BLURB = "Simulate stations growing and emigrating over time.";

interface TimelapseTabControls {
  presetSelect: HTMLSelectElement;
  durationSelect: HTMLSelectElement;
  emigrationSelect: HTMLSelectElement;
  runButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  diagnosticsButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  timeLabel: HTMLElement;
  controlMount: HTMLElement;
  progressBar: HTMLElement;
  progressFill: HTMLElement;
  container: HTMLElement;
}

export interface TimelapseTab {
  /** Lazy-mounts the Phaser scene if it hasn't been created yet. */
  activate: () => void;
  /** Cancels any in-flight run + destroys the Phaser scene. Used when the
   *  user navigates away from the Timelapse tab and on `beforeunload`.
   *  Does NOT remove the DOM event listeners on toolbar/step controls —
   *  those outlive the tab module (controls live in the page; the tab is
   *  built once at module init and reused across activations). Safe to call
   *  more than once. */
  destroy: () => void;
}

export function createTimelapseTab(): TimelapseTab {
  const controls = readControls();
  const run: TimelapseRun = {
    presetId: controls.presetSelect.value,
    durationSeconds: Number(controls.durationSelect.value),
    frames: [],
    status: "idle",
    currentFrameIndex: 0,
    generation: 0,
  };
  // Parallel array to run.frames; populated only by the editor's diagnostics
  // capture, dumped on Download. Kept off TimelapseRun so the sim-timelapse
  // type doesn't carry editor-only state.
  let diagnosticsFrames: DiagnosticsFrame[] = [];

  let game: Phaser.Game | null = null;
  let scene: TimelapseScene | null = null;
  let runHandle: TimelapseRunHandle | null = null;
  let mountedPresetId: string | null = null;
  // Cached because `createSimulation` randomizes initial-build zones and the
  // WAY generational-ship origin — without the cache the map would jump on
  // every duration/emigration change.
  const previewFrameByPresetId = new Map<string, TimelapseFrame>();

  const control: StationsTimelapseControl = createStationsTimelapseControl({
    parent: controls.controlMount,
    onStep(step) {
      if (run.frames.length === 0) return;
      run.currentFrameIndex = stepFrameIndex(run.currentFrameIndex, run.frames.length, step);
      renderCurrentFrame();
    },
    onScrubToTime(scrubbedSeconds) {
      if (run.frames.length === 0) return;
      run.currentFrameIndex = frameIndexNearestTime(run.frames, scrubbedSeconds);
      renderCurrentFrame();
    },
  });

  function getOrCapturePresetInitialFrame(presetId: string): TimelapseFrame | null {
    const cached = previewFrameByPresetId.get(presetId);
    if (cached) return cached;
    const fresh = capturePresetInitialFrame(presetId);
    if (fresh) previewFrameByPresetId.set(presetId, fresh);
    return fresh;
  }

  function mountSceneFor(presetId: string): TimelapseFrame | null {
    destroyScene();
    const map = createTimelapseMapForPresetId(presetId);
    if (!map) return null;
    const initialFrame = getOrCapturePresetInitialFrame(presetId);
    if (!initialFrame) return null;
    scene = new TimelapseScene(map, initialFrame);
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: controls.container,
      backgroundColor: "#050709",
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: "100%",
        height: "100%",
      },
      scene: [scene],
    });
    mountedPresetId = presetId;
    return initialFrame;
  }

  function destroyScene() {
    game?.destroy(true);
    game = null;
    scene = null;
    mountedPresetId = null;
  }

  /** Brings the scene + counts row in sync with the currently-selected preset.
   *  Remounts the scene if the preset changed; otherwise returns the cached
   *  (or freshly captured) frame 0 and pushes it through the existing scene. */
  function syncPreviewToSelectedPreset(): TimelapseFrame | null {
    const presetId = controls.presetSelect.value;
    if (!game || mountedPresetId !== presetId) {
      return mountSceneFor(presetId);
    }
    const initialFrame = getOrCapturePresetInitialFrame(presetId);
    if (initialFrame) scene?.renderFrame(initialFrame);
    return initialFrame;
  }

  function activate() {
    syncPreviewToSelectedPreset();
    resetRunToIdle();
  }

  /** Cancels any in-flight run and forgets its handle. Safe to call when no run is active. */
  function cancelActiveRun() {
    runHandle?.cancel();
    runHandle = null;
  }

  function destroy() {
    cancelActiveRun();
    destroyScene();
  }

  function startRun() {
    cancelActiveRun();
    beginFreshRunState();

    const generation = run.generation;
    showRunningState();

    // Same-preset re-runs reuse the existing scene; `StationDiscPool.draw()`
    // already drops absent stations on the next frame.
    if (run.presetId !== mountedPresetId) {
      mountSceneFor(run.presetId);
    }

    runHandle = startTimelapseRun(
      {
        presetId: run.presetId,
        durationSeconds: run.durationSeconds,
        emigrationIntensity: controls.emigrationSelect.value as TimelapseEmigrationSetting,
      },
      buildRunnerCallbacks(generation),
    );
  }

  /** Resets the in-memory run to a fresh running state and bumps the
   *  generation so stale callbacks from a prior run drop their work. */
  function beginFreshRunState() {
    run.presetId = controls.presetSelect.value;
    run.durationSeconds = Number(controls.durationSelect.value);
    run.frames = [];
    diagnosticsFrames = [];
    run.status = "running";
    run.currentFrameIndex = 0;
    run.generation++;
  }

  /** Runner callbacks for one run; each drops its work once a newer run has
   *  bumped the generation past `generation`. */
  function buildRunnerCallbacks(generation: number): TimelapseRunCallbacks {
    return {
      onFrameCaptured: (frame) =>
        ifCurrentGeneration(generation, run, () => {
          run.frames.push(frame);
          run.currentFrameIndex = run.frames.length - 1;
          refreshControl();
        }),
      onDiagnosticsFrameCaptured: (frame) =>
        ifCurrentGeneration(generation, run, () => {
          diagnosticsFrames.push(frame);
        }),
      onProgress: (progress) =>
        ifCurrentGeneration(generation, run, () => {
          controls.progressFill.style.width = `${Math.round(progress * 100)}%`;
          updateTimeLabel(run.frames[run.frames.length - 1]?.simTimeSeconds ?? 0, run.durationSeconds);
        }),
      onLivePreview: (frame) =>
        ifCurrentGeneration(generation, run, () => {
          scene?.renderFrame(frame);
        }),
      onComplete: () =>
        ifCurrentGeneration(generation, run, () => {
          finishRun();
        }),
    };
  }

  function pauseRun() {
    if (run.status !== "running") return;
    cancelActiveRun();
    finishRun();
  }

  function resetRun() {
    cancelActiveRun();
    resetRunToIdle();
  }

  /** Serializes the captured run's diagnostics frames (inventory + build per
   *  station) as a JSON file the user can download for debugging — distinguishes
   *  "trade trickle still flowing" from "construction deadlock". */
  function downloadDiagnostics() {
    if (diagnosticsFrames.length === 0) return;
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      presetId: run.presetId,
      durationSeconds: run.durationSeconds,
      emigrationIntensity: controls.emigrationSelect.value,
      framesCaptured: diagnosticsFrames.length,
      frames: diagnosticsFrames,
    };
    downloadJsonFile(payload, `timelapse-${run.presetId}-${fileNameTimestamp()}.json`);
  }

  function finishRun() {
    if (run.frames.length === 0) {
      // Pause fired before frame 0 was captured — nothing to step through.
      // Reset to idle so the user can try again.
      resetRunToIdle();
      return;
    }
    run.status = "complete";
    run.currentFrameIndex = run.frames.length - 1;
    showCompleteState();
    renderCurrentFrame();
  }

  function renderCurrentFrame() {
    const frame = run.frames[run.currentFrameIndex];
    if (!frame) return;
    scene?.renderFrame(frame);
    updateTimeLabel(frame.simTimeSeconds, run.durationSeconds);
    refreshControl();
  }

  function refreshControl() {
    if (run.frames.length === 0 || !runHandle) {
      controls.controlMount.hidden = true;
      return;
    }
    controls.controlMount.hidden = false;
    const frame = run.frames[run.currentFrameIndex];
    control.update({
      // The runner subscribes the simulation's station observers at run start
      // and forwards events into this `StationHistory`; the tab just reads it.
      history: runHandle.stationHistory,
      // Anchor the chart's right edge to run-end so bars stay in place as
      // frames stream in instead of sliding left each capture.
      currentTime: run.durationSeconds,
      windowSeconds: run.durationSeconds,
      // Playhead + counts row reflect the currently-viewed frame — tracks the
      // latest captured frame during the run, then the player's scrub position
      // once the run completes.
      playheadTime: frame?.simTimeSeconds ?? 0,
    });
  }

  function updateTimeLabel(simTimeSeconds: number, totalSeconds: number) {
    setTextIfChanged(controls.timeLabel, `${formatElapsed(simTimeSeconds)} / ${formatElapsed(totalSeconds)}`);
    controls.timeLabel.classList.remove("is-blurb");
  }

  function showBlurb() {
    controls.timeLabel.textContent = PRE_RUN_BLURB;
    controls.timeLabel.classList.add("is-blurb");
  }

  function resetRunToIdle() {
    run.status = "idle";
    run.frames = [];
    run.currentFrameIndex = 0;
    showIdleState();
  }

  function showIdleState() {
    controls.runButton.hidden = false;
    controls.pauseButton.hidden = true;
    controls.diagnosticsButton.hidden = true;
    controls.resetButton.hidden = true;
    controls.progressBar.hidden = true;
    // Stay hidden until the player kicks off a run — the chart + counts row
    // + step buttons are meaningless without captured frames behind them.
    controls.controlMount.hidden = true;
    showBlurb();
  }

  function showRunningState() {
    controls.runButton.hidden = true;
    controls.pauseButton.hidden = false;
    controls.diagnosticsButton.hidden = true;
    controls.resetButton.hidden = true;
    controls.progressBar.hidden = false;
    controls.progressFill.style.width = "0%";
    // Replace the blurb with `00m:00s / total` immediately so the user
    // doesn't see the prompt linger after they've already clicked Run.
    updateTimeLabel(0, run.durationSeconds);
  }

  function showCompleteState() {
    controls.runButton.hidden = true;
    controls.pauseButton.hidden = true;
    controls.diagnosticsButton.hidden = false;
    controls.resetButton.hidden = false;
    controls.progressBar.hidden = true;
  }

  function onAnySettingChanged() {
    cancelActiveRun();
    syncPreviewToSelectedPreset();
    resetRunToIdle();
  }

  setupToolbarListeners(controls, {
    startRun,
    pauseRun,
    resetRun,
    downloadDiagnostics,
    onAnySettingChanged,
  });

  showBlurb();

  return { activate, destroy };
}

interface ToolbarHandlers {
  startRun: () => void;
  pauseRun: () => void;
  resetRun: () => void;
  downloadDiagnostics: () => void;
  onAnySettingChanged: () => void;
}

function setupToolbarListeners(controls: TimelapseTabControls, handlers: ToolbarHandlers): void {
  controls.diagnosticsButton.insertAdjacentHTML("afterbegin", Download);
  controls.runButton.addEventListener("click", handlers.startRun);
  controls.pauseButton.addEventListener("click", handlers.pauseRun);
  controls.diagnosticsButton.addEventListener("click", handlers.downloadDiagnostics);
  controls.resetButton.addEventListener("click", handlers.resetRun);
  controls.presetSelect.addEventListener("change", handlers.onAnySettingChanged);
  controls.durationSelect.addEventListener("change", handlers.onAnySettingChanged);
  controls.emigrationSelect.addEventListener("change", handlers.onAnySettingChanged);
}

function readControls(): TimelapseTabControls {
  return {
    presetSelect: document.getElementById("timelapse-preset") as HTMLSelectElement,
    durationSelect: document.getElementById("timelapse-duration") as HTMLSelectElement,
    emigrationSelect: document.getElementById("timelapse-emigration-share") as HTMLSelectElement,
    runButton: document.getElementById("timelapse-run") as HTMLButtonElement,
    pauseButton: document.getElementById("timelapse-pause") as HTMLButtonElement,
    diagnosticsButton: document.getElementById("timelapse-diagnostics") as HTMLButtonElement,
    resetButton: document.getElementById("timelapse-reset") as HTMLButtonElement,
    timeLabel: document.getElementById("timelapse-time") as HTMLElement,
    controlMount: document.getElementById("timelapse-control-mount") as HTMLElement,
    progressBar: document.getElementById("timelapse-progress") as HTMLElement,
    progressFill: document.getElementById("timelapse-progress-fill") as HTMLElement,
    container: document.getElementById("timelapse-container") as HTMLElement,
  };
}

/** Runs `fn` only while `generation` is still the run's current generation;
 *  drops the work if a newer run has bumped `run.generation` past it. */
function ifCurrentGeneration(generation: number, run: TimelapseRun, fn: () => void): void {
  if (generation !== run.generation) return;
  fn();
}

function frameIndexNearestTime(frames: readonly TimelapseFrame[], targetSeconds: number): number {
  if (frames.length === 0) return 0;
  let bestIndex = 0;
  let bestDelta = Math.abs(frames[0].simTimeSeconds - targetSeconds);
  for (let i = 1; i < frames.length; i++) {
    const delta = Math.abs(frames[i].simTimeSeconds - targetSeconds);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}
