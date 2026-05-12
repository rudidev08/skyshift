// --- Trade-route stats observer ---
//
// These tests construct mock stations + ships outside any sim and use a
// dedicated mock TradeManager. The manager's deposit observer fires the
// route-stats recording, so the assertion can read tradeManager.getOrRefreshTradedRoutes(...).

import { economyConfig } from "../../data/economy-config.ts";
import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { createStation, getInventorySlot } from "../sim-station.ts";
import { TradeManager } from "../sim-trade-manager.ts";
import { type TradeShip } from "../sim-trade-types.ts";
import { processDepositAction } from "../sim-trade-queue.ts";
import type { Ship } from "../sim-ships.ts";
import type { Station } from "../sim-station-types.ts";
import { makeMockStationPlacement } from "./trade-test-fixtures.ts";

interface RouteStatsObserverFixture {
  manager: TradeManager;
  ship: TradeShip;
  producer: Station;
  home: Station;
  orbitingShip: Ship;
}

/** Producer + home stations, an orbiting ship, a TradeManager wired to read both, and a TradeShip ready to deposit 500 water at home. */
function makeRouteStatsObserverFixture(idPrefix: string): RouteStatsObserverFixture {
  const producer = createStation(makeMockStationPlacement({
    id: `${idPrefix}-SRC`,
    stationTypeId: "water-processing",
    size: "M",
    x: -100,
  }));
  const home = createStation(makeMockStationPlacement({
    id: `${idPrefix}-HOME`,
    stationTypeId: "farm",
    size: "M",
    x: 100,
  }));
  const homeWaterSlot = getInventorySlot(home, "water")!;
  homeWaterSlot.current = 0;

  const stationsById = new Map<string, Station>([[producer.id, producer], [home.id, home]]);
  const shipsById = new Map<string, Ship>();
  const orbitingShip: Ship = {
    station: home,
    shipTypeId: "trader",
    id: `${idPrefix}-SHIP`,
    shipName: `${idPrefix} Ship`,
  };
  shipsById.set(orbitingShip.id, orbitingShip);

  const manager = new TradeManager({
    stationManager: { getStation: (id: string) => stationsById.get(id) },
    shipManager: { getShip: (id: string) => shipsById.get(id) },
  });

  const ship: TradeShip = {
    reservations: [],
    cargoAmountByWareId: new Map([[homeWaterSlot.ware.id, 500]]),
    actionQueue: [],
    flight: null,
    targetStationId: producer.id,
    tradeDirection: "buy",
    lastHeading: null,
    idleStartTime: 0,
    homeStationId: home.id,
    orbitingShipId: orbitingShip.id,
  };
  return { manager, ship, producer, home, orbitingShip };
}

/** Refill the ship from cargo and re-fire a 500-water deposit at home. */
function depositFullWaterLoadAtHome(fixture: RouteStatsObserverFixture): void {
  const homeWaterSlot = getInventorySlot(fixture.home, "water")!;
  homeWaterSlot.current = 0;
  fixture.ship.cargoAmountByWareId = new Map([[homeWaterSlot.ware.id, 500]]);
  processDepositAction(fixture.ship, {
    type: "cargo-deposit",
    station: fixture.home,
    wareId: "water",
    amount: 500,
  }, fixture.manager);
}

test("deposit route stats record the pickup station as the source for buy deliveries", () => {
  const fixture = makeRouteStatsObserverFixture("WATER");

  depositFullWaterLoadAtHome(fixture);

  const tradedRoutes = fixture.manager.getOrRefreshTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 1, "delivery should create exactly one traded route");
  assertTrue(
    tradedRoutes[0].fromStationId === fixture.producer.id && tradedRoutes[0].toStationId === fixture.home.id,
    "delivery should record producer -> home instead of home -> home",
  );
  // fillFraction is amount / cargoCapacity. Trader capacity is 2500, deposit
  // is 500 water → 0.2. Pinning this catches a `/` → `*` mutation in the
  // event-builder that would silently inflate per-route activity totals.
  assertEqual(tradedRoutes[0].totalActivity, 0.2, "totalActivity matches amount / capacity");

  fixture.manager.dispose();
});

test("delivery event records its time as the manager's current tradeTime, not zero", () => {
  // Pin the recordDelivery event's `time` field to manager.tradeTime. A mutation
  // that hard-codes time=0 would silently break window queries — windows like
  // "last hour" rely on event.time matching live tradeTime so old events fall
  // outside the cutoff. Verify by recording at tradeTime=200, then querying a
  // window that includes [now-150 .. now] and confirming the delivery is in.
  const fixture = makeRouteStatsObserverFixture("TIME");
  fixture.manager.advanceTradeTime(200);
  depositFullWaterLoadAtHome(fixture);

  // Window covers tradeTime ∈ [50, 200]. With time: tradeTime=200 the delivery
  // is included; with time: 0 the cutoff (50) excludes it.
  const inWindow = fixture.manager.tradeRouteStats.getRouteStatsInWindow(200, 150);
  assertEqual(inWindow.length, 1, "delivery falls inside the [now-150, now] window");

  fixture.manager.dispose();
});

test("traded-route cache refreshes after 30 game seconds instead of wall-clock polling", () => {
  const fixture = makeRouteStatsObserverFixture("CACHE");

  depositFullWaterLoadAtHome(fixture);
  const first = fixture.manager.getOrRefreshTradedRoutes(0, Infinity);

  depositFullWaterLoadAtHome(fixture);
  const second = fixture.manager.getOrRefreshTradedRoutes(0, Infinity);
  assertTrue(second === first, "cache should stay warm before the game-time refresh boundary");

  // Just before the refresh boundary still returns the cached reference —
  // pins the `<` (not `<=`) check so a +1 off-by-one mutation is caught.
  const justBefore = fixture.manager.getOrRefreshTradedRoutes(economyConfig.tradeRouteCacheRefreshSeconds - 1, Infinity);
  assertTrue(justBefore === first, "cache should stay warm just before the boundary");

  const refreshed = fixture.manager.getOrRefreshTradedRoutes(economyConfig.tradeRouteCacheRefreshSeconds, Infinity);
  assertTrue(refreshed !== first, "cache should refresh at the configured game-time window");
  assertEqual(refreshed[0].totalDeliveries, 2, "refreshed stats should include the later delivery");

  fixture.manager.dispose();
});

test("recordRouteDeliveryFromTransfer ignores transfers whose ship is no longer registered", () => {
  // Pin the `if (!orbitingShip) return;` guard in recordRouteDeliveryFromTransfer.
  // Dropping the guard would let getShipTemplate(undefined.shipTypeId) throw on
  // a transfer fired during the gap between deregister and queue drain — a
  // race the production decommission flow exercises. Verify by firing a
  // synthetic transfer event whose ship id is absent from the resolver and
  // confirming no route stats are recorded (and no exception escapes).
  const fixture = makeRouteStatsObserverFixture("ORPHAN");
  // Fire a transfer for a TradeShip the manager's shipResolver can't find.
  const orphanTradeShip: TradeShip = {
    ...fixture.ship,
    orbitingShipId: "no-such-ship-in-resolver",
  };
  for (const observer of fixture.manager.tradeTransferObservers) {
    observer({
      amount: 500,
      ship: orphanTradeShip,
      station: fixture.home,
      cargoDirection: "incoming",
      wareId: "water",
    });
  }

  // Without the guard, getShipTemplate(undefined.shipTypeId) would have thrown
  // before this assertion runs. With the guard, the orphan transfer is skipped
  // silently and no route stats are recorded.
  const tradedRoutes = fixture.manager.getOrRefreshTradedRoutes(0, Infinity);
  assertEqual(tradedRoutes.length, 0, "orphan transfer is ignored by route stats");

  fixture.manager.dispose();
});

test("two TradeManagers record route stats independently — observer captures its own shipResolver", () => {
  // Regression pin: the constructor's tradeTransferObserver closes over `this`
  // and reads `this.shipResolver(...)`. Two coexistent managers each see only
  // their own stations + ships, so a deposit on manager A must not appear in
  // manager B's getOrRefreshTradedRoutes() and vice versa.
  const managerAFixture = makeRouteStatsObserverFixture("ISO-A");
  const managerBFixture = makeRouteStatsObserverFixture("ISO-B");

  // Fire one deposit on each manager, in interleaved order.
  processDepositAction(managerAFixture.ship, { type: "cargo-deposit", station: managerAFixture.home, wareId: "water", amount: 500 }, managerAFixture.manager);
  processDepositAction(managerBFixture.ship, { type: "cargo-deposit", station: managerBFixture.home, wareId: "water", amount: 500 }, managerBFixture.manager);

  const aRoutes = managerAFixture.manager.getOrRefreshTradedRoutes(0, Infinity);
  const bRoutes = managerBFixture.manager.getOrRefreshTradedRoutes(0, Infinity);

  assertEqual(aRoutes.length, 1, "manager A sees exactly one route");
  assertEqual(bRoutes.length, 1, "manager B sees exactly one route");
  assertTrue(aRoutes[0].fromStationId === managerAFixture.producer.id && aRoutes[0].toStationId === managerAFixture.home.id, "A's route is producer-A → home-A");
  assertTrue(bRoutes[0].fromStationId === managerBFixture.producer.id && bRoutes[0].toStationId === managerBFixture.home.id, "B's route is producer-B → home-B");

  managerAFixture.manager.dispose();
  managerBFixture.manager.dispose();
});
