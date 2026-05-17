/**
 * Devmode is on when running on localhost. It unlocks debug affordances like
 * the extra simulation-speed buttons wired in game-entry.ts.
 */
export function isDevModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost";
}
