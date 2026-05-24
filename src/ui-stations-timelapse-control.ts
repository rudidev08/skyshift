// Shared DOM component used by the live game's "Stations Timelapse Log" tab
// and the editor's tools/Timelapse. Renders three pieces:
//   - per-nation station-counts row (mirrors tools' existing format)
//   - 6-button step row (-1d -8h -1h / +1h +8h +1d)
//   - stacked bar chart (8h slices for 20-day windows, finer for shorter)
//
// The component does not own scrub state — the caller drives currentTime via
// onStep / onScrubToTime callbacks and re-calls update() with new bindings.
// WAY is excluded from counts + bars (live history's getCountsAt already
// skips it; the tools adapter feeds frames sourced from a sim that does
// emit WAY stations, so BAR_NATIONS leaves it out of the iteration).

import { bioNation, farNation, hubNation, oreNation, skyNation } from "../data/nations";
import type { NationTemplate } from "../data/nation-types";
import { nationColoredCodeSpan } from "./sim-nation-code-format";
import {
  bucketStationCount,
  computeBuckets,
  type ChartBucket,
} from "./ui-stations-timelapse-bucketing";
import { setHtmlIfChanged } from "./ui-dom-cache";
import { clamp01 } from "./util-clamp";
import type { StationHistory } from "./sim-station-history";
import { STEP_LABELS, STEP_ORDER, type TimelapseStep } from "./sim-timelapse-state";

export interface StationsTimelapseControlOptions {
  parent: HTMLElement;
  /** Called when a step button is clicked. Caller maps to its own time / index model. */
  onStep: (step: TimelapseStep) => void;
  /** Called when the user taps or drags inside the bar chart. `endTime` is the
   *  end-of-slice for the bar under the pointer. */
  onScrubToTime: (endTime: number) => void;
}

export interface StationsTimelapseControlBindings {
  history: StationHistory;
  /** Sim-time at the right edge of the chart. Buckets cover
   *  `[currentTime - windowSeconds, currentTime]`. Set this to a fixed value
   *  in tools/Timelapse (the run's duration) so bars don't shift as the run
   *  progresses; set it to "now" in the live game (chart slides forward as
   *  sim time advances). */
  currentTime: number;
  /** Total span shown by the chart. */
  windowSeconds: number;
  /** Sim-time the playhead points at + the per-nation counts row reflects.
   *  Must lie within the chart's `[currentTime - windowSeconds, currentTime]`
   *  range. Defaults to `currentTime` (playhead at the right edge, no scrub). */
  playheadTime?: number;
}

export interface StationsTimelapseControl {
  update(bindings: StationsTimelapseControlBindings): void;
  destroy(): void;
}

// Stacked bar colors flow warm → cool bottom-to-top (ORE 33° → HUB 205° HSL);
// the counts row left-to-right tracks the same sequence. WAY is absent because
// the gen-ship faction doesn't found stations the same way. Adding a new nation
// to the chart means adding a row here; the seg class is collocated so it can't
// be forgotten.
const BAR_NATIONS: ReadonlyArray<{ nation: NationTemplate; segmentClass: string }> = [
  { nation: oreNation, segmentClass: "stations-timelapse-bar__seg--ore" },
  { nation: farNation, segmentClass: "stations-timelapse-bar__seg--far" },
  { nation: bioNation, segmentClass: "stations-timelapse-bar__seg--bio" },
  { nation: skyNation, segmentClass: "stations-timelapse-bar__seg--sky" },
  { nation: hubNation, segmentClass: "stations-timelapse-bar__seg--hub" },
];

export function createStationsTimelapseControl(
  options: StationsTimelapseControlOptions,
): StationsTimelapseControl {
  const { parent, onStep, onScrubToTime } = options;

  const root = document.createElement("div");
  root.className = "stations-timelapse-root";

  const countsElement = document.createElement("div");
  countsElement.className = "stations-timelapse-counts";

  const stepRow = document.createElement("div");
  stepRow.className = "stations-timelapse-controls hud-segment hud-segment--row";
  for (const step of STEP_ORDER) {
    stepRow.appendChild(createStepButton(step, onStep));
  }

  const barsElement = document.createElement("div");
  barsElement.className = "stations-timelapse-bars";

  const axisElement = document.createElement("div");
  axisElement.className = "stations-timelapse-axis";

  root.append(countsElement, stepRow, barsElement, axisElement);
  parent.appendChild(root);

  let latestBuckets: ChartBucket[] = [];
  attachScrubPointerHandlers(barsElement, () => latestBuckets, onScrubToTime);

  function update(bindings: StationsTimelapseControlBindings): void {
    const playheadTime = bindings.playheadTime ?? bindings.currentTime;
    const { buckets, bucketDurationSeconds } = computeBuckets({
      history: bindings.history,
      windowSeconds: bindings.windowSeconds,
      currentTime: bindings.currentTime,
    });
    latestBuckets = buckets;
    renderCounts(bindings.history, playheadTime);
    renderBars(latestBuckets, playheadTime, bucketDurationSeconds);
    renderAxis(bindings);
    if (latestBuckets.length > 0) {
      const fraction = computePlayheadFraction(latestBuckets, playheadTime, bucketDurationSeconds);
      barsElement.style.setProperty("--playhead", `${fraction * 100}%`);
    }
  }

  function renderCounts(history: StationHistory, playheadTime: number): void {
    const counts = history.getCountsAt(playheadTime);
    const nationSegments: string[] = [];
    for (const { nation } of BAR_NATIONS) {
      const count = counts.get(nation.id) ?? 0;
      if (count === 0) continue;
      nationSegments.push(
        `<span class="stations-timelapse-counts-nation">${nationColoredCodeSpan(nation)} ${count}</span>`,
      );
    }
    const separator = ` <span class="stations-timelapse-counts-sep">•</span> `;
    setHtmlIfChanged(countsElement, nationSegments.join(separator));
  }

  function renderBars(buckets: ChartBucket[], playheadTime: number, bucketDurationSeconds: number): void {
    let bucketsWithData = 0;
    for (const bucket of buckets) {
      if (bucketStationCount(bucket) > 0) bucketsWithData++;
    }
    if (bucketsWithData < 2) {
      renderEmptyChartPlaceholder(barsElement, bucketDurationSeconds);
      return;
    }
    barsElement.classList.remove("is-empty");
    const maxBucketStationCount = Math.max(1, ...buckets.map((bucket) => bucketStationCount(bucket)));
    const barsHtml: string[] = [];
    for (const bucket of buckets) {
      barsHtml.push(buildBarHtml(bucket, playheadTime));
    }
    barsElement.style.setProperty("--bars-max", String(maxBucketStationCount));
    setHtmlIfChanged(barsElement, barsHtml.join("") + `<span class="stations-timelapse-playhead"></span>`);
  }

  function renderAxis(bindings: StationsTimelapseControlBindings): void {
    const { startLabel, midLabel } = buildAxisLabels(bindings.windowSeconds);
    const endLabel = "now";
    setHtmlIfChanged(
      axisElement,
      `<span>${startLabel}</span>${midLabel ? `<span>${midLabel}</span>` : ""}<span>${endLabel}</span>`,
    );
  }

  function destroy(): void {
    parent.removeChild(root);
  }

  return { update, destroy };
}

/** Left + optional mid tick labels for the chart axis. Mid label only appears
 *  for windows of 4+ days so short windows don't get a cramped middle tick. */
function buildAxisLabels(windowSeconds: number): { startLabel: string; midLabel: string } {
  const totalDays = Math.round(windowSeconds / (24 * 3600));
  const startLabel = totalDays >= 1 ? `−${totalDays}d` : `−${Math.round(windowSeconds / 3600)}h`;
  const midLabel = totalDays >= 4 ? `−${Math.round(totalDays / 2)}d` : "";
  return { startLabel, midLabel };
}

function computePlayheadFraction(
  buckets: ChartBucket[],
  playheadTime: number,
  bucketDurationSeconds: number,
): number {
  const startTime = buckets[0].endTime - bucketDurationSeconds;
  const endTime = buckets[buckets.length - 1].endTime;
  const span = endTime - startTime;
  const playheadFraction = span === 0 ? 1 : (playheadTime - startTime) / span;
  return clamp01(playheadFraction);
}

function createStepButton(step: TimelapseStep, onStep: (step: TimelapseStep) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud-btn";
  button.textContent = STEP_LABELS[step];
  button.dataset.step = step;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onStep(step);
  });
  return button;
}

/**
 * One filled bar conveys nothing — the chart needs at least two slices with
 * data. Until then, show a placeholder telling the player when the chart will
 * start filling in.
 */
function renderEmptyChartPlaceholder(barsElement: HTMLElement, bucketDurationSeconds: number): void {
  const waitHours = Math.max(1, Math.round((2 * bucketDurationSeconds) / 3600));
  barsElement.classList.add("is-empty");
  setHtmlIfChanged(
    barsElement,
    `<div class="stations-timelapse-empty">Station counts over time will show here after ${waitHours}h passed.</div>`,
  );
}

function buildBarHtml(bucket: ChartBucket, playheadTime: number): string {
  const isFuture = bucket.endTime > playheadTime;
  const segmentHtml: string[] = [];
  for (const { nation, segmentClass } of BAR_NATIONS) {
    const count = bucket.countsByNation.get(nation.id) ?? 0;
    if (count === 0) continue;
    segmentHtml.push(`<i class="${segmentClass}" style="--c:${count}"></i>`);
  }
  return `<div class="stations-timelapse-bar${isFuture ? " is-future" : ""}" style="--t:${bucketStationCount(bucket)}">${segmentHtml.join("")}</div>`;
}

function attachScrubPointerHandlers(
  bars: HTMLElement,
  getBuckets: () => ChartBucket[],
  onScrubToTime: (endTime: number) => void,
): void {
  function findBucketUnderPointer(clientX: number): ChartBucket | null {
    const rect = bars.getBoundingClientRect();
    const fraction = (clientX - rect.left) / rect.width;
    const buckets = getBuckets();
    if (buckets.length === 0) return null;
    const clampedFraction = clamp01(fraction);
    const index = Math.min(buckets.length - 1, Math.floor(clampedFraction * buckets.length));
    return buckets[index];
  }
  bars.addEventListener("pointerdown", (event) => {
    bars.setPointerCapture(event.pointerId);
    const bucket = findBucketUnderPointer(event.clientX);
    if (bucket) onScrubToTime(bucket.endTime);
  });
  bars.addEventListener("pointermove", (event) => {
    if (!bars.hasPointerCapture(event.pointerId)) return;
    const bucket = findBucketUnderPointer(event.clientX);
    if (bucket) onScrubToTime(bucket.endTime);
  });
  bars.addEventListener("pointerup", (event) => {
    bars.releasePointerCapture(event.pointerId);
  });
}
