// Sector environments define what station types are allowed to be built
import type { StationTypeId } from "./station-types";

export type SectorEnvironmentId =
  | "core"
  | "mineral-rich"
  | "bio-nebula"
  | "deep-space"
  | "frontier"
  | "trade-lanes"
  | "hazardous";

export interface SectorEnvironment {
  name: string;
  allowedStationTypeIds: readonly StationTypeId[];
}

export const sectorEnvironmentById: Record<SectorEnvironmentId, SectorEnvironment> = {
  "core": {
    name: "Core",
    allowedStationTypeIds: ["habitat", "tech-factory", "shipyard", "medical-lab", "water-processing"],
  },
  "mineral-rich": {
    name: "Mineral-rich",
    allowedStationTypeIds: ["mine", "metal-forge", "water-processing", "habitat"],
  },
  "bio-nebula": {
    name: "Bio-nebula",
    allowedStationTypeIds: ["farm", "medical-lab", "water-processing", "habitat"],
  },
  "deep-space": {
    name: "Deep space",
    allowedStationTypeIds: ["observatory", "archives"],
  },
  "frontier": {
    name: "Frontier",
    allowedStationTypeIds: ["habitat", "observatory"],
  },
  "trade-lanes": {
    name: "Trade lanes",
    allowedStationTypeIds: ["habitat", "water-processing", "shipyard"],
  },
  // Intentionally empty — hazardous sectors are uninhabitable.
  "hazardous": {
    name: "Hazardous",
    allowedStationTypeIds: [],
  },
};
