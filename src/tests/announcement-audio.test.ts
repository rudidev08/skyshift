import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  collectAnnouncementSpeechStringsFromMapStations,
  collectCoreAnnouncementSpeechStrings,
} from "../audio-speech-strings.ts";
import {
  applyTextToSpeechOverride,
  collectCoreVoiceKeys,
  collectVoiceKeysFromMapStations,
  nameToVoiceKey,
  textToVoiceKey,
} from "../audio-voice-keys.ts";

test("text-to-speech override helpers convert roman numerals and digits into spoken words", () => {
  assertTrue(applyTextToSpeechOverride("III") === "three", "roman numeral should become spoken word text");
  assertTrue(textToVoiceKey("III") === "three", "roman numeral should become spoken word voice key");
  assertTrue(applyTextToSpeechOverride("18") === "eighteen", "digit string should become spoken word text");
  assertTrue(nameToVoiceKey("Medical Lab") === "medical-lab", "display names should become hyphenated voice keys");
  assertTrue(applyTextToSpeechOverride("Hub-Cluster") === "Hub-Cluster", "non-overridden text should pass through unchanged");
  assertTrue(nameToVoiceKey("Gap of Calamity") === "gap-of-calamity", "every whitespace run should become a hyphen, not just the first");
});

test("core announcement helpers derive keys and speech strings from canonical game data", () => {
  const voiceKeys = collectCoreVoiceKeys();
  const speechStrings = collectCoreAnnouncementSpeechStrings();

  assertTrue(voiceKeys.has("hub-cluster"), "short nation names should be converted to voice keys");
  assertTrue(voiceKeys.has("medical-lab"), "station types should become voice keys");
  assertTrue(voiceKeys.has("three"), "roman numeral suffixes should use spoken word voice keys");
  assertTrue(voiceKeys.has("unclaimed"), "Unclaimed fallback should be added as a voice key");
  assertTrue(voiceKeys.has("gap-of-calamity"), "sector names should become voice keys");
  // Pin the per-nation stationNames pool. Skipping that loop would silently drop authored station-name voice keys.
  assertTrue(voiceKeys.has("high-pinnacle"), "nation station name pool should become voice keys");
  // Pin the per-nation shipNames pool. Skipping that loop would silently drop authored ship-name voice keys.
  assertTrue(voiceKeys.has("accord"), "nation ship name pool should become voice keys");
  // Pin the allShips ship type loop. Skipping it would silently drop ship-type voice keys.
  assertTrue(voiceKeys.has("tanker"), "ship types should become voice keys");
  assertTrue(speechStrings.has("Hub-Cluster"), "short nation names should stay readable in speech strings");
  assertTrue(speechStrings.has("Medical Lab"), "station types should stay readable in speech strings");
  assertTrue(speechStrings.has("three"), "roman numeral suffixes should become spoken word speech strings");
  assertTrue(speechStrings.has("Unclaimed"), "Unclaimed fallback should appear in speech strings");
  assertTrue(speechStrings.has("Gap of Calamity"), "sector names should stay readable in speech strings");
  // Pin the per-nation stationNames pool for speech strings. Skipping that loop would drop authored station names.
  assertTrue(speechStrings.has("High Pinnacle"), "nation station name pool should appear in speech strings");
  // Pin the per-nation shipNames pool for speech strings.
  assertTrue(speechStrings.has("Accord"), "nation ship name pool should appear in speech strings");
  // Pin the allShips ship type loop for speech strings.
  assertTrue(speechStrings.has("Tanker"), "ship types should appear in speech strings");
});

test("map station helpers keep full names and deduplicate repeats", () => {
  const mapStations = [{ name: "Accord III" }, { name: "Accord III" }, { name: "Moss Gate" }, {}];
  const voiceKeys = collectVoiceKeysFromMapStations(mapStations);
  const speechStrings = collectAnnouncementSpeechStringsFromMapStations(mapStations);

  assertEqual(voiceKeys.size, 2, "map station voice key set size");
  assertEqual(speechStrings.size, 2, "map station speech string set size");
  assertTrue(voiceKeys.has("accord-iii"), "map station names should keep their full-name voice key");
  assertTrue(speechStrings.has("Accord III"), "map station speech strings should keep their full name");
});
