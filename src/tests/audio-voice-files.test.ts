import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { test, assertTrue } from "./test-utils.ts";
import { collectSharedVoiceKeys, collectVoiceKeysFromMapStations } from "../audio-voice-keys.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";

const voicesDirectory = join(dirname(fileURLToPath(import.meta.url)), "../assets/voices");

// Settled preset is the superset of map-station names across presets today (Frontier
// is a strict subset), so collecting from it covers every map-specific name the game
// announcer can speak. Matches the assumption used by dev/audio/audio-build-strings.ts.
const expectedVoiceKeys = new Set<string>([
  ...collectSharedVoiceKeys(),
  ...collectVoiceKeysFromMapStations(settledPreset.presetStations),
]);
const expectedFilenames = new Set([...expectedVoiceKeys].map((voiceKey) => `${voiceKey}.wav`));
const actualFilenames = new Set(readdirSync(voicesDirectory).filter((filename) => filename.endsWith(".wav")));

function formatFilenameList(filenames: string[], listLabel: string): string {
  const maxListedFilenames = 20;
  const sortedFilenames = [...filenames].sort();
  const previewLines = sortedFilenames
    .slice(0, maxListedFilenames)
    .map((filename) => `    ${filename}`)
    .join("\n");
  const overflowLine =
    sortedFilenames.length > maxListedFilenames
      ? `\n    ... and ${sortedFilenames.length - maxListedFilenames} more`
      : "";
  return `${sortedFilenames.length} ${listLabel}:\n${previewLines}${overflowLine}`;
}

test("every voice key referenced in code has a matching .wav file", () => {
  const missingFilenames = [...expectedFilenames].filter((filename) => !actualFilenames.has(filename));
  assertTrue(missingFilenames.length === 0, formatFilenameList(missingFilenames, "missing voice files"));
});

test("every .wav file in src/assets/voices/ is referenced by a voice key in code", () => {
  const extraFilenames = [...actualFilenames].filter((filename) => !expectedFilenames.has(filename));
  assertTrue(extraFilenames.length === 0, formatFilenameList(extraFilenames, "extra voice files"));
});

// Pin collectVoiceKeysFromMapStations yields one key per named station. Filter inversion
// (e.g. `if (!mapStation.name)`) would yield zero keys, which the disk-equality tests miss
// because shared nation station-name pools already cover the preset names.
test("collectVoiceKeysFromMapStations yields a key for each named station", () => {
  const stations = [{ name: "Alpha Outpost" }, { name: "Beta Hub" }, {}];
  const keys = collectVoiceKeysFromMapStations(stations);
  assertTrue(keys.has("alpha-outpost"), "expected 'alpha-outpost' in collected keys");
  assertTrue(keys.has("beta-hub"), "expected 'beta-hub' in collected keys");
  assertTrue(keys.size === 2, `expected 2 keys, got ${keys.size}`);
});
