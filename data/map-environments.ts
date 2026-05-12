// Authored sector environments + allowed-station-type lookup table. The
// `allowedStationTypesForZone` helper lives in src/sim-map-environments.ts
// (presentation/lookup helpers live with runtime code per AGENTS.md).

import type { StationTypeId } from "./station-types";

export type EnvironmentId =
  | "core"
  | "mineral-rich"
  | "bio-nebula"
  | "deep-space"
  | "frontier"
  | "trade-lanes"
  | "hazardous";

/** `hazardous` is intentionally empty — those sectors are uninhabitable, not just unbuilt. */
export const ENVIRONMENT_ALLOWED_TYPES: Record<EnvironmentId, StationTypeId[]> = {
  core: ["habitat", "tech-factory", "shipyard", "medical-lab", "water-processing"],
  "mineral-rich": ["mine", "metal-forge", "water-processing", "habitat"],
  "bio-nebula": ["farm", "medical-lab", "water-processing", "habitat"],
  "deep-space": ["observatory", "archives"],
  frontier: ["habitat", "observatory"],
  "trade-lanes": ["habitat", "water-processing", "shipyard"],
  hazardous: [],
};
