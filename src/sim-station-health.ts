import type { Station } from "./sim-station-types";
import type { WareId } from "../data/ware-types";
import { getWareTemplate } from "./sim-ware-template";
import { getInventorySlot } from "./sim-station";

/** Ware-level health for a station's required inputs.
 *  - "bad"  — any required input is at 0.
 *  - "warn" — any required input is below 25% of slot.max (but > 0).
 *  - "ok"   — otherwise, or no required inputs. */
export type StationWareLevelHealth = "ok" | "warn" | "bad";

export function getStationWareLevelHealth(station: Station): StationWareLevelHealth {
  const requiredInputs = new Set<WareId>();
  for (const wareId of station.stationType.produces) {
    const ware = getWareTemplate(wareId);
    for (const input of ware.productionInputs) {
      requiredInputs.add(input.wareId);
    }
  }

  if (requiredInputs.size === 0) return "ok";

  let worst: StationWareLevelHealth = "ok";
  for (const wareId of requiredInputs) {
    const slot = getInventorySlot(station, wareId);
    if (!slot || slot.max <= 0) continue;
    if (slot.current <= 0) return "bad";
    if (slot.current < slot.max * 0.25) worst = "warn";
  }

  return worst;
}
