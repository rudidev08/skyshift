import type { WareId } from "../data/ware-types";

export type StationId = string;

export interface DeliveryEvent {
  time: number;
  fromStationId: StationId;
  toStationId: StationId;
  wareId: WareId;
  amount: number;
  /** Ship cargo / capacity for this delivery, in [0, 1]. Summed into `activity`
   *  so two half-full trips count as one full shipment for "N shipments" labels. */
  fillFraction: number;
}

export interface RouteWareStat {
  wareId: WareId;
  volume: number;
  /** Sum of fillFraction across deliveries of this ware on this route in window. */
  activity: number;
  /** Number of recorded deliveries for this ware on this route in window. */
  deliveryCount: number;
  lastDeliveryTime: number;
}

export interface RouteStats {
  fromStationId: StationId;
  toStationId: StationId;
  wares: RouteWareStat[];
  totalVolume: number;
  /** Sum of activity across all wares on this route in window. */
  totalActivity: number;
  /** Number of recorded deliveries across all wares on this route in window. */
  totalDeliveries: number;
  dominantWareId: WareId;
  lastDeliveryTime: number;
}

export interface TradeRouteStatisticsOptions {
  windowSeconds: number;
  cacheRefreshSeconds: number;
}

export interface TradeRouteStatistics {
  recordDelivery(event: DeliveryEvent): void;
  /** Stats over the default window (options.windowSeconds). */
  getAllRouteStats(now: number): RouteStats[];
  /** Stats over a custom window (seconds back from now). Pass Infinity for
   *  all-time. Uncached — recomputes each call. */
  getRouteStatsInWindow(now: number, windowSeconds: number): RouteStats[];
  getStatsForStation(stationId: StationId, now: number): RouteStats[];
  /** Drop all recorded events + cached results. */
  clear(): void;
}

export function getWareDeliveryCounts(routeStats: ReadonlyArray<RouteStats>): Map<WareId, number> {
  const deliveryCountByWareId = new Map<WareId, number>();
  for (const routeStat of routeStats) {
    for (const wareStat of routeStat.wares) {
      deliveryCountByWareId.set(
        wareStat.wareId,
        (deliveryCountByWareId.get(wareStat.wareId) ?? 0) + wareStat.deliveryCount,
      );
    }
  }
  return deliveryCountByWareId;
}

export function getWareTradeTotals(routeStats: ReadonlyArray<RouteStats>): Map<WareId, number> {
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

interface RouteWareTotals {
  volume: number;
  activity: number;
  deliveryCount: number;
  lastDeliveryTime: number;
}

interface RouteTotals {
  fromStationId: StationId;
  toStationId: StationId;
  wares: Map<WareId, RouteWareTotals>;
}

type TotalsByRoute = Map<string, RouteTotals>;

/** Add one delivery event to the running totals: bumps volume/activity/deliveryCount/lastDeliveryTime
 *  on that route's ware bucket, creating the route or ware bucket if needed. */
function addDeliveryToTotals(event: DeliveryEvent, totalsByRoute: TotalsByRoute): void {
  const key = pairKey(event.fromStationId, event.toStationId);
  let routeTotals = totalsByRoute.get(key);
  if (!routeTotals) {
    routeTotals = { fromStationId: event.fromStationId, toStationId: event.toStationId, wares: new Map() };
    totalsByRoute.set(key, routeTotals);
  }
  const wareTotals = routeTotals.wares.get(event.wareId);
  if (wareTotals) {
    wareTotals.volume += event.amount;
    wareTotals.activity += event.fillFraction;
    wareTotals.deliveryCount += 1;
    if (event.time > wareTotals.lastDeliveryTime) wareTotals.lastDeliveryTime = event.time;
  } else {
    routeTotals.wares.set(event.wareId, {
      volume: event.amount,
      activity: event.fillFraction,
      deliveryCount: 1,
      lastDeliveryTime: event.time,
    });
  }
}

/** Build a RouteStats from one route's per-ware totals: list of per-ware stats, sums across wares
 *  (totalVolume/totalActivity/totalDeliveries), dominant ware (max volume), and max lastDeliveryTime.
 *  Returns null when the route had no wares (caller skips). */
function buildRouteStatsFromWareTotals(routeTotals: RouteTotals): RouteStats | null {
  const wares: RouteWareStat[] = [];
  let totalVolume = 0;
  let totalActivity = 0;
  let totalDeliveries = 0;
  let dominantWare: { wareId: WareId; volume: number } | null = null;
  let lastDeliveryTime = 0;
  for (const [wareId, wareTotals] of routeTotals.wares) {
    wares.push({
      wareId,
      volume: wareTotals.volume,
      activity: wareTotals.activity,
      deliveryCount: wareTotals.deliveryCount,
      lastDeliveryTime: wareTotals.lastDeliveryTime,
    });
    totalVolume += wareTotals.volume;
    totalActivity += wareTotals.activity;
    totalDeliveries += wareTotals.deliveryCount;
    if (!dominantWare || wareTotals.volume > dominantWare.volume) {
      dominantWare = { wareId, volume: wareTotals.volume };
    }
    if (wareTotals.lastDeliveryTime > lastDeliveryTime) lastDeliveryTime = wareTotals.lastDeliveryTime;
  }
  if (!dominantWare) return null;
  return {
    fromStationId: routeTotals.fromStationId,
    toStationId: routeTotals.toStationId,
    wares,
    totalVolume,
    totalActivity,
    totalDeliveries,
    dominantWareId: dominantWare.wareId,
    lastDeliveryTime,
  };
}

export function createTradeRouteStatistics(
  options: TradeRouteStatisticsOptions,
): TradeRouteStatistics {
  const events: DeliveryEvent[] = [];
  let cachedRouteStats: RouteStats[] | null = null;
  let cachedRouteStatsTime = -Infinity;

  function pruneEventsOutsideDefaultWindow(now: number): void {
    // Only prune when the default window is finite — Infinity retains all events
    // so all-time queries still work via getRouteStatsInWindow.
    if (!Number.isFinite(options.windowSeconds)) return;
    const cutoff = now - options.windowSeconds;
    let drop = 0;
    while (drop < events.length && events[drop].time < cutoff) drop++;
    if (drop > 0) events.splice(0, drop);
  }

  function computeInWindow(now: number, windowSeconds: number): RouteStats[] {
    const cutoff = Number.isFinite(windowSeconds) ? now - windowSeconds : -Infinity;
    const totalsByRoute: TotalsByRoute = new Map();
    for (const event of events) {
      if (event.time < cutoff) continue;
      addDeliveryToTotals(event, totalsByRoute);
    }
    const routeStatsList: RouteStats[] = [];
    for (const routeTotals of totalsByRoute.values()) {
      const stats = buildRouteStatsFromWareTotals(routeTotals);
      if (stats) routeStatsList.push(stats);
    }
    return routeStatsList;
  }

  const api: TradeRouteStatistics = {
    recordDelivery(event) {
      events.push(event);
      // Amortize pruning across inserts — runtime queries via
      // getRouteStatsInWindow, which doesn't trigger the cache-miss prune in
      // getAllRouteStats. Without this the events array grows unbounded.
      pruneEventsOutsideDefaultWindow(event.time);
    },
    getAllRouteStats(now) {
      if (cachedRouteStats && now - cachedRouteStatsTime < options.cacheRefreshSeconds) return cachedRouteStats;
      pruneEventsOutsideDefaultWindow(now);
      cachedRouteStats = computeInWindow(now, options.windowSeconds);
      cachedRouteStatsTime = now;
      return cachedRouteStats;
    },
    getRouteStatsInWindow(now, windowSeconds) {
      return computeInWindow(now, windowSeconds);
    },
    getStatsForStation(stationId, now) {
      return api
        .getAllRouteStats(now)
        .filter((routeStat) => routeStat.fromStationId === stationId || routeStat.toStationId === stationId);
    },
    clear() {
      events.length = 0;
      cachedRouteStats = null;
      cachedRouteStatsTime = -Infinity;
    },
  };
  return api;
}
