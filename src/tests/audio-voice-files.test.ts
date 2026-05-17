import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { test, assertTrue } from "./test-utils.ts";
import { collectCoreVoiceKeys, collectVoiceKeysFromMapStations } from "../audio-voice-keys.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";

const voicesDirectory = join(dirname(fileURLToPath(import.meta.url)), "../assets/voices");

// Settled preset is the superset of map-station names across presets today (Frontier
// is a strict subset), so collecting from it covers every map-specific name the game
// announcer can speak. Matches the assumption used by dev/audio/audio-build-strings.ts.
const expectedVoiceKeys = new Set<string>([
  ...collectCoreVoiceKeys(),
  ...collectVoiceKeysFromMapStations(settledPreset.presetStations),
]);
const expectedFilenames = new Set([...expectedVoiceKeys].map((voiceKey) => `${voiceKey}.wav`));
const actualFilenames = new Set(readdirSync(voicesDirectory).filter((filename) => filename.endsWith(".wav")));

function formatFilenameList(filenames: string[], summary: string): string {
  const sortedFilenames = [...filenames].sort();
  const previewLines = sortedFilenames
    .slice(0, 20)
    .map((filename) => `    ${filename}`)
    .join("\n");
  const overflowLine = sortedFilenames.length > 20 ? `\n    ... and ${sortedFilenames.length - 20} more` : "";
  return `${sortedFilenames.length} ${summary}:\n${previewLines}${overflowLine}`;
}

test("every voice key referenced in code has a matching .wav in src/assets/voices/", () => {
  const missingFilenames = [...expectedFilenames].filter((filename) => !actualFilenames.has(filename));
  assertTrue(missingFilenames.length === 0, formatFilenameList(missingFilenames, "missing voice files"));
});

test("src/assets/voices/ contains no .wav files not referenced in code", () => {
  const extraFilenames = [...actualFilenames].filter((filename) => !expectedFilenames.has(filename));
  assertTrue(extraFilenames.length === 0, formatFilenameList(extraFilenames, "extra voice files"));
});
