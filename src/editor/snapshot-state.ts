// Frozen at module load (editor boot) so the diff-highlighter and save/revert
// gating can detect which baseline values the user has edited.
// Holds baselines for: ship cargo+speed, ware production output+inputs, economy config knobs.

import { allShips } from "../../data/ships";
import { allWares } from "../../data/wares";
import type { WareId, WareProductionInput } from "../../data/ware-types";
import { economyConfig } from "../../data/economy-config";

export type EconomyFieldName =
  | "minimumCargoFillThreshold"
  | "cargoFillDecayPerSecond"
  | "tradeWaitMinSeconds"
  | "tradeWaitMaxSeconds"
  | "groundedDelaySeconds"
  | "optimalPickChance";

export type ShipBaselineFieldName = "cargoCapacity" | "speed";

export interface ShipBaseline {
  id: string;
  cargoCapacity: number;
  speed: number;
}

export interface WareBaseline {
  id: WareId;
  productionOutput: number;
  productionInputs: WareProductionInput[];
}

export const baselineShips: ShipBaseline[] = allShips.map((ship) => ({
  id: ship.id,
  cargoCapacity: ship.cargoCapacity,
  speed: ship.speed,
}));

export const baselineWares: WareBaseline[] = allWares.map((ware) => ({
  id: ware.id,
  productionOutput: ware.productionOutput,
  productionInputs: ware.productionInputs.map((input) => ({
    wareId: input.wareId,
    unitsPerTick: input.unitsPerTick,
  })),
}));

export const baselineEconomyConfig: Record<EconomyFieldName, number> = {
  minimumCargoFillThreshold: economyConfig.minimumCargoFillThreshold,
  cargoFillDecayPerSecond: economyConfig.cargoFillDecayPerSecond,
  tradeWaitMinSeconds: economyConfig.tradeWaitMinSeconds,
  tradeWaitMaxSeconds: economyConfig.tradeWaitMaxSeconds,
  groundedDelaySeconds: economyConfig.groundedDelaySeconds,
  optimalPickChance: economyConfig.optimalPickChance,
};

export function isEconomyFieldName(field: string | undefined): field is EconomyFieldName {
  return field !== undefined && field in baselineEconomyConfig;
}

export function isShipBaselineFieldName(field: string | undefined): field is ShipBaselineFieldName {
  return field === "cargo" || field === "speed";
}
