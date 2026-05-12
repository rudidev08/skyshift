export function getTimePauseButtonTitle(paused: boolean, keyboardShortcutsEnabled: boolean): string {
  const action = paused ? "Resume" : "Pause";
  return keyboardShortcutsEnabled ? `${action} (Space)` : action;
}

export function getTimeAccelerationCycleButtonTitle(keyboardShortcutsEnabled: boolean): string {
  // Single HUD button cycles speed presets, so the tooltip lists all three keyboard shortcuts.
  return keyboardShortcutsEnabled ? "Cycle speed (1/2/3)" : "Cycle speed";
}
