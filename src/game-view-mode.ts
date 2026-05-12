export type GameViewMode = "normal" | "zones" | "overview";

export interface GameViewModeController {
  getViewMode(): GameViewMode;
  setViewMode(mode: GameViewMode): void;
  onViewModeChange(listener: (mode: GameViewMode, previous: GameViewMode) => void): () => void;
}

export function createGameViewModeController(initial: GameViewMode = "normal"): GameViewModeController {
  let current: GameViewMode = initial;
  const listeners = new Set<(mode: GameViewMode, previous: GameViewMode) => void>();

  function setViewMode(mode: GameViewMode) {
    if (mode === current) return;
    const previous = current;
    current = mode;
    for (const listener of listeners) listener(current, previous);
  }

  return {
    getViewMode: () => current,
    setViewMode,
    onViewModeChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
