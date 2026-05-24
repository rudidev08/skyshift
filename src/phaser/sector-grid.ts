import { type Scene } from "phaser";
import type { GameMap, Sector } from "../sim-map-types";
import { displayFontFamily } from "../../data/visuals-text";
import { sectorGridVisuals } from "../../data/visuals-sector-grid";
import { Layer } from "../../data/visuals-layers";
import { loadPreference, savePreference } from "../storage-preferences";
import { sectorEnvironmentById } from "../../data/map-sector-environments";
import type { SectorGridMode } from "../sector-grid-mode";
import { uiPreferenceDefaults } from "../../data/ui-preference-defaults";

/** Local emitter so this module type-imports `phaser` only — importing the
 *  EventEmitter as a value pulls in a `window`-referencing bundle that breaks
 *  the headless sector-grid.test in Node. */
class GridModeEmitter {
  private readonly listeners = new Set<(mode: SectorGridMode) => void>();
  on(listener: (mode: SectorGridMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(mode: SectorGridMode): void {
    for (const listener of this.listeners) listener(mode);
  }
}

const GRID_MODE_STORAGE_KEY = "sectorGridMode";
const GRID_MODES: readonly SectorGridMode[] = ["auto", "on", "off"];
function parseGridMode(storedValue: string): SectorGridMode {
  return (GRID_MODES as readonly string[]).includes(storedValue)
    ? (storedValue as SectorGridMode)
    : uiPreferenceDefaults.sectorGridMode;
}

interface SectorGridFadeState {
  lastFade: number;
  lastScrollTime: number;
  lastScrollX: number;
  lastScrollY: number;
  scrollTracked: boolean;
}

export interface SectorGrid {
  fadeState: SectorGridFadeState;
  grid: Phaser.GameObjects.Graphics;
  corners: Phaser.GameObjects.Graphics;
  sectorLabels: Phaser.GameObjects.Text[];
  gridMode: SectorGridMode;
  /** Switch grid between auto (fade on camera move), always-on, always-off.
   *  Persists to localStorage unless the creator opted out. */
  setMode(mode: SectorGridMode): void;
  /** Subscribe to mode changes so UI toggles can mirror programmatic flips. */
  onModeChange(listener: (mode: SectorGridMode) => void): () => void;
}

interface SectorGridOptions {
  initialMode?: SectorGridMode;
  persistMode?: boolean;
}

type SectorGridMapDimensions = Pick<GameMap, "gridSizeX" | "gridSizeY" | "sectorSize">;

// performance.now() is milliseconds; the registry stores the fade band in seconds.
const FADE_DELAY_MILLISECONDS = sectorGridVisuals.fadeDelaySeconds * 1000;
const FADE_DURATION_MILLISECONDS = sectorGridVisuals.fadeDurationSeconds * 1000;

export function hideSectorGridVisuals(sectorGrid: SectorGrid): void {
  sectorGrid.grid.setVisible(false);
  sectorGrid.corners.clear();
  sectorGrid.sectorLabels.forEach((sectorLabel) => sectorLabel.setVisible(false));
}

function setSectorGridAlpha(sectorGrid: SectorGrid, alpha: number): void {
  sectorGrid.grid.setVisible(true);
  sectorGrid.grid.setAlpha(alpha);
  sectorGrid.sectorLabels.forEach((sectorLabel) => {
    sectorLabel.setVisible(true);
    sectorLabel.setAlpha(alpha);
  });
}

export function showSectorGridFullAlpha(sectorGrid: SectorGrid): void {
  setSectorGridAlpha(sectorGrid, 1);
}

export function resetAutoSectorGridState(sectorGrid: SectorGrid): void {
  // lastScrollTime = -1 is the "uninitialized" sentinel — the next
  // updateSectorCorners only baselines the camera, doesn't count as movement.
  sectorGrid.fadeState.lastFade = 0;
  sectorGrid.fadeState.lastScrollTime = -1;
  sectorGrid.fadeState.lastScrollX = 0;
  sectorGrid.fadeState.lastScrollY = 0;
  sectorGrid.fadeState.scrollTracked = false;
  hideSectorGridVisuals(sectorGrid);
}

export function createSectorGrid(
  scene: Scene,
  sectors: Sector[],
  mapDimensions: SectorGridMapDimensions,
  options: SectorGridOptions = {},
): SectorGrid {
  const persistMode = options.persistMode ?? true;

  const gridGraphics = drawSectorGridLines(scene, mapDimensions);
  const corners = scene.add.graphics();
  corners.setDepth(Layer.SectorGrid);
  const sectorLabels = createSectorLabels(scene, sectors);

  gridGraphics.setVisible(false);
  sectorLabels.forEach((sectorLabel) => sectorLabel.setVisible(false));

  const emitter = new GridModeEmitter();
  const sectorGrid: SectorGrid = {
    fadeState: {
      lastFade: 0,
      lastScrollTime: -1,
      lastScrollX: 0,
      lastScrollY: 0,
      scrollTracked: false,
    },
    grid: gridGraphics,
    corners,
    sectorLabels,
    // Editor mode forces its own state and must not overwrite the player's
    // persisted gameplay preference.
    gridMode: options.initialMode ?? parseGridMode(loadPreference(GRID_MODE_STORAGE_KEY, uiPreferenceDefaults.sectorGridMode)),
    setMode(mode) {
      if (sectorGrid.gridMode === mode) return;
      sectorGrid.gridMode = mode;
      if (persistMode) savePreference(GRID_MODE_STORAGE_KEY, mode);
      applySectorGridMode(sectorGrid, mode);
      emitter.emit(mode);
    },
    onModeChange(listener) {
      return emitter.on(listener);
    },
  };
  applySectorGridMode(sectorGrid, sectorGrid.gridMode);

  return sectorGrid;
}

function strokeGridLines(
  graphics: Phaser.GameObjects.Graphics,
  geometry: { columns: number; rows: number; step: number; mapWidth: number; mapHeight: number },
): void {
  graphics.lineStyle(1, 0xffffff, sectorGridVisuals.gridLineAlpha);
  for (let column = 0; column <= geometry.columns; column++) {
    const x = column * geometry.step;
    graphics.moveTo(x, 0);
    graphics.lineTo(x, geometry.mapHeight);
  }
  for (let row = 0; row <= geometry.rows; row++) {
    const y = row * geometry.step;
    graphics.moveTo(0, y);
    graphics.lineTo(geometry.mapWidth, y);
  }
  graphics.strokePath();
}

function drawSectorGridLines(
  scene: Scene,
  mapDimensions: SectorGridMapDimensions,
): Phaser.GameObjects.Graphics {
  const { gridSizeX, gridSizeY, sectorSize } = mapDimensions;
  const gridGraphics = scene.add.graphics();
  gridGraphics.setDepth(Layer.SectorGrid);

  // Map grid top-left is always (0, 0); spans [0, gridSize * sectorSize] per axis.
  strokeGridLines(gridGraphics, {
    columns: gridSizeX,
    rows: gridSizeY,
    step: sectorSize,
    mapWidth: gridSizeX * sectorSize,
    mapHeight: gridSizeY * sectorSize,
  });
  return gridGraphics;
}

function createSectorLabels(scene: Scene, sectors: Sector[]): Phaser.GameObjects.Text[] {
  const sectorLabels: Phaser.GameObjects.Text[] = [];
  const margin = sectorGridVisuals.labelMargin;
  for (const sector of sectors) {
    const label = scene.add.text(
      sector.x - sector.size / 2 + margin,
      sector.y - sector.size / 2 + margin,
      buildSectorLabelText(sector),
      {
        fontFamily: displayFontFamily,
        fontSize: `${sectorGridVisuals.labelFontPixels}px`,
        color: sectorGridVisuals.labelColor,
      },
    );
    label.setOrigin(0, 0);
    label.setDepth(Layer.SectorGrid);
    label.setLineSpacing(sectorGridVisuals.labelLineSpacing);
    sectorLabels.push(label);
  }
  return sectorLabels;
}

/** Apply the grid-mode preference to the visuals: on → full alpha, off → hidden,
 *  auto → reset so fade logic takes over from the next camera move. */
export function applySectorGridMode(sectorGrid: SectorGrid, mode: SectorGridMode): void {
  if (mode === "on") {
    showSectorGridFullAlpha(sectorGrid);
    return;
  }
  if (mode === "off") {
    hideSectorGridVisuals(sectorGrid);
    return;
  }
  resetAutoSectorGridState(sectorGrid);
}

export function updateSectorCorners(
  sectorGrid: SectorGrid,
  sectors: Sector[],
  camera: Phaser.Cameras.Scene2D.Camera,
) {
  const nowMilliseconds = performance.now();
  trackCameraScrollForFade(sectorGrid.fadeState, camera, nowMilliseconds);

  if (sectorGrid.gridMode === "off") return;

  if (sectorGrid.gridMode === "on") {
    sectorGrid.fadeState.lastFade = 1;
    drawAllSectorCorners(sectorGrid.corners, sectors, 1);
    return;
  }

  const fade = tickAutoSectorGridFade(sectorGrid, nowMilliseconds);
  if (fade !== null) drawAllSectorCorners(sectorGrid.corners, sectors, fade);
}

function trackCameraScrollForFade(
  fadeState: SectorGridFadeState,
  camera: Phaser.Cameras.Scene2D.Camera,
  nowMilliseconds: number,
): void {
  if (!fadeState.scrollTracked) {
    fadeState.lastScrollX = camera.scrollX;
    fadeState.lastScrollY = camera.scrollY;
    fadeState.scrollTracked = true;
    return;
  }
  if (camera.scrollX !== fadeState.lastScrollX || camera.scrollY !== fadeState.lastScrollY) {
    fadeState.lastScrollX = camera.scrollX;
    fadeState.lastScrollY = camera.scrollY;
    fadeState.lastScrollTime = nowMilliseconds;
  }
}

function computeAutoFadeAlpha(elapsed: number): number | null {
  if (elapsed < FADE_DELAY_MILLISECONDS) return 1;
  if (elapsed < FADE_DELAY_MILLISECONDS + FADE_DURATION_MILLISECONDS) {
    return 1 - (elapsed - FADE_DELAY_MILLISECONDS) / FADE_DURATION_MILLISECONDS;
  }
  return null;
}

/** Update auto-mode fade state and apply the resulting alpha to grid + labels.
 *  Returns the fade value (0–1) so the caller can redraw sector corners, or
 *  null when the grid should stay hidden this frame. */
function tickAutoSectorGridFade(sectorGrid: SectorGrid, nowMilliseconds: number): number | null {
  const fadeState = sectorGrid.fadeState;
  // Auto mode's first frame only baselines the camera — showing the grid before
  // any movement would flash on startup and mode transitions.
  if (fadeState.lastScrollTime < 0) {
    hideSectorGridVisuals(sectorGrid);
    fadeState.lastFade = 0;
    return null;
  }

  const fade = computeAutoFadeAlpha(nowMilliseconds - fadeState.lastScrollTime);
  if (fade === null) {
    if (fadeState.lastFade !== 0) {
      hideSectorGridVisuals(sectorGrid);
      fadeState.lastFade = 0;
    }
    return null;
  }

  if (fade !== fadeState.lastFade) setSectorGridAlpha(sectorGrid, fade);
  fadeState.lastFade = fade;
  return fade;
}

function drawAllSectorCorners(corners: Phaser.GameObjects.Graphics, sectors: Sector[], fade: number): void {
  corners.clear();
  corners.lineStyle(4, 0xffffff, sectorGridVisuals.cornerBaseAlpha * fade);
  const half = sectors[0].size / 2;
  for (const sector of sectors) {
    drawCornerBrackets(corners, {
      bounds: {
        left: sector.x - half,
        top: sector.y - half,
        right: sector.x + half,
        bottom: sector.y + half,
      },
      armLength: sectorGridVisuals.cornerArmLength,
    });
  }
  corners.strokePath();
}

/** Overview-mode grid — uniform thin lines per sector plus N subdivisions per cell, sharing the auto-mode sector divider style. Hidden by default; overview mode toggles visibility. */
export function createOverviewGrid(
  scene: Scene,
  mapDimensions: SectorGridMapDimensions,
  subdivisions = 4,
): Phaser.GameObjects.Graphics {
  const { gridSizeX, gridSizeY, sectorSize } = mapDimensions;
  const gridGraphics = scene.add.graphics();
  gridGraphics.setDepth(Layer.SectorGrid);

  strokeGridLines(gridGraphics, {
    columns: gridSizeX * subdivisions,
    rows: gridSizeY * subdivisions,
    step: sectorSize / subdivisions,
    mapWidth: gridSizeX * sectorSize,
    mapHeight: gridSizeY * sectorSize,
  });
  gridGraphics.setVisible(false);
  return gridGraphics;
}

/** Sector grid label: sector name + coordinates above, environment below. */
export function buildSectorLabelText(sector: Sector): string {
  const header = `${sector.name} (${sector.gridX}, ${sector.gridY})`;
  const environment = sector.environment ? sectorEnvironmentById[sector.environment].name : "";
  return environment ? `${header}\n${environment}` : header;
}

interface CornerBracketsParams {
  bounds: { left: number; top: number; right: number; bottom: number };
  armLength: number;
}

/** Draw L-shaped brackets at each corner of a rectangle, arms extending inward. */
function drawCornerBrackets(graphics: Phaser.GameObjects.Graphics, params: CornerBracketsParams) {
  const { left, top, right, bottom } = params.bounds;
  const { armLength } = params;
  graphics.moveTo(left, top);
  graphics.lineTo(left + armLength, top);
  graphics.moveTo(left, top);
  graphics.lineTo(left, top + armLength);
  graphics.moveTo(right, top);
  graphics.lineTo(right - armLength, top);
  graphics.moveTo(right, top);
  graphics.lineTo(right, top + armLength);
  graphics.moveTo(left, bottom);
  graphics.lineTo(left + armLength, bottom);
  graphics.moveTo(left, bottom);
  graphics.lineTo(left, bottom - armLength);
  graphics.moveTo(right, bottom);
  graphics.lineTo(right - armLength, bottom);
  graphics.moveTo(right, bottom);
  graphics.lineTo(right, bottom - armLength);
}
