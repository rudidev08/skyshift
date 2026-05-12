import { test, assertEqual, assertNotUndefined } from "./test-utils.ts";
import { createStation, getInventorySlot } from "../sim-station.ts";
import { getStationWareLevelHealth } from "../sim-station-health.ts";
import type { StationPlacement, StationSize, StationTypeId } from "../../data/station-types.ts";
import type { Station } from "../sim-station-types.ts";
import { makeStationPlacement } from "./factories.ts";

function makeTestStationPlacement(stationTypeId: StationTypeId, size: StationSize = "S"): StationPlacement {
  return makeStationPlacement({
    name: "TestStation",
    stationTypeId,
    size,
    nation: { codeName: "TST", name: "Testers", color: "#fff" } as Station["nation"],
  });
}

test("getStationWareLevelHealth: ok when all inputs above 25%", () => {
  // water-processing consumes ice. createStation seeds slots at 50% fill.
  const station = createStation(makeTestStationPlacement("water-processing"));
  assertEqual(getStationWareLevelHealth(station), "ok", "50% fill is ok");
});

test("getStationWareLevelHealth: warn when an input is below 25% but >0", () => {
  const station = createStation(makeTestStationPlacement("water-processing"));
  const ice = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  ice.current = Math.floor(ice.max * 0.1);
  assertEqual(getStationWareLevelHealth(station), "warn", "10% fill is warn");
});

test("getStationWareLevelHealth: ok at exactly 25% fill (warn uses strict <)", () => {
  // Pins the warn threshold's `<` (not `<=`) — a slot exactly at 25% must
  // stay ok, not flip to warn.
  const station = createStation(makeTestStationPlacement("water-processing"));
  const ice = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  ice.current = ice.max * 0.25;
  assertEqual(getStationWareLevelHealth(station), "ok", "exact 25% should be ok");
});

test("getStationWareLevelHealth: ok in the 25-50% band", () => {
  // Pins the literal threshold at 0.25. Anything from 25% up to 50% must
  // stay ok — moving the constant to 0.5 would misreport this band as warn.
  const station = createStation(makeTestStationPlacement("water-processing"));
  const ice = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  ice.current = Math.floor(ice.max * 0.4);
  assertEqual(getStationWareLevelHealth(station), "ok", "40% fill is ok");
});

test("getStationWareLevelHealth: bad when any input is 0", () => {
  const station = createStation(makeTestStationPlacement("water-processing"));
  const ice = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  ice.current = 0;
  assertEqual(getStationWareLevelHealth(station), "bad", "empty input is bad");
});

test("getStationWareLevelHealth: ok when station has no required inputs", () => {
  // mine produces ice and mineral, both raw (no productionInputs).
  const station = createStation(makeTestStationPlacement("mine"));
  assertEqual(getStationWareLevelHealth(station), "ok", "no inputs means ok");
});
