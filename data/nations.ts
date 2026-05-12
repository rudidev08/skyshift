import type { NationTemplate } from "./nation-types";
import * as nationLore from "./strings-nations";

export const hubNation: NationTemplate = {
  id: "hub",
  codeName: "HUB",
  shortName: "Hub-Cluster",
  name: "Hub-Cluster Alliance",
  color: "#0069B3",
  lore: nationLore.HUB_LORE,
  namingStyle: nationLore.HUB_NAMING_STYLE,
  shipTypeId: "trader",
  buildableStationTypeIds: ["tech-factory", "water-processing", "shipyard"],
  primaryBuildableStationTypeId: "tech-factory",
  desire: { verb: nationLore.HUB_DESIRE_VERB, object: nationLore.HUB_DESIRE_OBJECT },
  buildsStations: true,
  participatesInEmigration: true,
  stationConstructionShipTypeId: "trader",
  stationNames: nationLore.HUB_STATION_NAMES,
  shipNames: nationLore.HUB_SHIP_NAMES,
  nameSuffixes: nationLore.HUB_NAME_SUFFIXES,
};

export const bioNation: NationTemplate = {
  id: "bio",
  codeName: "BIO",
  shortName: "Bio-Annex",
  name: "Bio-Annex",
  color: "#4CAF50",
  lore: nationLore.BIO_LORE,
  namingStyle: nationLore.BIO_NAMING_STYLE,
  shipTypeId: "seedhaul",
  buildableStationTypeIds: ["farm", "medical-lab", "habitat"],
  primaryBuildableStationTypeId: "farm",
  desire: { verb: nationLore.BIO_DESIRE_VERB, object: nationLore.BIO_DESIRE_OBJECT },
  buildsStations: true,
  participatesInEmigration: true,
  stationConstructionShipTypeId: "trader",
  stationNames: nationLore.BIO_STATION_NAMES,
  shipNames: nationLore.BIO_SHIP_NAMES,
  nameSuffixes: nationLore.BIO_NAME_SUFFIXES,
};

export const oreNation: NationTemplate = {
  id: "ore",
  codeName: "ORE",
  shortName: "Mining Fleet",
  name: "20th Mining Fleet",
  color: "#B36100",
  lore: nationLore.ORE_LORE,
  namingStyle: nationLore.ORE_NAMING_STYLE,
  shipTypeId: "tanker",
  buildableStationTypeIds: ["mine", "metal-forge"],
  primaryBuildableStationTypeId: "mine",
  desire: { verb: nationLore.ORE_DESIRE_VERB, object: nationLore.ORE_DESIRE_OBJECT },
  buildsStations: true,
  participatesInEmigration: true,
  stationConstructionShipTypeId: "trader",
  stationNames: nationLore.ORE_STATION_NAMES,
  shipNames: nationLore.ORE_SHIP_NAMES,
  nameSuffixes: nationLore.ORE_NAME_SUFFIXES,
};

export const skyNation: NationTemplate = {
  id: "sky",
  codeName: "SKY",
  shortName: "Skyshift",
  name: "Skyshift Cooperative",
  color: "#00F9FF",
  lore: nationLore.SKY_LORE,
  namingStyle: nationLore.SKY_NAMING_STYLE,
  shipTypeId: "jumpship",
  buildableStationTypeIds: ["archives"],
  primaryBuildableStationTypeId: "archives",
  desire: { verb: nationLore.SKY_DESIRE_VERB, object: nationLore.SKY_DESIRE_OBJECT },
  buildsStations: true,
  participatesInEmigration: true,
  stationConstructionShipTypeId: "trader",
  stationNames: nationLore.SKY_STATION_NAMES,
  shipNames: nationLore.SKY_SHIP_NAMES,
  nameSuffixes: nationLore.SKY_NAME_SUFFIXES,
};

export const farNation: NationTemplate = {
  id: "far",
  codeName: "FAR",
  shortName: "Farshift",
  name: "Farshift Collective",
  color: "#E8C840",
  lore: nationLore.FAR_LORE,
  namingStyle: nationLore.FAR_NAMING_STYLE,
  shipTypeId: "trader",
  buildableStationTypeIds: ["observatory"],
  primaryBuildableStationTypeId: "observatory",
  desire: { verb: nationLore.FAR_DESIRE_VERB, object: nationLore.FAR_DESIRE_OBJECT },
  buildsStations: true,
  participatesInEmigration: true,
  stationConstructionShipTypeId: "trader",
  stationNames: nationLore.FAR_STATION_NAMES,
  shipNames: nationLore.FAR_SHIP_NAMES,
  nameSuffixes: nationLore.FAR_NAME_SUFFIXES,
};

/** WAY owns the generational-ship stations and emigrant ships, but the two
 *  false flags below keep it out of the build-cycle and emigration pipelines
 *  that the other nations run through NationManager and EmigrationManager. */
export const wayNation: NationTemplate = {
  id: "way",
  codeName: "WAY",
  shortName: "Wayfarer-Ark",
  name: "Wayfarer-Ark Transitus",
  color: "#808080",
  lore: nationLore.WAY_LORE,
  namingStyle: nationLore.WAY_NAMING_STYLE,
  shipTypeId: null,
  // The generational ship is WAY's signature type — drives the overview seal and "Generational Ships: N"
  // stat line. buildsStations: false still keeps WAY out of build cycles.
  buildableStationTypeIds: ["generational-ship"],
  primaryBuildableStationTypeId: "generational-ship",
  desire: { verb: nationLore.WAY_DESIRE_VERB, object: nationLore.WAY_DESIRE_OBJECT },
  buildsStations: false,
  participatesInEmigration: false,
  stationConstructionShipTypeId: null,
  stationNames: nationLore.WAY_STATION_NAMES,
  shipNames: nationLore.WAY_SHIP_NAMES,
  nameSuffixes: nationLore.WAY_NAME_SUFFIXES,
};

/** Every nation including WAY — contrast with buildingNations which excludes it. */
export const allNations: NationTemplate[] = [
  hubNation,
  bioNation,
  oreNation,
  skyNation,
  farNation,
  wayNation,
];

/** Playable nations that run building cycles. */
export const buildingNations: NationTemplate[] = allNations.filter((nation) => nation.buildsStations);
