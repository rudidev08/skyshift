// --- Trade-route stats observer ---
//
// These tests construct mock stations + ships outside any sim and use a
// dedicated mock TradeManager. The manager's deposit observer fires the
// route-stats recording, so the assertion can read tradeManager.getTradedRoutes(...).

import { economyConfig } from "../../data/economy-config.ts";
import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { createStation, getInventorySlot } from "../sim-station.ts";
import { TradeManager } from "../sim-trade-manager.ts";
import { type TradeShip } from "../sim-trade-types.ts";
import { applyDepositAction } from "../sim-trade-queue.ts";
import type { Ship } from "../sim-ships.ts";
import type { Station } from "../sim-station-types.ts";
import { makePlacedStation } from "./factories.ts";
import { loadShipCargo, totalActivity } from "./trade-test-fixtures.ts";

interface RouteStatsObserverFixture {
  manager: TradeManager;
  tradeShip: TradeShip;
  producer: Station;
  homeStation: Station;
  orbitingShip: Ship;
}

/** Producer + home stations, an orbiting ship, a TradeManager wired to read both, and a TradeShip ready to deposit 500 water at home. */
function makeRouteStatsObserverFixture(idPrefix: string): RouteStatsObserverFixture {
  const producer = createStation(
    makePlacedStation({
      id: `${idPrefix}-SRC`,
      stationTypeId: "water-processing",
      size: "M",
      x: -100,
    }),
  );
  const homeStation = createStation(
    makePlacedStation({
      id: `${idPrefix}-HOME`,
      stationTypeId: "farm",
      size: "M",
      x: 100,
    }),
  );
  const homeWaterSlot = getInventorySlot(homeStation, "water")!;
  homeWaterSlot.current = 0;

  const stationsById = new Map<string, Station>([
    [producer.id, producer],
    [homeStation.id, homeStation],
  ]);
  const shipsById = new Map<string, Ship>();
  const orbitingShip: Ship = {
    station: homeStation,
    shipTypeId: "trader",
    id: `${idPrefix}-SHIP`,
    shipName: `${idPrefix} Ship`,
  };
  shipsById.set(orbitingShip.id, orbitingShip);

  const manager = new TradeManager({
    stationManager: { getStation: (id: string) => stationsById.get(id) },
    shipManager: { getShip: (id: string) => shipsById.get(id) },
  });

  const tradeShip: TradeShip = {
    reservations: [],
    cargoAmountByWareId: new Map([[homeWaterSlot.ware.id, 500]]),
    actionQueue: [],
    flight: null,
    targetStationId: producer.id,
    tradeDirection: "buy",
    idleSinceTradeTimeSeconds: 0,
    homeStationId: homeStation.id,
    orbitingShipId: orbitingShip.id,
  };
  return { manager, tradeShip, producer, homeStation, orbitingShip };
}

/** Refill the ship from cargo and re-fire a 500-water deposit at home. */
function depositWaterAtHome(fixture: RouteStatsObserverFixture): void {
  const homeWaterSlot = getInventorySlot(fixture.homeStation, "water")!;
  homeWaterSlot.current = 0;
  loadShipCargo(fixture.tradeShip, homeWaterSlot.ware.id, 500);
  applyDepositAction(
    fixture.tradeShip,
    {
      type: "cargo-deposit",
      station: fixture.homeStation,
      wareId: "water",
      amount: 500,
    },
    fixture.manager,
  );
}

/** Fan a 500-water incoming transfer at the home station through the
 *  manager's observers — the same path a real ferry delivery hits. */
function fireIncomingWaterTransferAtHome(
  fixture: RouteStatsObserverFixture,
  ship: TradeShip,
): void {
  for (const observer of fixture.manager.tradeTransferObservers) {
    observer({
      amount: 500,
      ship,
      station: fixture.homeStation,
      cargoDirection: "incoming",
      wareId: "water",
    });
  }
}

test("deposit route stats record the pickup station as the source for buy deliveries", () => {
  const fixture = makeRouteStatsObserverFixture("WATER");

  depositWaterAtHome(fixture);

  const tradedRoutes = fixture.manager.getTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 1, "delivery should create exactly one traded route");
  assertTrue(
    tradedRoutes[0].fromStationId === fixture.producer.id &&
      tradedRoutes[0].toStationId === fixture.homeStation.id,
    "delivery should record producer -> home instead of home -> home",
  );
  // fillFraction is amount / cargoCapacity. Trader capacity is 2500, deposit
  // is 500 water → 0.2. Pinning this catches a `/` → `*` mutation in the
  // event-builder that would silently inflate per-route activity totals.
  assertEqual(totalActivity(tradedRoutes[0]), 0.2, "route activity matches amount / capacity");

  fixture.manager.destroy();
});

test("delivery event records its timeSeconds as the manager's current tradeTimeSeconds, not zero", () => {
  // Pin the recordDelivery event's `timeSeconds` field to manager.tradeTimeSeconds. A
  // mutation that hard-codes timeSeconds=0 would silently break window queries — windows
  // like "last hour" rely on event.timeSeconds matching live tradeTimeSeconds so old
  // events fall outside the cutoff. Verify by recording at tradeTimeSeconds=200, then
  // querying a window that includes [now-150 .. now] and confirming the delivery is in.
  const fixture = makeRouteStatsObserverFixture("TIME");
  fixture.manager.advanceTradeTime(200);
  depositWaterAtHome(fixture);

  // Window covers tradeTimeSeconds ∈ [50, 200]. With timeSeconds: tradeTimeSeconds=200 the
  // delivery is included; with timeSeconds: 0 the cutoff (50) excludes it.
  const deliveriesInWindow = fixture.manager.tradeRouteStats.getRouteStatsInWindow(200, 150);
  assertEqual(deliveriesInWindow.length, 1, "delivery falls inside the [now-150, now] window");

  fixture.manager.destroy();
});

test("traded-route cache refreshes after 30 game seconds instead of wall-clock polling", () => {
  const fixture = makeRouteStatsObserverFixture("CACHE");

  depositWaterAtHome(fixture);
  const first = fixture.manager.getTradedRoutes(0, Infinity);

  depositWaterAtHome(fixture);
  const second = fixture.manager.getTradedRoutes(0, Infinity);
  assertTrue(second === first, "cache should stay warm before the game-time refresh boundary");

  // Just before the refresh boundary still returns the cached reference —
  // pins the `<` (not `<=`) check so a +1 off-by-one mutation is caught.
  const justBefore = fixture.manager.getTradedRoutes(
    economyConfig.tradeRouteCacheRefreshSeconds - 1,
    Infinity,
  );
  assertTrue(justBefore === first, "cache should stay warm just before the boundary");

  const refreshed = fixture.manager.getTradedRoutes(economyConfig.tradeRouteCacheRefreshSeconds, Infinity);
  assertTrue(refreshed !== first, "cache should refresh at the configured game-time window");
  // Two 500-water deposits at 2500 capacity → 0.2 activity each. The refreshed
  // result must include the later delivery (0.4 total), not just the first (0.2).
  assertEqual(totalActivity(refreshed[0]), 0.4, "refreshed stats should include the later delivery");

  fixture.manager.destroy();
});

test("recordRouteDeliveryFromTransfer ignores transfers whose ship is no longer registered", () => {
  // Pin the `if (!orbitingShip) return;` guard in recordRouteDeliveryFromTransfer.
  // Dropping the guard would let getShipTypeTemplate(undefined.shipTypeId) throw on
  // a transfer fired during the gap between deregister and queue drain — a
  // race the production decommission flow exercises. Verify by firing a
  // synthetic transfer event whose ship id is absent from the resolver and
  // confirming no route stats are recorded (and no exception escapes).
  const fixture = makeRouteStatsObserverFixture("ORPHAN");
  // Fire a transfer for a TradeShip the manager's shipResolver can't find.
  const orphanTradeShip: TradeShip = {
    ...fixture.tradeShip,
    orbitingShipId: "no-such-ship-in-resolver",
  };
  fireIncomingWaterTransferAtHome(fixture, orphanTradeShip);

  // Without the guard, getShipTypeTemplate(undefined.shipTypeId) would have thrown
  // before this assertion runs. With the guard, the orphan transfer is skipped
  // silently and no route stats are recorded.
  const tradedRoutes = fixture.manager.getTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 0, "orphan transfer is ignored by route stats");

  fixture.manager.destroy();
});

test("recordRouteDeliveryFromTransfer skips transfers with no targetStationId (idle ship at home)", () => {
  // Pin the `if (!fromStationId || !toStationId || fromStationId === toStationId) return;`
  // guard in recordRouteDeliveryFromTransfer. Without it, an incoming transfer
  // at home from a ship with targetStationId === null would record a route
  // keyed on "null::homeId" — a phantom route the overview window would surface.
  const fixture = makeRouteStatsObserverFixture("NO-TARGET");
  // Force a ship with no targetStationId — mirrors a freshly-enrolled or idle ship.
  fixture.tradeShip.targetStationId = null;
  // Fire an incoming transfer at home; with targetStationId null and toStation=home,
  // fromStationId resolves to null and the guard must short-circuit.
  fireIncomingWaterTransferAtHome(fixture, fixture.tradeShip);
  const tradedRoutes = fixture.manager.getTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 0, "transfer with null fromStationId records no route");

  fixture.manager.destroy();
});

test("recordRouteDeliveryFromTransfer skips transfers where fromStationId === toStationId (home-to-home)", () => {
  // Pin the third clause of the guard — even when both ids resolve to strings,
  // a deposit where from === to is structurally meaningless and must not record.
  // Reaches the clause via a ship whose targetStationId is also the home id
  // (e.g. a misconfigured trip that round-trips to home), with the deposit at home.
  const fixture = makeRouteStatsObserverFixture("SELF-LOOP");
  fixture.tradeShip.targetStationId = fixture.homeStation.id;
  fireIncomingWaterTransferAtHome(fixture, fixture.tradeShip);
  const tradedRoutes = fixture.manager.getTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 0, "transfer where from === to records no route");

  fixture.manager.destroy();
});

test("recordRouteDeliveryFromTransfer skips deliveries whose consumer station is emigrating", () => {
  // Fire the transfer observer directly (like the ORPHAN / NO-TARGET /
  // SELF-LOOP tests). depositWaterAtHome → applyDepositAction has its own
  // emigrating short-circuit that would mask this guard, so go straight to the
  // observer. Pin: consumer (toStation) state === "emigrating" → not recorded.
  const fixture = makeRouteStatsObserverFixture("EMIG-CONSUMER");
  fixture.homeStation.state = "emigrating";

  fireIncomingWaterTransferAtHome(fixture, fixture.tradeShip);

  const tradedRoutes = fixture.manager.getTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 0, "delivery to an emigrating consumer is not recorded");

  fixture.manager.destroy();
});

test("recordRouteDeliveryFromTransfer skips deliveries whose producer station is emigrating", () => {
  // Symmetric case: the producer (pickup) station is emigrating. The ship was
  // dispatched before the flip and completes its run after it.
  const fixture = makeRouteStatsObserverFixture("EMIG-PRODUCER");
  fixture.producer.state = "emigrating";

  depositWaterAtHome(fixture);

  const tradedRoutes = fixture.manager.getTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 0, "delivery from an emigrating producer is not recorded");

  fixture.manager.destroy();
});

test("recordRouteDeliveryFromTransfer skips deliveries whose producer station was already removed", () => {
  // During emigration wind-down a producer can be removed while a ship is mid-
  // flight delivering from it. Resolving fromStationId then yields undefined.
  // Pin: unresolvable producer → skip (otherwise a phantom route from the
  // removed station to home would record).
  const fixture = makeRouteStatsObserverFixture("EMIG-REMOVED");
  fixture.tradeShip.targetStationId = "REMOVED-PRODUCER-ID";

  depositWaterAtHome(fixture);

  const tradedRoutes = fixture.manager.getTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 0, "delivery from an unresolvable producer is not recorded");

  fixture.manager.destroy();
});

test("two TradeManagers record route stats independently — observer captures its own shipResolver", () => {
  // Regression pin: the constructor's tradeTransferObserver closes over `this`
  // and reads `this.shipResolver(...)`. Two coexistent managers each see only
  // their own stations + ships, so a deposit on manager A must not appear in
  // manager B's getTradedRoutes() and vice versa.
  const managerAFixture = makeRouteStatsObserverFixture("ISO-A");
  const managerBFixture = makeRouteStatsObserverFixture("ISO-B");

  // Fire one deposit on each manager.
  depositWaterAtHome(managerAFixture);
  depositWaterAtHome(managerBFixture);

  const aRoutes = managerAFixture.manager.getTradedRoutes(0, Infinity);
  const bRoutes = managerBFixture.manager.getTradedRoutes(0, Infinity);

  assertEqual(aRoutes.length, 1, "manager A sees exactly one route");
  assertEqual(bRoutes.length, 1, "manager B sees exactly one route");
  assertTrue(
    aRoutes[0].fromStationId === managerAFixture.producer.id &&
      aRoutes[0].toStationId === managerAFixture.homeStation.id,
    "A's route is producer-A → home-A",
  );
  assertTrue(
    bRoutes[0].fromStationId === managerBFixture.producer.id &&
      bRoutes[0].toStationId === managerBFixture.homeStation.id,
    "B's route is producer-B → home-B",
  );

  managerAFixture.manager.destroy();
  managerBFixture.manager.destroy();
});

test("clearTradeRouteHistory wipes recorded routes and the per-window cache", () => {
  // The overview polls getTradedRoutes(now, window) every 500ms; that result
  // is cached in routesCacheByWindow and refreshed after a game-time interval.
  // Clearing only the event store would still return the stale cached window.
  // Pin both: query a window first (populates the cache), clear, re-query at the same `now`.
  const fixture = makeRouteStatsObserverFixture("CLEAR");

  depositWaterAtHome(fixture);
  assertEqual(fixture.manager.getTradedRoutes(0, Infinity).length, 1, "one route before clear");

  fixture.manager.clearTradeRouteHistory();

  assertEqual(
    fixture.manager.getTradedRoutes(0, Infinity).length,
    0,
    "no routes after clear (event store + window cache both wiped)",
  );

  fixture.manager.destroy();
});
