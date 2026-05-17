import { economyConfig } from "../data/economy-config";
import { isDevModeEnabled } from "./util-devmode";

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
  forceDirty: boolean;
  onDirty: () => void;
}

/** Run `onDirty` if a render needs updating. Throttles by sim tick, compares
 *  current values to a snapshot, and re-snapshots after the callback. Returns
 *  true when the callback ran. */
export function updateIfDirty<TItem>(options: UpdateIfDirtyOptions<TItem>): boolean {
  const dirty = isDirty(options);
  if (dirty) {
    options.onDirty();
    options.state.firstDrawDone = true;
    captureSnapshot(options.state, options.items, options.getValue);
  }
  options.state.lastTick = options.currentTick;
  tickDirtyWarnCounter(options.state, dirty);
  return dirty;
}

function isDirty<TItem>(options: UpdateIfDirtyOptions<TItem>): boolean {
  const { state, currentTick, isFocused, forceDirty, items, getValue } = options;
  if (!state.firstDrawDone) return true;
  if (forceDirty) return true;
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

/** Dev-mode only: warns once after DIRTY_FRAMES_WARN_THRESHOLD consecutive dirty evaluations. */
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
