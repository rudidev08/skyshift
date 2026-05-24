// Aggregates StationHistory state into N buckets for the chart. Pure data; no
// DOM. Bucket size scales with the visible window so the chart fits roughly
// 60 bars at 20 days, fewer for shorter runs.

import type { StationHistory } from "./sim-station-history";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export interface ChartBucket {
  /** Sim-time at the end of this bucket's slice (not the start or midpoint). */
  endTime: number;
  countsByNation: Map<string, number>;
}

/** Total stations across non-WAY nations (`getCountsAt` already excludes WAY). */
export function bucketStationCount(bucket: ChartBucket): number {
  let total = 0;
  for (const value of bucket.countsByNation.values()) total += value;
  return total;
}

export interface ComputeBucketsOptions {
  history: StationHistory;
  windowSeconds: number;
  /** Sim-time of the right edge of the chart (typically the current sim-time). */
  currentTime: number;
}

export interface ChartBucketsResult {
  buckets: ChartBucket[];
  bucketDurationSeconds: number;
}

export function pickBucketDurationSeconds(windowSeconds: number): number {
  if (windowSeconds <= 6 * HOUR) return HOUR;
  if (windowSeconds <= 7 * DAY) return 4 * HOUR;
  return 8 * HOUR;
}

export function computeBuckets(options: ComputeBucketsOptions): ChartBucketsResult {
  const { history, windowSeconds, currentTime } = options;
  const bucketDurationSeconds = pickBucketDurationSeconds(windowSeconds);
  const startTime = currentTime - windowSeconds;
  const bucketCount = Math.max(1, Math.floor(windowSeconds / bucketDurationSeconds));
  const buckets: ChartBucket[] = [];
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
    const endTime = startTime + (bucketIndex + 1) * bucketDurationSeconds;
    buckets.push({ endTime, countsByNation: history.getCountsAt(endTime) });
  }
  return { buckets, bucketDurationSeconds };
}
