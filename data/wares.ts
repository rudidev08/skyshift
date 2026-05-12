import type { WareTemplate } from "./ware-types";

// Raw resources (no inputs) — bulk production, large quantities moved by tankers
export const ice: WareTemplate = {
  id: "ice",
  name: "Ice",
  productionOutput: 8,
  productionInputs: [],
};
export const mineral: WareTemplate = {
  id: "mineral",
  name: "Mineral",
  productionOutput: 8,
  productionInputs: [],
};
export const signal: WareTemplate = {
  id: "signal",
  name: "Signal",
  productionOutput: 2,
  productionInputs: [],
};

// Refined (single input) — medium quantities, 2:1 reduction from raw
export const water: WareTemplate = {
  id: "water",
  name: "Water",
  productionOutput: 4,
  productionInputs: [{ wareId: "ice", unitsPerTick: 8 }],
};
export const metal: WareTemplate = {
  id: "metal",
  name: "Metal",
  productionOutput: 4,
  productionInputs: [{ wareId: "mineral", unitsPerTick: 8 }],
};
export const hyperdata: WareTemplate = {
  id: "hyperdata",
  name: "Hyperdata",
  productionOutput: 2,
  productionInputs: [{ wareId: "signal", unitsPerTick: 2 }],
};

// Final products — small quantities, 2:1 reduction from refined
export const food: WareTemplate = {
  id: "food",
  name: "Food",
  productionOutput: 2,
  productionInputs: [{ wareId: "water", unitsPerTick: 4 }],
};
export const medicine: WareTemplate = {
  id: "medicine",
  name: "Medicine",
  productionOutput: 2,
  productionInputs: [
    { wareId: "mineral", unitsPerTick: 4 },
    { wareId: "food", unitsPerTick: 1 },
  ],
};
export const tech: WareTemplate = {
  id: "tech",
  name: "Tech",
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
  productionOutput: 1,
  productionInputs: [
    { wareId: "food", unitsPerTick: 1 },
    { wareId: "medicine", unitsPerTick: 1 },
  ],
};
export const hulls: WareTemplate = {
  id: "hulls",
  name: "Hulls",
  productionOutput: 1,
  productionInputs: [{ wareId: "tech", unitsPerTick: 4 }],
};

// Emigration-only cargo. No producer, no consumer — emigrant ships fly to the
// generational ship with their cargo slot filled with this ware, purely as
// flavor so ships read as "carrying people, not empty." Decommissioned on arrival.
export const passengers: WareTemplate = {
  id: "passengers",
  name: "Passengers",
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
