/* global document */ // referenced inside page.evaluate() callbacks (browser context).
// Shared scaffolding for the Puppeteer-driven performance checks
// (heap-leak-check, scene-switch-check, frame-jank-check). Each consumer
// imports the bits it needs; the helpers here cover the duplicated launch +
// navigate + heap-snapshot setup, not the per-script analysis.

import puppeteer from "puppeteer";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";

/**
 * Default Chrome flags for the heap-snapshot checks (heap-leak, scene-switch):
 * precise heap reporting + larger V8 heap so we can watch growth without OOM.
 */
export const BROWSER_ARGS_HEAP_SNAPSHOT = [
  "--enable-precise-memory-info",
  "--js-flags=--max-old-space-size=2048",
];

/**
 * Flags for the trace-based frame-jank check, which doesn't snapshot heap and
 * intentionally omits the V8 heap-size override.
 */
export const BROWSER_ARGS_TRACE_ONLY = ["--enable-precise-memory-info"];

/** Filesystem-safe timestamp used as a per-run output-directory name. */
export function formatRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

/** Create `path` (and any missing parents) if it doesn't already exist. */
export function ensureOutDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/**
 * Launch a Puppeteer browser with CDP-friendly flags. `args` defaults to the
 * heap-snapshot flag set; pass `BROWSER_ARGS_TRACE_ONLY` (or any explicit
 * array) to override.
 */
export function launchInstrumentedBrowser({ headless, args = BROWSER_ARGS_HEAP_SNAPSHOT }) {
  return puppeteer.launch({ headless, args });
}

/**
 * Navigate to `url`, wait for the Phaser canvas to mount, then wait an extra
 * `settleSeconds` for the scene to finish settling (Phaser + Vite HMR keep
 * firing past networkidle2).
 */
export async function gotoGameUrlAndSettle(page, url, settleSeconds) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, settleSeconds * 1000));
}

/**
 * Click the `[data-dev-speed="<speed>"]` button inside the page. Logs success
 * or a warning under `logPrefix` if the button isn't found.
 */
export async function clickDevSpeed(page, speed, logPrefix) {
  const clicked = await page.evaluate((speedValue) => {
    const button = document.querySelector(`[data-dev-speed="${speedValue}"]`);
    if (!button) return false;
    button.click();
    return true;
  }, speed);
  if (clicked) {
    console.log(`${logPrefix} clicked ${speed}× dev speed`);
  } else {
    console.log(`${logPrefix} WARNING: no [data-dev-speed="${speed}"] button found — running at 1×`);
  }
}

/**
 * Take a V8 heap snapshot over CDP, streaming the chunks straight to `file`
 * (buffering a multi-GB snapshot would OOM the Node runner). Forces a GC
 * first so the snapshot reflects retained-by-roots state, then reads
 * `JSHeapUsedSize` via `page.metrics()` and logs the result.
 * Returns `{ label, heapMB, file }`.
 */
export async function takeHeapSnapshot(client, page, file, label) {
  await client.send("HeapProfiler.collectGarbage");

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
  console.log(`[${label}] heap=${heapMB.toFixed(2)}MB → ${file}`);
  return { label, heapMB, file };
}
