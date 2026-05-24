import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { createInventorySlot } from "../sim-station.ts";
import { EconomyTimer, tickEconomy, staggerStationTicks } from "../sim-economy.ts";
import { economyConfig } from "../../data/economy-config.ts";
import { ice, water, food, medicine, provisions } from "../../data/wares.ts";
import type { InventorySlot, Station } from "../sim-station.ts";
import type { WareId } from "../../data/ware-types.ts";
import { makeStationWithProduces } from "./factories.ts";

// --- Fixtures ---

function createTestStation(produces: WareId[], inventory: InventorySlot[], sizeMultiplier = 1): Station {
  // Pin sizeMultiplier to 1 — single-batch production math (8 ice → 4 water)
  // shouldn't be scaled by the factory's size-derived default.
  return makeStationWithProduces(produces, { inventory, sizeMultiplier });
}

/** Force exactly one production tick by resetting the per-station stagger and a fresh timer. */
function tickOnce(station: Station) {
  const timer = new EconomyTimer();
  station.secondsSinceLastTick = 0;
  tickEconomy([station], timer, economyConfig.simulationIntervalSeconds);
}

// --- Tests ---

test("production consumes inputs and produces output", () => {
  // Water: costs 8 ice, produces 4 water
  const iceSlot = createInventorySlot(ice, 100, 500);
  const waterSlot = createInventorySlot(water, 0, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);

  tickOnce(station);

  assertEqual(iceSlot.current, 92, "ice after production");
  assertEqual(waterSlot.current, 4, "water after production");
  assertTrue(station.didProduceLastTick, "station.didProduceLastTick should be true");
});

test("production stops when output storage is full", () => {
  const iceSlot = createInventorySlot(ice, 100, 500);
  const waterSlot = createInventorySlot(water, 500, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);

  tickOnce(station);

  assertEqual(iceSlot.current, 100, "ice unchanged");
  assertEqual(waterSlot.current, 500, "water unchanged");
  // didProduceLastTick must reflect the skipped tick — the trade-simulation
  // report reads this to flag stalled producers, so it has to flip to false
  // when nothing fired (see report-trade-simulation.ts).
  assertEqual(station.didProduceLastTick, false, "didProduceLastTick should be false when output is full");
});

test("production stops when inputs are insufficient", () => {
  // Water needs 8 ice, station only has 3
  const iceSlot = createInventorySlot(ice, 3, 500);
  const waterSlot = createInventorySlot(water, 0, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);

  tickOnce(station);

  assertEqual(iceSlot.current, 3, "ice unchanged");
  assertEqual(waterSlot.current, 0, "water unchanged");
  assertEqual(
    station.didProduceLastTick,
    false,
    "didProduceLastTick should be false when inputs are insufficient",
  );
});

test("production fires when input quantity exactly matches cost", () => {
  // Boundary: 8 ice available, 8 ice cost — the < check must accept equality
  // (otherwise stations near the edge of their input buffer would stall).
  const iceSlot = createInventorySlot(ice, 8, 500);
  const waterSlot = createInventorySlot(water, 0, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);

  tickOnce(station);

  assertEqual(iceSlot.current, 0, "ice fully consumed");
  assertEqual(waterSlot.current, 4, "water produced");
  assertTrue(station.didProduceLastTick, "didProduceLastTick should be true at the equality boundary");
});

test("production fires when reserved leaves cost exactly available", () => {
  // 100 ice, 92 reserved → 8 effective. Cost is 8. Production must still
  // fire — the reservation accounting uses < not <=.
  const iceSlot = createInventorySlot(ice, 100, 500);
  iceSlot.reservedOutgoing = 92;
  const waterSlot = createInventorySlot(water, 0, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);

  tickOnce(station);

  assertEqual(iceSlot.current, 92, "ice reduced to reservation level");
  assertEqual(waterSlot.current, 4, "water produced from exact-fit input");
});

test("station multiplier scales production costs and output", () => {
  // Multiplier 2: costs 16 ice, produces 8 water
  const iceSlot = createInventorySlot(ice, 100, 500);
  const waterSlot = createInventorySlot(water, 0, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot], 2);

  tickOnce(station);

  assertEqual(iceSlot.current, 84, "ice after scaled production");
  assertEqual(waterSlot.current, 8, "water after scaled production");
});

test("output is clamped to max storage", () => {
  // Water slot almost full: only 2 space left, but production wants to add 4
  const iceSlot = createInventorySlot(ice, 100, 500);
  const waterSlot = createInventorySlot(water, 498, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);

  tickOnce(station);

  // Production fires (output < max), but result is clamped to max
  assertEqual(iceSlot.current, 92, "ice consumed");
  assertEqual(waterSlot.current, 500, "water clamped to max");
});

test("provisions producer consumes food/medicine and emits provisions each tick", () => {
  // Provisions producer (productionOutput 1, costs 1 food + 1 medicine) — both
  // inputs should be consumed AND the provisions output slot filled each tick.
  const foodSlot = createInventorySlot(food, 50, 500);
  const medicineSlot = createInventorySlot(medicine, 50, 500);
  const provisionsSlot = createInventorySlot(provisions, 0, 500);
  const station = createTestStation(["provisions"], [foodSlot, medicineSlot, provisionsSlot]);

  tickOnce(station);

  assertEqual(foodSlot.current, 49, "food consumed by provisions producer");
  assertEqual(medicineSlot.current, 49, "medicine consumed by provisions producer");
  assertEqual(provisionsSlot.current, 1, "provisions produced");
  assertTrue(station.didProduceLastTick, "station.didProduceLastTick should be true");
});

test("production should not consume cargo reserved for ship pickup", () => {
  // 100 ice in stock, but 95 reserved for a ship to pick up.
  // Only 5 effective ice available — not enough for the 8 ice cost.
  const iceSlot = createInventorySlot(ice, 100, 500);
  iceSlot.reservedOutgoing = 95;
  const waterSlot = createInventorySlot(water, 0, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);

  tickOnce(station);

  // Correct behavior: production should see only 5 available and skip
  assertEqual(iceSlot.current, 100, "ice should be untouched when reserved");
  assertEqual(waterSlot.current, 0, "water should not be produced");
});

test("staggerStationTicks spreads first ticks across one interval", () => {
  // Three stations should land at offsets 0, -1/3, -2/3 of the interval.
  const interval = economyConfig.simulationIntervalSeconds;
  const stations = [
    makeStationWithProduces(["water"]),
    makeStationWithProduces(["water"]),
    makeStationWithProduces(["water"]),
  ];
  // Pre-seed every station with a non-zero sentinel so the assertion that
  // the first station ends at 0 actually proves the loop visited i=0 (not
  // that it skipped it and left a default 0 in place).
  for (const station of stations) station.secondsSinceLastTick = 99;

  staggerStationTicks(stations);

  assertEqual(stations[0].secondsSinceLastTick, 0, "first station starts at 0");
  assertEqual(
    stations[1].secondsSinceLastTick,
    -((interval * 1) / 3),
    "second station offset by -1/3 interval",
  );
  assertEqual(
    stations[2].secondsSinceLastTick,
    -((interval * 2) / 3),
    "third station offset by -2/3 interval",
  );
});

test("EconomyTimer.reset zeroes both tick counter and sub-tick accumulator", () => {
  // Pin both fields zero out. Mutating either initializer (tick = 1, or
  // skipping the secondsSinceLastTick assignment) would let stale state
  // bleed into a fresh game — the next sub-interval frame would either
  // start at the wrong tick number or fire production immediately.
  const timer = new EconomyTimer();
  tickEconomy([], timer, economyConfig.simulationIntervalSeconds + 0.1);
  assertTrue(timer.tickCount > 0, "precondition: timer advanced before reset");

  timer.reset();

  assertEqual(timer.tickCount, 0, "tick reset to 0");
  // No public getter for secondsSinceLastTick, so probe via behavior:
  // a feed of (interval - 0.1) should NOT cross the threshold from a true
  // zero state. If reset left a non-zero accumulator, it would fire early.
  tickEconomy([], timer, economyConfig.simulationIntervalSeconds - 0.1);
  assertEqual(timer.tickCount, 0, "sub-tick accumulator reset to 0 (no early tick)");
});

test("EconomyTimer advances one tick per accumulated interval", () => {
  // Drive the timer with three sub-interval steps. With simulationIntervalSeconds = 0.5,
  // two 0.25s deltas equal one tick; the third 0.25s leaves the counter
  // unchanged because pending hasn't crossed the next interval boundary yet.
  const timer = new EconomyTimer();
  assertEqual(timer.tickCount, 0, "tick counter starts at 0");

  tickEconomy([], timer, 0.25);
  assertEqual(timer.tickCount, 0, "no tick yet after 0.25s");

  tickEconomy([], timer, 0.25);
  assertEqual(timer.tickCount, 1, "tick fires at 0.5s accumulated");

  tickEconomy([], timer, 0.25);
  assertEqual(timer.tickCount, 1, "no second tick after partial advance");

  tickEconomy([], timer, 0.25);
  assertEqual(timer.tickCount, 2, "second tick at 1.0s accumulated");
});

test("station tick reset enables steady cadence across sub-interval frames", () => {
  // A bug that adds (instead of subtracts) the interval after a tick would
  // let secondsSinceLastTick grow unbounded — the next sub-interval frame would
  // still satisfy the threshold and fire production again. Three 0.25s
  // frames should produce exactly one batch (8 ice → 4 water), not two.
  const timer = new EconomyTimer();
  const iceSlot = createInventorySlot(ice, 100, 500);
  const waterSlot = createInventorySlot(water, 0, 500);
  const station = createTestStation(["water"], [waterSlot, iceSlot]);
  station.secondsSinceLastTick = 0;

  tickEconomy([station], timer, 0.25);
  tickEconomy([station], timer, 0.25);
  tickEconomy([station], timer, 0.25);

  assertEqual(iceSlot.current, 92, "exactly one batch consumed across three sub-interval frames");
  assertEqual(waterSlot.current, 4, "exactly one batch produced");
});
