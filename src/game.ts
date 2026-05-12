import { Scene } from "phaser";
import type { GameMap } from "./sim-map-types";
import { backgroundConfig } from "../data/visuals-map-background";
import {
  preloadBackgrounds,
  createBackgrounds,
  updateParallax,
  type BackgroundLayers,
} from "./phaser/backgrounds-render";
import { preloadStationIcons } from "./phaser/texture-cache";
import {
  preloadStationZoneIcon,
  updateStationZoneLabels,
  type StationZoneVisualBundle,
  type StationZoneSelectionTarget,
} from "./phaser/station-zone-render";
import { createGameViewModeController, type GameViewMode, type GameViewModeController } from "./game-view-mode";
import {
  updateStationLabels,
  updateStationDetails,
  resetStationZoomDetailCache,
  type StationVisualBundle,
} from "./phaser/station-visual-bundle";
import {
  createSectorGrid,
  updateSectorCorners,
  type GridMode,
  type SectorGridSystem,
} from "./phaser/sector-grid";
import {
  setupTimeControls,
  type TimeController,
} from "./phaser/time-controls";
import type { PausedIndicator } from "./ui-game-paused-indicator";
import type { ElapsedTimeLabel } from "./render-elapsed-time-label";
import type { AmbientTrafficSystem } from "./phaser/ambient-traffic-render";
import type { Station } from "./sim-station";
import {
  createStationRenderPool,
  type StationRenderPool,
} from "./phaser/station-render";
import type { ScrollBounds, CameraControlsHandle } from "./phaser/camera-controls";
import { setupCameraControls } from "./phaser/camera-controls";
import type { Ship } from "./sim-ships";
import {
  hideShipForOverview,
  ShipSelectionTarget,
  type ShipVisualBundle,
} from "./phaser/ship-visual-bundle";
import { createShipOrbitPool, type ShipOrbitPool } from "./phaser/ship-orbit-pool";
import { createShipVisualBundles, type ShipVisualBundlesByShipId } from "./phaser/ship-visual-bundles";
import type { Simulation } from "./sim-lifecycle";
import { Selection, type SelectionTarget } from "./phaser/selection-input";
import { SelectionRingRender } from "./phaser/selection-ring-render";
import { resetCullingCache } from "./phaser/viewport-culling";
import { getTradeLog } from "./sim-trade-log";
import { createOverviewSystem, type OverviewSystem } from "./phaser/overview-system";
import { cameraMinZoom } from "../data/controls-camera";
import { findSectorAtPosition } from "./sim-sector-lookup";
import { setupZoomControls, type ZoomControls } from "./phaser/zoom-controls";
import { updateGameHud } from "./ui-game-hud";
import { applyViewMode as applyViewModeRender, syncSectorGridVisibilityForViewMode } from "./phaser/game-view-mode-render";
import type { GameSnapshot } from "./sim-save-types";
import { registerToastSelectionHook } from "./ui-toast";
import {
  setupHudOverlay,
  setupGameplaySpeedAndTimeHud,
  createGameSimulationForSnapshot,
  createGameSimulationForFreshUniverse,
  setInitialCameraView,
} from "./game-setup";
import { tickSimulation, updateShipVisuals } from "./game-loop";

export const GAME_SCENE_KEY = "Game";

export class Game extends Scene {
  camera!: Phaser.Cameras.Scene2D.Camera;

  lastSectorId = "";
  nebulaImages: Phaser.GameObjects.Image[] = [];
  cameraControls?: CameraControlsHandle;
  zoomControls?: ZoomControls;
  stationLabelsVisible = true;
  timeScale = 1;
  timeController!: TimeController;
  selection!: Selection;
  selectionRingRender!: SelectionRingRender;
  selectedObjectEl!: HTMLElement;
  selectedTypeEl!: HTMLElement;
  infoCardEl!: HTMLElement;
  serialCodeEl!: HTMLElement;
  descriptionEl!: HTMLElement;
  statusBandEl!: HTMLElement;
  loreEl!: HTMLElement;
  loreTitleEl!: HTMLElement;
  infoPanelEl!: HTMLElement;
  hudSealEl!: HTMLElement;
  loreToggleEl!: HTMLElement;
  logToggleEl!: HTMLElement;
  detailsContentEl!: HTMLElement;
  detailsBoxEl!: HTMLElement;
  loreBoxEl!: HTMLElement;
  lastSelectionTarget: SelectionTarget | null = null;
  // CSS custom properties don't go through dom-cache's WeakMap diffing, so
  // iconUri and accentColor need their own per-write last* fields.
  lastSealUri = "";
  lastAccentColor = "";
  lastDetailsPanelOpen = false;
  lastHudTick = -1;
  stations: Station[] = [];
  stationBundles: StationVisualBundle[] = [];
  stationBundleByStation = new Map<Station, StationVisualBundle>();
  ships: Ship[] = [];
  shipRenders: ShipVisualBundle[] = [];
  shipOrbitPool: ShipOrbitPool = createShipOrbitPool();
  shipBundles: ShipVisualBundlesByShipId = createShipVisualBundles();
  stationRenderPool!: StationRenderPool;
  bg!: BackgroundLayers;
  overviewGrid?: Phaser.GameObjects.Graphics;
  gridSystem!: SectorGridSystem;
  ambientTraffic!: AmbientTrafficSystem;
  stationZoneVisualBundles: StationZoneVisualBundle[] = [];
  stationZoneSelectionTargets: StationZoneSelectionTarget[] = [];
  viewMode: GameViewModeController = createGameViewModeController("normal");
  releaseOverviewPause: (() => void) | null = null;
  pausedIndicator?: PausedIndicator;
  elapsedTimeLabel?: ElapsedTimeLabel;
  unsubscribeSpeedObserver?: () => void;
  readonly stationZonesVisibleRef = { value: false };
  private cleanedUp = false;
  overviewSystem?: OverviewSystem;

  map!: GameMap;
  /** Sim graph for the active session — wired up in create(), torn down in cleanupScene. Undefined before create() and after teardown. */
  simulation?: Simulation;
  /** Accumulator for the slow dynamic-nations tick (~5s sim). */
  dynamicsTickAccumulator = 0;
  initialSnapshot: GameSnapshot | undefined = undefined;
  initialGridMode: GridMode | undefined = undefined;
  persistGridMode = true;
  isEditorMode = false;
  requestedViewModeRef: { value: GameViewMode } | undefined = undefined;
  private firstUpdateFired = false;

  constructor() {
    super("Game");
  }

  init(data: {
    map: GameMap;
    initialViewMode?: GameViewMode;
    requestedViewModeRef?: { value: GameViewMode };
    initialGridMode?: GridMode;
    persistGridMode?: boolean;
    isEditorMode?: boolean;
    initialSnapshot?: GameSnapshot;
  }) {
    this.map = data.map;
    this.initialSnapshot = data.initialSnapshot;
    this.initialGridMode = data.initialGridMode;
    this.persistGridMode = data.persistGridMode ?? true;
    this.isEditorMode = data.isEditorMode ?? false;
    this.requestedViewModeRef = data.requestedViewModeRef;
    const initialMode: GameViewMode = data.requestedViewModeRef?.value ?? data.initialViewMode ?? "normal";
    this.viewMode = createGameViewModeController(initialMode);
    this.stationZonesVisibleRef.value = initialMode === "zones";
  }

  preload() {
    preloadBackgrounds(this);
    preloadStationIcons(this);
    preloadStationZoneIcon(this);
  }

  create() {
    this.cleanedUp = false;
    this.events.once("shutdown", this.cleanupScene, this);
    this.events.once("destroy", this.cleanupScene, this);

    this.applyRequestedStartupViewMode();
    this.setupCameraAndBackground();
    setupHudOverlay(this);
    this.setupSelectionAndCaches();
    this.setupSectorGridAndTimeControls();
    if (!this.isEditorMode) setupGameplaySpeedAndTimeHud(this);

    const simulation = this.initialSnapshot
      ? createGameSimulationForSnapshot(this)
      : createGameSimulationForFreshUniverse(this);

    this.setupOverviewSystem(simulation);
    this.setupViewModeRender();
    this.setupCameraAndZoomControls();
    setInitialCameraView(this);
  }

  /** HUD clicks can land while Phaser is still booting — re-read the shared
   *  requested mode so startup honors the latest click instead of whatever
   *  mode was current when mountGameRuntime() began. */
  private applyRequestedStartupViewMode(): void {
    const requestedStartupViewMode = this.requestedViewModeRef?.value ?? this.viewMode.getViewMode();
    if (requestedStartupViewMode !== this.viewMode.getViewMode()) {
      this.viewMode.setViewMode(requestedStartupViewMode);
    }
    this.stationZonesVisibleRef.value = requestedStartupViewMode === "zones";
  }

  private setupCameraAndBackground(): void {
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(backgroundConfig.backgroundColor);
    this.bg = createBackgrounds(this, this.map.nebulas);
    this.nebulaImages = this.bg.nebulaImages;
  }

  private setupSelectionAndCaches(): void {
    this.selection = new Selection(this);
    this.selectionRingRender = new SelectionRingRender(this, this.selection);
    // Blocking toasts tuck the selection indicator away until they clear.
    registerToastSelectionHook((hidden) => this.selectionRingRender?.setExternallyHidden(hidden));
    // Name-pool reset and assignStationNames both happen per-branch in the
    // simulation factory (snapshot stations carry names; authored stations
    // draw from the freshly constructed simulation.namePool). Nothing global
    // to reset here.
    resetStationZoomDetailCache();
    resetCullingCache();
  }

  private setupSectorGridAndTimeControls(): void {
    this.gridSystem = createSectorGrid(
      this,
      this.map.sectors,
      this.map,
      {
        initialMode: this.initialGridMode,
        persistMode: this.persistGridMode,
      },
    );
    this.timeController = setupTimeControls(this, (scale) => {
      this.timeScale = scale;
    });
  }

  /** Built after Simulation construction so the ware → producers index is
   *  populated for the ware dropdown filter. Editor doesn't run
   *  nations/emigration, so the overlay is gameplay-only. */
  private setupOverviewSystem(simulation: Simulation): void {
    const uiRoot = document.getElementById("trade-route-overlay");
    if (!uiRoot || this.isEditorMode) return;
    this.overviewSystem = createOverviewSystem({
      scene: this,
      uiRoot,
      getStations: () => this.stations.map((station) => ({ id: station.id, x: station.x, y: station.y })),
      getSimTime: () => this.simulation?.tradeManager.tradeTime ?? 0,
      viewMode: this.viewMode,
      nationManager: simulation.nationManager,
      emigrationManager: simulation.emigrationManager,
      stationManager: simulation.stationManager,
      tradeManager: simulation.tradeManager,
      zones: simulation.stationZones,
      stationHistory: simulation.stationHistory,
      getLiveStationBundles: () => this.stationBundles,
    });
  }

  /** Initial apply must run after zone renders exist, since "zones" mode toggles their visibility. */
  private setupViewModeRender(): void {
    applyViewModeRender(this, this.viewMode.getViewMode());
    this.viewMode.onViewModeChange((mode) => applyViewModeRender(this, mode));
  }

  private setupCameraAndZoomControls(): void {
    const bounds: ScrollBounds = {
      minX: 0,
      maxX: this.map.gridSizeX * this.map.sectorSize,
      minY: 0,
      maxY: this.map.gridSizeY * this.map.sectorSize,
    };
    const minimumZoom = cameraMinZoom;
    this.zoomControls = setupZoomControls(this, {
      presets: [minimumZoom, 0.4, 1.0],
    });
    this.stationRenderPool = createStationRenderPool(this);
    this.cameraControls = setupCameraControls(this, bounds, {
      minZoom: minimumZoom,
      onZoom: this.zoomControls.updateDisplay,
    });
  }

  update(_time: number, delta: number) {
    const deltaSeconds = delta / 1000;
    const viewMode = this.viewMode.getViewMode();
    const inOverview = viewMode === "overview";

    updateParallax(this.bg, this.camera);
    const sector = this.refreshCurrentSectorHud(inOverview);
    if (!inOverview) updateSectorCorners(this.gridSystem, this.map.sectors, this.camera);

    const labelState = this.updateLabelsAndDetails(viewMode);
    this.tickSimulationIfRunning(deltaSeconds, _time, inOverview);

    const currentTick = this.simulation?.economyTimer.tick ?? 0;
    this.renderStations(_time, viewMode, currentTick);
    this.renderShipsForFrame(inOverview, labelState, currentTick);

    this.selection.update();
    this.selectionRingRender.update(this.camera.zoom);
    updateGameHud(this, sector);

    this.markFirstFrameReady();
  }

  /** Show or hide the sector info panel as the camera crosses sector boundaries.
   *  Returns the current sector so the caller can pass it to updateGameHud. */
  private refreshCurrentSectorHud(inOverview: boolean) {
    const sector = this.currentSector();
    const sectorId = sector?.id ?? "";
    if (sectorId === this.lastSectorId) return sector;
    // Skip in overview (panel is force-hidden) and editor (updateGameHud never
    // populates the card, so empty chrome reads as a broken selection box).
    if (!inOverview && !this.isEditorMode) {
      this.infoPanelEl.style.display = sector ? "" : "none";
    }
    this.lastSectorId = sectorId;
    return sector;
  }

  private updateLabelsAndDetails(viewMode: GameViewMode): { visible: boolean; alpha: number } {
    const labelState = updateStationLabels(
      this.stationBundles,
      this.camera.zoom,
      this.stationLabelsVisible,
    );
    this.stationLabelsVisible = labelState.visible;
    updateStationZoneLabels(this.stationZoneVisualBundles, this.camera.zoom, viewMode === "zones");
    updateStationDetails(this.stationBundles, this.camera.zoom);
    return labelState;
  }

  /** Editor is static (no sim ticks at all); pause freezes everything together. */
  private tickSimulationIfRunning(deltaSeconds: number, time: number, inOverview: boolean): void {
    if (this.timeScale <= 0 || this.isEditorMode) return;
    const scaledDelta = deltaSeconds * this.timeScale;
    tickSimulation(this, scaledDelta, time, inOverview);
  }

  private renderStations(time: number, viewMode: GameViewMode, currentTick: number): void {
    this.stationRenderPool.beginFrame();
    for (const bundle of this.stationBundles) {
      const selected = this.selection.isSelected(bundle.selectionTarget);
      this.stationRenderPool.updateStationRender(bundle, {
        time,
        zoom: this.camera.zoom,
        camera: this.camera,
        viewMode,
        selected,
        currentTick,
      });
    }
  }

  private renderShipsForFrame(
    inOverview: boolean,
    labelState: { visible: boolean; alpha: number },
    currentTick: number,
  ): void {
    if (inOverview) {
      // Overview mode draws its own ship layer, so the regular per-ship visuals stay hidden.
      for (const shipRender of this.shipRenders) hideShipForOverview(shipRender);
      return;
    }
    updateShipVisuals(this, labelState, currentTick);
  }

  /** First rendered frame has painted the HUD — flip the ready class so
   *  universe.html fades the loading curtain out. */
  private markFirstFrameReady(): void {
    if (this.firstUpdateFired) return;
    this.firstUpdateFired = true;
    document.body.classList.add("game-ready");
  }

  getSelectionDetailsLog(): string {
    const target = this.selection.target;
    if (target instanceof ShipSelectionTarget) {
      const tradeManager = this.simulation?.tradeManager;
      if (!tradeManager) return "";
      const tradeShip = tradeManager.findTradeShip(target.ship);
      if (tradeShip) return getTradeLog(tradeShip, tradeManager, tradeManager.tradeTime);
    }
    return "";
  }

  setSectorGridMode(mode: GridMode): void {
    this.gridSystem.setMode(mode);
    syncSectorGridVisibilityForViewMode(this, this.viewMode.getViewMode());
  }

  currentSector() {
    // Screen-space center (scrollX + width/2) to match clampCamera bounds logic.
    const centerX = this.camera.scrollX + this.camera.width / 2;
    const centerY = this.camera.scrollY + this.camera.height / 2;
    return findSectorAtPosition(this.map.sectors, centerX, centerY);
  }

  private cleanupScene() {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.cameraControls?.destroy();
    this.cameraControls = undefined;
    this.zoomControls?.destroy();
    this.zoomControls = undefined;
    this.stationRenderPool?.destroy();
    this.unsubscribeSpeedObserver?.();
    this.unsubscribeSpeedObserver = undefined;
    this.overviewSystem?.destroy();
    this.overviewSystem = undefined;
    this.pausedIndicator?.destroy();
    this.pausedIndicator = undefined;
    this.elapsedTimeLabel?.destroy();
    this.elapsedTimeLabel = undefined;
    this.selection?.destroy();
    this.selectionRingRender?.destroy();
    // Clear the toast's selection-hide hook — without this, the toast module
    // keeps a reference to this scene's destroyed selection ring, and its
    // activeBlockingToasts counter stays >0 so the next scene's first blocking
    // toast won't fire the hide.
    registerToastSelectionHook(null);
    this.simulation?.dispose();
    this.simulation = undefined;
  }
}
