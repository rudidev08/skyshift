import type { WareTemplate } from "./ware-types";
import * as wareLore from "./strings-wares";

// Raw resources (no inputs) — bulk production, large quantities moved by tankers
export const ice: WareTemplate = {
  id: "ice",
  name: "Ice",
  lore: wareLore.ICE,
  productionOutput: 8,
  productionInputs: [],
};
export const mineral: WareTemplate = {
  id: "mineral",
  name: "Mineral",
  lore: wareLore.MINERAL,
  productionOutput: 8,
  productionInputs: [],
};
export const signal: WareTemplate = {
  id: "signal",
  name: "Signal",
  lore: wareLore.SIGNAL,
  productionOutput: 2,
  productionInputs: [],
};

// Refined (single input) — water and metal reduce 2:1 from raw; hyperdata refines signal 1:1
export const water: WareTemplate = {
  id: "water",
  name: "Water",
  lore: wareLore.WATER,
  productionOutput: 4,
  productionInputs: [{ wareId: "ice", unitsPerTick: 8 }],
};
export const metal: WareTemplate = {
  id: "metal",
  name: "Metal",
  lore: wareLore.METAL,
  productionOutput: 4,
  productionInputs: [{ wareId: "mineral", unitsPerTick: 8 }],
};
export const hyperdata: WareTemplate = {
  id: "hyperdata",
  name: "Hyperdata",
  lore: wareLore.HYPERDATA,
  productionOutput: 2,
  productionInputs: [{ wareId: "signal", unitsPerTick: 2 }],
};

// Final products — small quantities, 2:1 reduction from refined
export const food: WareTemplate = {
  id: "food",
  name: "Food",
  lore: wareLore.FOOD,
  productionOutput: 2,
  productionInputs: [{ wareId: "water", unitsPerTick: 4 }],
};
export const medicine: WareTemplate = {
  id: "medicine",
  name: "Medicine",
  lore: wareLore.MEDICINE,
  productionOutput: 2,
  productionInputs: [
    { wareId: "mineral", unitsPerTick: 4 },
    { wareId: "food", unitsPerTick: 1 },
  ],
};
export const tech: WareTemplate = {
  id: "tech",
  name: "Tech",
  lore: wareLore.TECH,
  productionOutput: 2,
  productionInputs: [
    { wareId: "metal", unitsPerTick: 4 },
    { wareId: "hyperdata", unitsPerTick: 1 },
  ],
};

// Construction wares — produced by habitats (provisions) and shipyards (hulls), consumed by in-progress builds
export const provisions: WareTemplate = {
  id: "provisions",
  name: "Provisions",
  lore: wareLore.PROVISIONS,
  productionOutput: 1,
  productionInputs: [
    { wareId: "food", unitsPerTick: 1 },
    { wareId: "medicine", unitsPerTick: 1 },
  ],
};
export const hulls: WareTemplate = {
  id: "hulls",
  name: "Hulls",
  lore: wareLore.HULLS,
  productionOutput: 1,
  productionInputs: [{ wareId: "tech", unitsPerTick: 4 }],
};

// Emigration-only cargo. No producer, no consumer — emigrant ships fly to the
// generational ship with their cargo slot filled with this ware, purely as
// flavor so ships read as "carrying people, not empty." Decommissioned on arrival.
export const passengers: WareTemplate = {
  id: "passengers",
  name: "Passengers",
  lore: wareLore.PASSENGERS,
  productionOutput: 0,
  productionInputs: [],
};

// Sorted by id. Game views rely on this order.
export const allWares: WareTemplate[] = [
  food,
  hulls,
  hyperdata,
  ice,
  medicine,
  metal,
  mineral,
  passengers,
  provisions,
  signal,
  tech,
  water,
];
