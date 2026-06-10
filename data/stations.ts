import type { StationSize, StationTypeTemplate } from "./station-types";
import * as stationLore from "./strings-stations";

// station size multiplier for ware storage and production rates
export const sizeMultiplierBySize: Record<StationSize, number> = {
  S: 1,
  M: 2,
  L: 3,
};

export const longNameBySize: Record<StationSize, string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
};

// larger stations get more ships
export const shipsPerStationBySize: Record<StationSize, number> = {
  S: 1,
  M: 2,
  L: 3,
};

/** Station body radius per size, in map pixels. Shared by sim
 *  (flight phase-bounds) and render (sprite sizing). */
export const bodyRadiusBySize: Record<StationSize, number> = {
  S: 16,
  M: 22,
  L: 28,
};

export const allStationTypes: StationTypeTemplate[] = [
  {
    id: "mine",
    name: "Mine",
    namePlural: "Mines",
    produces: ["ice", "mineral"],
    lore: stationLore.MINE,
  },
  {
    id: "observatory",
    name: "Observatory",
    namePlural: "Observatories",
    produces: ["signal"],
    lore: stationLore.OBSERVATORY,
  },
  {
    id: "water-processing",
    name: "Water Processing",
    namePlural: "Water Processing", // mass noun — doesn't pluralize
    produces: ["water"],
    lore: stationLore.WATER_PROCESSING,
  },
  {
    id: "farm",
    name: "Farm",
    namePlural: "Farms",
    produces: ["food"],
    lore: stationLore.FARM,
  },
  {
    id: "medical-lab",
    name: "Medical Lab",
    namePlural: "Medical Labs",
    produces: ["medicine"],
    lore: stationLore.MEDICAL_LAB,
  },
  {
    id: "metal-forge",
    name: "Metal Forge",
    namePlural: "Metal Forges",
    produces: ["metal"],
    lore: stationLore.METAL_FORGE,
  },
  {
    id: "tech-factory",
    name: "Tech Factory",
    namePlural: "Tech Factories",
    produces: ["tech"],
    lore: stationLore.TECH_FACTORY,
  },
  {
    id: "archives",
    name: "Archives",
    namePlural: "Archives", // already plural — don't append "s"
    produces: ["hyperdata"],
    lore: stationLore.ARCHIVES,
  },
  {
    id: "habitat",
    name: "Habitat",
    namePlural: "Habitats",
    produces: ["provisions"],
    lore: stationLore.HABITAT,
  },
  {
    id: "shipyard",
    name: "Shipyard",
    namePlural: "Shipyards",
    produces: ["hulls"],
    lore: stationLore.SHIPYARD,
  },
  {
    id: "generational-ship",
    name: "Generational Ship",
    namePlural: "Generational Ships",
    produces: [],
    lore: stationLore.GENERATIONAL_SHIP,
  },
];
