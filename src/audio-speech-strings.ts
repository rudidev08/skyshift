/** Source text that maps to voice clips, used by asset-coverage diagnostics and announcement preload. */

import { allNations } from "../data/nations";
import { allShips } from "../data/ships";
import { stationTypes } from "../data/stations";
import { sectors as universeSectors } from "../data/map-sectors";
import { applyTextToSpeechOverride } from "./audio-voice-keys";

/** Collect every speech string baked into authored data — nation/ship/station/sector names plus the "Unclaimed" fallback. */
export function collectCoreAnnouncementSpeechStrings(): Set<string> {
  const speechStrings = new Set<string>();

  // Iterates allNations (not buildingNations) so the WAY nation's generational-ship station names get preloaded too.
  for (const nation of allNations) {
    speechStrings.add(nation.shortName);
    for (const stationName of nation.stationNames) speechStrings.add(stationName);
    for (const shipName of nation.shipNames) speechStrings.add(shipName);
    for (const suffix of nation.nameSuffixes) speechStrings.add(applyTextToSpeechOverride(suffix));
  }

  for (const shipType of allShips) speechStrings.add(shipType.name);
  for (const stationType of stationTypes) speechStrings.add(stationType.name);

  speechStrings.add("Unclaimed");
  for (const sector of universeSectors) speechStrings.add(sector.name);

  return speechStrings;
}

/** Collect speech strings for player-renamed map stations whose names aren't in the authored data. */
export function collectAnnouncementSpeechStringsFromMapStations(mapStations: readonly { name?: string }[]): Set<string> {
  const speechStrings = new Set<string>();

  for (const mapStation of mapStations) {
    if (mapStation.name) speechStrings.add(mapStation.name);
  }

  return speechStrings;
}
