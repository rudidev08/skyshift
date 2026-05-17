import { test, assertEqual } from "./test-utils.ts";
import { clampPlayheadTime } from "../ui-overview-stations-timelapse.ts";

// playheadTime is constrained to [max(0, now - 20d), now]. The 20-day span is
// the chart window; the 0 floor is sim start (time zero) — there is no station
// history before the game began, so the scrubber must not go there.
const DAY = 24 * 3600;
const TWENTY_DAYS = 20 * DAY;

test("clampPlayheadTime: time before sim start clamps to 0 when now < 20d", () => {
  // Game has run 5 days. Dragging the scrubber fully left proposes a deeply
  // negative time; it must stop at time zero, not at now - 20d (= -15d).
  const now = 5 * DAY;
  assertEqual(clampPlayheadTime(-9_999_999, now), 0, "fully-left drag, 5d in");
});

test("clampPlayheadTime: slightly-negative proposal clamps to 0 when now < 20d", () => {
  const now = 1 * DAY;
  assertEqual(clampPlayheadTime(-50, now), 0, "−50s proposed, 1d in");
});

test("clampPlayheadTime: at exactly 20d in, floor is still 0", () => {
  const now = TWENTY_DAYS;
  // now - 20d = 0, so the floor coincides with time zero.
  assertEqual(clampPlayheadTime(-1, now), 0, "−1s proposed, exactly 20d in");
});

test("clampPlayheadTime: past 20d in, floor is the chart's left edge", () => {
  const now = 25 * DAY;
  const leftEdge = now - TWENTY_DAYS; // 5d — earliest retained history
  assertEqual(clampPlayheadTime(2 * DAY, now), leftEdge, "before window, 25d in");
});

test("clampPlayheadTime: proposal past now clamps to now", () => {
  const now = 5 * DAY;
  assertEqual(clampPlayheadTime(now + 9_999_999, now), now, "future proposed");
});

test("clampPlayheadTime: proposal inside range passes through unchanged", () => {
  const now = 5 * DAY;
  assertEqual(clampPlayheadTime(2 * DAY, now), 2 * DAY, "in-range proposed");
});
