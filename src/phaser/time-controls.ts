import { type Scene } from "phaser";
import { speedCycle } from "../../data/controls-game-speed";

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
// speedCycle (1×→2×→5×) is what the cycle button rotates through; pause is its own
// button. Devmode may register extra running speeds (e.g. 20×, 60×) that the cycle
// button skips but normalizeSpeed still accepts via setExtendedAllowedSpeeds.
let allowedSpeeds: ReadonlyArray<number> = speedCycle;
let externalPauseSimCallback: ((scale: number) => void) | null = null;

export function setExtendedAllowedSpeeds(speeds: ReadonlyArray<number>): void {
  allowedSpeeds = [...speedCycle, ...speeds];
}

function normalizeSpeed(scale: number): number {
  if (scale === 0) return 0;
  if (!Number.isFinite(scale)) return speedCycle[0];

  let bestMatchSpeed = allowedSpeeds[0];
  let bestMatchDistance = Math.abs(scale - bestMatchSpeed);
  for (const allowedSpeed of allowedSpeeds.slice(1)) {
    const distance = Math.abs(scale - allowedSpeed);
    if (distance < bestMatchDistance) {
      bestMatchSpeed = allowedSpeed;
      bestMatchDistance = distance;
    }
  }

  return bestMatchSpeed;
}

function setCurrentSpeed(scale: number, onSpeedChange?: (speed: number) => void) {
  const normalizedScale = normalizeSpeed(scale);
  if (normalizedScale === currentSpeed) return;
  currentSpeed = normalizedScale;
  if (normalizedScale > 0) lastUnpausedSpeed = normalizedScale;

  if (onSpeedChange) onSpeedChange(normalizedScale);
  for (const observer of speedChangeObservers) observer(normalizedScale);
}

export function setupTimeControls(scene: Scene, onSpeedChange: (scale: number) => void): TimeController {
  // Module-level state outlives the previous scene; reset so a remounted scene starts at 1× rather than the previous scene's last speed.
  currentSpeed = 1;
  lastUnpausedSpeed = 1;

  const detachPauseAndCycle = attachPauseAndCycleButtons(onSpeedChange);
  const detachDevModeSpeedButtons = attachDevModeSpeedButtons(onSpeedChange);

  const controller: TimeController = {
    get currentSpeed() {
      return currentSpeed;
    },
    setSpeed(scale: number) {
      setCurrentSpeed(scale, onSpeedChange);
    },
    togglePause() {
      setCurrentSpeed(currentSpeed === 0 ? lastUnpausedSpeed : 0, onSpeedChange);
    },
  };

  // pauseSim/resumeSim/isSimPaused need a scene-bound onSpeedChange to drive the sim; capture this scene's so external callers (view modes) get the same behavior as the pause button.
  externalPauseSimCallback = onSpeedChange;

  const cleanup = () => {
    detachPauseAndCycle();
    detachDevModeSpeedButtons();
    externalPauseSimCallback = null;
  };
  scene.events.once("shutdown", cleanup);
  scene.events.once("destroy", cleanup);

  return controller;
}

function attachPauseAndCycleButtons(onSpeedChange: (scale: number) => void): () => void {
  const pauseButton = document.getElementById("speed-pause-btn") as HTMLButtonElement | null;
  const cycleButton = document.getElementById("speed-cycle-btn") as HTMLButtonElement | null;

  const onPauseClick = () => {
    setCurrentSpeed(currentSpeed === 0 ? lastUnpausedSpeed : 0, onSpeedChange);
  };
  // Cycle advances 1×→2×→5×→1×. If paused, first click just resumes at the
  // last running speed — unpausing shouldn't quietly bump the speed.
  const onCycleClick = () => {
    if (currentSpeed === 0) {
      setCurrentSpeed(lastUnpausedSpeed, onSpeedChange);
      return;
    }
    const index = Math.max(0, (speedCycle as ReadonlyArray<number>).indexOf(currentSpeed));
    const next = speedCycle[(index + 1) % speedCycle.length];
    setCurrentSpeed(next, onSpeedChange);
  };

  pauseButton?.addEventListener("click", onPauseClick);
  cycleButton?.addEventListener("click", onCycleClick);

  return () => {
    pauseButton?.removeEventListener("click", onPauseClick);
    cycleButton?.removeEventListener("click", onCycleClick);
  };
}

/** Devmode extras: buttons tagged with data-dev-speed jump straight to that
 *  scale without touching the cycle progression. */
function attachDevModeSpeedButtons(onSpeedChange: (scale: number) => void): () => void {
  const devModeSpeedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-dev-speed]"));
  const handlers = new Map<HTMLButtonElement, () => void>();
  for (const button of devModeSpeedButtons) {
    const rawDevModeSpeed = button.dataset.devSpeed;
    const devModeSpeed = rawDevModeSpeed === undefined ? Number.NaN : Number.parseFloat(rawDevModeSpeed);
    if (!Number.isFinite(devModeSpeed) || devModeSpeed <= 0) continue;
    const onClick = () => setCurrentSpeed(devModeSpeed, onSpeedChange);
    button.addEventListener("click", onClick);
    handlers.set(button, onClick);
  }
  return () => {
    for (const [button, handler] of handlers) button.removeEventListener("click", handler);
  };
}

export function pauseSim(): void {
  if (currentSpeed === 0) return;
  setCurrentSpeed(0, externalPauseSimCallback ?? undefined);
}

export function resumeSim(): void {
  if (currentSpeed !== 0) return;
  setCurrentSpeed(lastUnpausedSpeed, externalPauseSimCallback ?? undefined);
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
