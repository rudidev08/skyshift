import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  bucketStationCount,
  computeBuckets,
  pickBucketDurationSeconds,
} from "../ui-stations-timelapse-bucketing.ts";
import { createStationHistory } from "../sim-station-history.ts";
import { makeTimelapseStation } from "./factories.ts";

const HOUR = 3600;
const DAY = 24 * HOUR;

test("pickBucketDurationSeconds: 1h bars for windows up to 6h", () => {
  assertEqual(pickBucketDurationSeconds(6 * HOUR), HOUR, "exact 6h");
  assertEqual(pickBucketDurationSeconds(3 * HOUR), HOUR, "3h");
});

test("pickBucketDurationSeconds: 4h bars for windows up to 7d", () => {
  assertEqual(pickBucketDurationSeconds(24 * HOUR), 4 * HOUR, "1d");
  assertEqual(pickBucketDurationSeconds(7 * DAY), 4 * HOUR, "7d");
});

test("pickBucketDurationSeconds: 8h bars for windows over 7d", () => {
  assertEqual(pickBucketDurationSeconds(20 * DAY), 8 * HOUR, "20d");
  assertEqual(pickBucketDurationSeconds(8 * DAY), 8 * HOUR, "8d");
});

test("computeBuckets: one bucket per slice with end-of-slice counts", () => {
  const history = createStationHistory();
  history.recordCreated(0, makeTimelapseStation({ id: "a", nationId: "hub" }));
  // 9h = inside slice 1 (8h..16h), so bio is absent from slice 0 (ends 8h).
  history.recordCreated(9 * HOUR, makeTimelapseStation({ id: "b", nationId: "bio" }));
  // 8d window derives 8h slices; currentTime = windowSeconds makes startTime 0,
  // so slice 0 ends at 8h and slice 1 ends at 16h.
  const { buckets } = computeBuckets({
    history,
    windowSeconds: 8 * DAY,
    currentTime: 8 * DAY,
  });
  assertEqual(buckets[0].countsByNation.get("hub"), 1, "bucket 0 hub");
  assertTrue(!buckets[0].countsByNation.has("bio"), "bucket 0 no bio");
  assertEqual(buckets[1].countsByNation.get("bio"), 1, "bucket 1 bio");
  assertEqual(bucketStationCount(buckets[1]), 2, "bucket 1 total");
});

test("computeBuckets: event recorded at bucket endTime is included in that bucket", () => {
  // Pin the inclusive `event.timeSeconds <= endTime` boundary inside getCountsAt
  // (the loop's `event.timeSeconds > timeSeconds` break). A `> → >=` mutation would push
  // boundary creations into the next slice, off-by-one'ing the rewind chart.
  const history = createStationHistory();
  history.recordCreated(8 * HOUR, makeTimelapseStation({ id: "boundary", nationId: "hub" }));
  // 8d window derives 8h slices, startTime 0 → first slice ends at exactly 8h.
  const { buckets } = computeBuckets({
    history,
    windowSeconds: 8 * DAY,
    currentTime: 8 * DAY,
  });
  // The boundary event sits at the first slice's endpoint (8h).
  assertEqual(buckets[0].countsByNation.get("hub"), 1, "endTime-creation included in bucket 0");
});

test("computeBuckets: WAY excluded from totals via history.getCountsAt", () => {
  const history = createStationHistory();
  history.recordCreated(0, makeTimelapseStation({ id: "a", nationId: "hub" }));
  history.recordCreated(0, makeTimelapseStation({ id: "b", nationId: "way" }));
  const { buckets } = computeBuckets({
    history,
    windowSeconds: 8 * DAY,
    currentTime: 8 * DAY,
  });
  assertEqual(bucketStationCount(buckets[0]), 1, "way not counted in total");
  assertTrue(!buckets[0].countsByNation.has("way"), "way absent from per-nation map");
});

test("computeBuckets: window shorter than bucket duration still yields one bucket", () => {
  // Pin the Math.max(1, ...) floor. A 0.5h window derives a 1h slice, so
  // Math.floor(0.5h / 1h) gives 0; the clamp keeps the chart showing at least
  // one bar so an early-game preview isn't an empty array.
  const history = createStationHistory();
  history.recordCreated(0, makeTimelapseStation({ id: "a", nationId: "hub" }));
  const { buckets } = computeBuckets({
    history,
    windowSeconds: HOUR / 2,
    currentTime: HOUR / 2,
  });
  assertEqual(buckets.length, 1, "single bucket when window < bucketDuration");
  assertEqual(buckets[0].countsByNation.get("hub"), 1, "single bucket reflects history");
});

test("computeBuckets: removed station drops only itself from later slices", () => {
  // Pin live.delete(stationId) inside computeLiveStationsAt. A clear()-instead-of-delete
  // mutation drops every live station at removal time — bucket 1's hub count
  // would collapse to 0 instead of falling by one.
  const history = createStationHistory();
  history.recordCreated(0, makeTimelapseStation({ id: "hub-1", nationId: "hub" }));
  history.recordCreated(0, makeTimelapseStation({ id: "hub-2", nationId: "hub" }));
  history.recordRemoved(9 * HOUR, "hub-1");
  // 8d window derives 8h slices, startTime 0 → slice 0 ends 8h, slice 1 ends 16h.
  const { buckets } = computeBuckets({
    history,
    windowSeconds: 8 * DAY,
    currentTime: 8 * DAY,
  });
  assertEqual(buckets[0].countsByNation.get("hub"), 2, "both alive in slice 0");
  assertEqual(buckets[1].countsByNation.get("hub"), 1, "only hub-2 survives in slice 1");
});

test("computeBuckets: empty history → buckets with zero totals", () => {
  const history = createStationHistory();
  // 24h window derives 4h slices → 6 buckets.
  const { buckets } = computeBuckets({
    history,
    windowSeconds: 24 * HOUR,
    currentTime: 24 * HOUR,
  });
  assertEqual(buckets.length, 6, "6 buckets");
  for (const bucket of buckets) assertEqual(bucketStationCount(bucket), 0, "total 0");
});
