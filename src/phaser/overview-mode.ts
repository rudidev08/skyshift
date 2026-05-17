// Overview view mode orchestrator. Mounts a four-tab DOM sidebar (Trading /
// Nations / Emigration / Log) and a map-space trade-route Phaser overlay that
// shows only while the Trading tab is active.
//
// Per-tab content lives in sibling files (overview-trade-sidebar/render,
// ui-overview-nations, ui-overview-emigration, ui-overview-stations-timelapse).
// Visuals carry no per-ware color: dim-gray baseline lines, accent green only
// when a specific ware is selected in the Trading dropdown.

import type { Scene } from "phaser";
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
import { createStationRewindOverlay, type StationRewindOverlay } from "./station-rewind-overlay";
import type { StationVisualBundle } from "./station-visual-bundle";
import type { StationPosition } from "./overview-trade-render";
import { createTradeRouteOverlay } from "./overview-trade-overlay";
import type { StationHistory } from "../sim-station-history";

export type { StationPosition } from "./overview-trade-render";

export interface OverviewModeOptions {
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

export interface OverviewMode {
  update(): void;
  destroy(): void;
}

type TabId = "wares" | "nations" | "emigration" | "stations-timelapse";

interface OverviewTabBar {
  root: HTMLDivElement;
  waresPanel: HTMLDivElement;
  nationsPanel: HTMLDivElement;
  emigrationPanel: HTMLDivElement;
  stationsTimelapsePanel: HTMLDivElement;
  setActiveTab(tabId: TabId): void;
}

/** Build the tab bar wrap + 4 panel containers + setActiveTab dispatcher.
 *  Lazy-mount of pane content is the caller's job (via `onActivate`) so the
 *  tab bar stays free of cross-system dependencies. */
function createOverviewTabBar(onActivate: (tabId: TabId) => void): OverviewTabBar {
  const root = document.createElement("div");
  root.className = "ware-sidebar-wrap";

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
    root.classList.toggle(
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
  root.appendChild(tabs);
  root.append(waresPanel, nationsPanel, emigrationPanel, stationsTimelapsePanel);

  return { root, waresPanel, nationsPanel, emigrationPanel, stationsTimelapsePanel, setActiveTab };
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

  let nationsPane: NationsPane | null = null;
  let emigrationControls: EmigrationControls | null = null;
  let stationsTimelapsePane: StationsTimelapseLogPane | null = null;

  function activate(tabId: TabId): void {
    // Switched away from the log tab — return the map to "now". Any non-log
    // tab gets the overlay hidden, including wares / nations / emigration.
    if (tabId !== "stations-timelapse") rewindOverlay.hide();

    if (tabId === "nations") {
      if (!nationsPane) {
        nationsPane = createNationsPane({
          root: tabBar.nationsPanel,
          nationManager,
          emigrationManager,
          stationManager,
          zones,
        });
      }
      nationsPane.update();
    } else if (tabId === "emigration") {
      if (!emigrationControls) {
        emigrationControls = createEmigrationControls(tabBar.emigrationPanel, emigrationManager);
      }
      emigrationControls.update();
    } else if (tabId === "stations-timelapse") {
      if (!stationsTimelapsePane) {
        stationsTimelapsePane = createStationsTimelapseLogPane({
          root: tabBar.stationsTimelapsePanel,
          stationHistory,
          getSimTime,
          rewindOverlay,
        });
      }
      stationsTimelapsePane.update();
    }
  }

  function refreshActive(): void {
    // Skip hidden panes — activate() refreshes the activated tab immediately,
    // so nothing goes stale on switch.
    if (!tabBar.nationsPanel.hidden) nationsPane?.update();
    if (!tabBar.emigrationPanel.hidden) emigrationControls?.update();
    if (!tabBar.stationsTimelapsePanel.hidden) stationsTimelapsePane?.update();
  }

  function destroy(): void {
    nationsPane?.destroy();
    emigrationControls?.destroy();
    stationsTimelapsePane?.destroy();
    nationsPane = null;
    emigrationControls = null;
    stationsTimelapsePane = null;
  }

  return { activate, refreshActive, destroy };
}

export function createOverviewMode(options: OverviewModeOptions): OverviewMode {
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

  // Remounts can reuse a root node from a previous scene — force default hidden
  // state so normal mode never inherits stale overlay UI.
  uiRoot.setAttribute("hidden", "");
  uiRoot.innerHTML = "";

  let visible = false;
  let activeTab: TabId = "wares";

  const tabBar = createOverviewTabBar((tabId) => {
    activeTab = tabId;
    tradeRouteOverlay.setTradeLinesActive(visible && activeTab === "wares");
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
  const tradeRouteOverlay = createTradeRouteOverlay({
    scene,
    sidebarParent: tabBar.waresPanel,
    tradeManager,
    getStations,
    getSimTime,
  });

  uiRoot.appendChild(tabBar.root);
  tabBar.setActiveTab("wares");

  const unsubViewMode = viewMode.onViewModeChange((mode) => {
    setVisible(mode === "overview");
  });
  if (viewMode.getViewMode() === "overview") setVisible(true);

  function setVisible(nextVisible: boolean): void {
    if (nextVisible === visible) return;
    visible = nextVisible;
    if (nextVisible) uiRoot.removeAttribute("hidden");
    else uiRoot.setAttribute("hidden", "");
    tradeRouteOverlay.setPanelOpen(nextVisible);
    tradeRouteOverlay.setTradeLinesActive(visible && activeTab === "wares");
  }

  function update(): void {
    tradeRouteOverlay.refreshData();
    lazyPanes.refreshActive();
  }

  function destroy(): void {
    setVisible(false);
    unsubViewMode();
    tradeRouteOverlay.destroy();
    lazyPanes.destroy();
    rewindOverlay.destroy();
    uiRoot.innerHTML = "";
  }

  return { update, destroy };
}
