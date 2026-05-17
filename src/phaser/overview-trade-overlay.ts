// Trade-route overlay for the Overview's Trading tab — owns the map-space
// route lines (createTradeRouteRender) and the ware-filter dropdown
// (createOverviewTradeSidebar), refreshed on a 500ms poll while any overview
// tab is open. The overview-mode orchestrator (overview-mode.ts) is the sole
// consumer. Visuals carry no per-ware color: dim-gray baseline lines, accent
// green only when a ware is selected in the dropdown.

import type { Scene } from "phaser";
import { allWares } from "../../data/wares";
import type { WareId } from "../../data/ware-types";
import { getWareTradeTotals, type RouteStats } from "../sim-trade-route-statistics";
import type { TradeManager } from "../sim-trade-manager";
import { createOverviewTradeSidebar, type OverviewTradeSidebar } from "../ui-overview-trade-sidebar";
import {
  createTradeRouteRender,
  NONE,
  type StationPosition,
  type TradeRouteData,
  type TradeRouteRender,
  type WareSelection,
} from "./overview-trade-render";

const DATA_REFRESH_MS = 500;
// The overview always shows the last 2 hours of trade deliveries.
const OVERVIEW_TRADE_WINDOW_SECONDS = 2 * 60 * 60;

function buildTradeRoutesFromRouteStats(
  routeStats: ReadonlyArray<RouteStats>,
  stationById: Map<string, StationPosition>,
): TradeRouteData[] {
  const tradeRoutes: TradeRouteData[] = [];
  for (const route of routeStats) {
    if (!stationById.has(route.fromStationId) || !stationById.has(route.toStationId)) continue;
    const wares = route.wares.slice().sort((wareA, wareB) => wareA.wareId.localeCompare(wareB.wareId));
    const wareActivity = new Map<WareId, number>();
    for (const ware of wares) wareActivity.set(ware.wareId, ware.activity);
    tradeRoutes.push({
      fromStationId: route.fromStationId,
      toStationId: route.toStationId,
      wares: wares.map((ware) => ware.wareId),
      wareActivity,
    });
  }
  return tradeRoutes;
}

function mapStationPositionsById(stations: ReadonlyArray<StationPosition>): Map<string, StationPosition> {
  const stationById = new Map<string, StationPosition>();
  for (const station of stations) stationById.set(station.id, station);
  return stationById;
}

/** Filter the full ware list down to wares the fleet can carry on at least one producer-to-consumer route. */
function computeTradeableWares(tradeManager: TradeManager) {
  const transportableIds = new Set(tradeManager.getShipTransportableWares());
  return [...allWares].filter((ware) => transportableIds.has(ware.id));
}

interface TradeRouteOverlayOptions {
  scene: Scene;
  sidebarParent: HTMLElement;
  tradeManager: TradeManager;
  getStations: () => ReadonlyArray<StationPosition>;
  getSimTime: () => number;
}

export interface TradeRouteOverlay {
  refreshData(): void;
  setPanelOpen(open: boolean): void;
  setTradeLinesActive(active: boolean): void;
  destroy(): void;
}

/** Owns the trade-data closure: render lines + sidebar dropdown + state.
 *  `setPanelOpen` drives the data refresh timer (fires while any overview tab
 *  is open so the dropdown totals stay fresh). `setTradeLinesActive` toggles
 *  the map overlay (Trading tab only). */
export function createTradeRouteOverlay(options: TradeRouteOverlayOptions): TradeRouteOverlay {
  const { scene, sidebarParent, tradeManager, getStations, getSimTime } = options;

  // Sidebar wares list — only wares the fleet can carry on some route,
  // preserving the order written in data/wares.
  const tradeableWares = computeTradeableWares(tradeManager);

  let selectedWare: WareSelection = NONE;
  // Gray baseline routes from windowed delivery data; green overlay reuses
  // the same set, filtered to the selected ware.
  let baselineRoutes: TradeRouteData[] = [];
  let stationById = new Map<string, StationPosition>();
  let panelOpen = false;
  let tradeLinesActive = false;
  let refreshTimer: number | null = null;

  const tradeRender: TradeRouteRender = createTradeRouteRender(scene);
  const tradeSidebar: OverviewTradeSidebar = createOverviewTradeSidebar({
    parent: sidebarParent,
    tradeableWares,
    onSelectionChange(ware: WareSelection): void {
      selectedWare = ware;
      redraw();
    },
  });

  function refreshData(): void {
    if (!panelOpen) return;
    const now = getSimTime();
    stationById = mapStationPositionsById(getStations());

    // Fixed 2h window for both the dim baseline and the green overlay:
    // deliveries that actually happened in the window.
    const tradeWindowStats = tradeManager.getTradedRoutes(now, OVERVIEW_TRADE_WINDOW_SECONDS);
    baselineRoutes = buildTradeRoutesFromRouteStats(tradeWindowStats, stationById);
    // Dropdown totals weight partial loads by activity (fill-equivalent), not whole trades — matches the route-label math in getWareTradeTotals.
    tradeSidebar.setWareTotals(getWareTradeTotals(tradeWindowStats));

    redraw();
  }

  function redraw(): void {
    if (!tradeLinesActive) return;
    tradeRender.redraw(baselineRoutes, selectedWare, stationById);
  }

  function stopRefreshTimer(): void {
    if (refreshTimer === null) return;
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function setPanelOpen(nextOpen: boolean): void {
    if (nextOpen === panelOpen) return;
    panelOpen = nextOpen;
    if (nextOpen) {
      refreshData();
      refreshTimer = window.setInterval(refreshData, DATA_REFRESH_MS);
    } else {
      tradeSidebar.closeDropdown();
      stopRefreshTimer();
    }
  }

  function setTradeLinesActive(nextActive: boolean): void {
    tradeLinesActive = nextActive;
    tradeRender.setVisible(nextActive);
    if (nextActive) redraw();
  }

  function destroy(): void {
    stopRefreshTimer();
    tradeRender.destroy();
    tradeSidebar.destroy();
  }

  return { refreshData, setPanelOpen, setTradeLinesActive, destroy };
}
