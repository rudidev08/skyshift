// Frozen at module load (editor boot) so the diff-highlighter and save/revert
// gating can detect which authored values the user has edited.

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
  | "optimalChance";

export type ShipBaselineField = "cargoCapacity" | "speed";

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

export const baselineShips: ShipBaseline[] = allShips.map(ship => ({
  id: ship.id,
  cargoCapacity: ship.cargoCapacity,
  speed: ship.speed,
}));

export const baselineWares: WareBaseline[] = allWares.map(ware => ({
  id: ware.id,
  productionOutput: ware.productionOutput,
  productionInputs: ware.productionInputs.map(input => ({
    wareId: input.wareId,
    unitsPerTick: input.unitsPerTick,
  })),
}));

export const baselineConfigValues: Record<EconomyFieldName, number> = {
  minimumCargoFillThreshold: economyConfig.minimumCargoFillThreshold,
  cargoFillDecayPerSecond: economyConfig.cargoFillDecayPerSecond,
  tradeWaitMinSeconds: economyConfig.tradeWaitMinSeconds,
  tradeWaitMaxSeconds: economyConfig.tradeWaitMaxSeconds,
  groundedDelaySeconds: economyConfig.groundedDelaySeconds,
  optimalChance: economyConfig.optimalChance,
};

export function isEconomyFieldName(field: string | undefined): field is EconomyFieldName {
  return field !== undefined && field in baselineConfigValues;
}

export function isShipBaselineField(field: string | undefined): field is ShipBaselineField {
  return field === "cargo" || field === "speed";
}
