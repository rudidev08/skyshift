// Voice-clip key vocabulary — keys produced here match the lowercase-hyphenated
// stem of `.wav` files in `src/assets/voices/`. The runtime announcer uses
// nameToVoiceKey/textToVoiceKey; dev tools and tests use the collect* exports.

import { spokenTextBySourceText } from "../data/audio-spoken-substitutions";
import { allNations } from "../data/nations";
import { allShips } from "../data/ships";
import { allStationTypes } from "../data/stations";
import { sectors as universeSectors } from "../data/map-sectors";

/** Name to voice-clip key (lowercase-hyphenated stem of `.wav` files in src/assets/voices/). */
export function nameToVoiceKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

/** Returns the spoken-form override for a text string from data files, or the original if no override is registered. */
export function applyTextToSpeechOverride(text: string): string {
  return spokenTextBySourceText[text] ?? text;
}

/** Voice-clip key for a text string from data files — applies the spoken-form override, then folds to the lowercase-hyphenated voice-key form. */
export function textToVoiceKey(text: string): string {
  return nameToVoiceKey(applyTextToSpeechOverride(text));
}

/**
 * Every readable speech string baked into the data files shared across all maps:
 * nation short names, per-nation station/ship name pools, spoken-form-substituted
 * name suffixes, ship-type and station-type names, the "Unclaimed" zone label,
 * and sector names. Includes WAY so its generational-ship station names get
 * preloaded; stationBuilderNations would skip them. `collectSharedVoiceKeys` folds
 * each string through `nameToVoiceKey`; `collectSharedSpeechStrings` keeps them raw.
 */
function* sharedSpeechStrings(): Generator<string> {
  for (const nation of allNations) {
    yield nation.shortName;
    yield* nation.stationNames;
    yield* nation.shipNames;
    for (const suffix of nation.nameSuffixes) yield applyTextToSpeechOverride(suffix);
  }

  for (const shipType of allShips) yield shipType.name;
  for (const stationType of allStationTypes) yield stationType.name;

  yield "Unclaimed";
  for (const sector of universeSectors) yield sector.name;
}

/** Readable speech strings for one map's placed station names, skipping nameless entries. */
function* mapStationSpeechStrings(mapStations: readonly { name?: string }[]): Generator<string> {
  for (const mapStation of mapStations) {
    if (mapStation.name) yield mapStation.name;
  }
}

/** Voice-clip keys derived from data shared across all maps — see `sharedSpeechStrings` for the covered set. */
export function collectSharedVoiceKeys(): Set<string> {
  const voiceKeys = new Set<string>();
  for (const speechString of sharedSpeechStrings()) voiceKeys.add(nameToVoiceKey(speechString));
  return voiceKeys;
}

/** Readable speech strings derived from data shared across all maps — see `sharedSpeechStrings` for the covered set. */
export function collectSharedSpeechStrings(): Set<string> {
  return new Set(sharedSpeechStrings());
}

/** Voice-clip keys for one map's station names. Separate from collectSharedVoiceKeys (which is map-independent) so the voice-files test and dev/audio/audio-verify-clips.ts can build the expected clip set as the union of shared keys and per-map station names. */
export function collectVoiceKeysFromMapStations(mapStations: readonly { name?: string }[]): Set<string> {
  const voiceKeys = new Set<string>();
  for (const name of mapStationSpeechStrings(mapStations)) voiceKeys.add(nameToVoiceKey(name));
  return voiceKeys;
}

/** Readable speech strings for one map's placed station names — pairs with `collectVoiceKeysFromMapStations`. */
export function collectSpeechStringsFromMapStations(
  mapStations: readonly { name?: string }[],
): Set<string> {
  return new Set(mapStationSpeechStrings(mapStations));
}
