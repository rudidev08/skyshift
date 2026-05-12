// Single source of truth for nation-colored code HTML used across the HUD
// (event log, trade route cards, nation cards).

/** Nation code wrapped in a nation-colored span, e.g. `ORE` in `#B36100`. */
export function nationColoredCodeSpan(nation: { color: string; codeName: string }): string {
  return `<span style="color:${nation.color}">${nation.codeName}</span>`;
}
