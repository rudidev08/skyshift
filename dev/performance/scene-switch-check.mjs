#!/usr/bin/env node
// Scene-switch leak check — navigates between URLs to cycle Game-scene
// construct/destroy and reports heap retention after each cycle.
//
// Loads: snapshot 1 → navigate → snapshot 2 → navigate → ... If teardown is
// clean, retained heap should plateau. If Phaser objects leak across scenes,
// it grows monotonically.
//
// Prerequisites: dev server must already be running (`npm run dev`).
//
// Usage:
//   node dev/performance/scene-switch-check.mjs [--urls <CSV>] [--cycles <N>]
//                                               [--wait <SECONDS>] [--out <DIR>]
//                                               [--headed]
//
// Defaults:
//   --urls    http://localhost:5173/start/settled,http://localhost:5173/start/frontier
//   --cycles  5  (number of navigations after the initial load — yields cycles+1 snapshots)
//   --wait    5  (seconds to wait at each URL before snapshotting; lets Phaser settle)
//   --out     dev/performance/snapshots.local
//   --headed  visible browser (default: headless)

import puppeteer from "puppeteer";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    urls: {
      type: "string",
      default: "http://localhost:5173/start/settled,http://localhost:5173/start/frontier",
    },
    cycles: { type: "string", default: "5" },
    wait: { type: "string", default: "5" },
    out: { type: "string", default: "dev/performance/snapshots.local" },
    headed: { type: "boolean", default: false },
  },
});

const cycleCount = Number(args.cycles);
const waitSeconds = Number(args.wait);
if (!Number.isFinite(cycleCount) || cycleCount <= 0) throw new Error(`--cycles must be positive, got "${args.cycles}"`);
if (!Number.isFinite(waitSeconds) || waitSeconds <= 0) throw new Error(`--wait must be positive, got "${args.wait}"`);

const urls = args.urls.split(",").map((url) => url.trim()).filter(Boolean);
if (urls.length === 0) throw new Error(`--urls must list at least one URL`);

const runId = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const outDir = join(args.out, `scene-switch-${runId}`);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

console.log(`[scene-switch] urls=[${urls.join(", ")}] cycles=${cycleCount} wait=${waitSeconds}s out=${outDir}`);

const browser = await puppeteer.launch({
  headless: !args.headed,
  args: ["--enable-precise-memory-info", "--js-flags=--max-old-space-size=2048"],
});

const measurements = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const client = await page.createCDPSession();
  await client.send("HeapProfiler.enable");

  async function navigateAndSnapshot(label, url) {
    console.log(`[${label}] navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.waitForSelector("canvas", { timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));

    await client.send("HeapProfiler.collectGarbage");

    const file = join(outDir, `${label}.heapsnapshot`);
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
    measurements.push({ label, url, heapMB, file });
    console.log(`[${label}] heap=${heapMB.toFixed(2)}MB → ${file}`);
  }

  await navigateAndSnapshot("cycle0", urls[0]);
  for (let i = 1; i <= cycleCount; i++) {
    await navigateAndSnapshot(`cycle${i}`, urls[i % urls.length]);
  }
} finally {
  await browser.close();
}

console.log("\n=== Heap measurements per cycle ===");
for (const m of measurements) {
  console.log(`  ${m.label.padEnd(8)}  ${m.heapMB.toFixed(2).padStart(7)} MB  (${m.url})`);
}

const baseline = measurements[0].heapMB;
const last = measurements[measurements.length - 1].heapMB;
const delta = last - baseline;
const sign = delta >= 0 ? "+" : "";
const percent = ((delta / baseline) * 100).toFixed(1);
console.log(`\nDelta over ${cycleCount} cycles: ${sign}${delta.toFixed(2)} MB (${sign}${percent}%)`);
console.log(`Plateauing = clean teardown. Monotonic growth = leak.`);
console.log(`\nFor class-by-class diff: Chrome DevTools → Memory → "Load profile", load any .heapsnapshot from ${outDir}.`);
