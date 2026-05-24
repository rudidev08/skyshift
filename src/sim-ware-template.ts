import { allWares } from "../data/wares";
import type { WareTemplate, WareProductionInput, WareId } from "../data/ware-types";
import { economyConfig } from "../data/economy-config";
import { templateLookupById } from "./util-template-registry";

export const getWareTemplate = templateLookupById<WareId, WareTemplate>(allWares, "ware");

/** Reads economyConfig each call so editor edits to targetFillTimeSeconds take effect on the next station built. */
export function getStorageCapacityInTicks(): number {
  return economyConfig.targetFillTimeSeconds / economyConfig.simulationIntervalSeconds;
}

/** Station output storage for a ware — one hour of its production output. */
export function getWareOutputStorage(ware: WareTemplate): number {
  return ware.productionOutput * getStorageCapacityInTicks();
}

/** Station input storage for a production input — one hour of its consumption. */
export function getWareInputStorage(input: WareProductionInput): number {
  return input.unitsPerTick * getStorageCapacityInTicks();
}

// Canonical ware order. Lets display sites sort without per-ware sortOrder fields.
const wareOrderById = new Map<WareId, number>(allWares.map((ware, index) => [ware.id, index]));

export function sortWares(leftWare: WareTemplate, rightWare: WareTemplate): number {
  return wareOrderById.get(leftWare.id)! - wareOrderById.get(rightWare.id)!;
}
