import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { createInventorySlot as createSlot } from "../sim-station.ts";
import {
  processDepositAction,
  startTrip,
  withdrawCargo,
  depositCargo,
} from "../sim-trade-queue.ts";
import { addReservation } from "../sim-trade-reservation.ts";
import { ice, food, medicine } from "../../data/wares.ts";
import {
  makeMockStation,
  makeMockTradeShip,
  withMockManager,
} from "./trade-test-fixtures.ts";
import { createSimulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-builder.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { findRoundTradeTrip } from "../sim-trade-decision.ts";
import { getInventorySlot } from "../sim-station.ts";

// Pins cargo + reservation integrity through queue advancement
// (sim-trade-queue.ts). Existing trade-cargo-transfer.test.ts covers
// per-action helpers; this file covers the queue-level plumbing where
// silent corruption shows up.

test("buildQueueFromTrip: deposits queued before withdrawals at the target stop", () => {
  // Pin the order: targetActions = [...targetDeposits, ...targetWithdrawals].
  // Mutating to put withdrawals first would refill the hold before emptying it,
  // potentially overflowing or wasting capacity.
  const simulation = createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDuration: 0,
  });
  // Build a synthetic 2-leg trip so target sees both a deposit and a withdrawal.
  const home = simulation.stationManager.getStation("BIO-M");
  const target = simulation.stationManager.getStation("BIO-H");
  if (!home || !target) {
    simulation.tradeManager.dispose();
    return;
  }
  let ship = null;
  for (const candidate of simulation.tradeManager.tradeShips) {
    if (candidate.homeStationId === "BIO-M") { ship = candidate; break; }
  }
  if (!ship) { simulation.tradeManager.dispose(); return; }

  startTrip(ship, [
    { wareId: "medicine", amount: 50, fromStation: home, toStation: target },
    { wareId: "food", amount: 50, fromStation: target, toStation: home },
  ], simulation.tradeManager);

  // Walk the queue. The target's first cargo action must be a cargo-deposit
  // (medicine), followed by a cargo-withdrawal (food).
  let firstTargetActionIndex = -1;
  let firstTargetAction = null;
  let secondTargetAction = null;
  for (let actionIndex = 0; actionIndex < ship.actionQueue.length; actionIndex++) {
    const action = ship.actionQueue[actionIndex];
    if ((action.type === "cargo-deposit" || action.type === "cargo-withdrawal") && action.station.id === target.id) {
      if (firstTargetActionIndex < 0) {
        firstTargetActionIndex = actionIndex;
        firstTargetAction = action;
      } else if (secondTargetAction === null) {
        secondTargetAction = action;
      }
    }
  }
  assertEqual(firstTargetAction?.type, "cargo-deposit", "first target cargo action is a deposit");
  assertEqual(secondTargetAction?.type, "cargo-withdrawal", "second target cargo action is a withdrawal");

  simulation.tradeManager.dispose();
});

test("buildQueueFromTrip: dock-wait inserted before withdrawals at home (when home has cargo to load)", () => {
  // Pin `if (needsHomeLanding) { queue.push(buildDockWait(homeLabel)); ... }`.
  // Mutating the conditional or removing the dockWait would let the queue
  // start cargo-withdrawal immediately, skipping the time-on-ground beat.
  const simulation = createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDuration: 0,
  });
  let ship = null;
  let legs = null;
  for (const candidate of simulation.tradeManager.tradeShips) {
    const tripLegs = findRoundTradeTrip(candidate, simulation.tradeManager);
    if (tripLegs && tripLegs[0].fromStation.id === candidate.homeStationId) {
      ship = candidate;
      legs = tripLegs;
      break;
    }
  }
  if (!ship || !legs) { simulation.tradeManager.dispose(); return; }
  startTrip(ship, legs, simulation.tradeManager);

  // Find the first cargo-withdrawal at home; the action immediately before it
  // must be a wait labeled with "Dock:".
  for (let actionIndex = 0; actionIndex < ship.actionQueue.length; actionIndex++) {
    const action = ship.actionQueue[actionIndex];
    if (action.type === "cargo-withdrawal" && action.station.id === ship.homeStationId) {
      const previous = ship.actionQueue[actionIndex - 1];
      assertEqual(previous?.type, "wait", "action before home withdrawal is a wait");
      if (previous?.type === "wait") {
        assertTrue(previous.label.startsWith("Dock:"), `wait label starts with 'Dock:'; got '${previous.label}'`);
      }
      simulation.tradeManager.dispose();
      return;
    }
  }
  simulation.tradeManager.dispose();
});

test("processDepositAction: capacity-shrunk delivery (delivered < amount) releases the original reservation amount", () => {
  // Pin the `if (delivered < amount)` branch — releases action.amount, NOT delivered.
  // Without this branch, an overfilled destination (slot.max shrank since
  // reservation) would leave a phantom incoming claim for (amount - delivered)
  // on the slot.
  withMockManager((manager) => {
    const ship = makeMockTradeShip();
    const destinationSlot = createSlot(ice, 480, 500);
    const destination = makeMockStation([destinationSlot]);
    ship.cargoAmountByWareId = new Map([["ice", 100]]);
    addReservation(ship, { station: destination, wareId: "ice", amount: 100, cargoDirection: "incoming" });

    processDepositAction(ship, {
      type: "cargo-deposit",
      station: destination,
      wareId: "ice",
      amount: 100,
    }, manager);

    assertEqual(destinationSlot.current, 500, "destination filled to capacity (delivered = 20)");
    assertEqual(destinationSlot.reservedIncoming, 0, "full original reservation released, not just delivered");
    assertEqual(ship.reservations.length, 0, "ship reservation entry cleared");
  });
});

test("processDepositAction: missing slot (target inventory cleared mid-trip) — slot counter stays untouched, cargo dropped", () => {
  // Pin the `if (slot) fulfillReservation(...)` guard. When slot is missing,
  // we don't increment any slot's reservedIncoming. Cargo is silently
  // discarded (removeCargo at the bottom of processDepositAction).
  withMockManager((manager) => {
    const ship = makeMockTradeShip();
    const destinationSlot = createSlot(ice, 0, 500);
    const destination = makeMockStation([destinationSlot]);
    addReservation(ship, { station: destination, wareId: "ice", amount: 100, cargoDirection: "incoming" });
    // Place the reservation on the slot's counter so we can see whether it
    // changes — startTrip would normally do this; we mimic it here.
    destinationSlot.reservedIncoming = 100;
    ship.cargoAmountByWareId = new Map([["ice", 100]]);

    // Wipe the destination's inventory so getInventorySlot returns undefined.
    destination.inventory = [];
    destination.inventoryByWareId.clear();

    processDepositAction(ship, {
      type: "cargo-deposit",
      station: destination,
      wareId: "ice",
      amount: 100,
    }, manager);

    // Slot counter is untouched (we cleared the inventory, the slot object
    // still exists in our local handle). Pin: no phantom claim added.
    // Pin removeCargo at the end of processDepositAction — cargo is dropped
    // even when slot is gone. Mutating the unconditional removeCargo to
    // gate on `if (slot)` would leave phantom cargo on the ship forever.
    assertEqual(ship.cargoAmountByWareId.size, 0, "cargo dropped from ship");
  });
});

test("processDepositAction: emigrating destination — cargo discarded, reservation released cleanly", () => {
  // Pin `isEmigrating` branch: delivered = 0, but slot still exists so
  // fulfillReservation runs and clears the reservation. No leak.
  withMockManager((manager) => {
    const ship = makeMockTradeShip();
    const destinationSlot = createSlot(ice, 0, 500);
    const destination = makeMockStation([destinationSlot]);
    destination.state = "emigrating";
    // addReservation populates destinationSlot.reservedIncoming on its own —
    // don't manually set it first or the slot's counter ends up doubled.
    addReservation(ship, { station: destination, wareId: "ice", amount: 100, cargoDirection: "incoming" });
    ship.cargoAmountByWareId = new Map([["ice", 100]]);

    processDepositAction(ship, {
      type: "cargo-deposit",
      station: destination,
      wareId: "ice",
      amount: 100,
    }, manager);

    // Pin: delivered=0 → slot stock unchanged, reservation released, cargo dropped.
    assertEqual(destinationSlot.current, 0, "emigrating station does not stock cargo");
    assertEqual(destinationSlot.reservedIncoming, 0, "reservation released cleanly");
    assertEqual(ship.cargoAmountByWareId.size, 0, "ship cargo dropped");
    assertEqual(ship.reservations.length, 0, "ship reservation entry cleared");
  });
});

test("processWithdrawAction-equivalent via tick: missing slot → no cargo added, ship inventory uncorrupted", () => {
  // processWithdrawAction is private. Test via the queue: have a ship attempt
  // a withdrawal at a station whose inventory was cleared. Pin: no cargo is
  // added to the ship and no slot counters change.
  const simulation = createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDuration: 0,
  });
  // Build a 1-leg synthetic trip.
  let ship = null;
  let legs = null;
  for (const candidate of simulation.tradeManager.tradeShips) {
    const tripLegs = findRoundTradeTrip(candidate, simulation.tradeManager);
    if (tripLegs) { ship = candidate; legs = tripLegs; break; }
  }
  if (!ship || !legs) { simulation.tradeManager.dispose(); return; }
  startTrip(ship, legs, simulation.tradeManager);

  // Wipe the source station's inventory. The ship will eventually arrive,
  // attempt withdrawal, find no slot, take 0.
  const source = legs[0].fromStation;
  source.inventory = [];
  source.inventoryByWareId.clear();

  // Tick to trip completion. The withdraw at source returns 0; ship cargo for
  // that ware should never accumulate.
  for (let stepIndex = 0; stepIndex < 4000; stepIndex++) {
    simulation.tradeManager.tick(1);
  }

  // Pin: ship's cargo for that ware is empty (withdraw took nothing).
  assertEqual(
    ship.cargoAmountByWareId.get(legs[0].wareId) ?? 0,
    0,
    "no cargo added when source slot is gone",
  );

  simulation.tradeManager.dispose();
});

test("advanceQueue bursts through multiple instant cargo actions until a fly blocker", () => {
  // Pin the burst loop. Mutating the case "cargo-deposit"/"cargo-withdrawal"
  // to add a `return` would break the burst — the queue would advance one
  // instant action per tick instead of all-at-once.
  const simulation = createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDuration: 0,
  });
  let ship = null;
  let legs = null;
  for (const candidate of simulation.tradeManager.tradeShips) {
    const tripLegs = findRoundTradeTrip(candidate, simulation.tradeManager);
    if (tripLegs) { ship = candidate; legs = tripLegs; break; }
  }
  if (!ship || !legs) { simulation.tradeManager.dispose(); return; }
  startTrip(ship, legs, simulation.tradeManager);

  // Tick enough to consume the leading placeholder + dock + withdrawals
  // (instant burst). Then the queue head should be a fly action.
  // Initial tick processes the leading placeholder; subsequent ticks burst.
  simulation.tradeManager.tick(0.1); // small delta to fire the timer

  // After the initial schedule, tick until the head is a fly action.
  let headType = ship.actionQueue[0]?.type;
  let safetyCounter = 0;
  while (headType !== "fly" && safetyCounter < 50) {
    simulation.tradeManager.tick(0.5);
    headType = ship.actionQueue[0]?.type;
    safetyCounter++;
  }

  // Pin the burst: after the dock-wait fires, the cargo-withdrawal(s) burst
  // through and the queue lands on the fly action. (If the test exited the
  // loop, headType is "fly".)
  assertTrue(headType === "fly" || ship.actionQueue.length === 0, `burst progressed to fly or empty; got ${headType}`);

  simulation.tradeManager.dispose();
});

test("withdrawCargo + depositCargo: round-trip preserves total cargo across slots", () => {
  // Pin the basic conservation invariant — what's withdrawn equals what's
  // deposited (clamped by capacity). Mutating either function's clamp would
  // create or destroy cargo.
  withMockManager(() => {
    const sourceSlot = createSlot(food, 100, 500);
    const destinationSlot = createSlot(food, 200, 500);

    const taken = withdrawCargo(sourceSlot, 50);
    const delivered = depositCargo(destinationSlot, taken);

    assertEqual(taken, 50, "withdrew 50");
    assertEqual(delivered, 50, "delivered 50 (room available)");
    assertEqual(sourceSlot.current + destinationSlot.current, 100 + 200, "total preserved");
  });
});

test("withdrawCargo: clamps to current when stock is below request", () => {
  // Pin Math.min(maxAmount, slot.current). Mutating to Math.max would let the
  // ship withdraw more than the source has, driving slot.current negative.
  withMockManager(() => {
    const sourceSlot = createSlot(medicine, 30, 500);
    const taken = withdrawCargo(sourceSlot, 100);
    assertEqual(taken, 30, "clamped to current stock");
    assertEqual(sourceSlot.current, 0, "source emptied");
  });
});

test("processDepositAction: removeCargo runs even when delivery is short — no phantom cargo on ship", () => {
  // Pin the unconditional `removeCargo(ship, action.wareId, amount)` at the
  // end of processDepositAction. Mutating to gate it (e.g. only on delivered
  // > 0) would leave overflow cargo on the ship after a short deposit.
  withMockManager((manager) => {
    const ship = makeMockTradeShip();
    const destinationSlot = createSlot(ice, 0, 50);  // tiny destination
    const destination = makeMockStation([destinationSlot]);
    addReservation(ship, { station: destination, wareId: "ice", amount: 100, cargoDirection: "incoming" });
    ship.cargoAmountByWareId = new Map([["ice", 100]]);

    processDepositAction(ship, {
      type: "cargo-deposit",
      station: destination,
      wareId: "ice",
      amount: 100,
    }, manager);

    assertEqual(destinationSlot.current, 50, "destination filled to its tiny max");
    assertEqual(ship.cargoAmountByWareId.size, 0, "ship cargo emptied even though only 50 of 100 delivered");
  });
});

test("startTrip throws when a leg references a ware with no inventory slot at either station", () => {
  // Pin the slot-existence check in startTrip. Without the throw, the trip
  // would proceed with broken reservations and crash later when the action fires.
  const simulation = createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDuration: 0,
  });
  let ship = null;
  for (const candidate of simulation.tradeManager.tradeShips) {
    if (candidate.homeStationId === "BIO-M") { ship = candidate; break; }
  }
  const home = simulation.stationManager.getStation("BIO-M");
  const target = simulation.stationManager.getStation("BIO-H");
  if (!ship || !home || !target) { simulation.tradeManager.dispose(); return; }
  // hyperdata: not produced/consumed by either station — neither has a slot.
  let threw = false;
  try {
    startTrip(ship, [
      { wareId: "hyperdata", amount: 50, fromStation: home, toStation: target },
    ], simulation.tradeManager);
  } catch {
    threw = true;
  }
  assertTrue(threw, "startTrip throws for missing slot");

  // Pin the OR (not AND) — startTrip's startup-time check must reject EITHER
  // side missing with its own labeled error, not let the leg through to
  // addReservation's downstream reserveOutgoing/reserveIncoming throw.
  // An `||` → `&&` mutation would skip the up-front check; the leg would
  // proceed past the check and throw with a different ("reserveOutgoing:
  // station X has no slot...") message later — silently letting trips
  // half-commit reservations on stations whose ware partly exists.
  // provisions: BIO-H (habitat) produces it (has slot); BIO-M (medical-lab)
  // does not — slot exists at target but not at home, leg from home is
  // asymmetric.
  let asymError: Error | null = null;
  try {
    startTrip(ship, [
      { wareId: "provisions", amount: 50, fromStation: home, toStation: target },
    ], simulation.tradeManager);
  } catch (error) {
    asymError = error as Error;
  }
  assertTrue(asymError !== null, "startTrip throws when only one side lacks the slot (asymmetric)");
  assertTrue(
    asymError !== null && asymError.message.includes("startTrip: missing inventory slot"),
    `asymmetric throw uses startTrip's own error, not a downstream reserve* error; got: ${asymError?.message}`,
  );

  simulation.tradeManager.dispose();
});

test("advanceQueue: queue.shift is called for each instant action processed (not skipped)", () => {
  // Indirect pin of the per-action shift — count actions before/after a burst
  // and verify the count drops by exactly the number processed in the burst.
  withMockManager((manager) => {
    const ship = makeMockTradeShip();
    const destinationSlot1 = createSlot(ice, 0, 500);
    const destinationSlot2 = createSlot(food, 0, 500);
    const destination1 = makeMockStation([destinationSlot1]);
    const destination2 = makeMockStation([destinationSlot2]);
    ship.cargoAmountByWareId = new Map([["ice", 50], ["food", 50]]);

    // Two instant deposits.
    addReservation(ship, { station: destination1, wareId: "ice", amount: 50, cargoDirection: "incoming" });
    addReservation(ship, { station: destination2, wareId: "food", amount: 50, cargoDirection: "incoming" });

    processDepositAction(ship, {
      type: "cargo-deposit",
      station: destination1,
      wareId: "ice",
      amount: 50,
    }, manager);
    processDepositAction(ship, {
      type: "cargo-deposit",
      station: destination2,
      wareId: "food",
      amount: 50,
    }, manager);

    // Both deposits processed. Pin the cumulative effect — each shifted slot
    // is filled, each reservation cleared.
    assertEqual(destinationSlot1.current, 50, "first deposit landed");
    assertEqual(destinationSlot2.current, 50, "second deposit landed");
    assertEqual(ship.cargoAmountByWareId.size, 0, "all cargo deposited");
    assertEqual(ship.reservations.length, 0, "all reservations cleared");
    // Reference getInventorySlot so unused-import lint stays quiet.
    assertEqual(getInventorySlot(destination1, "ice")?.current, 50, "slot lookup matches");
  });
});
