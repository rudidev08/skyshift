import { test, assertEqual } from "./test-utils.ts";
import { createInventorySlot } from "../sim-station.ts";
import { addReservation, fulfillReservation, clearReservations } from "../sim-trade-reservation.ts";
import { ice } from "../../data/wares.ts";
import { makeEmptyTradeShip, withMockManager } from "./trade-test-fixtures.ts";

test("multiple reservations on same slot stack", () => {
  withMockManager(({ makeRegisteredStation }) => {
    const shipA = makeEmptyTradeShip();
    const shipB = makeEmptyTradeShip();
    const slot = createInventorySlot(ice, 100, 500);
    const station = makeRegisteredStation([slot]);

    addReservation(shipA, { station, wareId: "ice", amount: 30, cargoDirection: "outgoing" });
    addReservation(shipB, { station, wareId: "ice", amount: 20, cargoDirection: "outgoing" });

    assertEqual(slot.reservedOutgoing, 50, "stacked reservedOutgoing");
  });
});

test("fulfillReservation handles partial fulfillment", () => {
  withMockManager(({ makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const slot = createInventorySlot(ice, 100, 500);
    const station = makeRegisteredStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 80, cargoDirection: "outgoing" });
    fulfillReservation(ship, { station, wareId: "ice", amount: 30, cargoDirection: "outgoing" });

    assertEqual(slot.reservedOutgoing, 50, "reservedOutgoing partial");
    assertEqual(ship.reservations[0].amount, 50, "entry partially remaining");
  });
});

test("fulfillReservation consumes across two same-key entries, leaving the correct residual", () => {
  // A ship can hold two separate reservation entries on the same
  // (station, ware, direction) — e.g. a 2-leg trip whose primary and backhaul
  // legs both touch this slot. One partial fulfillment must drain the first
  // entry fully (30 → 0, pruned) and the second only partially (40 → 20),
  // matching the 50 just transferred. Pin `remaining -= fulfilled`: a
  // `-=` → `+=` mutation makes `remaining` grow instead of shrink, so the
  // loop over-consumes the second entry (40 → 0) and prunes it too —
  // clearReservations at trip-end would then release 20 less than the slot
  // actually still has claimed.
  withMockManager(({ makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const slot = createInventorySlot(ice, 100, 500);
    const station = makeRegisteredStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 30, cargoDirection: "outgoing" });
    addReservation(ship, { station, wareId: "ice", amount: 40, cargoDirection: "outgoing" });
    assertEqual(slot.reservedOutgoing, 70, "both entries stacked on the slot");

    fulfillReservation(ship, { station, wareId: "ice", amount: 50, cargoDirection: "outgoing" });

    // Slot counter: 70 reserved − 50 fulfilled = 20 still claimed.
    assertEqual(slot.reservedOutgoing, 20, "slot counter down by exactly the fulfilled 50");
    // First entry (30) drained to 0 and pruned; second entry holds the 20 residual.
    assertEqual(ship.reservations.length, 1, "only the partially-consumed entry remains");
    assertEqual(ship.reservations[0].amount, 20, "second entry left with 40 − 20 = 20");

    // Trip-end cleanup must release exactly the 20 residual, returning the
    // slot counter to 0 — not under/over-release from a mis-tracked entry.
    clearReservations(ship);
    assertEqual(slot.reservedOutgoing, 0, "residual released cleanly at trip end");
  });
});

test("clearReservations removes unfulfilled amounts from slots", () => {
  withMockManager(({ makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const sourceSlot = createInventorySlot(ice, 100, 500);
    const destinationSlot = createInventorySlot(ice, 50, 500);
    const sourceStation = makeRegisteredStation([sourceSlot]);
    const destinationStation = makeRegisteredStation([destinationSlot]);

    addReservation(ship, {
      station: sourceStation,
      wareId: "ice",
      amount: 60,
      cargoDirection: "outgoing",
    });
    addReservation(ship, {
      station: destinationStation,
      wareId: "ice",
      amount: 60,
      cargoDirection: "incoming",
    });

    clearReservations(ship);

    assertEqual(sourceSlot.reservedOutgoing, 0, "source cleared");
    assertEqual(destinationSlot.reservedIncoming, 0, "dest cleared");
    assertEqual(ship.reservations.length, 0, "array emptied");
  });
});

test("clearReservations skips already-fulfilled entries", () => {
  withMockManager(({ makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const slot = createInventorySlot(ice, 100, 500);
    const station = makeRegisteredStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 50, cargoDirection: "outgoing" });
    fulfillReservation(ship, { station, wareId: "ice", amount: 50, cargoDirection: "outgoing" });
    // Slot counter is already 0 — clearReservations must not go negative.
    clearReservations(ship);

    assertEqual(slot.reservedOutgoing, 0, "should stay at 0, not go negative");
  });
});

test("fulfillReservation only decrements ship entries matching cargoDirection", () => {
  // A ship that holds both an incoming and an outgoing reservation on the same
  // (station, ware) — fulfilling outgoing must not touch the incoming entry,
  // otherwise clearReservations at trip-end releases the wrong slot counter.
  withMockManager(({ makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const slot = createInventorySlot(ice, 100, 500);
    const station = makeRegisteredStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 40, cargoDirection: "incoming" });
    addReservation(ship, { station, wareId: "ice", amount: 30, cargoDirection: "outgoing" });

    fulfillReservation(ship, { station, wareId: "ice", amount: 30, cargoDirection: "outgoing" });

    // Outgoing entry settled; incoming entry untouched.
    const outgoingEntries = ship.reservations.filter((r) => r.cargoDirection === "outgoing");
    const incomingEntries = ship.reservations.filter((r) => r.cargoDirection === "incoming");
    assertEqual(outgoingEntries.length, 0, "outgoing entry removed");
    assertEqual(incomingEntries.length, 1, "incoming entry still on ship");
    assertEqual(incomingEntries[0].amount, 40, "incoming entry not decremented by outgoing fulfill");
    assertEqual(slot.reservedIncoming, 40, "slot incoming counter untouched by outgoing fulfill");
    assertEqual(slot.reservedOutgoing, 0, "slot outgoing counter cleared");
  });
});

test("zero-amount reservation leaves slot counters untouched", () => {
  // A zero reservation is valid (math is +0) but must not inflate slot
  // counters — guards against a future "round up tiny reservation" change
  // silently double-booking capacity.
  withMockManager(({ makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const slot = createInventorySlot(ice, 100, 500);
    const station = makeRegisteredStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 0, cargoDirection: "outgoing" });
    assertEqual(slot.reservedOutgoing, 0, "reservedOutgoing untouched by zero reservation");

    // Entry exists on the ship but is benign — clearReservations must not
    // drive the slot counter negative when releasing it.
    clearReservations(ship);
    assertEqual(slot.reservedOutgoing, 0, "clear of a zero reservation stays at 0");
    assertEqual(ship.reservations.length, 0, "reservation array emptied");
  });
});
