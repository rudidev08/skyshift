// Extracts all speakable game strings and writes them as a comma-separated list
// for the voice-clip generator to consume.
// Run: npx tsx dev/audio/audio-build-strings.ts

import {
  collectAnnouncementSpeechStringsFromMapStations,
  collectCoreAnnouncementSpeechStrings,
} from "../../src/audio-speech-strings";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { settledPreset } from "../../data/map-preset-settled";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outputFile = join(projectRoot, "dev/audio/data/audio-strings.txt");
// Settled is the superset of station names across presets today (Frontier
// is a strict subset), so collecting from settledPreset covers every map
// station name the announcement system can speak.
const allSpeechStrings = [...new Set([
  ...collectCoreAnnouncementSpeechStrings(),
  ...collectAnnouncementSpeechStringsFromMapStations(settledPreset.stations),
])].sort();

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, allSpeechStrings.join(", ") + "\n");
console.log(`${allSpeechStrings.length} strings → ${outputFile}`);
