// Tab content for the Overview's Log tab. Owns the upper-right time header
// and drives the StationRewindOverlay (showing past station states on the map
// while the player has scrubbed to a past moment). The chart itself lives in
// StationsTimelapseControl; this module connects scrub state to the map
// overlay.

import { formatElapsed } from "./render-elapsed-time-label";
import { createStationsTimelapseControl } from "./ui-stations-timelapse-control";
import { setTextIfChanged } from "./ui-dom-cache";
import { createWareSidebar } from "./ui-overview-sidebar-shell";
import type { StationHistory } from "./sim-station-history";
import type { StationRewindOverlay } from "./phaser/station-rewind-overlay";
import { STEP_SECONDS } from "./sim-timelapse-state";

const TWENTY_DAYS_IN_SECONDS = 20 * 24 * 60 * 60;

export interface StationsTimelapseLogPane {
  update(): void;
  destroy(): void;
}

export interface StationsTimelapseLogPaneOptions {
  root: HTMLElement;
  stationHistory: StationHistory;
  getSimTimeSeconds: () => number;
  rewindOverlay: StationRewindOverlay;
}

export function createStationsTimelapseLogPane(
  options: StationsTimelapseLogPaneOptions,
): StationsTimelapseLogPane {
  const { root, stationHistory, getSimTimeSeconds, rewindOverlay } = options;

  const { paneElement, timeElement, destroyPane } = createTimelapseLogPaneShell(root);

  // Anchor the playhead at "now" at creation so the scrubber opens at the live edge.
  let playheadTime = getSimTimeSeconds();

  const control = createStationsTimelapseControl({
    parent: paneElement,
    onStep(step) {
      const proposed = playheadTime + STEP_SECONDS[step];
      playheadTime = clampPlayheadTime(proposed, getSimTimeSeconds());
      refreshAfterPlayheadMove();
    },
    onScrubToTime(endTime) {
      playheadTime = clampPlayheadTime(endTime, getSimTimeSeconds());
      refreshAfterPlayheadMove();
    },
  });

  function refreshAfterPlayheadMove(): void {
    const now = getSimTimeSeconds();
    if (playheadTime >= now) {
      rewindOverlay.hide();
    } else {
      rewindOverlay.show(stationHistory.getStateAt(playheadTime));
    }
    repaintPane();
  }

  function repaintPane(): void {
    setTextIfChanged(timeElement, formatElapsed(playheadTime));
    control.update({
      history: stationHistory,
      // Right edge is always current sim-time so the chart scrolls forward
      // as the game runs; the window shows the last 20 days.
      currentTime: getSimTimeSeconds(),
      windowSeconds: TWENTY_DAYS_IN_SECONDS,
      // Where the player is currently looking — moves the playhead + drives
      // the per-nation counts row + dims bars after this point.
      playheadTime,
    });
  }

  repaintPane();

  function update(): void {
    clampPlayheadToNow();
    repaintPane();
  }

  function clampPlayheadToNow(): void {
    const now = getSimTimeSeconds();
    if (playheadTime >= now) playheadTime = now;
  }

  function destroy(): void {
    rewindOverlay.hide();
    control.destroy();
    destroyPane();
  }

  return { update, destroy };
}

function createTimelapseLogPaneShell(root: HTMLElement): {
  paneElement: HTMLDivElement;
  timeElement: HTMLSpanElement;
  destroyPane: () => void;
} {
  // The shared ware-sidebar chrome (glass background, dashed border,
  // morse-stripe top accent) makes the Log tab match the Trading and
  // Emigration tabs instead of floating bare on the canvas.
  const shell = createWareSidebar(root, "Log");
  const paneElement = shell.sidebar;
  paneElement.classList.add("stations-timelapse-frame");

  const head = document.createElement("div");
  head.className = "stations-timelapse-frame-head";
  const title = document.createElement("span");
  title.textContent = "Stations Timelapse Log";
  const timeElement = document.createElement("span");
  timeElement.className = "stations-timelapse-frame-time";
  head.append(title, timeElement);

  paneElement.appendChild(head);

  return { paneElement, timeElement, destroyPane: shell.destroy };
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
