import { economyConfig } from "../../data/economy-config.ts";
import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  createTradeRouteStatistics,
  type DeliveryEvent,
  getWareDeliveryCounts,
  getWareTradeTotals,
} from "../sim-trade-route-statistics.ts";

function deliveryEvent(overrides: Partial<DeliveryEvent>): DeliveryEvent {
  return {
    time: 0,
    fromStationId: "A",
    toStationId: "B",
    wareId: "water",
    amount: 10,
    fillFraction: 1,
    ...overrides,
  };
}

function makeRouteStatistics() {
  return createTradeRouteStatistics({
    windowSeconds: 600,
    cacheRefreshSeconds: economyConfig.tradeRouteCacheRefreshSeconds,
  });
}

test("aggregates volume per station pair + ware", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 10, amount: 5 }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 20, amount: 7 }));
  const routes = routeStatistics.getAllRouteStats(25);
  assertEqual(routes.length, 1, "route count");
  assertEqual(routes[0].totalVolume, 12, "totalVolume");
  assertEqual(routes[0].wares.length, 1, "wares length");
  // Split per field so a regression names the field, not a generic
  // "ware entry matches" label.
  assertEqual(routes[0].wares[0].wareId, "water", "aggregated ware id");
  assertEqual(routes[0].wares[0].volume, 12, "aggregated volume");
  assertEqual(routes[0].wares[0].lastDeliveryTime, 20, "last delivery timestamp");
  assertEqual(routes[0].lastDeliveryTime, 20, "route lastDeliveryTime is the latest ware lastDeliveryTime");
});

test("route lastDeliveryTime tracks the most recent delivery across wares", () => {
  // Route-level lastDeliveryTime is the max across wares, not the latest
  // record inserted — pins the `>` comparison so a flipped aggregator is caught.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 10, wareId: "water" }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 50, wareId: "metal" }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 30, wareId: "water" }));
  const [route] = routeStatistics.getAllRouteStats(60);
  assertEqual(route.lastDeliveryTime, 50, "lastDeliveryTime is the maximum across wares");
});

test("drops events older than the window", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 0, amount: 100 }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 700, amount: 3 }));
  const routes = routeStatistics.getAllRouteStats(700);
  assertEqual(routes[0].totalVolume, 3, "pruned total");
});

test("event at exactly the cutoff is kept (window is half-open)", () => {
  // Pins both cutoff comparisons (the on-insert prune and the in-window
  // computation) using `<`, not `<=`. An event timestamped at the cutoff itself
  // must stay inside the retained window — catches a `< → <=` mutation that
  // would silently shorten the window by one tick on either path.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 100, amount: 7 }));
  // Triggering insert-side prune at time=700 sets cutoff=100. With `<`, the
  // event at 100 survives; with `<=`, it would be evicted.
  routeStatistics.recordDelivery(deliveryEvent({ time: 700, amount: 1 }));

  const fromInWindow = routeStatistics.getRouteStatsInWindow(700, 600);
  assertEqual(fromInWindow[0].totalVolume, 8, "in-window query keeps boundary event");

  // Querying via Infinity skips the cutoff filter, so any difference in the
  // surviving event count is the insert-side prune's doing.
  const fromInfinity = routeStatistics.getRouteStatsInWindow(700, Infinity);
  assertEqual(fromInfinity[0].totalVolume, 8, "boundary event survived insert-time prune");
});

test("never prunes when window is Infinity", () => {
  const routeStatistics = createTradeRouteStatistics({
    windowSeconds: Infinity,
    cacheRefreshSeconds: economyConfig.tradeRouteCacheRefreshSeconds,
  });
  routeStatistics.recordDelivery(deliveryEvent({ time: 0, amount: 100 }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 999999, amount: 3 }));
  const routes = routeStatistics.getRouteStatsInWindow(999999, Infinity);
  assertEqual(routes[0].totalVolume, 103, "all events retained under Infinity retention");
});

test("returns cached stats until TTL elapses", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 10, amount: 4 }));
  const first = routeStatistics.getAllRouteStats(11);
  routeStatistics.recordDelivery(deliveryEvent({ time: 12, amount: 4 }));
  const second = routeStatistics.getAllRouteStats(12);
  assertTrue(second === first, "second call returns cached reference");
  // Just before the TTL boundary still returns the cached reference — pins
  // the `<` (not `<=`) check so a +1 mutation is caught.
  const justBeforeBoundary = routeStatistics.getAllRouteStats(11 + economyConfig.tradeRouteCacheRefreshSeconds - 1);
  assertTrue(justBeforeBoundary === first, "just before TTL boundary returns cached reference");
  // At the TTL boundary the cache refreshes — pins the strict-less-than
  // semantics so a `<` → `<=` mutation is caught.
  const atBoundary = routeStatistics.getAllRouteStats(11 + economyConfig.tradeRouteCacheRefreshSeconds);
  assertTrue(atBoundary !== first, "at TTL boundary returns fresh reference");
  assertEqual(atBoundary[0].totalVolume, 8, "fresh total");
});

test("filters by station via getStatsForStation", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 1, fromStationId: "A", toStationId: "B" }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 2, fromStationId: "C", toStationId: "D" }));
  assertEqual(routeStatistics.getStatsForStation("A", 3).length, 1, "A matches");
  assertEqual(routeStatistics.getStatsForStation("D", 3).length, 1, "D matches");
  assertEqual(routeStatistics.getStatsForStation("Z", 3).length, 0, "Z does not match");
});

test("picks the dominant ware per pair", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 1, wareId: "water", amount: 3 }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 2, wareId: "metal", amount: 8 }));
  const [route] = routeStatistics.getAllRouteStats(3);
  assertTrue(route.dominantWareId === "metal", "dominant is metal");
  // Pin totalVolume aggregates ACROSS wares. Mutating the running sum to
  // an assignment (`totalVolume = wareTotals.volume`) would only register
  // the last ware in iteration order — single-ware routes wouldn't catch it.
  assertEqual(route.totalVolume, 11, "totalVolume sums across wares (3 + 8)");
});

test("sums fillFraction into per-ware activity and route totalActivity", () => {
  const routeStatistics = makeRouteStatistics();
  // Two half-full water deliveries → 1.0 water activity.
  routeStatistics.recordDelivery(deliveryEvent({ time: 1, wareId: "water", fillFraction: 0.5 }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 2, wareId: "water", fillFraction: 0.5 }));
  // One full metal delivery → 1.0 metal activity.
  routeStatistics.recordDelivery(deliveryEvent({ time: 3, wareId: "metal", fillFraction: 1 }));
  const [route] = routeStatistics.getAllRouteStats(4);
  const water = route.wares.find((ware) => ware.wareId === "water")!;
  const metal = route.wares.find((ware) => ware.wareId === "metal")!;
  assertEqual(water.activity, 1, "water activity sums to 1");
  assertEqual(metal.activity, 1, "metal activity sums to 1");
  assertEqual(route.totalActivity, 2, "totalActivity sums per-ware activities");
});

test("tracks delivery counts per ware and per route", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 1, wareId: "water" }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 2, wareId: "water" }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 3, wareId: "metal" }));
  const [route] = routeStatistics.getAllRouteStats(4);
  const water = route.wares.find((ware) => ware.wareId === "water")!;
  const metal = route.wares.find((ware) => ware.wareId === "metal")!;
  assertEqual(water.deliveryCount, 2, "water deliveryCount");
  assertEqual(metal.deliveryCount, 1, "metal deliveryCount");
  assertEqual(route.totalDeliveries, 3, "route totalDeliveries");
});

test("clear drops events AND invalidates the cache", () => {
  // clear() is called when loadFromSnapshot rebuilds the trade manager state.
  // Stale cached stats would surface old route data after a load.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 10, amount: 4 }));
  // Warm the cache.
  const before = routeStatistics.getAllRouteStats(11);
  assertEqual(before.length, 1, "precondition: route present");

  routeStatistics.clear();
  // Pin both effects: a query within the cache TTL must NOT return the stale
  // cached array — dropping the cache-reset would let it survive across clear.
  const after = routeStatistics.getAllRouteStats(11);
  assertEqual(after.length, 0, "no routes after clear");
  assertTrue(after !== before, "cache reference invalidated, not the stale array");
});

test("aggregates per-ware delivery counts and fill-equivalent trade totals across routes", () => {
  // Two water deliveries on different routes (quarter-fill + three-quarters) and
  // one full-fill metal delivery — one seed covers both helpers' aggregations.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(deliveryEvent({ time: 1, fromStationId: "A", toStationId: "B", wareId: "water", fillFraction: 0.25 }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 2, fromStationId: "C", toStationId: "D", wareId: "water", fillFraction: 0.75 }));
  routeStatistics.recordDelivery(deliveryEvent({ time: 3, fromStationId: "A", toStationId: "B", wareId: "metal", fillFraction: 1 }));
  const allRoutes = routeStatistics.getAllRouteStats(4);
  const deliveryCounts = getWareDeliveryCounts(allRoutes);
  const tradeTotals = getWareTradeTotals(allRoutes);
  assertEqual(deliveryCounts.get("water") ?? 0, 2, "water aggregate delivery count");
  assertEqual(deliveryCounts.get("metal") ?? 0, 1, "metal aggregate delivery count");
  assertEqual(tradeTotals.get("water") ?? 0, 1, "water aggregate trade total");
  assertEqual(tradeTotals.get("metal") ?? 0, 1, "metal aggregate trade total");
});
