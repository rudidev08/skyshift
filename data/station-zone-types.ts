import type { StationSize } from "./station-types";

/** A buildable slot. Position and size are fixed by the universe; whether a
 *  station sits here at game start comes from the preset. */
export interface StationZoneTemplate {
  /** `<sector-id>-<n>` — stable, scoped to the containing sector. The sector
   *  is resolved from `x`/`y` at seed time; the prefix here must name the
   *  sector the position falls in (checked in createZoneFromTemplate). */
  id: string;
  x: number;
  y: number;
  size: StationSize;
}
