#!/usr/bin/env node
// Frame-jank / GC-pressure check — records a CDP trace covering V8 GC events
// and frame timing while the game runs at realistic per-frame allocation
// rate, then summarizes the GC events and saves the full trace for visual
// inspection in chrome://tracing or DevTools Performance.
//
// Concern: per-render-frame allocations (e.g. `getPointOnCurve` returning a
// fresh `{x, y}`) cause minor-GC pauses that show up as frame jank. Heap
// snapshots can't see this — only timeline tracing can.
//
// Prerequisites: dev server must already be running (`npm run dev`).
//
// Usage:
//   node dev/performance/frame-jank-check.mjs [--url <URL>] [--duration <SECONDS>]
//                                             [--accelerate <SPEED>] [--out <DIR>]
//                                             [--headed]
//
// Defaults:
//   --url         http://localhost:5173/start/settled
//   --duration    30 (long enough to see steady-state GC cadence)
//   --accelerate  0  (1× sim speed by default — render frames are wall-clock,
//                     so accelerating only helps reach "many ships in flight"
//                     state faster; defaults to 0 to reflect real per-frame load)
//   --out         dev/performance/traces.local
//   --headed      visible browser (default: headless)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  formatRunId,
  ensureOutDir,
  launchInstrumentedBrowser,
  gotoGameUrlAndSettle,
  clickDevSpeed,
  BROWSER_ARGS_TRACE_ONLY,
} from "./puppeteer-helpers.mjs";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173/start/settled" },
    duration: { type: "string", default: "30" },
    accelerate: { type: "string", default: "0" },
    out: { type: "string", default: "dev/performance/traces.local" },
    headed: { type: "boolean", default: false },
  },
});

const durationSeconds = Number(args.duration);
const accelerateSpeed = Number(args.accelerate);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
  throw new Error(`--duration must be positive, got "${args.duration}"`);
if (!Number.isFinite(accelerateSpeed) || accelerateSpeed < 0)
  throw new Error(`--accelerate must be non-negative, got "${args.accelerate}"`);

const outDir = join(args.out, formatRunId());
ensureOutDir(outDir);
const tracePath = join(outDir, "trace.json");

console.log(
  `[frame-jank] url=${args.url} duration=${durationSeconds}s accelerate=${accelerateSpeed}x out=${outDir}`,
);

const browser = await launchInstrumentedBrowser({
  headless: !args.headed,
  args: BROWSER_ARGS_TRACE_ONLY,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log(`[frame-jank] navigating...`);
  await gotoGameUrlAndSettle(page, args.url, 3);

  if (accelerateSpeed > 0) {
    await clickDevSpeed(page, accelerateSpeed, "[frame-jank]");
  }

  console.log(`[frame-jank] tracing for ${durationSeconds}s...`);
  await page.tracing.start({
    path: tracePath,
    categories: [
      "disabled-by-default-v8.gc",
      "v8",
      "toplevel",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
  await page.tracing.stop();
} finally {
  await browser.close();
}

// Quick parse for GC summary. Full timeline lives in the .json — load it in
// chrome://tracing or DevTools Performance for ship-position correlation.
const trace = JSON.parse(readFileSync(tracePath, "utf-8"));
const events = trace.traceEvents;

function summarizeGcEvents(events) {
  const minor = { count: 0, totalMicroseconds: 0, maxMicroseconds: 0 };
  const major = { count: 0, totalMicroseconds: 0, maxMicroseconds: 0 };
  for (const event of events) {
    if (event.dur == null || !event.cat?.includes("v8")) continue;
    const isMinor = event.name === "V8.GCScavenger" || event.name === "MinorGC";
    const isMajor =
      event.name === "V8.GCMarkCompactor" || event.name === "MajorGC" || event.name === "V8.GCFinalizeMC";
    if (isMinor) {
      minor.count++;
      minor.totalMicroseconds += event.dur;
      if (event.dur > minor.maxMicroseconds) minor.maxMicroseconds = event.dur;
    } else if (isMajor) {
      major.count++;
      major.totalMicroseconds += event.dur;
      if (event.dur > major.maxMicroseconds) major.maxMicroseconds = event.dur;
    }
  }
  return { minor, major };
}

const { minor, major } = summarizeGcEvents(events);

function printGcSummaryLine(label, { count, totalMicroseconds, maxMicroseconds }) {
  const totalMilliseconds = totalMicroseconds / 1000;
  const avgMilliseconds = count > 0 ? totalMilliseconds / count : 0;
  const ratePerSecond = count / durationSeconds;
  const overheadPercent = (totalMilliseconds / (durationSeconds * 1000)) * 100;
  console.log(
    `  ${label}: ${count} events  |  total ${totalMilliseconds.toFixed(1)}ms (${overheadPercent.toFixed(2)}% of run)  |  avg ${avgMilliseconds.toFixed(2)}ms  |  max ${(maxMicroseconds / 1000).toFixed(2)}ms  |  rate ${ratePerSecond.toFixed(2)}/s`,
  );
}

console.log(`\n=== GC summary over ${durationSeconds}s ===`);
printGcSummaryLine("minor GC (scavenge)", minor);
printGcSummaryLine("major GC (mark-compact)", major);

// Thresholds (codex + 2 review-agent consensus, 2026-05-05): single-pause and
// overhead %, separate minor/major. Rate alone is informational — high rate
// with low max+overhead is fine.
const minorMaxMilliseconds = minor.maxMicroseconds / 1000;
const majorMaxMilliseconds = major.maxMicroseconds / 1000;
const minorOverheadPercent = (minor.totalMicroseconds / 1000 / (durationSeconds * 1000)) * 100;
const majorOverheadPercent = (major.totalMicroseconds / 1000 / (durationSeconds * 1000)) * 100;

const issues = [];
if (minorMaxMilliseconds > 3) issues.push(`minor-GC max ${minorMaxMilliseconds.toFixed(2)}ms exceeds 3ms`);
if (minorOverheadPercent > 3) issues.push(`minor-GC overhead ${minorOverheadPercent.toFixed(2)}% exceeds 3%`);
if (majorMaxMilliseconds > 10) issues.push(`major-GC max ${majorMaxMilliseconds.toFixed(2)}ms exceeds 10ms`);
if (majorOverheadPercent > 0.5)
  issues.push(`major-GC overhead ${majorOverheadPercent.toFixed(2)}% exceeds 0.5%`);

if (issues.length === 0) {
  console.log(
    `\nVerdict: PASS — within thresholds (minor max <=3ms / overhead <=3%; major max <=10ms / overhead <=0.5%).`,
  );
} else {
  console.log(`\nVerdict: INVESTIGATE`);
  for (const issue of issues) console.log(`  - ${issue}`);
}

console.log(`\nTrace saved: ${tracePath}`);
console.log(
  `Open in chrome://tracing/ or DevTools Performance ("Load profile") for the full visual timeline (frame timing, GC bars, paint events, etc).`,
);
