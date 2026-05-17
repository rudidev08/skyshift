// Voice-clip key vocabulary — keys produced here match the lowercase-hyphenated
// stem of `.wav` files in `src/assets/voices/`. Consumed by both the runtime
// announcement system and the speech-string preload helpers.

import { spokenTextBySourceText } from "../data/audio-spoken-substitutions";
import { allNations } from "../data/nations";
import { allShips } from "../data/ships";
import { allStationTypes } from "../data/stations";
import { sectors as universeSectors } from "../data/map-sectors";

/** Display name to voice-clip key (lowercase-hyphenated stem of `.wav` files in src/assets/voices/). */
export function nameToVoiceKey(displayName: string): string {
  return displayName.toLowerCase().replace(/\s+/g, "-");
}

/** Returns the spoken-form override for a text string from data files, or the original if no override is registered. */
export function applyTextToSpeechOverride(text: string): string {
  return spokenTextBySourceText[text] ?? text;
}

/** Voice-clip key for a text string from data files — applies the spoken-form override, then folds to the lowercase-hyphenated voice-key form. */
export function textToVoiceKey(text: string): string {
  return nameToVoiceKey(applyTextToSpeechOverride(text));
}

/** Voice-clip keys derived from data shared across all maps: nation names, station/ship types, sector names, the "Unclaimed" zone label, plus the WAY generational-ship station names that map-station collection would skip. */
export function collectCoreVoiceKeys(): Set<string> {
  const voiceKeys = new Set<string>();

  for (const nation of allNations) {
    voiceKeys.add(nameToVoiceKey(nation.shortName));
    for (const stationName of nation.stationNames) voiceKeys.add(nameToVoiceKey(stationName));
    for (const shipName of nation.shipNames) voiceKeys.add(nameToVoiceKey(shipName));
    for (const suffix of nation.nameSuffixes) voiceKeys.add(textToVoiceKey(suffix));
  }

  for (const shipType of allShips) voiceKeys.add(nameToVoiceKey(shipType.name));
  for (const stationType of allStationTypes) voiceKeys.add(nameToVoiceKey(stationType.name));

  voiceKeys.add(nameToVoiceKey("Unclaimed"));
  for (const sector of universeSectors) voiceKeys.add(nameToVoiceKey(sector.name));

  return voiceKeys;
}

/** Voice-clip keys for per-map station names — separate from the core set so preset switches only need to refresh map-specific clips. */
export function collectVoiceKeysFromMapStations(mapStations: readonly { name?: string }[]): Set<string> {
  const voiceKeys = new Set<string>();

  for (const mapStation of mapStations) {
    if (mapStation.name) voiceKeys.add(nameToVoiceKey(mapStation.name));
  }

  return voiceKeys;
}
