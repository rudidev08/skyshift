import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  computeBuckets,
  pickBucketDurationSeconds,
} from "../ui-stations-timelapse-bucketing.ts";
import { createStationHistory, type HistoryStation } from "../sim-station-history.ts";

const HOUR = 3600;
const DAY = 24 * HOUR;

const stationFixture = (overrides: Partial<HistoryStation> = {}): HistoryStation => ({
  id: "hub-1",
  position: { x: 0, y: 0 },
  nationId: "hub",
  typeId: "tech-factory",
  state: "operational",
  ...overrides,
});

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
  history.recordCreated(0, stationFixture({ id: "a", nationId: "hub" }));
  // 9h = inside slice 1 (8h..16h), so bio is absent from slice 0 (ends 8h).
  history.recordCreated(9 * HOUR, stationFixture({ id: "b", nationId: "bio" }));
  const buckets = computeBuckets({
    history,
    windowSeconds: 16 * HOUR,
    currentTime: 16 * HOUR,
    bucketDurationSeconds: 8 * HOUR,
  });
  assertEqual(buckets.length, 2, "bucket count");
  assertEqual(buckets[0].countsByNation.get("hub"), 1, "bucket 0 hub");
  assertTrue(!buckets[0].countsByNation.has("bio"), "bucket 0 no bio");
  assertEqual(buckets[1].countsByNation.get("bio"), 1, "bucket 1 bio");
  assertEqual(buckets[1].total, 2, "bucket 1 total");
});

test("computeBuckets: WAY excluded from totals via history.getCountsAt", () => {
  const history = createStationHistory();
  history.recordCreated(0, stationFixture({ id: "a", nationId: "hub" }));
  history.recordCreated(0, stationFixture({ id: "b", nationId: "way" }));
  const buckets = computeBuckets({
    history,
    windowSeconds: 8 * HOUR,
    currentTime: 8 * HOUR,
    bucketDurationSeconds: 8 * HOUR,
  });
  assertEqual(buckets[0].total, 1, "way not counted in total");
  assertTrue(!buckets[0].countsByNation.has("way"), "way absent from per-nation map");
});

test("computeBuckets: empty history → buckets with zero totals", () => {
  const history = createStationHistory();
  const buckets = computeBuckets({
    history,
    windowSeconds: 24 * HOUR,
    currentTime: 24 * HOUR,
    bucketDurationSeconds: 8 * HOUR,
  });
  assertEqual(buckets.length, 3, "3 buckets");
  for (const bucket of buckets) assertEqual(bucket.total, 0, "total 0");
});
