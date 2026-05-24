import type { WareId } from "../data/ware-types";

export type StationId = string;

export interface DeliveryEvent {
  timeSeconds: number;
  fromStationId: StationId;
  toStationId: StationId;
  wareId: WareId;
  /** Ship cargo / capacity for this delivery, in [0, 1]. Summed into `activity`
   *  so two half-full trips count as one full shipment for "N shipments" labels. */
  fillFraction: number;
}

export interface RouteWareStat {
  wareId: WareId;
  /** Sum of fillFraction across deliveries of this ware on this route in window. */
  activity: number;
}

export interface RouteStats {
  fromStationId: StationId;
  toStationId: StationId;
  wares: RouteWareStat[];
}

export interface TradeRouteStatisticsOptions {
  windowSeconds: number;
}

export interface TradeRouteStatistics {
  recordDelivery(event: DeliveryEvent): void;
  /** Stats over a custom window (seconds back from now). Pass Infinity for
   *  all-time. Recomputes each call. */
  getRouteStatsInWindow(nowSeconds: number, windowSeconds: number): RouteStats[];
  clear(): void;
}

export function sumWareTradeTotals(routeStats: ReadonlyArray<RouteStats>): Map<WareId, number> {
  const tradeTotalByWareId = new Map<WareId, number>();
  for (const routeStat of routeStats) {
    for (const wareStat of routeStat.wares) {
      tradeTotalByWareId.set(
        wareStat.wareId,
        (tradeTotalByWareId.get(wareStat.wareId) ?? 0) + wareStat.activity,
      );
    }
  }
  return tradeTotalByWareId;
}

function pairKey(fromStationId: StationId, toStationId: StationId): string {
  return `${fromStationId}::${toStationId}`;
}

interface RouteTotals {
  fromStationId: StationId;
  toStationId: StationId;
  activityByWareId: Map<WareId, number>;
}

type TotalsByRoute = Map<string, RouteTotals>;

/** Creates the route and ware buckets on first use; existing buckets accumulate. */
function addDeliveryToTotals(event: DeliveryEvent, totalsByRoute: TotalsByRoute): void {
  const key = pairKey(event.fromStationId, event.toStationId);
  let routeTotals = totalsByRoute.get(key);
  if (!routeTotals) {
    routeTotals = {
      fromStationId: event.fromStationId,
      toStationId: event.toStationId,
      activityByWareId: new Map(),
    };
    totalsByRoute.set(key, routeTotals);
  }
  const activity = routeTotals.activityByWareId.get(event.wareId) ?? 0;
  routeTotals.activityByWareId.set(event.wareId, activity + event.fillFraction);
}

function buildRouteStatsFromWareTotals(routeTotals: RouteTotals): RouteStats {
  const wares: RouteWareStat[] = [];
  for (const [wareId, activity] of routeTotals.activityByWareId) {
    wares.push({ wareId, activity });
  }
  return {
    fromStationId: routeTotals.fromStationId,
    toStationId: routeTotals.toStationId,
    wares,
  };
}

export function createTradeRouteStatistics(options: TradeRouteStatisticsOptions): TradeRouteStatistics {
  const events: DeliveryEvent[] = [];

  function pruneEventsOutsideDefaultWindow(nowSeconds: number): void {
    // Only prune when the default window is finite — Infinity retains all events
    // so all-time queries still work via getRouteStatsInWindow.
    if (!Number.isFinite(options.windowSeconds)) return;
    const cutoff = nowSeconds - options.windowSeconds;
    let dropCount = 0;
    while (dropCount < events.length && events[dropCount].timeSeconds < cutoff) dropCount++;
    if (dropCount > 0) events.splice(0, dropCount);
  }

  return {
    recordDelivery(event) {
      events.push(event);
      // Prune at each insert so the events array doesn't grow unbounded between window queries.
      pruneEventsOutsideDefaultWindow(event.timeSeconds);
    },
    getRouteStatsInWindow(nowSeconds, windowSeconds) {
      const cutoff = Number.isFinite(windowSeconds) ? nowSeconds - windowSeconds : -Infinity;
      const totalsByRoute: TotalsByRoute = new Map();
      for (const event of events) {
        if (event.timeSeconds < cutoff) continue;
        addDeliveryToTotals(event, totalsByRoute);
      }
      const routeStatsList: RouteStats[] = [];
      for (const routeTotals of totalsByRoute.values()) {
        routeStatsList.push(buildRouteStatsFromWareTotals(routeTotals));
      }
      return routeStatsList;
    },
    clear() {
      events.length = 0;
    },
  };
}
