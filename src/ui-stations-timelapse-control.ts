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
  computeBuckets,
  pickBucketDurationSeconds,
  type ChartBucket,
} from "./ui-stations-timelapse-bucketing";
import { setHtmlIfChanged } from "./ui-dom-cache";
import type { StationHistory } from "./sim-station-history";
import type { TimelapseStep } from "./sim-timelapse-state";

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

const STEP_ORDER: TimelapseStep[] = ["-1d", "-8h", "-1h", "+1h", "+8h", "+1d"];
const STEP_LABELS: Record<TimelapseStep, string> = {
  "-1d": "−1d",
  "-8h": "−8h",
  "-1h": "−1h",
  "+1h": "+1h",
  "+8h": "+8h",
  "+1d": "+1d",
};

// HSL-hue iteration order (ORE 33° → FAR 49° → BIO 122° → SKY 181° → HUB 205°)
// so stacked bar colors flow warm → cool bottom-to-top, and the counts row
// left-to-right tracks the same sequence. Seg class is collocated with each
// nation so a new entry can't be added without its CSS class. WAY is absent
// because the gen-ship faction doesn't found stations the same way; adding a
// new nation that should appear on the chart means adding a row here.
const BAR_NATIONS: ReadonlyArray<{ nation: NationTemplate; segClass: string }> = [
  { nation: oreNation, segClass: "stations-timelapse-bar__seg--ore" },
  { nation: farNation, segClass: "stations-timelapse-bar__seg--far" },
  { nation: bioNation, segClass: "stations-timelapse-bar__seg--bio" },
  { nation: skyNation, segClass: "stations-timelapse-bar__seg--sky" },
  { nation: hubNation, segClass: "stations-timelapse-bar__seg--hub" },
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
    const bucketDurationSeconds = pickBucketDurationSeconds(bindings.windowSeconds);
    latestBuckets = computeBuckets({
      history: bindings.history,
      windowSeconds: bindings.windowSeconds,
      currentTime: bindings.currentTime,
      bucketDurationSeconds,
    });
    renderCounts(bindings.history, playheadTime);
    renderBars(latestBuckets, playheadTime, bucketDurationSeconds);
    renderAxis(bindings);
    renderPlayhead(latestBuckets, playheadTime, bucketDurationSeconds);
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
      if (bucket.total > 0) bucketsWithData++;
    }
    if (bucketsWithData < 2) {
      renderEmptyChartPlaceholder(barsElement, bucketDurationSeconds);
      return;
    }
    barsElement.classList.remove("is-empty");
    const maxBucketTotal = Math.max(1, ...buckets.map((bucket) => bucket.total));
    const html: string[] = [];
    for (const bucket of buckets) {
      html.push(buildBarHtml(bucket, playheadTime));
    }
    barsElement.style.setProperty("--bars-max", String(maxBucketTotal));
    setHtmlIfChanged(barsElement, html.join("") + `<span class="stations-timelapse-playhead"></span>`);
  }

  function renderAxis(bindings: StationsTimelapseControlBindings): void {
    const totalDays = Math.round(bindings.windowSeconds / (24 * 3600));
    const startLabel = totalDays >= 1 ? `−${totalDays}d` : `−${Math.round(bindings.windowSeconds / 3600)}h`;
    const midLabel = totalDays >= 4 ? `−${Math.round(totalDays / 2)}d` : "";
    const endLabel = "now";
    setHtmlIfChanged(
      axisElement,
      `<span>${startLabel}</span>${midLabel ? `<span>${midLabel}</span>` : ""}<span>${endLabel}</span>`,
    );
  }

  function renderPlayhead(buckets: ChartBucket[], playheadTime: number, bucketDurationSeconds: number): void {
    const playheadElement = barsElement.querySelector<HTMLElement>(".stations-timelapse-playhead");
    if (!playheadElement || buckets.length === 0) return;
    playheadElement.style.left = `${computePlayheadFraction(buckets, playheadTime, bucketDurationSeconds) * 100}%`;
  }

  function destroy(): void {
    parent.removeChild(root);
  }

  return { update, destroy };
}

function computePlayheadFraction(
  buckets: ChartBucket[],
  playheadTime: number,
  bucketDurationSeconds: number,
): number {
  const startTime = buckets[0].endTime - bucketDurationSeconds;
  const endTime = buckets[buckets.length - 1].endTime;
  const span = endTime - startTime;
  const positionFraction = span === 0 ? 1 : (playheadTime - startTime) / span;
  return Math.max(0, Math.min(1, positionFraction));
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
 * A single filled bar is just a number — the chart is meaningless until at
 * least two slices carry data. Until then, show a placeholder telling the
 * player when the chart will start filling in.
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
  const segHtml: string[] = [];
  for (const { nation, segClass } of BAR_NATIONS) {
    const count = bucket.countsByNation.get(nation.id) ?? 0;
    if (count === 0) continue;
    segHtml.push(`<i class="${segClass}" style="--c:${count}"></i>`);
  }
  return `<div class="stations-timelapse-bar${isFuture ? " is-future" : ""}" style="--t:${bucket.total}">${segHtml.join("")}</div>`;
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
    const clamped = Math.max(0, Math.min(1, fraction));
    const index = Math.min(buckets.length - 1, Math.floor(clamped * buckets.length));
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
