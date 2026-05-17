/** Source text that maps to voice clips, used by asset-coverage diagnostics and announcement preload. */

import { allNations } from "../data/nations";
import { allShips } from "../data/ships";
import { allStationTypes } from "../data/stations";
import { sectors as universeSectors } from "../data/map-sectors";
import { applyTextToSpeechOverride } from "./audio-voice-keys";

/** Collect every speech string baked into the data files — nation/ship/station/sector names plus the "Unclaimed" fallback. */
export function collectCoreSpeechStrings(): Set<string> {
  const speechStrings = new Set<string>();

  // Includes WAY so its generational-ship station names get preloaded; stationBuilderNations would skip them.
  for (const nation of allNations) {
    speechStrings.add(nation.shortName);
    for (const stationName of nation.stationNames) speechStrings.add(stationName);
    for (const shipName of nation.shipNames) speechStrings.add(shipName);
    for (const suffix of nation.nameSuffixes) speechStrings.add(applyTextToSpeechOverride(suffix));
  }

  for (const shipType of allShips) speechStrings.add(shipType.name);
  for (const stationType of allStationTypes) speechStrings.add(stationType.name);

  speechStrings.add("Unclaimed");
  for (const sector of universeSectors) speechStrings.add(sector.name);

  return speechStrings;
}

/** Collect speech strings for per-map station names — separate from the core set so preset-specific names can be handled apart from the shared data files. */
export function collectAnnouncementSpeechStringsFromMapStations(
  mapStations: readonly { name?: string }[],
): Set<string> {
  const speechStrings = new Set<string>();

  for (const mapStation of mapStations) {
    if (mapStation.name) speechStrings.add(mapStation.name);
  }

  return speechStrings;
}
