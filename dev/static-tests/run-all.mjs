// Runs every *.test.mjs in this directory as an isolated child process and
// reports a single pass/fail summary. Each test gets its own browser, so a
// crash in one doesn't poison the others.
//
// Prerequisites: dev server must already be running (`npm run dev`).
//
// Usage: node dev/static-tests/run-all.mjs [--headed]

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(here)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

if (testFiles.length === 0) {
  console.log("no *.test.mjs files found");
  process.exit(0);
}

const childArgs = process.argv.slice(2);
const failedTests = [];

for (const file of testFiles) {
  console.log(`\n──── ${file} ────`);
  const exitCode = await new Promise((resolve) => {
    const child = spawn("node", [join(here, file), ...childArgs], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 0));
  });
  if (exitCode !== 0) failedTests.push(file);
}

const passed = testFiles.length - failedTests.length;
console.log(`\n${passed}/${testFiles.length} passing`);
if (failedTests.length > 0) {
  console.log(`failed: ${failedTests.join(", ")}`);
  process.exit(1);
}
