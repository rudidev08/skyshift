import type { NationTemplate } from "./nation-types";
import * as nationLore from "./strings-nations";

/** Core systems, center of civilization.
 *  Builds tech factories (primary), water processing, and shipyards — the only
 *  source of hulls. Its build scorer packs each new station into the sector
 *  closest to existing ones, so HUB grows as a tight cluster. */
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

/** Closely tied to HUB, in both location and symbiosis. Settled in Palo Celestia grown tree nebula
 *  Life-support economy — farms (primary), medical labs, and habitats: food,
 *  medicine, provisions. The only seedhaul fleet, and the only build scorer
 *  that prefers bio-nebula sectors. */
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

/** At home in asteroid-dense space.
 *  Raw-materials base — mines (primary; ice and mineral) and metal forges. The
 *  only tanker fleet, and its build scorer prefers mineral-rich sectors. */
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

/** Isolated in bright nebulas. Jump ships can reach any space in short amount of time.
 *  Builds only archives (hyperdata). The lone jumpship fleet, and the only
 *  build scorer that ignores distance — it picks deep-space sectors at random,
 *  settling where others can't reach instead of clustering. */
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

/** Nomadic collective, driven by curiosity and variation.
 *  Builds only observatories (signal). Its build scorer is the inverse of
 *  every other nation's — it builds farthest from its own stations, scattering
 *  outposts across the map instead of clustering. */
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

/** The only nation outside the economy — no fleet, produces nothing, never
 *  builds, never emigrates: a neutral population carrier. Its generational
 *  ships are seeded fully formed rather than constructed. */
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
  shipNames: [],
  nameSuffixes: [],
};

/** Every nation including WAY — contrast with stationBuilderNations which excludes it. */
export const allNations: NationTemplate[] = [
  hubNation,
  bioNation,
  oreNation,
  skyNation,
  farNation,
  wayNation,
];

/** Playable nations that run building cycles. */
export const stationBuilderNations: NationTemplate[] = allNations.filter((nation) => nation.buildsStations);
