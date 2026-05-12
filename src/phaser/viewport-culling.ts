import { cullingMargin, cullingRefreshIntervalMilliseconds } from "../../data/controls-camera";
import { economyConfig } from "../../data/economy-config";
import { stationVisuals } from "../../data/station-visuals";
import { isDevModeEnabled } from "../util-devmode";

/** Convert a CSS hex color string (e.g. "#ff8800") to the 0xRRGGBB number Phaser color APIs expect. */
export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** True if pointer moved less than 10px — a click, not a drag. */
export function isClickNotDrag(pointer: Phaser.Input.Pointer): boolean {
  return Math.abs(pointer.upX - pointer.downX) < 10 && Math.abs(pointer.upY - pointer.downY) < 10;
}

interface CullingBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// One struct so the culling state stays in sync; separate `let`s drift.
const cullingCache: {
  bounds: CullingBounds | null;
  lastRefreshTime: number;
  lastScrollX: number;
  lastScrollY: number;
  lastZoom: number;
  lastWidth: number;
  lastHeight: number;
} = {
  bounds: null,
  lastRefreshTime: 0,
  lastScrollX: 0,
  lastScrollY: 0,
  lastZoom: 0,
  lastWidth: 0,
  lastHeight: 0,
};

/** Current culling bounds. Cached when camera is still; otherwise recomputed at
 *  most once per `cullingRefreshIntervalMilliseconds` — the margin buffers any
 *  flicker between refreshes. Refreshes the module-level cache when the camera
 *  has moved/zoomed/resized and the refresh interval has elapsed. */
function getOrRefreshCullingBounds(camera: Phaser.Cameras.Scene2D.Camera): CullingBounds {
  const cameraChanged =
    camera.scrollX !== cullingCache.lastScrollX
    || camera.scrollY !== cullingCache.lastScrollY
    || camera.zoom !== cullingCache.lastZoom
    || camera.width !== cullingCache.lastWidth
    || camera.height !== cullingCache.lastHeight;

  if (cullingCache.bounds && !cameraChanged) return cullingCache.bounds;

  const now = performance.now();
  if (cullingCache.bounds && now - cullingCache.lastRefreshTime < cullingRefreshIntervalMilliseconds) {
    return cullingCache.bounds;
  }

  cullingCache.lastRefreshTime = now;
  cullingCache.lastScrollX = camera.scrollX;
  cullingCache.lastScrollY = camera.scrollY;
  cullingCache.lastZoom = camera.zoom;
  cullingCache.lastWidth = camera.width;
  cullingCache.lastHeight = camera.height;

  // Phaser 4: world center = scrollX + width/2 (zoom-independent). Dividing by
  // zoom would shift the culling region off-center.
  const centerX = cullingCache.lastScrollX + cullingCache.lastWidth / 2;
  const centerY = cullingCache.lastScrollY + cullingCache.lastHeight / 2;
  const halfVisibleWidth = cullingCache.lastWidth / (2 * cullingCache.lastZoom);
  const halfVisibleHeight = cullingCache.lastHeight / (2 * cullingCache.lastZoom);
  const extendX = halfVisibleWidth * (1 + cullingMargin);
  const extendY = halfVisibleHeight * (1 + cullingMargin);
  cullingCache.bounds = {
    minX: centerX - extendX,
    maxX: centerX + extendX,
    minY: centerY - extendY,
    maxY: centerY + extendY,
  };
  return cullingCache.bounds;
}

/** Map-space rectangle centered on (x, y); width/height default to 0 for points. */
export interface MapTargetRect {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** True if a map-space point or rect is within the culling viewport. Bounds
 *  cache invalidates on camera move/zoom/resize. */
export function isVisibleInViewport(
  camera: Phaser.Cameras.Scene2D.Camera,
  target: MapTargetRect,
): boolean {
  const bounds = getOrRefreshCullingBounds(camera);
  const halfWidth = (target.width ?? 0) / 2;
  const halfHeight = (target.height ?? 0) / 2;
  return target.x + halfWidth >= bounds.minX && target.x - halfWidth <= bounds.maxX
      && target.y + halfHeight >= bounds.minY && target.y - halfHeight <= bounds.maxY;
}

/** Reset the culling cache. Call on scene restart to drop stale bounds. */
export function resetCullingCache(): void {
  cullingCache.bounds = null;
}

/** True when a UI element should refresh its text this frame. Focused elements
 *  (selected station/ship, HUD) update every sim tick; background elements
 *  update on a slower interval. Text updates are expensive in browsers.
 *
 *  `currentTick` is the simulation's current EconomyTimer tick — caller
 *  passes it in so this stays a pure function. */
export function shouldUpdateUI(currentTick: number, lastTick: number, isFocused: boolean): boolean {
  const interval = isFocused
    ? economyConfig.focusedAttentionIntervalTicks
    : economyConfig.backgroundAttentionIntervalTicks;
  return currentTick !== lastTick && currentTick % interval === 0;
}

// Warn after this many consecutive dirty evaluations — usually means getValue
// returns floats that never match (state can never settle).
const DIRTY_FRAMES_WARN_THRESHOLD = 60;

export interface RenderDirtyState {
  lastTick: number;
  snapshot: number[];
  /** False until onDirty has run once. Lets always-empty arrays (e.g.
   *  generational-ship zero-wares inventory) settle after their first draw
   *  instead of firing onDirty forever. */
  firstDrawDone: boolean;
  /** Optional dev-mode label — warns when this state stays dirty for more than
   *  DIRTY_FRAMES_WARN_THRESHOLD consecutive evaluations. */
  debugLabel?: string;
  /** Counts toward DIRTY_FRAMES_WARN_THRESHOLD; reset to 0 on a clean evaluation. */
  consecutiveDirtyEvaluations: number;
}

export function createRenderDirtyState(debugLabel?: string): RenderDirtyState {
  return {
    lastTick: -1,
    snapshot: [],
    firstDrawDone: false,
    debugLabel,
    consecutiveDirtyEvaluations: 0,
  };
}

export interface UpdateIfDirtyOptions<TItem> {
  state: RenderDirtyState;
  currentTick: number;
  isFocused: boolean;
  items: readonly TItem[];
  getValue: (item: TItem) => number;
  forceReason: boolean;
  onDirty: () => void;
}

/** Run `onDirty` if a render needs updating. Throttles by sim tick, compares
 *  current values to a snapshot, and re-snapshots after the callback. Returns
 *  true when the callback ran. */
export function updateIfDirty<TItem>(options: UpdateIfDirtyOptions<TItem>): boolean {
  const { state, currentTick, isFocused, items, getValue, forceReason, onDirty } = options;
  const dirty = evaluateDirty(state, currentTick, isFocused, forceReason, items, getValue);
  if (dirty) {
    onDirty();
    state.firstDrawDone = true;
    captureSnapshot(state, items, getValue);
  }
  state.lastTick = currentTick;
  tickDirtyWarnCounter(state, dirty);
  return dirty;
}

/** Returns true on first call, when forceReason is set (e.g. selection changed), or on tick-aligned ticks where any item's value differs from the snapshot. */
function evaluateDirty<TItem>(
  state: RenderDirtyState,
  currentTick: number,
  isFocused: boolean,
  forceReason: boolean,
  items: readonly TItem[],
  getValue: (item: TItem) => number,
): boolean {
  if (!state.firstDrawDone) return true;
  if (forceReason) return true;
  const interval = isFocused
    ? economyConfig.focusedAttentionIntervalTicks
    : economyConfig.backgroundAttentionIntervalTicks;
  if (currentTick === state.lastTick || currentTick % interval !== 0) return false;
  for (let i = 0; i < items.length; i++) {
    if (getValue(items[i]) !== state.snapshot[i]) return true;
  }
  return false;
}

function captureSnapshot<TItem>(
  state: RenderDirtyState,
  items: readonly TItem[],
  getValue: (item: TItem) => number,
): void {
  if (state.snapshot.length !== items.length) {
    state.snapshot = new Array(items.length);
  }
  for (let i = 0; i < items.length; i++) {
    state.snapshot[i] = getValue(items[i]);
  }
}

/** Counts consecutive dirty evaluations and warns once at DIRTY_FRAMES_WARN_THRESHOLD — catches getValue returning subtly-different floats each call (state never settles). */
function tickDirtyWarnCounter(state: RenderDirtyState, dirty: boolean): void {
  if (!state.debugLabel || !isDevModeEnabled()) return;
  if (!dirty) {
    state.consecutiveDirtyEvaluations = 0;
    return;
  }
  state.consecutiveDirtyEvaluations++;
  if (state.consecutiveDirtyEvaluations === DIRTY_FRAMES_WARN_THRESHOLD) {
    console.warn(
      `[updateIfDirty] state "${state.debugLabel}" stayed dirty for ${DIRTY_FRAMES_WARN_THRESHOLD} consecutive evaluations`,
    );
  }
}

export const DISPLAY_FONT_FAMILY = '"Space Grotesk", system-ui, sans-serif';
export const MONO_FONT_FAMILY = '"JetBrains Mono", ui-monospace, monospace';

/** Default text style for map-space labels (station names, ship names, cargo). */
export const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: DISPLAY_FONT_FAMILY,
  fontSize: stationVisuals.labelFontSize,
  color: "#c0c0c0",
};
