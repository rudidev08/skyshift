import { test, assertThrows } from "./test-utils.ts";
import { derivePresetMap, type DerivePresetMapDeps } from "../static-pages/lore-derive-preset-map.ts";
import type { MapPreset, PresetStation } from "../../data/map-types.ts";
import { allNations } from "../../data/nations.ts";
import { zones as universeZones } from "../../data/map-zones.ts";

// Pins derivePresetMap's contract: an unknown zoneId in a preset is a
// data-file mistake, not a runtime drift, so the function must throw and
// surface the offending id — not silently place the station at (0, 0) and
// hide the typo behind a fallback.

function buildDeps(): DerivePresetMapDeps {
  const zoneById = new Map(universeZones.map((zone) => [zone.id, zone]));
  const nationById = new Map(allNations.map((nation) => [nation.id, nation]));
  const sectorKey = (x: number, y: number) => `${Math.floor(x / 1000)},${Math.floor(y / 1000)}`;
  return { zoneById, nationById, universeZones, sectorKey };
}

function buildPresetWithUnknownZone(zoneId: string): MapPreset {
  const station: PresetStation = {
    zoneId,
    stationId: "BIO-TEST",
    name: "Phantom Station",
    nationId: "bio",
    stationTypeId: "farm",
  };
  return {
    id: "test-preset",
    name: "Test",
    description: "",
    presetStations: [station],
  };
}

test("derivePresetMap throws when a preset station references an unknown zoneId", () => {
  const deps = buildDeps();
  const preset = buildPresetWithUnknownZone("zone-that-does-not-exist");
  assertThrows(
    () => derivePresetMap(preset, deps),
    "zone-that-does-not-exist",
    "unknown zoneId should throw and reference the offending id",
  );
});
