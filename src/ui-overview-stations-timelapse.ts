// Game-side tab content for the Overview's Log tab. Wraps the shared
// StationsTimelapseControl with the upper-right time header and drives
// the StationRewindOverlay (showing past stations on the map while the
// player has scrubbed to a past moment).

import { formatElapsed } from "./render-elapsed-time-label";
import { createStationsTimelapseControl } from "./ui-stations-timelapse-control";
import { setTextIfChanged } from "./ui-dom-cache";
import { morseBarGradient } from "./render-morse-bar";
import type { StationHistory } from "./sim-station-history";
import type { StationRewindOverlay } from "./phaser/station-rewind-overlay";
import type { TimelapseStep } from "./sim-timelapse-state";

const TWENTY_DAYS_IN_SECONDS = 20 * 24 * 60 * 60;
const STEP_SECONDS: Record<TimelapseStep, number> = {
  "-1d": -24 * 3600,
  "-8h": -8 * 3600,
  "-1h": -1 * 3600,
  "+1h": 1 * 3600,
  "+8h": 8 * 3600,
  "+1d": 24 * 3600,
};

export interface StationsTimelapseLogPane {
  update(): void;
  destroy(): void;
}

export interface StationsTimelapseLogPaneOptions {
  root: HTMLElement;
  stationHistory: StationHistory;
  getSimTime: () => number;
  rewindOverlay: StationRewindOverlay;
}

export function createStationsTimelapseLogPane(
  options: StationsTimelapseLogPaneOptions,
): StationsTimelapseLogPane {
  const { root, stationHistory, getSimTime, rewindOverlay } = options;

  const { frameElement, timeElement } = createPaneFrame(root);

  // Anchor the playhead at "now" at creation; per-tick tracking happens in
  // snapPlayheadToNowIfPast below.
  let playheadTime = getSimTime();

  const control = createStationsTimelapseControl({
    parent: frameElement,
    onStep(step) {
      const proposed = playheadTime + STEP_SECONDS[step];
      playheadTime = clampPlayheadTime(proposed, getSimTime());
      refreshAfterPlayheadMove();
    },
    onScrubToTime(endTime) {
      playheadTime = clampPlayheadTime(endTime, getSimTime());
      refreshAfterPlayheadMove();
    },
  });

  function refreshAfterPlayheadMove(): void {
    const now = getSimTime();
    if (playheadTime >= now) {
      rewindOverlay.hide();
    } else {
      const frame = stationHistory.getStateAt(playheadTime);
      rewindOverlay.show(frame);
    }
    repaintPane();
  }

  function repaintPane(): void {
    setTextIfChanged(timeElement, formatElapsed(playheadTime));
    control.update({
      history: stationHistory,
      // Chart slides forward with sim-time; right edge is always "now", and
      // the window stretches back TWENTY_DAYS_IN_SECONDS.
      currentTime: getSimTime(),
      windowSeconds: TWENTY_DAYS_IN_SECONDS,
      // Where the player is currently looking — moves the playhead + drives
      // the per-nation counts row + dims bars after this point.
      playheadTime,
    });
  }

  repaintPane();

  function update(): void {
    snapPlayheadToNowIfPast();
    repaintPane();
  }

  function snapPlayheadToNowIfPast(): void {
    const now = getSimTime();
    if (playheadTime >= now) playheadTime = now;
  }

  function destroy(): void {
    rewindOverlay.hide();
    control.destroy();
    root.innerHTML = "";
  }

  return { update, destroy };
}

function createPaneFrame(root: HTMLElement): {
  frameElement: HTMLDivElement;
  timeElement: HTMLSpanElement;
} {
  root.innerHTML = "";
  // ware-sidebar gives the same panel chrome (glass background, dashed border,
  // morse-stripe top accent) the Trading and Emigration tabs use, so the Log
  // tab visually matches its siblings instead of floating bare on the canvas.
  const frameElement = document.createElement("div");
  frameElement.className = "stations-timelapse-frame ware-sidebar";
  frameElement.style.setProperty(
    "--morse-bar",
    morseBarGradient("Log", { letterCount: 3, color: "var(--paper-mute)" }),
  );

  const head = document.createElement("div");
  head.className = "stations-timelapse-frame-head";
  const title = document.createElement("span");
  title.textContent = "Stations Timelapse Log";
  const timeElement = document.createElement("span");
  timeElement.className = "stations-timelapse-frame-time";
  head.append(title, timeElement);

  frameElement.appendChild(head);
  root.appendChild(frameElement);

  return { frameElement, timeElement };
}

/** Constrain a proposed playhead time to where the player can actually scrub:
 *  no later than `now`, and no earlier than the chart's left edge — but never
 *  before sim start (time zero), since no history exists before the game began. */
export function clampPlayheadTime(proposedTime: number, now: number): number {
  const earliest = Math.max(0, now - TWENTY_DAYS_IN_SECONDS);
  if (proposedTime < earliest) return earliest;
  if (proposedTime > now) return now;
  return proposedTime;
}
