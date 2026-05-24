import { test, assertEqual } from "./test-utils.ts";
import { createInventorySlot } from "../sim-station.ts";
import { effectiveSpace } from "../sim-trade-decision.ts";
import { withdrawCargo, depositCargo, applyDepositAction } from "../sim-trade-queue.ts";
import { addReservation, fulfillReservation, clearReservations } from "../sim-trade-reservation.ts";
import { ice } from "../../data/wares.ts";
import { loadShipCargo, makeEmptyTradeShip, withMockManager } from "./trade-test-fixtures.ts";

test("depositCargo clamps to max", () => {
  withMockManager(() => {
    const destinationSlot = createInventorySlot(ice, 480, 500);

    depositCargo(destinationSlot, 50);

    assertEqual(destinationSlot.current, 500, "clamped to max");
  });
});

test("depositCargo does nothing when slot is already over capacity", () => {
  // Pin Math.max(0, slot.max - slot.current). Without the clamp, an overfilled
  // slot (e.g. station max shrank after a reservation) would deliver a negative
  // amount and silently drain the slot below current — known-bug shape.
  withMockManager(() => {
    const destinationSlot = createInventorySlot(ice, 510, 500);

    const delivered = depositCargo(destinationSlot, 100);

    assertEqual(delivered, 0, "no delivery when over capacity");
    assertEqual(destinationSlot.current, 510, "current untouched, not driven negative");
  });
});

test("full deposit releases only the delivered amount, not the original reservation amount", () => {
  // Pin `delivered < amount` (strict, not <=). Ship reserved 100 but only carries
  // 60 (lost cargo upstream); destination has plenty of room so all 60 deposit.
  // delivered === amount (60 === 60) — must take the non-shrunk-capacity branch
  // and release only 60. A `< → <=` mutation would release the full 100, leaving
  // a phantom -40 incoming on the (still-100-reserved) slot.
  withMockManager(({ manager, makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const destinationSlot = createInventorySlot(ice, 0, 500);
    const destinationStation = makeRegisteredStation([destinationSlot]);
    loadShipCargo(ship, ice.id, 60);

    addReservation(ship, {
      station: destinationStation,
      wareId: "ice",
      amount: 100,
      cargoDirection: "incoming",
    });

    applyDepositAction(
      ship,
      {
        type: "cargo-deposit",
        station: destinationStation,
        wareId: "ice",
        amount: 100,
      },
      manager,
    );

    assertEqual(destinationSlot.current, 60, "60 delivered");
    // 100 reserved minus 60 released = 40 still claimed for the unfulfilled portion.
    assertEqual(destinationSlot.reservedIncoming, 40, "only delivered amount released, residual claim left");
  });
});

test("partial withdrawal should not leak destination reservation", () => {
  // Ship reserves 100 outgoing/incoming, but source only has 60 at withdrawal.
  withMockManager(({ makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const sourceSlot = createInventorySlot(ice, 60, 500);
    const destinationSlot = createInventorySlot(ice, 50, 500);
    const sourceStation = makeRegisteredStation([sourceSlot]);
    const destinationStation = makeRegisteredStation([destinationSlot]);

    // Reserve the full planned trade amount.
    addReservation(ship, {
      station: sourceStation,
      wareId: "ice",
      amount: 100,
      cargoDirection: "outgoing",
    });
    addReservation(ship, {
      station: destinationStation,
      wareId: "ice",
      amount: 100,
      cargoDirection: "incoming",
    });

    // Withdraw clamps to the 60 actually present (production ate the rest).
    const withdrawnAmount = withdrawCargo(sourceSlot, 100);
    assertEqual(withdrawnAmount, 60, "withdraw clamped to 60");
    loadShipCargo(ship, ice.id, withdrawnAmount);
    fulfillReservation(ship, {
      station: sourceStation,
      wareId: "ice",
      amount: withdrawnAmount,
      cargoDirection: "outgoing",
    });

    // Deposit the actual cargo at destination.
    depositCargo(destinationSlot, withdrawnAmount);
    fulfillReservation(ship, {
      station: destinationStation,
      wareId: "ice",
      amount: withdrawnAmount,
      cargoDirection: "incoming",
    });
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

// Between a partial withdrawal and clearReservations, other ships see
// inflated reservation counters — these tests check intermediate state.

test("partial withdrawal leaves phantom reservations visible to other ships", () => {
  // Ship A reserves 100 from source + 100 incoming at dest, but source
  // only has 60 (economy bug ate reserved cargo).
  withMockManager(({ makeRegisteredStation }) => {
    const shipA = makeEmptyTradeShip();
    const sourceSlot = createInventorySlot(ice, 60, 500);
    const destinationSlot = createInventorySlot(ice, 50, 500);
    const sourceStation = makeRegisteredStation([sourceSlot]);
    const destinationStation = makeRegisteredStation([destinationSlot]);

    addReservation(shipA, {
      station: sourceStation,
      wareId: "ice",
      amount: 100,
      cargoDirection: "outgoing",
    });
    addReservation(shipA, {
      station: destinationStation,
      wareId: "ice",
      amount: 100,
      cargoDirection: "incoming",
    });

    // Ship A withdraws only 60.
    const withdrawnAmount = withdrawCargo(sourceSlot, 100);
    loadShipCargo(shipA, ice.id, withdrawnAmount);
    fulfillReservation(shipA, {
      station: sourceStation,
      wareId: "ice",
      amount: withdrawnAmount,
      cargoDirection: "outgoing",
    });

    // Intermediate state — ship A is in flight, not deposited yet.
    // Dest: 50 current, 100 phantom incoming → effectiveSpace = 350. Only 60
    // will arrive, so real space is 390 — ship B sees 40 less than available.
    assertEqual(effectiveSpace(destinationSlot), 350, "dest space with phantom reservation");

    // After the trade completes and clears, real space should be higher.
    depositCargo(destinationSlot, withdrawnAmount);
    fulfillReservation(shipA, {
      station: destinationStation,
      wareId: "ice",
      amount: withdrawnAmount,
      cargoDirection: "incoming",
    });
    shipA.cargoAmountByWareId = new Map();
    clearReservations(shipA);
    assertEqual(effectiveSpace(destinationSlot), 390, "dest space after cleanup");
  });
});
