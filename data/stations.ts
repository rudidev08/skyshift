import type { StationSize, StationTemplate } from "./station-types";
import * as stationLore from "./strings-stations";

export const sizeMultiplierBySize: Record<StationSize, number> = {
  S: 1,
  M: 2,
  L: 3,
};

export const shortNameBySize: Record<StationSize, string> = {
  S: "S",
  M: "M",
  L: "L",
};

export const longNameBySize: Record<StationSize, string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
};

export const shipCountBySize: Record<StationSize, number> = {
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

export const stationTypes: StationTemplate[] = [
  { id: "mine",              name: "Mine",                                                produces: ["ice", "mineral"], lore: stationLore.MINE },
  { id: "observatory",       name: "Observatory",       plural: "Observatories",          produces: ["signal"],         lore: stationLore.OBSERVATORY },
  { id: "water-processing",  name: "Water Processing",  plural: "Water Processing",       produces: ["water"],          lore: stationLore.WATER_PROCESSING }, // mass noun — doesn't pluralize
  { id: "farm",              name: "Farm",                                                produces: ["food"],           lore: stationLore.FARM },
  { id: "medical-lab",       name: "Medical Lab",                                         produces: ["medicine"],       lore: stationLore.MEDICAL_LAB },
  { id: "metal-forge",       name: "Metal Forge",                                         produces: ["metal"],          lore: stationLore.METAL_FORGE },
  { id: "tech-factory",      name: "Tech Factory",      plural: "Tech Factories",         produces: ["tech"],           lore: stationLore.TECH_FACTORY },
  { id: "archives",          name: "Archives",          plural: "Archives",               produces: ["hyperdata"],      lore: stationLore.ARCHIVES }, // already plural — don't append "s"
  { id: "habitat",           name: "Habitat",                                             produces: ["provisions"],     lore: stationLore.HABITAT },
  { id: "shipyard",          name: "Shipyard",                                            produces: ["hulls"],          lore: stationLore.SHIPYARD },
  { id: "generational-ship", name: "Generational Ship",                                   produces: [],                 lore: stationLore.GENERATIONAL_SHIP },
];
