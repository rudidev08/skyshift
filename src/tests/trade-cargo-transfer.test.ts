import { test, assertEqual } from "./test-utils.ts";
import { createInventorySlot as createSlot } from "../sim-station.ts";
import { effectiveSpace } from "../sim-trade-decision.ts";
import {
  withdrawCargo,
  depositCargo,
  processDepositAction,
} from "../sim-trade-queue.ts";
import {
  addReservation,
  fulfillReservation,
  clearReservations,
} from "../sim-trade-reservation.ts";
import { ice } from "../../data/wares.ts";
import { makeMockStation, makeMockTradeShip, withMockManager } from "./trade-test-fixtures.ts";

// --- Cargo transfer ---

test("depositCargo clamps to max", () => {
  withMockManager(() => {
    const iceSlot = createSlot(ice, 480, 500);

    depositCargo(iceSlot, 50);

    assertEqual(iceSlot.current, 500, "clamped to max");
  });
});

test("depositCargo does nothing when slot is already over capacity", () => {
  // Pin Math.max(0, slot.max - slot.current). Without the clamp, an overfilled
  // slot (e.g. station max shrank after a reservation) would deliver a negative
  // amount and silently drain the slot below current — known-bug shape.
  withMockManager(() => {
    const iceSlot = createSlot(ice, 510, 500);

    const delivered = depositCargo(iceSlot, 100);

    assertEqual(delivered, 0, "no delivery when over capacity");
    assertEqual(iceSlot.current, 510, "current untouched, not driven negative");
  });
});

test("full deposit releases only the delivered amount, not the original reservation amount", () => {
  // Pin `delivered < amount` (strict, not <=). Ship reserved 100 but only carries
  // 60 (lost cargo upstream); destination has plenty of room so all 60 deposit.
  // delivered === amount (60 === 60) — must take the non-shrunk-capacity branch
  // and release only 60. A `< → <=` mutation would release the full 100, leaving
  // a phantom -40 incoming on the (still-100-reserved) slot.
  withMockManager((manager) => {
    const ship = makeMockTradeShip();
    const destinationSlot = createSlot(ice, 0, 500);
    const destinationStation = makeMockStation([destinationSlot]);
    ship.cargoAmountByWareId = new Map([[ice.id, 60]]);

    addReservation(ship, { station: destinationStation, wareId: "ice", amount: 100, cargoDirection: "incoming" });

    processDepositAction(ship, {
      type: "cargo-deposit",
      station: destinationStation,
      wareId: "ice",
      amount: 100,
    }, manager);

    assertEqual(destinationSlot.current, 60, "60 delivered");
    // 100 reserved minus 60 released = 40 still claimed for the unfulfilled portion.
    assertEqual(destinationSlot.reservedIncoming, 40, "only delivered amount released, residual claim left");
  });
});

// --- Bug scenarios ---

test("partial withdrawal should not leak destination reservation", () => {
  // Ship reserves 100 outgoing/incoming, but source only has 60 at withdrawal.
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const sourceSlot = createSlot(ice, 60, 500);
    const destinationSlot = createSlot(ice, 50, 500);
    const sourceStation = makeMockStation([sourceSlot]);
    const destinationStation = makeMockStation([destinationSlot]);

    // Reserve the full planned trade amount.
    addReservation(ship, { station: sourceStation, wareId: "ice", amount: 100, cargoDirection: "outgoing" });
    addReservation(ship, { station: destinationStation, wareId: "ice", amount: 100, cargoDirection: "incoming" });

    // Withdraw clamps to the 60 actually present (production ate the rest).
    const taken = withdrawCargo(sourceSlot, 100);
    assertEqual(taken, 60, "withdraw clamped to 60");
    ship.cargoAmountByWareId = taken > 0 ? new Map([[ice.id, taken]]) : new Map();
    fulfillReservation(ship, { station: sourceStation, wareId: "ice", amount: taken, cargoDirection: "outgoing" });

    // Deposit the actual cargo at destination.
    depositCargo(destinationSlot, taken);
    fulfillReservation(ship, { station: destinationStation, wareId: "ice", amount: taken, cargoDirection: "incoming" });
    ship.cargoAmountByWareId = new Map();

    // Mirrors the resetTradeState call at trip end in sim-trade-queue.ts.
    clearReservations(ship);

    // Both slots should hold zero reservations after the full cycle.
    assertEqual(sourceSlot.reservedOutgoing, 0, "source reservation cleaned up");
    assertEqual(destinationSlot.reservedIncoming, 0, "dest reservation cleaned up");
    // And the inventory should match the reduced amount.
    assertEqual(sourceSlot.current, 0, "source drained to 0");
    assertEqual(destinationSlot.current, 110, "dest received 60");
  });
});

test("zero withdrawal should not permanently block slot", () => {
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const sourceSlot = createSlot(ice, 0, 500);
    const destinationSlot = createSlot(ice, 50, 500);
    const sourceStation = makeMockStation([sourceSlot]);
    const destinationStation = makeMockStation([destinationSlot]);

    addReservation(ship, { station: sourceStation, wareId: "ice", amount: 100, cargoDirection: "outgoing" });
    addReservation(ship, { station: destinationStation, wareId: "ice", amount: 100, cargoDirection: "incoming" });

    const taken = withdrawCargo(sourceSlot, 100);
    assertEqual(taken, 0, "nothing to take");
    ship.cargoAmountByWareId = taken > 0 ? new Map([[ice.id, taken]]) : new Map();
    fulfillReservation(ship, { station: sourceStation, wareId: "ice", amount: taken, cargoDirection: "outgoing" });

    depositCargo(destinationSlot, taken);
    fulfillReservation(ship, { station: destinationStation, wareId: "ice", amount: taken, cargoDirection: "incoming" });
    ship.cargoAmountByWareId = new Map();

    clearReservations(ship);

    assertEqual(sourceSlot.reservedOutgoing, 0, "source not permanently blocked");
    assertEqual(destinationSlot.reservedIncoming, 0, "dest not permanently blocked");
  });
});

// Between a partial withdrawal and clearReservations, other ships see
// inflated reservation counters — these tests check intermediate state.

test("partial withdrawal leaves phantom reservations visible to other ships", () => {
  // Ship A reserves 100 from source + 100 incoming at dest, but source
  // only has 60 (economy bug ate reserved cargo).
  withMockManager(() => {
    const shipA = makeMockTradeShip();
    const sourceSlot = createSlot(ice, 60, 500);
    const destinationSlot = createSlot(ice, 50, 500);
    const sourceStation = makeMockStation([sourceSlot]);
    const destinationStation = makeMockStation([destinationSlot]);

    addReservation(shipA, { station: sourceStation, wareId: "ice", amount: 100, cargoDirection: "outgoing" });
    addReservation(shipA, { station: destinationStation, wareId: "ice", amount: 100, cargoDirection: "incoming" });

    // Ship A withdraws only 60.
    const taken = withdrawCargo(sourceSlot, 100);
    shipA.cargoAmountByWareId = taken > 0 ? new Map([[ice.id, taken]]) : new Map();
    fulfillReservation(shipA, { station: sourceStation, wareId: "ice", amount: taken, cargoDirection: "outgoing" });

    // Intermediate state — ship A is in flight, not deposited yet.
    // Dest: 50 current, 100 phantom incoming → effectiveSpace = 350. Only 60
    // will arrive, so real space is 390 — ship B sees 40 less than available.
    assertEqual(effectiveSpace(destinationSlot), 350, "dest space with phantom reservation");

    // After the trade completes and clears, real space should be higher.
    depositCargo(destinationSlot, taken);
    fulfillReservation(shipA, { station: destinationStation, wareId: "ice", amount: taken, cargoDirection: "incoming" });
    shipA.cargoAmountByWareId = new Map();
    clearReservations(shipA);
    assertEqual(effectiveSpace(destinationSlot), 390, "dest space after cleanup");
  });
});
