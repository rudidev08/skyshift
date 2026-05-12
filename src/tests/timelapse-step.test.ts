import { test, assertEqual } from "./test-utils.ts";
import { stepFrameIndex } from "../sim-timelapse-state.ts";

// Frame cadence = 1 sim-hour, so:
//   ±1h shifts by 1
//   ±8h shifts by 8
//   ±1d shifts by 24
// stepFrameIndex clamps to [0, framesLength - 1].

test("stepFrameIndex: +1h shifts by 1", () => {
  assertEqual(stepFrameIndex(2, 10, "+1h"), 3, "+1h from 2");
});

test("stepFrameIndex: -1h shifts by 1", () => {
  assertEqual(stepFrameIndex(2, 10, "-1h"), 1, "-1h from 2");
});

test("stepFrameIndex: +8h shifts by 8", () => {
  assertEqual(stepFrameIndex(2, 30, "+8h"), 10, "+8h from 2");
});

test("stepFrameIndex: -8h shifts by 8", () => {
  assertEqual(stepFrameIndex(20, 30, "-8h"), 12, "-8h from 20");
});

test("stepFrameIndex: -1h from 0 clamps to 0", () => {
  assertEqual(stepFrameIndex(0, 10, "-1h"), 0, "-1h from 0");
});

test("stepFrameIndex: -8h from 2 clamps to 0", () => {
  // 2 - 8 = -6; clamps to 0.
  assertEqual(stepFrameIndex(2, 10, "-8h"), 0, "-8h from 2");
});

test("stepFrameIndex: +1h from last clamps to last", () => {
  assertEqual(stepFrameIndex(9, 10, "+1h"), 9, "+1h from 9");
});

test("stepFrameIndex: +8h from near-last clamps to last", () => {
  // 5 + 8 = 13; clamps to 9 (last index for length 10).
  assertEqual(stepFrameIndex(5, 10, "+8h"), 9, "+8h from 5");
});

test("stepFrameIndex: +1d shifts by 24", () => {
  assertEqual(stepFrameIndex(2, 50, "+1d"), 26, "+1d from 2");
});

test("stepFrameIndex: -1d shifts by 24", () => {
  assertEqual(stepFrameIndex(40, 50, "-1d"), 16, "-1d from 40");
});

test("stepFrameIndex: +1d from 30 in length-50 clamps to 49", () => {
  // 30 + 24 = 54; clamps to 49 (last index for length 50).
  assertEqual(stepFrameIndex(30, 50, "+1d"), 49, "+1d from 30");
});

test("stepFrameIndex: -1d from 10 clamps to 0", () => {
  // 10 - 24 = -14; clamps to 0.
  assertEqual(stepFrameIndex(10, 50, "-1d"), 0, "-1d from 10");
});

test("stepFrameIndex: framesLength=1 always returns 0", () => {
  assertEqual(stepFrameIndex(0, 1, "+1h"), 0, "+1h on length-1");
  assertEqual(stepFrameIndex(0, 1, "-8h"), 0, "-8h on length-1");
  assertEqual(stepFrameIndex(0, 1, "+1d"), 0, "+1d on length-1");
});
