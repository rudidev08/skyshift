export function getSpeedPauseButtonTitle(paused: boolean, keyboardShortcutsEnabled: boolean): string {
  const action = paused ? "Resume" : "Pause";
  return keyboardShortcutsEnabled ? `${action} (Space)` : action;
}

export function getSpeedCycleButtonTitle(keyboardShortcutsEnabled: boolean): string {
  return keyboardShortcutsEnabled ? "Cycle speed (1/2/3)" : "Cycle speed";
}
