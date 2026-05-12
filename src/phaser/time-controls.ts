import { type Scene } from "phaser";
import { SPEED_CYCLE } from "../../data/controls-game-speed";

export interface TimeController {
  setSpeed(scale: number): void;
  togglePause(): void;
  readonly currentSpeed: number;
}

// Module-level state so pause/resume can fire from anywhere (view modes, etc.)
// while staying in sync with the pause button UI.
let currentSpeed = 1;
let lastUnpausedSpeed = 1;
const speedChangeObservers: Array<(speed: number) => void> = [];
// SPEED_CYCLE (1×→2×→5×) is what the cycle button rotates through; pause is its own
// button. Devmode may register extra running speeds (e.g. 20×, 60×) that the cycle
// button skips but normalizeSpeed still accepts via setExtendedAllowedSpeeds.
let allowedSpeeds: ReadonlyArray<number> = SPEED_CYCLE;
let activeOnSpeedChange: ((scale: number) => void) | null = null;

export function setExtendedAllowedSpeeds(speeds: ReadonlyArray<number>): void {
  allowedSpeeds = [...SPEED_CYCLE, ...speeds];
}

function normalizeSpeed(scale: number): number {
  if (scale === 0) return 0;
  if (!Number.isFinite(scale)) return SPEED_CYCLE[0];

  let closestSpeed = allowedSpeeds[0];
  let closestDistance = Math.abs(scale - closestSpeed);
  for (const allowedSpeed of allowedSpeeds.slice(1)) {
    const distance = Math.abs(scale - allowedSpeed);
    if (distance < closestDistance) {
      closestSpeed = allowedSpeed;
      closestDistance = distance;
    }
  }

  return closestSpeed;
}

function applySpeed(scale: number, onSpeedChange?: (speed: number) => void) {
  const normalizedScale = normalizeSpeed(scale);
  if (normalizedScale === currentSpeed) return;
  currentSpeed = normalizedScale;
  if (normalizedScale > 0) lastUnpausedSpeed = normalizedScale;

  if (onSpeedChange) onSpeedChange(normalizedScale);
  for (const observer of speedChangeObservers) observer(normalizedScale);
}

export function setupTimeControls(
  scene: Scene,
  onSpeedChange: (scale: number) => void,
): TimeController {
  // Module-level state outlives the previous scene; reset so a remounted scene starts at 1× rather than the previous scene's last speed.
  currentSpeed = 1;
  lastUnpausedSpeed = 1;

  const pauseButton = document.getElementById("speed-pause-btn") as HTMLButtonElement | null;
  const cycleButton = document.getElementById("speed-cycle-btn") as HTMLButtonElement | null;

  const onPauseClick = () => {
    applySpeed(currentSpeed === 0 ? lastUnpausedSpeed : 0, onSpeedChange);
  };
  // Cycle advances 1×→2×→5×→1×. If paused, first click just resumes at the
  // last running speed — unpausing shouldn't quietly bump the speed.
  const onCycleClick = () => {
    if (currentSpeed === 0) {
      applySpeed(lastUnpausedSpeed, onSpeedChange);
      return;
    }
    const index = Math.max(0, (SPEED_CYCLE as ReadonlyArray<number>).indexOf(currentSpeed));
    const next = SPEED_CYCLE[(index + 1) % SPEED_CYCLE.length];
    applySpeed(next, onSpeedChange);
  };

  pauseButton?.addEventListener("click", onPauseClick);
  cycleButton?.addEventListener("click", onCycleClick);

  const devModeSpeedHandlers = wireDevModeSpeedButtons(onSpeedChange);

  const controller: TimeController = {
    get currentSpeed() {
      return currentSpeed;
    },
    setSpeed(scale: number) {
      applySpeed(scale, onSpeedChange);
    },
    togglePause() {
      applySpeed(currentSpeed === 0 ? lastUnpausedSpeed : 0, onSpeedChange);
    },
  };

  // pauseSim/resumeSim/isSimPaused need a scene-bound onSpeedChange to drive the sim; capture this scene's so external callers (view modes) get the same behavior as the pause button.
  activeOnSpeedChange = onSpeedChange;

  const cleanup = () => {
    pauseButton?.removeEventListener("click", onPauseClick);
    cycleButton?.removeEventListener("click", onCycleClick);
    for (const [button, handler] of devModeSpeedHandlers) button.removeEventListener("click", handler);
    activeOnSpeedChange = null;
  };
  scene.events.once("shutdown", cleanup);
  scene.events.once("destroy", cleanup);

  return controller;
}

/** Devmode extras: buttons tagged with data-dev-speed jump straight to that
 *  scale without touching the cycle progression. Returns the handler map so
 *  the caller's cleanup can `removeEventListener` each one. */
function wireDevModeSpeedButtons(onSpeedChange: (scale: number) => void): Map<HTMLButtonElement, () => void> {
  const devModeSpeedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-dev-speed]"));
  const devModeSpeedHandlers = new Map<HTMLButtonElement, () => void>();
  for (const button of devModeSpeedButtons) {
    const rawDevModeSpeed = button.dataset.devSpeed;
    const devModeSpeed = rawDevModeSpeed === undefined ? Number.NaN : Number.parseFloat(rawDevModeSpeed);
    if (!Number.isFinite(devModeSpeed) || devModeSpeed <= 0) continue;
    const onClick = () => applySpeed(devModeSpeed, onSpeedChange);
    button.addEventListener("click", onClick);
    devModeSpeedHandlers.set(button, onClick);
  }
  return devModeSpeedHandlers;
}

export function pauseSim(): void {
  if (currentSpeed === 0) return;
  applySpeed(0, activeOnSpeedChange ?? undefined);
}

export function resumeSim(): void {
  if (currentSpeed !== 0) return;
  applySpeed(lastUnpausedSpeed, activeOnSpeedChange ?? undefined);
}

export function isSimPaused(): boolean {
  return currentSpeed === 0;
}

export function addSpeedChangeObserver(observer: (speed: number) => void): () => void {
  speedChangeObservers.push(observer);
  return () => {
    const index = speedChangeObservers.indexOf(observer);
    if (index >= 0) speedChangeObservers.splice(index, 1);
  };
}
