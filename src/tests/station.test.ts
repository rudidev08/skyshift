import { test, assertEqual, assertTrue, assertNotUndefined, assertThrows } from "./test-utils.ts";
import {
  getStationRates,
  createStation,
  getInventorySlot,
  getAllInventorySlots,
  reserveIncoming,
  reserveOutgoing,
  releaseIncoming,
  releaseOutgoing,
  canStationTrade,
  isStationProducing,
  isStationUnderConstruction,
} from "../sim-station.ts";
import { stationCodeNameLabel, getStationTemplate } from "../sim-station-template.ts";
import type { StationPlacement, StationSize, StationTypeId } from "../../data/station-types.ts";
import type { Station } from "../sim-station-types.ts";
import type { WareId } from "../../data/ware-types.ts";
import { makeStationPlacement, makeStation } from "./factories.ts";

function makeTestStation(produces: WareId[], size: StationSize = "S") {
  return makeStation({ produces, size });
}

function makeTestStationPlacement(stationTypeId: StationTypeId, size: StationSize = "S"): StationPlacement {
  return makeStationPlacement({
    name: "TestStation",
    stationTypeId,
    size,
    nation: { codeName: "TST", name: "Testers", color: "#fff" } as Station["nation"],
  });
}

test("getStationRates: provisions producer consumes food/medicine and outputs provisions", () => {
  const station = makeTestStation(["provisions"]);

  const rates = getStationRates(station);

  assertEqual(rates.production.get("provisions") ?? -1, 1, "provisions production rate");
  assertTrue(rates.consumption.size > 0, "provisions still consumes inputs");
  assertEqual(rates.consumption.get("food") ?? -1, 1, "food consumption rate");
  assertEqual(rates.consumption.get("medicine") ?? -1, 1, "medicine consumption rate");
});

test("getStationRates: hulls producer consumes tech and outputs hulls", () => {
  const station = makeTestStation(["hulls"]);

  const rates = getStationRates(station);

  assertEqual(rates.production.get("hulls") ?? -1, 1, "hulls production rate");
  assertEqual(rates.consumption.get("tech") ?? -1, 4, "tech consumption for hulls");
});

test("getStationRates: mine produces both ice and mineral with separate rates", () => {
  // Mine produces ice (output 8) and mineral (output 8), both raw with no inputs
  const station = makeTestStation(["ice", "mineral"]);

  const rates = getStationRates(station);

  assertEqual(rates.production.get("ice") ?? -1, 8, "ice production");
  assertEqual(rates.production.get("mineral") ?? -1, 8, "mineral production");
  assertEqual(rates.consumption.size, 0, "raw wares have no consumption");
});

test("getStationRates: size L multiplier triples base rates", () => {
  // Large station multiplier is 3 — all rates should be tripled
  const station = makeTestStation(["water"], "L");

  const rates = getStationRates(station);

  // Water: base output 4, cost 8 ice. Large = x3.
  assertEqual(rates.production.get("water") ?? -1, 12, "water production at size L");
  assertEqual(rates.consumption.get("ice") ?? -1, 24, "ice consumption at size L");
});

test("getStationRates: size M doubles provisions producer rates", () => {
  // Medium provisions station: produces 1 provisions + consumes 1 food + 1 medicine, multiplied by 2
  const station = makeTestStation(["provisions"], "M");

  const rates = getStationRates(station);

  assertEqual(rates.production.get("provisions") ?? -1, 2, "provisions production at size M");
  assertEqual(rates.consumption.get("food") ?? -1, 2, "food consumption at size M");
  assertEqual(rates.consumption.get("medicine") ?? -1, 2, "medicine consumption at size M");
});

test("getStationRates: station type with empty produces list has zero rates", () => {
  // Edge case: a station type that produces nothing at all
  const station = makeTestStation([]);

  const rates = getStationRates(station);

  assertEqual(rates.production.size, 0, "no production");
  assertEqual(rates.consumption.size, 0, "no consumption");
});

test("getStationRates: sink ware with output 0 is excluded from production", () => {
  // Passengers has productionOutput 0 — the only sink ware in the data set.
  // The `productionOutput > 0` filter in getStationRates pins this; relaxing
  // it to >= 0 would falsely list passengers as a produced ware.
  const station = makeTestStation(["passengers"]);

  const rates = getStationRates(station);

  assertEqual(rates.production.size, 0, "sink wares should not appear as production");
  assertEqual(rates.production.has("passengers"), false, "passengers must not be in production map");
});

test("createStation: mine has exactly two output slots for ice and mineral with no duplicates", () => {
  // Mine produces ice and mineral, both raw (no inputs).
  // Should have exactly 2 inventory slots, one per output.
  const mapStation = makeTestStationPlacement("mine", "S");
  const station = createStation(mapStation);

  const slots = getAllInventorySlots(station);
  assertEqual(slots.length, 2, "mine should have 2 inventory slots");

  // Read order off the live inventory (no .sort() here) so the canonical
  // wares-order sort inside createStation is what we're actually pinning.
  assertEqual(slots[0].ware.id, "ice", "ice should sort before mineral in canonical wares order");
  assertEqual(slots[1].ware.id, "mineral", "mineral follows ice in canonical wares order");
});

test("createStation: habitat inventory is sorted in canonical wares order", () => {
  // Habitat produces provisions; produces-iteration order would push
  // provisions first, then food + medicine inputs. Canonical wares order
  // (food, medicine, provisions) only matches if createStation re-sorts.
  const mapStation = makeTestStationPlacement("habitat", "S");
  const station = createStation(mapStation);

  const wareIds = getAllInventorySlots(station).map((slot) => slot.ware.id);
  assertEqual(wareIds[0], "food", "food sorts first");
  assertEqual(wareIds[1], "medicine", "medicine sorts after food");
  assertEqual(wareIds[2], "provisions", "provisions sorts last among habitat wares");
});

// Water output storage = productionOutput(4) × storageTicks(7200) = 28800.
// Multiplier scales storage and the half-fill seed (both floored).
// S=1 is the identity case (no scaling); M and L exercise the multiplier branch.
const sizeMultipliers: Array<[StationSize, number]> = [
  ["M", 2],
  ["L", 3],
];
for (const [size, multiplier] of sizeMultipliers) {
  test(`createStation: water storage at size ${size} is floor(28800 * ${multiplier})`, () => {
    const mapStation = makeTestStationPlacement("water-processing", size);
    const station = createStation(mapStation);
    const waterSlot = assertNotUndefined(getInventorySlot(station, "water"), "water slot");
    assertEqual(waterSlot.max, Math.floor(28800 * multiplier), `water max at size ${size}`);
  });
}

test("createStation: ice input storage scales with multiplier (size L)", () => {
  // Ice input storage = cost(8) × storageTicks(7200) = 57600. Output-slot
  // test above doesn't exercise input slots, so keep this one for the
  // input-side formula.
  const mapStation = makeTestStationPlacement("water-processing", "L");
  const station = createStation(mapStation);
  const iceSlot = assertNotUndefined(getInventorySlot(station, "ice"), "ice input slot");
  assertEqual(iceSlot.max, Math.floor(57600 * 3), "ice input max at size L");
});

test("createStation: initial current is half of max (floored)", () => {
  // Stations start at 50% fill — verify the floor(max * 0.5) formula
  const mapStation = makeTestStationPlacement("water-processing", "S");
  const station = createStation(mapStation);

  const waterSlot = assertNotUndefined(getInventorySlot(station, "water"), "water slot");
  // max = floor(28800 * 1) = 28800, current = floor(28800 * 0.5) = 14400
  assertEqual(waterSlot.current, Math.floor(waterSlot.max * 0.5), "water starts at half fill");

  const iceSlot = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  assertEqual(iceSlot.current, Math.floor(iceSlot.max * 0.5), "ice starts at half fill");
});

test("createStation: shipyard has a hulls output slot plus tech input slot", () => {
  const mapStation = makeTestStationPlacement("shipyard", "M");
  const station = createStation(mapStation);

  assertNotUndefined(getInventorySlot(station, "hulls"), "hulls slot");

  const techSlot = assertNotUndefined(getInventorySlot(station, "tech"), "tech slot");
  assertEqual(techSlot.max, Math.floor(28800 * 2), "tech input storage scaled by M multiplier");
});

test("getInventorySlot returns the same slot instance as getAllInventorySlots", () => {
  // Indexed lookup and iteration view must return identical slot refs —
  // a mismatch would make mutations through one path invisible via the
  // other and silently break economy code.
  const mapStation = makeTestStationPlacement("medical-lab", "L");
  const station = createStation(mapStation);

  for (const slot of getAllInventorySlots(station)) {
    const mappedSlot = getInventorySlot(station, slot.ware.id);
    assertTrue(mappedSlot !== undefined, `${slot.ware.id} should resolve via getInventorySlot`);
    assertTrue(mappedSlot === slot, `${slot.ware.id} accessors should return the same slot instance`);
  }
});

test("createStation: defaults state to producing when placement omits it", () => {
  // Pin the assembleStation default. Trade routing and rate math gate off
  // `state === "producing"`; flipping the fallback to "claimed" would silently
  // suspend trade for every freshly-created station.
  const mapStation = makeTestStationPlacement("mine", "S");
  const station = createStation(mapStation);
  assertEqual(station.state, "producing", "default state");
});

test("createStation: reservations initialized to zero on all slots", () => {
  // Nonzero reservations at startup would let trade ships see phantom availability.
  const mapStation = makeTestStationPlacement("mine", "M");
  const station = createStation(mapStation);

  for (const slot of getAllInventorySlots(station)) {
    assertEqual(slot.reservedIncoming, 0, `${slot.ware.id} reservedIncoming should start at 0`);
    assertEqual(slot.reservedOutgoing, 0, `${slot.ware.id} reservedOutgoing should start at 0`);
  }
});

test("reserveIncoming and releaseIncoming round-trip cleanly", () => {
  const station = createStation(makeTestStationPlacement("water-processing"));
  const iceSlot = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");
  assertEqual(iceSlot.reservedIncoming, 0, "starts at 0");

  reserveIncoming(station, "ice", 50);
  assertEqual(iceSlot.reservedIncoming, 50, "increments by amount");
  reserveIncoming(station, "ice", 30);
  assertEqual(iceSlot.reservedIncoming, 80, "accumulates across calls");

  releaseIncoming(station, "ice", 50);
  assertEqual(iceSlot.reservedIncoming, 30, "release subtracts amount");
});

test("releaseIncoming clamps reservedIncoming to zero on over-release", () => {
  // Pins the Math.max(0, ...) clamp — without it, an over-release would make
  // reservedIncoming go negative and inflate effective availability for trade.
  const station = createStation(makeTestStationPlacement("water-processing"));
  const iceSlot = assertNotUndefined(getInventorySlot(station, "ice"), "ice slot");

  reserveIncoming(station, "ice", 10);
  releaseIncoming(station, "ice", 100);

  assertEqual(iceSlot.reservedIncoming, 0, "should clamp at 0, not go negative");
});

test("reserveOutgoing and releaseOutgoing round-trip cleanly", () => {
  // Pin reserveOutgoing's side effect. Skipping `slot.reservedOutgoing += amount`
  // would leave reservedOutgoing at 0 throughout, hiding stale availability for
  // outbound trade pickups; the over-release test alone can't see that.
  const station = createStation(makeTestStationPlacement("water-processing"));
  const waterSlot = assertNotUndefined(getInventorySlot(station, "water"), "water slot");
  assertEqual(waterSlot.reservedOutgoing, 0, "starts at 0");

  reserveOutgoing(station, "water", 40);
  assertEqual(waterSlot.reservedOutgoing, 40, "increments by amount");
  reserveOutgoing(station, "water", 25);
  assertEqual(waterSlot.reservedOutgoing, 65, "accumulates across calls");

  releaseOutgoing(station, "water", 40);
  assertEqual(waterSlot.reservedOutgoing, 25, "release subtracts amount");
});

test("releaseIncoming and releaseOutgoing no-op when the slot is missing", () => {
  // Pin the missing-slot guard. Trade ships may release against a station
  // whose slot was demolished; dropping the `if (!slot) return` would throw
  // mid-tick instead of silently completing the release.
  const station = createStation(makeTestStationPlacement("water-processing"));
  releaseIncoming(station, "tech", 10);
  releaseOutgoing(station, "tech", 10);
  // No assertion on the (absent) slot — the contract is "does not throw."
});

test("isStationProducing and isStationUnderConstruction match only their own state", () => {
  // Pin the state predicates. Inverting either's comparison (e.g. `!==` for
  // `===`) would silently flip every UI/economy site that gates off them.
  const station = createStation(makeTestStationPlacement("water-processing"));
  station.state = "producing";
  assertEqual(isStationProducing(station), true, "producing → isProducing");
  assertEqual(isStationUnderConstruction(station), false, "producing → !isUnderConstruction");
  station.state = "building";
  assertEqual(isStationProducing(station), false, "building → !isProducing");
  assertEqual(isStationUnderConstruction(station), true, "building → isUnderConstruction");
  station.state = "claimed";
  assertEqual(isStationProducing(station), false, "claimed → !isProducing");
  assertEqual(isStationUnderConstruction(station), false, "claimed → !isUnderConstruction");
});

test("canStationTrade is true for both producing and building states", () => {
  // Pin both branches of the OR. Construction-site stations need trade routing
  // to deliver inbound provisions/hulls; dropping the "building" branch would
  // freeze every build site mid-construction.
  const station = createStation(makeTestStationPlacement("water-processing"));
  station.state = "producing";
  assertEqual(canStationTrade(station), true, "producing trades");
  station.state = "building";
  assertEqual(canStationTrade(station), true, "building trades");
  station.state = "claimed";
  assertEqual(canStationTrade(station), false, "claimed does not trade");
  station.state = "emigrating";
  assertEqual(canStationTrade(station), false, "emigrating does not trade");
});

test("releaseOutgoing clamps reservedOutgoing to zero on over-release", () => {
  // Pins the Math.max(0, ...) clamp on the outgoing side — symmetric to the
  // incoming clamp test above.
  const station = createStation(makeTestStationPlacement("water-processing"));
  const waterSlot = assertNotUndefined(getInventorySlot(station, "water"), "water slot");

  reserveOutgoing(station, "water", 5);
  releaseOutgoing(station, "water", 50);

  assertEqual(waterSlot.reservedOutgoing, 0, "should clamp at 0, not go negative");
});

test("getStationTemplate throws on an unknown station type id", () => {
  // Pin the registry-lookup throw. The Map is the single boundary that maps
  // string ids to templates; dropping the not-found check would let typo'd
  // ids return undefined and bubble through to consumers as cryptic
  // `cannot read properties of undefined` failures far from the cause.
  assertThrows(
    () => getStationTemplate("nope" as Parameters<typeof getStationTemplate>[0]),
    "Unknown station type",
    "unknown id should be named in the error",
  );
});

test("stationCodeNameLabel formats as '<codeName> <name>' (code first)", () => {
  // Pin the public format. The JSDoc promises e.g. "SKY Drifthollow"; HUD copy
  // (sim-trade-queue, sim-trade-log) embeds the result inline. Swapping the
  // template order would silently flip every "Fly: <from> to <to>" log line.
  const station = makeStation({
    placement: { name: "Drifthollow", nation: { codeName: "SKY" } as Station["nation"] },
  });
  assertEqual(stationCodeNameLabel(station), "SKY Drifthollow", "code first, then name");
});
