import type { Nation } from "./sim-nation";

/** Nation code wrapped in a nation-colored span, e.g. `ORE` in `#B36100`. */
export function nationColoredCodeSpan(nation: Nation): string {
  return `<span style="color:${nation.color}">${nation.codeName}</span>`;
}
