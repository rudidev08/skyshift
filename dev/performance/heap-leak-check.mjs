#!/usr/bin/env node
/* global document */ // referenced inside page.evaluate() callbacks (browser context).
// Heap-leak / GC-pressure sanity check for the running game.
//
// Spawns a headless Chrome via Puppeteer, navigates to a game URL, captures
// V8 heap snapshots at intervals, and reports heap-size deltas. Snapshots are
// saved as .heapsnapshot files — load them in Chrome DevTools → Memory tab →
// "Load" button for class-by-class diffing.
//
// Prerequisites: dev server must already be running (`npm run dev`).
//
// Usage:
//   node dev/performance/heap-leak-check.mjs [--url <URL>] [--duration <SECONDS>]
//                                            [--snapshots <COUNT>] [--accelerate <SPEED>]
//                                            [--out <DIR>] [--headed]
//
// Defaults:
//   --url         http://localhost:5173/start/settled
//   --duration    300 (5 minutes)
//   --snapshots   3
//   --accelerate  60 (clicks the dev-mode 60× speed button after page load; 0 to disable)
//   --out         dev/performance/snapshots.local
//   --headed      run with a visible browser window (default: headless)
//
// Examples:
//   # Quick 1-min check
//   node dev/performance/heap-leak-check.mjs --duration 60
//
//   # Long memory-leak hunt: 30 minutes, snapshot every 5
//   node dev/performance/heap-leak-check.mjs --duration 1800 --snapshots 7
//
//   # Frame-jank check: normal speed (sim time = wall time), watch one short window
//   node dev/performance/heap-leak-check.mjs --duration 120 --snapshots 2 --accelerate 0

import puppeteer from "puppeteer";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173/start/settled" },
    duration: { type: "string", default: "300" },
    snapshots: { type: "string", default: "3" },
    accelerate: { type: "string", default: "60" },
    out: { type: "string", default: "dev/performance/snapshots.local" },
    headed: { type: "boolean", default: false },
  },
});

const durationSeconds = Number(args.duration);
const snapshotCount = Math.max(2, Number(args.snapshots));
const accelerateSpeed = Number(args.accelerate);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
  throw new Error(`--duration must be a positive number, got "${args.duration}"`);
if (!Number.isFinite(snapshotCount)) throw new Error(`--snapshots must be a number, got "${args.snapshots}"`);
if (!Number.isFinite(accelerateSpeed) || accelerateSpeed < 0)
  throw new Error(`--accelerate must be a non-negative number, got "${args.accelerate}"`);
const intervalSeconds = durationSeconds / (snapshotCount - 1);
const runId = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const outDir = join(args.out, runId);

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

console.log(
  `[heap-check] url=${args.url} duration=${durationSeconds}s snapshots=${snapshotCount} accelerate=${accelerateSpeed}x out=${outDir}`,
);

const browser = await puppeteer.launch({
  headless: !args.headed,
  // Precise heap reporting + larger heap so we can watch growth without OOM.
  args: ["--enable-precise-memory-info", "--js-flags=--max-old-space-size=2048"],
});

const measurements = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const client = await page.createCDPSession();
  await client.send("HeapProfiler.enable");

  console.log(`[heap-check] navigating...`);
  await page.goto(args.url, { waitUntil: "networkidle2", timeout: 60_000 });

  // Phaser scene + Vite HMR can keep firing settle events for a beat after networkidle2.
  // Wait for the canvas to exist (proxy for "scene created") plus a short cushion.
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  if (accelerateSpeed > 0) {
    const clicked = await page.evaluate((speed) => {
      const button = document.querySelector(`[data-dev-speed="${speed}"]`);
      if (!button) return false;
      button.click();
      return true;
    }, accelerateSpeed);
    if (clicked) {
      console.log(`[heap-check] clicked ${accelerateSpeed}× dev speed`);
    } else {
      console.log(
        `[heap-check] WARNING: no [data-dev-speed="${accelerateSpeed}"] button found — running at 1×`,
      );
    }
  }

  async function takeSnapshot(label) {
    // Drain minor-GC noise so the snapshot reflects retained-by-roots state.
    await client.send("HeapProfiler.collectGarbage");

    const file = join(outDir, `${label}.heapsnapshot`);
    // Stream chunks straight to disk — buffering + joining a multi-GB snapshot
    // would OOM the Node runner long before the browser hits its own heap cap.
    const stream = createWriteStream(file);
    const onChunk = ({ chunk }) => stream.write(chunk);
    client.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await client.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    client.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await new Promise((resolve, reject) => {
      stream.end((error) => (error ? reject(error) : resolve()));
    });

    const metrics = await page.metrics();
    const heapMB = metrics.JSHeapUsedSize / 1024 / 1024;
    measurements.push({ label, heapMB, file });
    console.log(`[${label}] heap=${heapMB.toFixed(2)}MB → ${file}`);
  }

  await takeSnapshot("t0");
  const startMs = Date.now();
  for (let i = 1; i < snapshotCount; i++) {
    const targetMs = startMs + intervalSeconds * 1000 * i;
    const waitMs = targetMs - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const elapsedSeconds = Math.round(intervalSeconds * i);
    await takeSnapshot(`t${elapsedSeconds}s`);
  }
} finally {
  await browser.close();
}

console.log("\n=== Heap measurements ===");
for (const measurement of measurements) {
  console.log(`  ${measurement.label.padEnd(8)}  ${measurement.heapMB.toFixed(2).padStart(7)} MB`);
}

const baseline = measurements[0].heapMB;
const last = measurements[measurements.length - 1].heapMB;
const delta = last - baseline;
const sign = delta >= 0 ? "+" : "";
const percent = ((delta / baseline) * 100).toFixed(1);
console.log(`\nDelta over ${durationSeconds}s: ${sign}${delta.toFixed(2)} MB (${sign}${percent}%)`);

if (snapshotCount > 2) {
  console.log("\nIntermediate growth (per snapshot interval):");
  for (let i = 1; i < measurements.length; i++) {
    const intervalDelta = measurements[i].heapMB - measurements[i - 1].heapMB;
    const intervalSign = intervalDelta >= 0 ? "+" : "";
    console.log(
      `  ${measurements[i - 1].label} → ${measurements[i].label}  ${intervalSign}${intervalDelta.toFixed(2)} MB`,
    );
  }
}

console.log(
  `\nFor class-by-class diff: open Chrome DevTools → Memory tab → "Load profile" button, load any .heapsnapshot from ${outDir}.`,
);
console.log(
  `Compare two snapshots: load both, switch the dropdown above the table from "Summary" to "Comparison", pick the baseline snapshot.`,
);
