import { type Scene } from "phaser";
import type { Sector } from "../sim-map-types";
import { DISPLAY_FONT_FAMILY } from "./viewport-culling";
import { Layer } from "./depth-layers";
import { loadKeyValueSetting, saveKeyValueSetting } from "../storage-preferences";
import { sectorHeaderText, formatEnvironment } from "../render-sector-label";

/** Local emitter so this module type-imports `phaser` only — importing the
 *  EventEmitter as a value pulls in a `window`-referencing bundle that breaks
 *  the headless sector-grid.test in Node. */
class ModeChangeEmitter {
  private readonly listeners = new Set<(mode: GridMode) => void>();
  on(listener: (mode: GridMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(mode: GridMode): void {
    for (const listener of this.listeners) listener(mode);
  }
}

export type GridMode = "on" | "auto" | "off";
const GRID_MODE_STORAGE_KEY = "sectorGridMode";
const GRID_MODES: readonly GridMode[] = ["auto", "on", "off"];
function parseGridMode(raw: string): GridMode {
  return (GRID_MODES as readonly string[]).includes(raw) ? (raw as GridMode) : "auto";
}

interface SectorGridFadeState {
  lastFade: number;
  lastScrollTime: number;
  lastScrollX: number;
  lastScrollY: number;
  scrollTracked: boolean;
}

export interface SectorGridSystem {
  fadeState: SectorGridFadeState;
  grid: Phaser.GameObjects.Graphics;
  corners: Phaser.GameObjects.Graphics;
  sectorLabels: Phaser.GameObjects.Text[];
  gridMode: GridMode;
  /** Switch grid between auto (fade on camera move), always-on, always-off.
   *  Persists to localStorage unless the creator opted out. */
  setMode(mode: GridMode): void;
  /** Subscribe to mode changes so UI toggles can mirror programmatic flips. */
  onModeChange(listener: (mode: GridMode) => void): () => void;
}

interface SectorGridOptions {
  initialMode?: GridMode;
  persistMode?: boolean;
}

interface MapDimensions {
  gridSizeX: number;
  gridSizeY: number;
  sectorSize: number;
}

const FADE_DELAY = 3000;
const FADE_DURATION = 750;
const CORNER_ARM_LENGTH = 60;

export function hideSectorGridVisuals(gridSystem: SectorGridSystem): void {
  gridSystem.grid.setVisible(false);
  gridSystem.corners.clear();
  gridSystem.sectorLabels.forEach((sectorLabel) => sectorLabel.setVisible(false));
}

export function resetAutoSectorGridState(gridSystem: SectorGridSystem): void {
  // lastScrollTime = -1 is the "uninitialized" sentinel — the next
  // updateSectorCorners only baselines the camera, doesn't count as movement.
  gridSystem.fadeState.lastFade = 0;
  gridSystem.fadeState.lastScrollTime = -1;
  gridSystem.fadeState.lastScrollX = 0;
  gridSystem.fadeState.lastScrollY = 0;
  gridSystem.fadeState.scrollTracked = false;
  hideSectorGridVisuals(gridSystem);
}

export function createSectorGrid(
  scene: Scene,
  sectors: Sector[],
  mapDimensions: MapDimensions,
  options: SectorGridOptions = {},
): SectorGridSystem {
  const persistMode = options.persistMode ?? true;

  const gridGraphics = drawSectorGridLines(scene, mapDimensions);
  const corners = scene.add.graphics();
  corners.setDepth(gridGraphics.depth);
  const sectorLabels = createSectorLabels(scene, sectors);

  gridGraphics.setVisible(false);
  sectorLabels.forEach((sectorLabel) => sectorLabel.setVisible(false));

  const emitter = new ModeChangeEmitter();
  const result: SectorGridSystem = {
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
    gridMode: options.initialMode ?? parseGridMode(loadKeyValueSetting(GRID_MODE_STORAGE_KEY, "auto")),
    setMode(mode) {
      if (result.gridMode === mode) return;
      result.gridMode = mode;
      if (persistMode) saveKeyValueSetting(GRID_MODE_STORAGE_KEY, mode);
      applySectorGridMode(result, mode);
      emitter.emit(mode);
    },
    onModeChange(listener) {
      return emitter.on(listener);
    },
  };
  applySectorGridMode(result, result.gridMode);

  return result;
}

function drawSectorGridLines(scene: Scene, mapDimensions: MapDimensions): Phaser.GameObjects.Graphics {
  const { gridSizeX, gridSizeY, sectorSize } = mapDimensions;
  const alpha = 0.18;
  const gridGraphics = scene.add.graphics();
  gridGraphics.setDepth(Layer.Grid);

  // Map grid top-left is always (0, 0); spans [0, gridSize * sectorSize] per axis.
  const mapWidth = gridSizeX * sectorSize;
  const mapHeight = gridSizeY * sectorSize;
  gridGraphics.lineStyle(1, 0xffffff, alpha);
  for (let column = 0; column <= gridSizeX; column++) {
    const x = column * sectorSize;
    gridGraphics.moveTo(x, 0);
    gridGraphics.lineTo(x, mapHeight);
  }
  for (let row = 0; row <= gridSizeY; row++) {
    const y = row * sectorSize;
    gridGraphics.moveTo(0, y);
    gridGraphics.lineTo(mapWidth, y);
  }
  gridGraphics.strokePath();
  return gridGraphics;
}

function createSectorLabels(scene: Scene, sectors: Sector[]): Phaser.GameObjects.Text[] {
  const sectorLabels: Phaser.GameObjects.Text[] = [];
  const margin = 12;
  for (const sector of sectors) {
    const label = scene.add.text(
      sector.x - sector.size / 2 + margin,
      sector.y - sector.size / 2 + margin,
      buildSectorLabelText(sector),
      { fontFamily: DISPLAY_FONT_FAMILY, fontSize: "56px", color: "rgba(255,255,255,0.7)" },
    );
    label.setOrigin(0, 0);
    label.setDepth(Layer.Grid);
    label.setLineSpacing(20);
    sectorLabels.push(label);
  }
  return sectorLabels;
}

function applySectorGridMode(gridSystem: SectorGridSystem, mode: GridMode): void {
  if (mode === "on") {
    gridSystem.grid.setVisible(true);
    gridSystem.grid.setAlpha(1);
    gridSystem.sectorLabels.forEach((sectorLabel) => {
      sectorLabel.setVisible(true);
      sectorLabel.setAlpha(1);
    });
    return;
  }
  if (mode === "off") {
    hideSectorGridVisuals(gridSystem);
    return;
  }
  // "auto" — fade logic takes over from the next camera move.
  resetAutoSectorGridState(gridSystem);
}

export function updateSectorCorners(
  gridSystem: SectorGridSystem,
  sectors: Sector[],
  camera: Phaser.Cameras.Scene2D.Camera,
) {
  const now = performance.now();
  trackCameraScrollForFade(gridSystem.fadeState, camera, now);

  if (gridSystem.gridMode === "off") return;

  if (gridSystem.gridMode === "on") {
    gridSystem.fadeState.lastFade = 1;
    drawAllSectorCorners(gridSystem.corners, sectors, 1);
    return;
  }

  const fade = tickAutoSectorGridFade(gridSystem, now);
  if (fade !== null) drawAllSectorCorners(gridSystem.corners, sectors, fade);
}

function trackCameraScrollForFade(
  fadeState: SectorGridFadeState,
  camera: Phaser.Cameras.Scene2D.Camera,
  now: number,
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
    fadeState.lastScrollTime = now;
  }
}

/** Update auto-mode fade state and apply the resulting alpha to grid + labels.
 *  Returns the fade value (0–1) so the caller can redraw sector corners, or
 *  null when the grid should stay hidden this frame. */
function tickAutoSectorGridFade(gridSystem: SectorGridSystem, now: number): number | null {
  const fadeState = gridSystem.fadeState;
  // Auto mode's first frame only baselines the camera — showing the grid before
  // any movement would flash on startup and mode transitions.
  if (fadeState.lastScrollTime < 0) {
    hideSectorGridVisuals(gridSystem);
    fadeState.lastFade = 0;
    return null;
  }

  const elapsed = now - fadeState.lastScrollTime;
  let fade: number;
  if (elapsed < FADE_DELAY) {
    fade = 1;
  } else if (elapsed < FADE_DELAY + FADE_DURATION) {
    fade = 1 - (elapsed - FADE_DELAY) / FADE_DURATION;
  } else {
    if (fadeState.lastFade !== 0) {
      hideSectorGridVisuals(gridSystem);
      fadeState.lastFade = 0;
    }
    return null;
  }

  if (fade !== fadeState.lastFade) {
    gridSystem.grid.setVisible(true);
    gridSystem.grid.setAlpha(fade);
    gridSystem.sectorLabels.forEach((sectorLabel) => {
      sectorLabel.setVisible(true);
      sectorLabel.setAlpha(fade);
    });
  }
  fadeState.lastFade = fade;
  return fade;
}

function drawAllSectorCorners(corners: Phaser.GameObjects.Graphics, sectors: Sector[], fade: number): void {
  corners.clear();
  corners.lineStyle(4, 0xffffff, 0.36 * fade);
  const half = sectors[0].size / 2;
  for (const sector of sectors) {
    drawCornerBrackets(corners, {
      bounds: {
        left: sector.x - half,
        top: sector.y - half,
        right: sector.x + half,
        bottom: sector.y + half,
      },
      armLength: CORNER_ARM_LENGTH,
    });
  }
  corners.strokePath();
}

/** Overview-mode grid — uniform thin lines per sector plus N subdivisions per cell, sharing the auto-mode sector divider style. Hidden by default; overview mode toggles visibility. */
export function createOverviewGrid(
  scene: Scene,
  mapDimensions: MapDimensions,
  subdivisions = 4,
): Phaser.GameObjects.Graphics {
  const { gridSizeX, gridSizeY, sectorSize } = mapDimensions;
  const gridGraphics = scene.add.graphics();
  gridGraphics.setDepth(Layer.Grid);
  const alpha = 0.18;
  gridGraphics.lineStyle(1, 0xffffff, alpha);

  const subdivisionSize = sectorSize / subdivisions;
  const totalCols = gridSizeX * subdivisions;
  const totalRows = gridSizeY * subdivisions;
  const mapWidth = gridSizeX * sectorSize;
  const mapHeight = gridSizeY * sectorSize;

  for (let column = 0; column <= totalCols; column++) {
    const x = column * subdivisionSize;
    gridGraphics.moveTo(x, 0);
    gridGraphics.lineTo(x, mapHeight);
  }
  for (let row = 0; row <= totalRows; row++) {
    const y = row * subdivisionSize;
    gridGraphics.moveTo(0, y);
    gridGraphics.lineTo(mapWidth, y);
  }
  gridGraphics.strokePath();
  gridGraphics.setVisible(false);
  return gridGraphics;
}

/** Sector grid label: sector name + coordinates above, environment below. */
function buildSectorLabelText(sector: Sector): string {
  const header = sectorHeaderText(sector);
  const environment = sector.environment ? formatEnvironment(sector.environment) : "";
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
