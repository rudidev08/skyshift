import { test, assertTrue } from "./test-utils.ts";
import { hasUnsavedEdits } from "../editor/edits-heuristic.ts";
import type { PlacedStation } from "../../data/station-types.ts";
import type { Nebula } from "../../data/map-types.ts";
import { bioNation } from "../../data/nations.ts";
import { makePlacedStation, makeNebula } from "./factories.ts";

function station(id: string, x: number, y: number): PlacedStation {
  return makePlacedStation({ id, x, y });
}

function nebula(textureKey: string, x: number, y: number): Nebula {
  return makeNebula({ textureKey, x, y });
}

test("hasUnsavedEdits: fresh editor with untouched baseline returns false", () => {
  const baselineStations = [station("HUB-1", 100, 100), station("BIO-1", 200, 200)];
  const baselineNebulas = [nebula("neb-a", 0, 0)];
  const currentStations = baselineStations.map((station) => ({ ...station }));
  const currentNebulas = baselineNebulas.map((nebula) => ({ ...nebula }));
  assertTrue(
    !hasUnsavedEdits(currentStations, baselineStations, currentNebulas, baselineNebulas),
    "identical clones should register as 'no edits'",
  );
});

test("hasUnsavedEdits: station removed (current shorter than baseline) -> true", () => {
  const baseline = [station("HUB-1", 100, 100), station("BIO-1", 200, 200)];
  const current = [station("HUB-1", 100, 100)];
  assertTrue(hasUnsavedEdits(current, baseline, [], []), "removing a station is an edit");
});

test("hasUnsavedEdits: station added (current longer than baseline) -> true", () => {
  const baseline = [station("HUB-1", 100, 100)];
  const current = [station("HUB-1", 100, 100), station("BIO-1", 200, 200)];
  assertTrue(hasUnsavedEdits(current, baseline, [], []), "adding a station is an edit");
});

test("hasUnsavedEdits: station id substituted (same count) -> true", () => {
  const baseline = [station("HUB-1", 100, 100), station("BIO-1", 200, 200)];
  // Same length, but one id swapped
  const current = [station("HUB-1", 100, 100), { ...station("NEW-1", 300, 300), nation: bioNation }];
  assertTrue(hasUnsavedEdits(current, baseline, [], []), "substituting a new id should register");
});

test("hasUnsavedEdits: station moved -> true", () => {
  const baseline = [station("HUB-1", 100, 100)];
  const current = [station("HUB-1", 150, 100)];
  assertTrue(hasUnsavedEdits(current, baseline, [], []), "x-coordinate change should register");
});

// Pin station y-coordinate is checked. Removing the y-check on stations would let an unmoved-x but moved-y station read as no-edit.
test("hasUnsavedEdits: station y moved (x unchanged) -> true", () => {
  const baseline = [station("HUB-1", 100, 100)];
  const current = [station("HUB-1", 100, 175)];
  assertTrue(hasUnsavedEdits(current, baseline, [], []), "y-coordinate change should register");
});

test("hasUnsavedEdits: nebula added -> true", () => {
  const baselineStations: PlacedStation[] = [];
  const baselineNebulas: Nebula[] = [];
  const currentNebulas = [nebula("neb-new", 100, 100)];
  assertTrue(
    hasUnsavedEdits([], baselineStations, currentNebulas, baselineNebulas),
    "new nebula should register",
  );
});

test("hasUnsavedEdits: nebula removed (current shorter than baseline) -> true", () => {
  const baseline = [nebula("neb-a", 0, 0), nebula("neb-b", 50, 50)];
  const current = [nebula("neb-a", 0, 0)];
  assertTrue(hasUnsavedEdits([], [], current, baseline), "removing a nebula is an edit");
});

test("hasUnsavedEdits: nebula moved -> true", () => {
  const baseline = [nebula("neb-a", 0, 0)];
  const current = [nebula("neb-a", 50, 0)];
  assertTrue(hasUnsavedEdits([], [], current, baseline), "nebula x change should register");
});

// Pin nebula y-coordinate is checked. Removing the y-check on nebulas would let an unmoved-x but moved-y nebula read as no-edit.
test("hasUnsavedEdits: nebula y moved (x unchanged) -> true", () => {
  const baseline = [nebula("neb-a", 0, 0)];
  const current = [nebula("neb-a", 0, 75)];
  assertTrue(hasUnsavedEdits([], [], current, baseline), "nebula y change should register");
});

test("hasUnsavedEdits: nebula texture swapped -> true", () => {
  const baseline = [nebula("neb-a", 0, 0)];
  const current = [nebula("neb-b", 0, 0)];
  assertTrue(hasUnsavedEdits([], [], current, baseline), "nebula texture change should register");
});

test("hasUnsavedEdits: empty/empty returns false", () => {
  assertTrue(!hasUnsavedEdits([], [], [], []), "nothing vs nothing is not an edit");
});

// Pin nebula iteration walks every index, not just index 0. Replacing the iterator with a fixed `0` would let a later-index change slip past.
test("hasUnsavedEdits: nebula at index >= 1 changed (index 0 unchanged) -> true", () => {
  const baseline = [nebula("neb-a", 0, 0), nebula("neb-b", 50, 50), nebula("neb-c", 200, 200)];
  const current = [nebula("neb-a", 0, 0), nebula("neb-b", 50, 50), nebula("neb-c", 999, 200)];
  assertTrue(hasUnsavedEdits([], [], current, baseline), "change at later index should register");
});
