// Verifies that a clip directory contains the full canonical announcement voice pack.
// Run: node --import tsx dev/audio/audio-verify-clips.ts <clip-directory> [--allow-extra]

import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import {
  collectAnnouncementSpeechStringsFromMapStations,
  collectCoreAnnouncementSpeechStrings,
} from "../../src/audio-speech-strings";
import { settledPreset } from "../../data/map-preset-settled";

function collectExpectedAnnouncementClipFilenames(): string[] {
  // Derive filenames from live game data — a stale manifest could hide a missing clip.
  // Settled covers Frontier's station names too, so it's the only preset we need to scan.
  const expectedSpeechStrings = new Set<string>(collectCoreAnnouncementSpeechStrings());
  for (const speechString of collectAnnouncementSpeechStringsFromMapStations(settledPreset.stations)) {
    expectedSpeechStrings.add(speechString);
  }

  return [...expectedSpeechStrings].sort().map((speechString) => `${speechString}.wav`);
}

const commandLineArguments = process.argv.slice(2);
const clipDirectoryArgument = commandLineArguments.find((argument) => !argument.startsWith("--"));
const allowExtraFiles = commandLineArguments.includes("--allow-extra");

if (!clipDirectoryArgument) {
  console.error("Usage: node --import tsx dev/audio/audio-verify-clips.ts <clip-directory> [--allow-extra]");
  process.exit(1);
}

const clipDirectoryPath = resolve(clipDirectoryArgument);

if (!existsSync(clipDirectoryPath)) {
  console.error(`ERROR: Clip directory does not exist: ${clipDirectoryPath}`);
  process.exit(1);
}

if (!statSync(clipDirectoryPath).isDirectory()) {
  console.error(`ERROR: Clip path is not a directory: ${clipDirectoryPath}`);
  process.exit(1);
}

const expectedClipFilenames = collectExpectedAnnouncementClipFilenames();
const expectedClipFilenameSet = new Set(expectedClipFilenames);
const actualClipFilenames = readdirSync(clipDirectoryPath)
  .filter((filename) => filename.endsWith(".wav"))
  .sort();
const actualClipFilenameSet = new Set(actualClipFilenames);

const missingClipFilenames = expectedClipFilenames.filter(
  (filename) => !actualClipFilenameSet.has(filename),
);
const extraClipFilenames = actualClipFilenames.filter(
  (filename) => !expectedClipFilenameSet.has(filename),
);

if (missingClipFilenames.length > 0) {
  console.error(`ERROR: ${missingClipFilenames.length} announcement clips are missing from ${clipDirectoryPath}`);
  for (const filename of missingClipFilenames.slice(0, 20)) {
    console.error(`  MISSING: ${filename}`);
  }
  if (missingClipFilenames.length > 20) {
    console.error(`  ... and ${missingClipFilenames.length - 20} more`);
  }
  process.exit(1);
}

if (!allowExtraFiles && extraClipFilenames.length > 0) {
  console.error(`ERROR: ${extraClipFilenames.length} unexpected clips were found in ${clipDirectoryPath}`);
  for (const filename of extraClipFilenames.slice(0, 20)) {
    console.error(`  EXTRA: ${filename}`);
  }
  if (extraClipFilenames.length > 20) {
    console.error(`  ... and ${extraClipFilenames.length - 20} more`);
  }
  process.exit(1);
}

// --allow-extra exists because the generate step keeps reviewed clips even after
// they leave the canonical set; callers verifying that legacy directory opt in here.
const extraFileSummary = allowExtraFiles && extraClipFilenames.length > 0
  ? ` (${extraClipFilenames.length} extra ignored)`
  : "";
console.log(
  `Verified ${expectedClipFilenames.length} expected announcement clips in ${clipDirectoryPath}${extraFileSummary}`,
);
