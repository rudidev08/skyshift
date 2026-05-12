// Voice-clip key vocabulary — keys produced here match the lowercase-hyphenated
// stem of `.wav` files in `src/assets/voices/`. Consumed by both the runtime
// announcement system and the speech-string preload helpers.

import { spokenTextBySourceText } from "../data/audio-spoken-substitutions";
import { allNations } from "../data/nations";
import { allShips } from "../data/ships";
import { stationTypes } from "../data/stations";
import { sectors as universeSectors } from "../data/map-sectors";

/** Display name to voice-clip key (lowercase-hyphenated stem of `.wav` files in src/assets/voices/). */
export function nameToVoiceKey(displayName: string): string {
  return displayName.toLowerCase().replace(/\s+/g, "-");
}

export function applyTextToSpeechOverride(text: string): string {
  return spokenTextBySourceText[text] ?? text;
}

export function textToVoiceKey(text: string): string {
  return nameToVoiceKey(applyTextToSpeechOverride(text));
}

export function collectCoreVoiceKeys(): Set<string> {
  const voiceKeys = new Set<string>();

  // Includes WAY so its generational-ship station names get preloaded; buildingNations would skip them.
  for (const nation of allNations) {
    voiceKeys.add(nameToVoiceKey(nation.shortName));
    for (const stationName of nation.stationNames) voiceKeys.add(nameToVoiceKey(stationName));
    for (const shipName of nation.shipNames) voiceKeys.add(nameToVoiceKey(shipName));
    for (const suffix of nation.nameSuffixes) voiceKeys.add(textToVoiceKey(suffix));
  }

  for (const shipType of allShips) voiceKeys.add(nameToVoiceKey(shipType.name));
  for (const stationType of stationTypes) voiceKeys.add(nameToVoiceKey(stationType.name));

  voiceKeys.add(nameToVoiceKey("Unclaimed"));
  for (const sector of universeSectors) voiceKeys.add(nameToVoiceKey(sector.name));

  return voiceKeys;
}

export function collectVoiceKeysFromMapStations(mapStations: readonly { name?: string }[]): Set<string> {
  const voiceKeys = new Set<string>();

  for (const mapStation of mapStations) {
    if (mapStation.name) voiceKeys.add(nameToVoiceKey(mapStation.name));
  }

  return voiceKeys;
}
