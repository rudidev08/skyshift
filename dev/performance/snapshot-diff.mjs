#!/usr/bin/env node
// Diff two V8 heap snapshots — print classes with biggest growth in object
// count + total self-size. Self-size is just per-object header bytes, not
// retained size — for proper retention analysis (children/closures), load
// both snapshots in Chrome DevTools Memory tab and use the "Comparison" view.
//
// What this script IS good for: pinpointing which constructors are allocating
// extra instances over the run (e.g. "+342 EmigrationEvent objects" tells you
// the emigration cycle is leaking event records).
//
// Usage:
//   node dev/performance/snapshot-diff.mjs <baseline.heapsnapshot> <later.heapsnapshot> [--top N]
//
// Defaults:
//   --top  20

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
  options: { top: { type: "string", default: "20" } },
  allowPositionals: true,
});

if (positionals.length !== 2) {
  console.error("Usage: snapshot-diff.mjs <baseline.heapsnapshot> <later.heapsnapshot> [--top N]");
  process.exit(2);
}

const topN = Number(options.top);
if (!Number.isFinite(topN) || topN <= 0) throw new Error(`--top must be positive, got "${options.top}"`);

function loadClassCounts(path) {
  console.log(`[snapshot-diff] loading ${path}...`);
  const json = JSON.parse(readFileSync(path, "utf-8"));
  const fieldNames = json.snapshot.meta.node_fields;
  const nodeTypeNames = json.snapshot.meta.node_types[0];
  const fieldsPerNode = fieldNames.length;
  const typeIndex = fieldNames.indexOf("type");
  const nameIndex = fieldNames.indexOf("name");
  const selfSizeIndex = fieldNames.indexOf("self_size");
  const objectTypeId = nodeTypeNames.indexOf("object");

  const counts = new Map();
  const nodes = json.nodes;
  const strings = json.strings;
  for (let offset = 0; offset < nodes.length; offset += fieldsPerNode) {
    if (nodes[offset + typeIndex] !== objectTypeId) continue;
    const className = strings[nodes[offset + nameIndex]] || "(unnamed)";
    const selfSize = nodes[offset + selfSizeIndex];
    const existing = counts.get(className);
    if (existing) {
      existing.count++;
      existing.totalSelfSize += selfSize;
    } else {
      counts.set(className, { count: 1, totalSelfSize: selfSize });
    }
  }
  return counts;
}

const baseline = loadClassCounts(positionals[0]);
const later = loadClassCounts(positionals[1]);

const allClasses = new Set([...baseline.keys(), ...later.keys()]);
const diffs = [];
for (const className of allClasses) {
  const baselineEntry = baseline.get(className) ?? { count: 0, totalSelfSize: 0 };
  const laterEntry = later.get(className) ?? { count: 0, totalSelfSize: 0 };
  const countDelta = laterEntry.count - baselineEntry.count;
  const sizeDelta = laterEntry.totalSelfSize - baselineEntry.totalSelfSize;
  if (countDelta === 0 && sizeDelta === 0) continue;
  diffs.push({
    className,
    laterCount: laterEntry.count,
    countDelta,
    laterSize: laterEntry.totalSelfSize,
    sizeDelta,
  });
}

diffs.sort((a, b) => b.sizeDelta - a.sizeDelta);

function formatSize(bytes) {
  if (Math.abs(bytes) >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (Math.abs(bytes) >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDelta(value, formatter = (x) => x.toString()) {
  return value >= 0 ? `+${formatter(value)}` : formatter(value);
}

console.log(`\n=== Top ${topN} classes by self-size growth ===`);
console.log(
  "class".padEnd(45) +
    "count".padStart(10) +
    "Δcount".padStart(10) +
    "self_size".padStart(12) +
    "Δsize".padStart(14),
);
console.log("-".repeat(91));
for (const diff of diffs.slice(0, topN)) {
  const className = diff.className.length > 44 ? diff.className.slice(0, 41) + "..." : diff.className;
  console.log(
    className.padEnd(45) +
      String(diff.laterCount).padStart(10) +
      formatDelta(diff.countDelta).padStart(10) +
      formatSize(diff.laterSize).padStart(12) +
      formatDelta(diff.sizeDelta, formatSize).padStart(14),
  );
}

const totalCountDelta = diffs.reduce((sum, diff) => sum + diff.countDelta, 0);
const totalSizeDelta = diffs.reduce((sum, diff) => sum + diff.sizeDelta, 0);
console.log(
  `\nTotal across all classes (only those that changed): ${formatDelta(totalCountDelta)} objects, ${formatDelta(totalSizeDelta, formatSize)} self-size`,
);
console.log(
  `\nNote: self_size is per-object header bytes only. For full retained-size (children + closures), load both snapshots in Chrome DevTools → Memory → "Load profile", then switch dropdown to "Comparison".`,
);
