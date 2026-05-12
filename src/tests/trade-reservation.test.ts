import { test, assertEqual } from "./test-utils.ts";
import { createInventorySlot as createSlot } from "../sim-station.ts";
import {
  addReservation,
  fulfillReservation,
  clearReservations,
} from "../sim-trade-reservation.ts";
import { ice } from "../../data/wares.ts";
import { makeMockStation, makeMockTradeShip, withMockManager } from "./trade-test-fixtures.ts";

// --- Reservation lifecycle ---

test("multiple reservations on same slot stack", () => {
  withMockManager(() => {
    const shipA = makeMockTradeShip();
    const shipB = makeMockTradeShip();
    const slot = createSlot(ice, 100, 500);
    const station = makeMockStation([slot]);

    addReservation(shipA, { station, wareId: "ice", amount: 30, cargoDirection: "outgoing" });
    addReservation(shipB, { station, wareId: "ice", amount: 20, cargoDirection: "outgoing" });

    assertEqual(slot.reservedOutgoing, 50, "stacked reservedOutgoing");
  });
});

test("fulfillReservation decrements slot counter and removes settled entry", () => {
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const slot = createSlot(ice, 100, 500);
    const station = makeMockStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 50, cargoDirection: "outgoing" });
    fulfillReservation(ship, { station, wareId: "ice", amount: 50, cargoDirection: "outgoing" });

    assertEqual(slot.reservedOutgoing, 0, "reservedOutgoing after fulfill");
    assertEqual(ship.reservations.length, 0, "fully-settled entry removed");
  });
});

test("fulfillReservation handles partial fulfillment", () => {
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const slot = createSlot(ice, 100, 500);
    const station = makeMockStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 80, cargoDirection: "outgoing" });
    fulfillReservation(ship, { station, wareId: "ice", amount: 30, cargoDirection: "outgoing" });

    assertEqual(slot.reservedOutgoing, 50, "reservedOutgoing partial");
    assertEqual(ship.reservations[0].amount, 50, "entry partially remaining");
  });
});

test("clearReservations removes unfulfilled amounts from slots", () => {
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const sourceSlot = createSlot(ice, 100, 500);
    const destinationSlot = createSlot(ice, 50, 500);
    const sourceStation = makeMockStation([sourceSlot]);
    const destinationStation = makeMockStation([destinationSlot]);

    addReservation(ship, { station: sourceStation, wareId: "ice", amount: 60, cargoDirection: "outgoing" });
    addReservation(ship, { station: destinationStation, wareId: "ice", amount: 60, cargoDirection: "incoming" });

    clearReservations(ship);

    assertEqual(sourceSlot.reservedOutgoing, 0, "source cleared");
    assertEqual(destinationSlot.reservedIncoming, 0, "dest cleared");
    assertEqual(ship.reservations.length, 0, "array emptied");
  });
});

test("clearReservations skips already-fulfilled entries", () => {
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const slot = createSlot(ice, 100, 500);
    const station = makeMockStation([slot]);

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
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const slot = createSlot(ice, 100, 500);
    const station = makeMockStation([slot]);

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
  withMockManager(() => {
    const ship = makeMockTradeShip();
    const slot = createSlot(ice, 100, 500);
    const station = makeMockStation([slot]);

    addReservation(ship, { station, wareId: "ice", amount: 0, cargoDirection: "outgoing" });
    assertEqual(slot.reservedOutgoing, 0, "reservedOutgoing untouched by zero reservation");

    // Entry exists on the ship but is benign — clearReservations must not
    // drive the slot counter negative when releasing it.
    clearReservations(ship);
    assertEqual(slot.reservedOutgoing, 0, "clear of a zero reservation stays at 0");
    assertEqual(ship.reservations.length, 0, "reservation array emptied");
  });
});
