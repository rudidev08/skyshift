export type WareId =
  | "food"
  | "hulls"
  | "hyperdata"
  | "ice"
  | "medicine"
  | "metal"
  | "mineral"
  | "passengers"
  | "provisions"
  | "signal"
  | "tech"
  | "water";

/** Station input storage holds one hour of production demand, derived in src/sim-ware-template.ts. */
export type WareProductionInput = {
  wareId: WareId;
  unitsPerTick: number;
};

export type WareTemplate = {
  id: WareId;
  name: string;
  /** Units produced per production tick. Station output storage holds one hour of production. */
  productionOutput: number;
  /** Inputs per production tick. Order is stable and meaningful for display. */
  productionInputs: WareProductionInput[];
};
