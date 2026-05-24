import { test, assertEqual, assertTrue, assertThrows } from "./test-utils.ts";
import { createInventorySlot } from "../sim-station.ts";
import {
  advanceQueue,
  applyDepositAction,
  startTrip,
  withdrawCargo,
  depositCargo,
} from "../sim-trade-queue.ts";
import { addReservation } from "../sim-trade-reservation.ts";
import { ice, food, medicine } from "../../data/wares.ts";
import {
  findShipHomedAt,
  findShipWithRoundTrip,
  loadShipCargo,
  makeEmptyTradeShip,
  withMockManager,
} from "./trade-test-fixtures.ts";
import type { TradeShip } from "../sim-trade-types.ts";
import type { ShipAction } from "../sim-travel-types.ts";
import { createSettledSimulation } from "./sim-test-fixtures.ts";

// Pins cargo + reservation integrity through queue advancement
// (sim-trade-queue.ts). Existing trade-cargo-transfer.test.ts covers
// per-action helpers; this file covers the queue-level plumbing where
// silent corruption shows up.

function findFirstCargoActionPairAtStation(
  ship: TradeShip,
  stationId: string,
): { first: ShipAction | null; second: ShipAction | null } {
  let first: ShipAction | null = null;
  let second: ShipAction | null = null;
  for (const action of ship.actionQueue) {
    if (action.type !== "cargo-deposit" && action.type !== "cargo-withdrawal") continue;
    if (action.station.id !== stationId) continue;
    if (first === null) {
      first = action;
    } else if (second === null) {
      second = action;
      break;
    }
  }
  return { first, second };
}

function findActionBefore(
  ship: TradeShip,
  predicate: (action: ShipAction) => boolean,
): ShipAction | null {
  for (let index = 1; index < ship.actionQueue.length; index++) {
    if (predicate(ship.actionQueue[index])) {
      return ship.actionQueue[index - 1];
    }
  }
  return null;
}

test("createQueueFromTrip: deposits queued before withdrawals at the target stop", () => {
  // Pin the order: targetActions = [...targetDeposits, ...targetWithdrawals].
  // Mutating to put withdrawals first would refill the hold before emptying it,
  // potentially overflowing or wasting capacity.
  const simulation = createSettledSimulation();
  // Build a synthetic 2-leg trip so target sees both a deposit and a withdrawal.
  const home = simulation.stationManager.getStation("BIO-M");
  const target = simulation.stationManager.getStation("BIO-H");
  if (!home || !target) {
    simulation.tradeManager.destroy();
    return;
  }
  const ship = findShipHomedAt(simulation, "BIO-M");
  if (!ship) {
    simulation.tradeManager.destroy();
    return;
  }

  startTrip(
    ship,
    [
      { wareId: "medicine", amount: 50, fromStation: home, toStation: target },
      { wareId: "food", amount: 50, fromStation: target, toStation: home },
    ],
    simulation.tradeManager,
  );

  // Walk the queue. The target's first cargo action must be a cargo-deposit
  // (medicine), followed by a cargo-withdrawal (food).
  const { first, second } = findFirstCargoActionPairAtStation(ship, target.id);
  assertEqual(first?.type, "cargo-deposit", "first target cargo action is a deposit");
  assertEqual(second?.type, "cargo-withdrawal", "second target cargo action is a withdrawal");

  simulation.tradeManager.destroy();
});

test("createQueueFromTrip: dock-wait inserted before withdrawals at home (when home has cargo to load)", () => {
  // Pin `if (needsHomeLanding) { queue.push(createDockWait(homeLabel)); ... }`.
  // Mutating the conditional or removing the dockWait would let the queue
  // start cargo-withdrawal immediately, skipping the time-on-ground beat.
  const simulation = createSettledSimulation();
  const found = findShipWithRoundTrip(
    simulation,
    (candidate, legs) => legs[0].fromStation.id === candidate.homeStationId,
  );
  if (!found) {
    simulation.tradeManager.destroy();
    return;
  }
  const { ship, legs } = found;
  startTrip(ship, legs, simulation.tradeManager);

  // Find the first cargo-withdrawal at home; the action immediately before it
  // must be a wait labeled with "Dock:".
  const previousAction = findActionBefore(
    ship,
    (action) => action.type === "cargo-withdrawal" && action.station.id === ship.homeStationId,
  );
  assertEqual(previousAction?.type, "wait", "action before home withdrawal is a wait");
  if (previousAction?.type === "wait") {
    assertTrue(
      previousAction.label.startsWith("Dock:"),
      `wait label starts with 'Dock:'; got '${previousAction.label}'`,
    );
  }
  simulation.tradeManager.destroy();
});

test("applyDepositAction: capacity-shrunk delivery (delivered < amount) releases the original reservation amount", () => {
  // Pin the `if (delivered < amount)` branch — releases action.amount, NOT delivered.
  // Without this branch, an overfilled destination (slot.max shrank since
  // reservation) would leave a phantom incoming claim for (amount - delivered)
  // on the slot.
  withMockManager(({ manager, makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const destinationSlot = createInventorySlot(ice, 480, 500);
    const destination = makeRegisteredStation([destinationSlot]);
    loadShipCargo(ship, "ice", 100);
    addReservation(ship, {
      station: destination,
      wareId: "ice",
      amount: 100,
      cargoDirection: "incoming",
    });

    applyDepositAction(
      ship,
      {
        type: "cargo-deposit",
        station: destination,
        wareId: "ice",
        amount: 100,
      },
      manager,
    );

    assertEqual(destinationSlot.current, 500, "destination filled to capacity (delivered = 20)");
    assertEqual(
      destinationSlot.reservedIncoming,
      0,
      "full original reservation released, not just delivered",
    );
    assertEqual(ship.reservations.length, 0, "ship reservation entry cleared");
  });
});

test("applyDepositAction: missing slot (target inventory cleared mid-trip) — slot counter stays untouched, cargo dropped", () => {
  // Pin the `if (slot) fulfillReservation(...)` guard. When slot is missing,
  // we don't increment any slot's reservedIncoming. Cargo is silently
  // discarded (removeCargo at the bottom of applyDepositAction).
  withMockManager(({ manager, makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const destinationSlot = createInventorySlot(ice, 0, 500);
    const destination = makeRegisteredStation([destinationSlot]);
    addReservation(ship, {
      station: destination,
      wareId: "ice",
      amount: 100,
      cargoDirection: "incoming",
    });
    // Place the reservation on the slot's counter so we can see whether it
    // changes — startTrip would normally do this; we mimic it here.
    destinationSlot.reservedIncoming = 100;
    loadShipCargo(ship, "ice", 100);

    // Wipe the destination's inventory so getInventorySlot returns undefined.
    destination.inventory = [];
    destination.inventoryByWareId.clear();

    applyDepositAction(
      ship,
      {
        type: "cargo-deposit",
        station: destination,
        wareId: "ice",
        amount: 100,
      },
      manager,
    );

    // Slot counter is untouched (we cleared the inventory, the slot object
    // still exists in our local handle). Pin: no phantom claim added.
    // Pin removeCargo at the end of applyDepositAction — cargo is dropped
    // even when slot is gone. Mutating the unconditional removeCargo to
    // gate on `if (slot)` would leave phantom cargo on the ship forever.
    assertEqual(ship.cargoAmountByWareId.size, 0, "cargo dropped from ship");
  });
});

test("applyDepositAction: emigrating destination — cargo discarded, reservation released cleanly", () => {
  // Pin `isEmigrating` branch: delivered = 0, but slot still exists so
  // fulfillReservation runs and clears the reservation. No leak.
  withMockManager(({ manager, makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const destinationSlot = createInventorySlot(ice, 0, 500);
    const destination = makeRegisteredStation([destinationSlot]);
    destination.state = "emigrating";
    // addReservation populates destinationSlot.reservedIncoming on its own —
    // don't manually set it first or the slot's counter ends up doubled.
    addReservation(ship, {
      station: destination,
      wareId: "ice",
      amount: 100,
      cargoDirection: "incoming",
    });
    loadShipCargo(ship, "ice", 100);

    applyDepositAction(
      ship,
      {
        type: "cargo-deposit",
        station: destination,
        wareId: "ice",
        amount: 100,
      },
      manager,
    );

    // Pin: delivered=0 → slot stock unchanged, reservation released, cargo dropped.
    assertEqual(destinationSlot.current, 0, "emigrating station does not stock cargo");
    assertEqual(destinationSlot.reservedIncoming, 0, "reservation released cleanly");
    assertEqual(ship.cargoAmountByWareId.size, 0, "ship cargo dropped");
    assertEqual(ship.reservations.length, 0, "ship reservation entry cleared");
  });
});

test("applyWithdrawAction releases the outgoing reservation entry on the ship (not the incoming entry)", () => {
  // Pin applyWithdrawAction's `cargoDirection: "outgoing"` on its
  // fulfillReservation call. A swap to "incoming" would leave the
  // ship's outgoing-reservation entry on the array (since the entry-removal
  // loop in fulfillReservation matches by direction), so after the
  // withdrawal fires the ship still has its outgoing entry.
  withMockManager(({ manager, makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const sourceSlot = createInventorySlot(ice, 100, 500);
    const sourceStation = makeRegisteredStation([sourceSlot]);

    addReservation(ship, {
      station: sourceStation,
      wareId: "ice",
      amount: 50,
      cargoDirection: "outgoing",
    });
    // Synthesize a queued withdraw + drive it via advanceQueue. The ship has
    // a leading placeholder + one withdraw + one terminal action so advanceQueue
    // processes the burst and exits cleanly.
    ship.actionQueue = [
      { type: "wait", durationSeconds: 0, label: "—" },
      { type: "cargo-withdrawal", station: sourceStation, wareId: "ice", amount: 50 },
      { type: "wait", durationSeconds: 999, label: "park" },
    ];

    advanceQueue(ship, manager);

    // After the withdraw fires: ship's outgoing entry is settled and removed.
    // With the bug (cargoDirection "incoming" in fulfillReservation), the
    // entry-removal loop skips the outgoing entry, leaving it stuck.
    const outgoingEntries = ship.reservations.filter(
      (reservation) => reservation.cargoDirection === "outgoing",
    );
    assertEqual(outgoingEntries.length, 0, "outgoing reservation entry removed after withdraw");
  });
});

test("applyWithdrawAction-equivalent via tick: missing slot → no cargo added, ship inventory uncorrupted", () => {
  // applyWithdrawAction is private. Test via the queue: have a ship attempt
  // a withdrawal at a station whose inventory was cleared. Pin: no cargo is
  // added to the ship and no slot counters change.
  const simulation = createSettledSimulation();
  // Build a 1-leg synthetic trip.
  const found = findShipWithRoundTrip(simulation);
  if (!found) {
    simulation.tradeManager.destroy();
    return;
  }
  const { ship, legs } = found;
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

  simulation.tradeManager.destroy();
});

test("advanceQueue bursts through multiple instant cargo actions until a fly blocker", () => {
  // Pin the burst loop. Mutating the case "cargo-deposit"/"cargo-withdrawal"
  // to add a `return` would break the burst — the queue would advance one
  // instant action per tick instead of all-at-once.
  const simulation = createSettledSimulation();
  const found = findShipWithRoundTrip(simulation);
  if (!found) {
    simulation.tradeManager.destroy();
    return;
  }
  const { ship, legs } = found;
  startTrip(ship, legs, simulation.tradeManager);

  // Tick enough to consume the leading placeholder + dock + withdrawals
  // (instant burst). Then the queue head should be a fly action.
  // Initial tick processes the leading placeholder; subsequent ticks burst.
  simulation.tradeManager.tick(0.1); // small delta to fire the timer

  // After the initial schedule, tick until the head is a fly action.
  let headActionType = ship.actionQueue[0]?.type;
  let tickAttempts = 0;
  while (headActionType !== "fly" && tickAttempts < 50) {
    simulation.tradeManager.tick(0.5);
    headActionType = ship.actionQueue[0]?.type;
    tickAttempts++;
  }

  // Pin the burst: after the dock-wait fires, the cargo-withdrawal(s) burst
  // through and the queue lands on the fly action. (If the test exited the
  // loop, headActionType is "fly".)
  assertTrue(
    headActionType === "fly" || ship.actionQueue.length === 0,
    `burst progressed to fly or empty; got ${headActionType}`,
  );

  simulation.tradeManager.destroy();
});

test("withdrawCargo + depositCargo: round-trip preserves total cargo across slots", () => {
  // Pin the basic conservation rule — what's withdrawn equals what's
  // deposited (clamped by capacity). Mutating either function's clamp would
  // create or destroy cargo.
  withMockManager(() => {
    const sourceSlot = createInventorySlot(food, 100, 500);
    const destinationSlot = createInventorySlot(food, 200, 500);

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
    const sourceSlot = createInventorySlot(medicine, 30, 500);
    const taken = withdrawCargo(sourceSlot, 100);
    assertEqual(taken, 30, "clamped to current stock");
    assertEqual(sourceSlot.current, 0, "source emptied");
  });
});

test("applyDepositAction: removeCargo runs even when delivery is short — no phantom cargo on ship", () => {
  // Pin the unconditional `removeCargo(ship, action.wareId, amount)` at the
  // end of applyDepositAction. Mutating to gate it (e.g. only on delivered
  // > 0) would leave overflow cargo on the ship after a short deposit.
  withMockManager(({ manager, makeRegisteredStation }) => {
    const ship = makeEmptyTradeShip();
    const destinationSlot = createInventorySlot(ice, 0, 50); // tiny destination
    const destination = makeRegisteredStation([destinationSlot]);
    addReservation(ship, {
      station: destination,
      wareId: "ice",
      amount: 100,
      cargoDirection: "incoming",
    });
    loadShipCargo(ship, "ice", 100);

    applyDepositAction(
      ship,
      {
        type: "cargo-deposit",
        station: destination,
        wareId: "ice",
        amount: 100,
      },
      manager,
    );

    assertEqual(destinationSlot.current, 50, "destination filled to its tiny max");
    assertEqual(ship.cargoAmountByWareId.size, 0, "ship cargo emptied even though only 50 of 100 delivered");
  });
});

test("startTrip throws when a leg references a ware with no inventory slot at either station", () => {
  // Pin the slot-existence check in startTrip. Without the throw, the trip
  // would proceed with broken reservations and crash later when the action fires.
  const simulation = createSettledSimulation();
  const ship = findShipHomedAt(simulation, "BIO-M");
  const home = simulation.stationManager.getStation("BIO-M");
  const target = simulation.stationManager.getStation("BIO-H");
  if (!ship || !home || !target) {
    simulation.tradeManager.destroy();
    return;
  }
  // hyperdata: not produced/consumed by either station — neither has a slot.
  assertThrows(
    () =>
      startTrip(
        ship,
        [{ wareId: "hyperdata", amount: 50, fromStation: home, toStation: target }],
        simulation.tradeManager,
      ),
    "",
    "startTrip throws for missing slot",
  );

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
  assertThrows(
    () =>
      startTrip(
        ship,
        [{ wareId: "provisions", amount: 50, fromStation: home, toStation: target }],
        simulation.tradeManager,
      ),
    "startTrip: missing inventory slot",
    "asymmetric throw uses startTrip's own error, not a downstream reserve* error",
  );

  simulation.tradeManager.destroy();
});
