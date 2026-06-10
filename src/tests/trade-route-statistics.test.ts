import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  createTradeRouteStatistics,
  type DeliveryEvent,
  sumWareTradeTotals,
} from "../sim-trade-route-statistics.ts";
import { totalActivity } from "./trade-test-fixtures.ts";

// The live path is recordDelivery → getRouteStatsInWindow (the dead
// default-window query + internal cache layer and the unread
// volume/deliveryCount/total* aggregates were removed). These pin the
// surviving aggregation: per-ware fill-fraction activity over a window.

const DEFAULT_WINDOW_SECONDS = 600;

function createDeliveryEvent(overrides: Partial<DeliveryEvent>): DeliveryEvent {
  return {
    timeSeconds: 0,
    fromStationId: "A",
    toStationId: "B",
    wareId: "water",
    fillFraction: 1,
    ...overrides,
  };
}

function makeRouteStatistics() {
  return createTradeRouteStatistics({ windowSeconds: DEFAULT_WINDOW_SECONDS });
}

test("aggregates per-ware activity per station pair", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 10, fillFraction: 0.5 }));
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 20, fillFraction: 0.5 }));
  const routes = routeStatistics.getRouteStatsInWindow(25, DEFAULT_WINDOW_SECONDS);
  assertEqual(routes.length, 1, "route count");
  assertEqual(routes[0].fromStationId, "A", "from station");
  assertEqual(routes[0].toStationId, "B", "to station");
  assertEqual(routes[0].wares.length, 1, "wares length");
  assertEqual(routes[0].wares[0].wareId, "water", "aggregated ware id");
  assertEqual(routes[0].wares[0].activity, 1, "two half-full trips sum to one shipment of activity");
});

test("drops events older than the query window", () => {
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 0, fillFraction: 1 }));
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 700, fillFraction: 0.5 }));
  const routes = routeStatistics.getRouteStatsInWindow(700, DEFAULT_WINDOW_SECONDS);
  assertEqual(totalActivity(routes[0]), 0.5, "only the in-window delivery is aggregated");
});

test("event at exactly the cutoff is kept (window is half-open)", () => {
  // Pins both cutoff comparisons (the on-insert prune and the in-window
  // computation) using `<`, not `<=`. An event timestamped at the cutoff itself
  // must stay inside the retained window — catches a `< → <=` mutation that
  // would silently shorten the window by one tick on either path.
  // Binary-exact fractions (0.5 + 0.25) so the activity sum has no float noise.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 100, fillFraction: 0.5 }));
  // Triggering insert-side prune at time=700 sets cutoff=100. With `<`, the
  // event at 100 survives; with `<=`, it would be evicted.
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 700, fillFraction: 0.25 }));

  const fromInWindow = routeStatistics.getRouteStatsInWindow(700, 600);
  assertEqual(totalActivity(fromInWindow[0]), 0.75, "in-window query keeps boundary event");

  // Querying via Infinity skips the cutoff filter, so any difference in the
  // surviving event count is the insert-side prune's doing.
  const fromInfinity = routeStatistics.getRouteStatsInWindow(700, Infinity);
  assertEqual(totalActivity(fromInfinity[0]), 0.75, "boundary event survived insert-time prune");
});

test("insert-side prune physically drops events past the finite default window", () => {
  // Pin that the finite-window insert prune actually runs. The events array is
  // private, so observe the prune's effect through a wider (Infinity) query:
  // an event strictly older than the default-window cutoff must be physically
  // gone after a later insert triggers the prune, even when a no-cutoff query
  // would otherwise still include it. Inverting the `!Number.isFinite(...)`
  // early-return guard (or dropping the pruneEventsOutsideDefaultWindow call)
  // would skip the prune for finite windows, so the stale 0.6 event would
  // resurface here — 1.0 total (0.6 + 0.4) instead of 0.4.
  const routeStatistics = makeRouteStatistics();
  // Stale event at t=0; default window is 600s.
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 0, fillFraction: 0.6 }));
  // Insert at t=700 sets cutoff=100, and t=0 < 100 → the stale event is dropped
  // from the underlying store on this insert.
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 700, fillFraction: 0.4 }));

  // Infinity query has no cutoff filter, so it would surface the t=0 event if it
  // were still stored. It must not be — only the t=700 event remains.
  const fromInfinity = routeStatistics.getRouteStatsInWindow(700, Infinity);
  assertEqual(totalActivity(fromInfinity[0]), 0.4, "stale pre-window event was pruned on insert, not retained");
});

test("query window narrower than retention excludes still-stored events", () => {
  // Pin the in-window cutoff filter in getRouteStatsInWindow for the case the
  // production overview actually hits: the live query window (2h) is narrower
  // than the retention window (3h), so events older than the query window are
  // still in the store but must be filtered out of the result. The insert-side
  // prune can't mask this — it only trims to the wider retention window.
  // Dropping the `if (event.timeSeconds < cutoff) continue;` line (or flipping
  // its comparison) would let the older event leak into the narrow window.
  const routeStatistics = makeRouteStatistics(); // retention 600s
  // Event at t=100 stays in the store (insert prune at t=700 sets cutoff=100,
  // and 100 is not < 100, so it survives retention).
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 100, fillFraction: 0.5 }));
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 700, fillFraction: 0.25 }));

  // Narrow query: window 100 at now=700 → cutoff 600. The t=100 event is in the
  // store but outside this window; only the t=700 event counts.
  const narrow = routeStatistics.getRouteStatsInWindow(700, 100);
  assertEqual(totalActivity(narrow[0]), 0.25, "narrow query excludes the still-stored older event");

  // Sanity: the t=100 event really is still stored — a wide query surfaces it.
  const wide = routeStatistics.getRouteStatsInWindow(700, Infinity);
  assertEqual(totalActivity(wide[0]), 0.75, "older event remains in the store for a wider window");
});

test("never prunes when window is Infinity", () => {
  const routeStatistics = createTradeRouteStatistics({ windowSeconds: Infinity });
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 0, fillFraction: 1 }));
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 999999, fillFraction: 0.5 }));
  const routes = routeStatistics.getRouteStatsInWindow(999999, Infinity);
  assertEqual(totalActivity(routes[0]), 1.5, "all events retained under Infinity retention");
});

test("treats A->B and B->A as distinct routes", () => {
  // Pin pairKey participation of both endpoints. A `pairKey(from, to)` →
  // `pairKey(from, from)` (or any single-endpoint key) collapses outbound
  // and return traffic into one row — masking back-haul vs primary direction.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(
    createDeliveryEvent({ timeSeconds: 1, fromStationId: "A", toStationId: "B", fillFraction: 0.5 }),
  );
  routeStatistics.recordDelivery(
    createDeliveryEvent({ timeSeconds: 2, fromStationId: "B", toStationId: "A", fillFraction: 0.7 }),
  );
  const routes = routeStatistics.getRouteStatsInWindow(3, DEFAULT_WINDOW_SECONDS);
  assertEqual(routes.length, 2, "two distinct directional routes");
  const ab = routes.find((route) => route.fromStationId === "A" && route.toStationId === "B")!;
  const ba = routes.find((route) => route.fromStationId === "B" && route.toStationId === "A")!;
  assertEqual(totalActivity(ab), 0.5, "A->B activity");
  assertEqual(totalActivity(ba), 0.7, "B->A activity");
});

test("treats A->B and A->C as distinct routes (toStationId participates in pair key)", () => {
  // Pin pairKey using BOTH endpoints. A `pairKey(from, to)` → `pairKey(from, from)`
  // mutation drops toStationId from the key, collapsing every outbound from A
  // into a single row attributed to whichever destination arrived first.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(
    createDeliveryEvent({ timeSeconds: 1, fromStationId: "A", toStationId: "B", fillFraction: 0.5 }),
  );
  routeStatistics.recordDelivery(
    createDeliveryEvent({ timeSeconds: 2, fromStationId: "A", toStationId: "C", fillFraction: 0.7 }),
  );
  const routes = routeStatistics.getRouteStatsInWindow(3, DEFAULT_WINDOW_SECONDS);
  assertEqual(routes.length, 2, "two distinct destinations off A");
  const toB = routes.find((route) => route.toStationId === "B")!;
  const toC = routes.find((route) => route.toStationId === "C")!;
  assertEqual(totalActivity(toB), 0.5, "A->B kept its own bucket");
  assertEqual(totalActivity(toC), 0.7, "A->C kept its own bucket");
});

test("sums fillFraction into per-ware activity", () => {
  const routeStatistics = makeRouteStatistics();
  // Two half-full water deliveries → 1.0 water activity.
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 1, wareId: "water", fillFraction: 0.5 }));
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 2, wareId: "water", fillFraction: 0.5 }));
  // One full metal delivery → 1.0 metal activity.
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 3, wareId: "metal", fillFraction: 1 }));
  const [route] = routeStatistics.getRouteStatsInWindow(4, DEFAULT_WINDOW_SECONDS);
  const water = route.wares.find((ware) => ware.wareId === "water")!;
  const metal = route.wares.find((ware) => ware.wareId === "metal")!;
  assertEqual(water.activity, 1, "water activity sums to 1");
  assertEqual(metal.activity, 1, "metal activity sums to 1");
  assertEqual(totalActivity(route), 2, "route activity sums per-ware activities");
});

test("clear drops all recorded events", () => {
  // clear() runs from destroy() (teardown) and seedInitialTradeShips() (fresh
  // seeding). Stale events would surface old route data after either.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 10, fillFraction: 0.4 }));
  assertEqual(
    routeStatistics.getRouteStatsInWindow(11, DEFAULT_WINDOW_SECONDS).length,
    1,
    "precondition: route present",
  );

  routeStatistics.clear();
  assertEqual(
    routeStatistics.getRouteStatsInWindow(11, DEFAULT_WINDOW_SECONDS).length,
    0,
    "no routes after clear",
  );
});

test("sumWareTradeTotals aggregates fill-equivalent trade totals across routes", () => {
  // Two water deliveries on different routes (quarter-fill + three-quarters) and
  // one full-fill metal delivery — pins the surviving cross-route aggregator.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(
    createDeliveryEvent({ timeSeconds: 1, fromStationId: "A", toStationId: "B", wareId: "water", fillFraction: 0.25 }),
  );
  routeStatistics.recordDelivery(
    createDeliveryEvent({ timeSeconds: 2, fromStationId: "C", toStationId: "D", wareId: "water", fillFraction: 0.75 }),
  );
  routeStatistics.recordDelivery(
    createDeliveryEvent({ timeSeconds: 3, fromStationId: "A", toStationId: "B", wareId: "metal", fillFraction: 1 }),
  );
  const allRoutes = routeStatistics.getRouteStatsInWindow(4, DEFAULT_WINDOW_SECONDS);
  const tradeTotals = sumWareTradeTotals(allRoutes);
  assertEqual(tradeTotals.get("water") ?? 0, 1, "water aggregate trade total");
  assertEqual(tradeTotals.get("metal") ?? 0, 1, "metal aggregate trade total");
});

test("route stats expose activity + ware id but no volume/dominant/total aggregates", () => {
  // Guards items 16+17: the overlay reads only fromStationId/toStationId and
  // each ware's wareId + activity. The dropped aggregates
  // (totalVolume/totalActivity/totalDeliveries/dominantWareId/lastDeliveryTime,
  // per-ware volume/deliveryCount/lastDeliveryTime) must NOT reappear. Under
  // the OLD shape these keys existed (and the old tests asserted them at
  // totalVolume/dominantWareId/etc.), so this assertion fails pre-removal.
  const routeStatistics = makeRouteStatistics();
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 1, wareId: "water", fillFraction: 0.5 }));
  routeStatistics.recordDelivery(createDeliveryEvent({ timeSeconds: 2, wareId: "metal", fillFraction: 1 }));
  const [route] = routeStatistics.getRouteStatsInWindow(3, DEFAULT_WINDOW_SECONDS);

  // The shape the overlay actually consumes is present.
  assertTrue(typeof route.fromStationId === "string", "fromStationId present");
  assertTrue(typeof route.toStationId === "string", "toStationId present");
  for (const ware of route.wares) {
    assertTrue(typeof ware.wareId === "string", "ware carries wareId");
    assertTrue(typeof ware.activity === "number", "ware carries activity");
  }

  const routeKeys = Object.keys(route).sort();
  assertEqual(
    routeKeys.join(","),
    "fromStationId,toStationId,wares",
    "RouteStats exposes only fromStationId/toStationId/wares (no total* / dominantWareId / lastDeliveryTime)",
  );
  const wareKeys = Object.keys(route.wares[0]).sort();
  assertEqual(
    wareKeys.join(","),
    "activity,wareId",
    "RouteWareStat exposes only wareId/activity (no volume / deliveryCount / lastDeliveryTime)",
  );
});
