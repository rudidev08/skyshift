import { allWares } from "../data/wares";
import type { WareTemplate, WareProductionInput, WareId } from "../data/ware-types";
import { economyConfig } from "../data/economy-config";

const wareTemplatesById = new Map<WareId, WareTemplate>(allWares.map((ware) => [ware.id, ware]));

/** Throws on unknown id — every WareId comes from the data files, so a miss means a typo or stale reference, not a runtime case to handle. */
export function getWareTemplate(id: WareId): WareTemplate {
  const ware = wareTemplatesById.get(id);
  if (!ware) throw new Error(`Unknown ware: ${id}`);
  return ware;
}

/** Storage capacity in ticks. Read live (not cached) so editor edits to economyConfig take effect on the next station built. */
function getStorageCapacityInTicks(): number {
  return economyConfig.targetFillTimeSeconds / economyConfig.simulationIntervalSeconds;
}

export function getWareOutputStorage(ware: WareTemplate): number {
  return ware.productionOutput * getStorageCapacityInTicks();
}

export function getWareInputStorage(input: WareProductionInput): number {
  return input.unitsPerTick * getStorageCapacityInTicks();
}

// Canonical ware order. Lets display sites sort without per-ware sortOrder fields.
const wareOrderById = new Map<WareId, number>(allWares.map((ware, index) => [ware.id, index]));

export function sortWares(leftWare: WareTemplate, rightWare: WareTemplate): number {
  return wareOrderById.get(leftWare.id)! - wareOrderById.get(rightWare.id)!;
}
