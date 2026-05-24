import { test, assertEqual, assertNotUndefined } from "./test-utils.ts";
import { createStation, getInventorySlot } from "../sim-station.ts";
import { getStationWareLevelHealth } from "../sim-station-health.ts";
import { makePlacedStationWithType } from "./factories.ts";

test("getStationWareLevelHealth: ok when all inputs above 25%", () => {
  // water-processing consumes ice. createStation seeds slots at 50% fill.
  const station = createStation(makePlacedStationWithType("water-processing"));
  assertEqual(getStationWareLevelHealth(station), "ok", "50% fill is ok");
});

test("getStationWareLevelHealth: warn when an input is below 25% but >0", () => {
  const station = createStation(makePlacedStationWithType("water-processing"));
  const ice = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  ice.current = Math.floor(ice.max * 0.1);
  assertEqual(getStationWareLevelHealth(station), "warn", "10% fill is warn");
});

test("getStationWareLevelHealth: ok at exactly 25% fill (warn uses strict <)", () => {
  // Pins the warn threshold's `<` (not `<=`) — a slot exactly at 25% must
  // stay ok, not flip to warn.
  const station = createStation(makePlacedStationWithType("water-processing"));
  const ice = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  ice.current = ice.max * 0.25;
  assertEqual(getStationWareLevelHealth(station), "ok", "exact 25% should be ok");
});

test("getStationWareLevelHealth: bad when any input is 0", () => {
  const station = createStation(makePlacedStationWithType("water-processing"));
  const ice = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  ice.current = 0;
  assertEqual(getStationWareLevelHealth(station), "bad", "empty input is bad");
});

test("getStationWareLevelHealth: ok when station has no required inputs", () => {
  // mine produces ice and mineral, both raw (no productionInputs).
  const station = createStation(makePlacedStationWithType("mine"));
  assertEqual(getStationWareLevelHealth(station), "ok", "no inputs means ok");
});
