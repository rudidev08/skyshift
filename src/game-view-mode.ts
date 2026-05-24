export type GameViewMode = "normal" | "zones" | "overview";

/** Shared mutable holder for the view mode the HUD has requested — read by
 *  Game.create() once Phaser finishes booting so a startup click isn't lost. */
export interface RequestedViewModeCell {
  value: GameViewMode;
}

export interface GameViewModeController {
  getViewMode(): GameViewMode;
  setViewMode(mode: GameViewMode): void;
  onViewModeChange(listener: (mode: GameViewMode) => void): () => void;
}

export function createGameViewModeController(initial: GameViewMode = "normal"): GameViewModeController {
  let current: GameViewMode = initial;
  const listeners = new Set<(mode: GameViewMode) => void>();

  function setViewMode(mode: GameViewMode) {
    if (mode === current) return;
    current = mode;
    for (const listener of listeners) listener(current);
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
