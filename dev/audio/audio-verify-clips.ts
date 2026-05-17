// Verifies that a clip directory contains the full canonical announcement voice pack.
// Run: node --import tsx dev/audio/audio-verify-clips.ts <clip-directory> [--allow-extra]

import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { collectCoreVoiceKeys, collectVoiceKeysFromMapStations } from "../../src/audio-voice-keys";
import { settledPreset } from "../../data/map-preset-settled";

function collectExpectedAnnouncementClipFilenames(): string[] {
  // Derive filenames from live game data — a stale manifest could hide a missing clip.
  // Settled covers Frontier's station names too, so it's the only preset we need to scan.
  const expectedVoiceKeys = new Set<string>(collectCoreVoiceKeys());
  for (const voiceKey of collectVoiceKeysFromMapStations(settledPreset.presetStations)) {
    expectedVoiceKeys.add(voiceKey);
  }

  return [...expectedVoiceKeys].sort().map((voiceKey) => `${voiceKey}.wav`);
}

interface ParsedArguments {
  clipDirectoryPath: string;
  allowExtraFiles: boolean;
}

function parseArguments(): ParsedArguments {
  const commandLineArguments = process.argv.slice(2);
  const clipDirectoryArgument = commandLineArguments.find((argument) => !argument.startsWith("--"));
  const allowExtraFiles = commandLineArguments.includes("--allow-extra");
  if (!clipDirectoryArgument) {
    console.error(
      "Usage: node --import tsx dev/audio/audio-verify-clips.ts <clip-directory> [--allow-extra]",
    );
    process.exit(1);
  }
  return { clipDirectoryPath: resolve(clipDirectoryArgument), allowExtraFiles };
}

function validateClipDirectory(clipDirectoryPath: string): void {
  if (!existsSync(clipDirectoryPath)) {
    console.error(`ERROR: Clip directory does not exist: ${clipDirectoryPath}`);
    process.exit(1);
  }
  if (!statSync(clipDirectoryPath).isDirectory()) {
    console.error(`ERROR: Clip path is not a directory: ${clipDirectoryPath}`);
    process.exit(1);
  }
}

function reportFilenameProblems(severityLabel: string, header: string, filenames: string[]): void {
  if (filenames.length === 0) return;
  console.error(header);
  for (const filename of filenames.slice(0, 20)) {
    console.error(`  ${severityLabel}: ${filename}`);
  }
  if (filenames.length > 20) {
    console.error(`  ... and ${filenames.length - 20} more`);
  }
  process.exit(1);
}

function verifyAnnouncementClips(): void {
  const { clipDirectoryPath, allowExtraFiles } = parseArguments();
  validateClipDirectory(clipDirectoryPath);

  const expectedClipFilenames = collectExpectedAnnouncementClipFilenames();
  const expectedClipFilenameSet = new Set(expectedClipFilenames);
  const actualClipFilenames = readdirSync(clipDirectoryPath)
    .filter((filename) => filename.endsWith(".wav"))
    .sort();
  const actualClipFilenameSet = new Set(actualClipFilenames);

  const missingClipFilenames = expectedClipFilenames.filter(
    (filename) => !actualClipFilenameSet.has(filename),
  );
  const extraClipFilenames = actualClipFilenames.filter((filename) => !expectedClipFilenameSet.has(filename));

  reportFilenameProblems(
    "MISSING",
    `ERROR: ${missingClipFilenames.length} announcement clips are missing from ${clipDirectoryPath}`,
    missingClipFilenames,
  );
  if (!allowExtraFiles) {
    reportFilenameProblems(
      "EXTRA",
      `ERROR: ${extraClipFilenames.length} unexpected clips were found in ${clipDirectoryPath}`,
      extraClipFilenames,
    );
  }

  // --allow-extra exists because the generate step keeps reviewed clips even after
  // they leave the canonical set; callers verifying that legacy directory opt in here.
  const extraFileSummary =
    allowExtraFiles && extraClipFilenames.length > 0 ? ` (${extraClipFilenames.length} extra ignored)` : "";
  console.log(
    `Verified ${expectedClipFilenames.length} expected announcement clips in ${clipDirectoryPath}${extraFileSummary}`,
  );
}

verifyAnnouncementClips();
