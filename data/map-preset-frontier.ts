// Frontier map starts with one of each station type so economy is not stuck
import type { MapPreset } from "./map-types";

export const frontierPreset: MapPreset = {
  id: "frontier",
  name: "Frontier",
  description: "Early days, nations just getting started.",
  simulationWarmupSeconds: 20,
  // stations start almost empty with wares
  initialInventoryFillRange: {
    inventoryLowerBound: 0.05,
    inventoryUpperBound: 0.2,
  },
  presetStations: [
    {
      zoneId: "overgrowth-4",
      stationId: "BIO-F",
      name: "Bloomreach",
      nationId: "bio",
      stationTypeId: "farm",
    },
    {
      zoneId: "abject-pride-1",
      stationId: "BIO-M",
      name: "Rootspire",
      nationId: "bio",
      stationTypeId: "medical-lab",
    },
    {
      zoneId: "bright-towers-4",
      stationId: "HUB-K",
      name: "High Pinnacle",
      nationId: "hub",
      stationTypeId: "habitat",
    },
    {
      zoneId: "bright-towers-5",
      stationId: "HUB-S",
      name: "Old Bastion",
      nationId: "hub",
      stationTypeId: "shipyard",
    },
    {
      zoneId: "new-logic-4",
      stationId: "HUB-V",
      name: "Bright Cipher",
      nationId: "hub",
      stationTypeId: "tech-factory",
    },
    {
      zoneId: "abject-pride-3",
      stationId: "HUB-C",
      name: "Clear Mandate",
      nationId: "hub",
      stationTypeId: "water-processing",
    },
    {
      zoneId: "hearth-6",
      stationId: "ORE-E",
      name: "Slagholm",
      nationId: "ore",
      stationTypeId: "metal-forge",
    },
    {
      zoneId: "hearth-7",
      stationId: "ORE-R",
      name: "Ironvein",
      nationId: "ore",
      stationTypeId: "mine",
    },
    {
      zoneId: "void-of-safety-2",
      stationId: "SKY-A",
      name: "Drifthollow",
      nationId: "sky",
      stationTypeId: "archives",
    },
    {
      zoneId: "blind-study-3",
      stationId: "FAR-D",
      name: "Deep Range",
      nationId: "far",
      stationTypeId: "observatory",
    },
  ],
};
