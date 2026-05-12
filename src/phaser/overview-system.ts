// Overview view mode orchestrator. Mounts a four-tab DOM sidebar (Trading /
// Nations / Emigration / Log) and a map-space trade-route Phaser overlay that
// shows only while the Trading tab is active.
//
// Per-tab content lives in sibling files (overview-trade-sidebar/render,
// ui-overview-nations, ui-overview-emigration, ui-overview-stations-timelapse).
// Visuals carry no per-ware color: dim-gray baseline lines, accent green only
// when a specific ware is selected in the Trading dropdown.

import type { Scene } from "phaser";
import { allWares } from "../../data/wares";
import type { WareId } from "../../data/ware-types";
import { getWareTradeTotals, type RouteStats } from "../sim-trade-route-statistics";
import type { GameViewModeController } from "../game-view-mode";
import type { NationManager } from "../sim-nation-manager";
import type { EmigrationManager } from "../sim-emigration-manager";
import type { StationManager } from "../sim-station-manager";
import type { TradeManager } from "../sim-trade-manager";
import type { StationZone } from "../sim-station-zone-types";
import { createNationsPane, type NationsPane } from "../ui-overview-nations";
import { createEmigrationControls, type EmigrationControls } from "../ui-overview-emigration";
import {
  createStationsTimelapseLogPane,
  type StationsTimelapseLogPane,
} from "../ui-overview-stations-timelapse";
import { createOverviewTradeSidebar, type OverviewTradeMode, type OverviewTradeSidebar } from "../ui-overview-trade-sidebar";
import { createStationRewindOverlay, type StationRewindOverlay } from "./station-rewind-overlay";
import type { StationVisualBundle } from "./station-visual-bundle";
import {
  createTradeRouteRender,
  NONE,
  type StationPosition,
  type TradeRouteData,
  type TradeRouteRender,
  type WareSelection,
} from "./overview-trade-render";
import type { StationHistory } from "../sim-station-history";

const DATA_REFRESH_MS = 500;
const WINDOW_20_MIN_SECONDS = 1200;
const WINDOW_1_HOUR_SECONDS = 3600;
const WINDOW_2_HOUR_SECONDS = 7200;

const MODE_WINDOW_SECONDS: Record<OverviewTradeMode, number> = {
  "last-20-min": WINDOW_20_MIN_SECONDS,
  "last-1-hour": WINDOW_1_HOUR_SECONDS,
  "last-2-hour": WINDOW_2_HOUR_SECONDS,
};

export type { StationPosition } from "./overview-trade-render";

export interface OverviewSystemOptions {
  scene: Scene;
  uiRoot: HTMLElement;
  getStations: () => ReadonlyArray<StationPosition>;
  getSimTime: () => number;
  viewMode: GameViewModeController;
  nationManager: NationManager;
  emigrationManager: EmigrationManager;
  stationManager: StationManager;
  tradeManager: TradeManager;
  zones: StationZone[];
  stationHistory: StationHistory;
  /** Live station visual bundles — hidden by the rewind overlay while the
   *  player is scrubbed to a past moment in the Stations Timelapse Log tab. */
  getLiveStationBundles: () => readonly StationVisualBundle[];
}

export interface OverviewSystem {
  update(): void;
  destroy(): void;
}

type TabId = "wares" | "nations" | "emigration" | "stations-timelapse";

interface OverviewTabBar {
  wrap: HTMLDivElement;
  waresPanel: HTMLDivElement;
  nationsPanel: HTMLDivElement;
  emigrationPanel: HTMLDivElement;
  stationsTimelapsePanel: HTMLDivElement;
  setActiveTab(tabId: TabId): void;
}

function buildTradeRoutesFromRouteStats(
  routeStats: ReadonlyArray<RouteStats>,
  stationById: Map<string, StationPosition>,
): TradeRouteData[] {
  const tradeRoutes: TradeRouteData[] = [];
  for (const route of routeStats) {
    if (!stationById.has(route.fromStationId) || !stationById.has(route.toStationId)) continue;
    const wares = route.wares
      .slice()
      .sort((wareA, wareB) => wareA.wareId.localeCompare(wareB.wareId));
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

function mapStationPositionsById(
  stations: ReadonlyArray<StationPosition>,
): Map<string, StationPosition> {
  const stationById = new Map<string, StationPosition>();
  for (const station of stations) stationById.set(station.id, station);
  return stationById;
}

/** Build the tab bar wrap + 4 panel containers + setActiveTab dispatcher.
 *  Lazy-mount of pane content is the caller's job (via `onActivate`) so the
 *  tab bar stays free of cross-system dependencies. */
function createOverviewTabBar(onActivate: (tabId: TabId) => void): OverviewTabBar {
  const wrap = document.createElement("div");
  wrap.className = "ware-sidebar-wrap";

  const tabs = document.createElement("div");
  tabs.className = "hud-segment hud-segment--row";
  tabs.style.marginBottom = "8px";
  const tabButtons = new Map<TabId, HTMLButtonElement>();

  const waresPanel = document.createElement("div");
  const nationsPanel = document.createElement("div");
  const emigrationPanel = document.createElement("div");
  const stationsTimelapsePanel = document.createElement("div");

  function setActiveTab(tabId: TabId): void {
    for (const [id, tabButton] of tabButtons) tabButton.classList.toggle("is-on", id === tabId);
    waresPanel.hidden = tabId !== "wares";
    nationsPanel.hidden = tabId !== "nations";
    emigrationPanel.hidden = tabId !== "emigration";
    stationsTimelapsePanel.hidden = tabId !== "stations-timelapse";
    // Non-wares tabs need more horizontal room (per-nation tab strip,
    // emigration descriptions, full log lines), so widen the wrap.
    wrap.classList.toggle(
      "ware-sidebar-wrap--wide",
      tabId === "nations" || tabId === "emigration" || tabId === "stations-timelapse",
    );
    onActivate(tabId);
  }

  function appendTabButton(id: TabId, label: string): void {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = "hud-btn";
    tabButton.textContent = label;
    tabButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setActiveTab(id);
    });
    tabs.appendChild(tabButton);
    tabButtons.set(id, tabButton);
  }
  appendTabButton("wares", "Trading");
  appendTabButton("nations", "Nations");
  appendTabButton("emigration", "Emigration");
  appendTabButton("stations-timelapse", "Log");
  wrap.appendChild(tabs);
  wrap.append(waresPanel, nationsPanel, emigrationPanel, stationsTimelapsePanel);

  return { wrap, waresPanel, nationsPanel, emigrationPanel, stationsTimelapsePanel, setActiveTab };
}

/** Filter the full ware list down to wares the fleet can carry on at least one producer-to-consumer route. */
function computeTradeableWares(tradeManager: TradeManager) {
  const transportableIds = new Set(tradeManager.getShipTransportableWares());
  return [...allWares].filter((ware) => transportableIds.has(ware.id));
}

interface LazyTabPanesOptions {
  tabBar: OverviewTabBar;
  nationManager: NationManager;
  emigrationManager: EmigrationManager;
  stationManager: StationManager;
  zones: StationZone[];
  stationHistory: StationHistory;
  getSimTime: () => number;
  rewindOverlay: StationRewindOverlay;
}

interface LazyTabPanes {
  /** Wired into `createOverviewTabBar`'s onActivate; mounts the panel on first activation, then refreshes it. */
  activate(tabId: TabId): void;
  /** Refresh whichever tab is currently visible (called on the per-frame update tick). */
  refreshActive(): void;
  destroy(): void;
}

/** Owns lifecycle of the lazy-mounted panes (nations / emigration / log). */
function createLazyTabPanes(options: LazyTabPanesOptions): LazyTabPanes {
  const {
    tabBar,
    nationManager,
    emigrationManager,
    stationManager,
    zones,
    stationHistory,
    getSimTime,
    rewindOverlay,
  } = options;

  let nationsPaneHandle: NationsPane | null = null;
  let emigrationControlsHandle: EmigrationControls | null = null;
  let stationsTimelapsePaneHandle: StationsTimelapseLogPane | null = null;

  function activate(tabId: TabId): void {
    // Switched away from the log tab — return the map to "now". Any non-log
    // tab gets the overlay hidden, including wares / nations / emigration.
    if (tabId !== "stations-timelapse") rewindOverlay.hide();

    if (tabId === "nations") {
      if (!nationsPaneHandle) {
        nationsPaneHandle = createNationsPane({ root: tabBar.nationsPanel, nationManager, emigrationManager, stationManager, zones });
      }
      nationsPaneHandle.update();
    } else if (tabId === "emigration") {
      if (!emigrationControlsHandle) {
        emigrationControlsHandle = createEmigrationControls(tabBar.emigrationPanel, emigrationManager);
      }
      emigrationControlsHandle.update();
    } else if (tabId === "stations-timelapse") {
      if (!stationsTimelapsePaneHandle) {
        stationsTimelapsePaneHandle = createStationsTimelapseLogPane({
          root: tabBar.stationsTimelapsePanel,
          stationHistory,
          getSimTime,
          rewindOverlay,
        });
      }
      stationsTimelapsePaneHandle.update();
    }
  }

  function refreshActive(): void {
    // Skip hidden panes — activate() refreshes the activated tab immediately,
    // so nothing goes stale on switch.
    if (!tabBar.nationsPanel.hidden) nationsPaneHandle?.update();
    if (!tabBar.emigrationPanel.hidden) emigrationControlsHandle?.update();
    if (!tabBar.stationsTimelapsePanel.hidden) stationsTimelapsePaneHandle?.update();
  }

  function destroy(): void {
    nationsPaneHandle?.destroy();
    emigrationControlsHandle?.destroy();
    stationsTimelapsePaneHandle?.destroy();
    nationsPaneHandle = null;
    emigrationControlsHandle = null;
    stationsTimelapsePaneHandle = null;
  }

  return { activate, refreshActive, destroy };
}

export function createOverviewSystem(options: OverviewSystemOptions): OverviewSystem {
  const {
    scene,
    uiRoot,
    getStations,
    getSimTime,
    viewMode,
    nationManager,
    emigrationManager,
    stationManager,
    tradeManager,
    zones,
    stationHistory,
    getLiveStationBundles,
  } = options;

  // Sidebar wares list — only wares the fleet can carry on some route,
  // preserving authored sort order from data/wares.
  const tradeableWares = computeTradeableWares(tradeManager);

  let selectedWare: WareSelection = NONE;
  let selectedTimeWindow: OverviewTradeMode = "last-20-min";

  // Gray baseline routes from windowed delivery data; green overlay reuses
  // the same set, filtered to the selected ware.
  let baselineRoutes: TradeRouteData[] = [];
  let stationById = new Map<string, StationPosition>();

  // Remounts can reuse a root node from a previous scene — force default hidden
  // state so normal mode never inherits stale overlay UI.
  uiRoot.setAttribute("hidden", "");
  uiRoot.innerHTML = "";

  // Built before the tab bar so the onActivate callback can update its visibility.
  const tradeRender: TradeRouteRender = createTradeRouteRender(scene);

  let visible = false;
  let activeTab: TabId = "wares";
  let refreshTimer: number | null = null;

  const tabBar = createOverviewTabBar((tabId) => {
    activeTab = tabId;
    applyTradeRenderVisibility();
    lazyPanes.activate(tabId);
  });
  const rewindOverlay = createStationRewindOverlay({
    scene,
    getLiveBundles: getLiveStationBundles,
  });
  const lazyPanes = createLazyTabPanes({
    tabBar,
    nationManager,
    emigrationManager,
    stationManager,
    zones,
    stationHistory,
    getSimTime,
    rewindOverlay,
  });

  const tradeSidebar: OverviewTradeSidebar = createOverviewTradeSidebar({
    parent: tabBar.waresPanel,
    tradeableWares,
    onSelectionChange(ware: WareSelection): void {
      selectedWare = ware;
      redraw();
    },
    onModeChange(mode: OverviewTradeMode): void {
      selectedTimeWindow = mode;
      refreshData();
    },
  });

  uiRoot.appendChild(tabBar.wrap);
  tabBar.setActiveTab("wares");

  const unsubViewMode = viewMode.onViewModeChange((mode) => {
    setVisible(mode === "overview");
  });
  if (viewMode.getViewMode() === "overview") setVisible(true);

  function stopRefreshTimer(): void {
    if (refreshTimer === null) return;
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  /** Trade lines show only on the Trading tab; non-trading tabs hide the overlay. */
  function applyTradeRenderVisibility(): void {
    const tradeLinesActive = visible && activeTab === "wares";
    tradeRender.setVisible(tradeLinesActive);
    if (tradeLinesActive) redraw();
  }

  function setVisible(nextVisible: boolean): void {
    if (nextVisible === visible) return;
    visible = nextVisible;
    if (nextVisible) {
      uiRoot.removeAttribute("hidden");
      refreshData();
      refreshTimer = window.setInterval(refreshData, DATA_REFRESH_MS);
    } else {
      uiRoot.setAttribute("hidden", "");
      tradeSidebar.closeDropdown();
      stopRefreshTimer();
    }
    applyTradeRenderVisibility();
  }

  function refreshData(): void {
    if (!visible) return;
    const now = getSimTime();
    stationById = mapStationPositionsById(getStations());

    // Mode picks the time window for both the dim baseline and the green
    // overlay: deliveries that actually happened in the window.
    const tradeWindowStats = tradeManager.getOrRefreshTradedRoutes(now, MODE_WINDOW_SECONDS[selectedTimeWindow]);
    baselineRoutes = buildTradeRoutesFromRouteStats(tradeWindowStats, stationById);
    // Dropdown totals weight partial loads by activity (fill-equivalent), not whole trades — matches the route-label math in getWareTradeTotals.
    tradeSidebar.setWareTotals(getWareTradeTotals(tradeWindowStats));

    redraw();
  }

  function redraw(): void {
    if (!visible || activeTab !== "wares") return;
    tradeRender.redraw(baselineRoutes, selectedWare, stationById);
  }

  function update(): void {
    refreshData();
    lazyPanes.refreshActive();
  }

  function destroy(): void {
    setVisible(false);
    unsubViewMode();
    stopRefreshTimer();
    tradeRender.destroy();
    tradeSidebar.destroy();
    lazyPanes.destroy();
    rewindOverlay.destroy();
    uiRoot.innerHTML = "";
  }

  return { update, destroy };
}
