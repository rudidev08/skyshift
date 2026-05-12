import { economyConfig } from "../data/economy-config";
import type { WareId } from "../data/ware-types";
import { adjustForStation, getInventorySlot, type Station, type InventorySlot } from "./sim-station";
import { getWareTemplate } from "./sim-ware-template";

/** Per-simulation tick counter and sub-tick accumulator. Snapshots persist
 *  only `tick`; secondsSinceLastTick re-zeros on load. */
export class EconomyTimer {
  /** Wall-clock seconds accumulated since the last sim tick fired. */
  private secondsSinceLastTick = 0;
  /** Sim ticks since the last reset. UI throttling reads this. */
  tick = 0;

  reset(): void {
    this.secondsSinceLastTick = 0;
    this.tick = 0;
  }

  advance(deltaSeconds: number): void {
    this.secondsSinceLastTick += deltaSeconds;
    if (this.secondsSinceLastTick >= economyConfig.simulationIntervalSeconds) {
      this.secondsSinceLastTick -= economyConfig.simulationIntervalSeconds;
      this.tick++;
    }
  }
}

/** Stagger per-station tick offsets so production spreads across frames. */
export function staggerStationTicks(stations: Station[]) {
  const interval = economyConfig.simulationIntervalSeconds;
  for (let i = 0; i < stations.length; i++) {
    // Negative offsets spread each station's first tick evenly across one
    // interval, so production doesn't all land on the same frame.
    stations[i].secondsSinceLastTick = -(interval * i / stations.length);
  }
}

/** Produce one batch of `wareId` at this station if all preconditions hold:
 *  output slot has room (sink wares skip this), and every input slot has
 *  enough stock past its outgoing reservation. Returns true if a batch ran. */
function tickWareProductionIfReady(station: Station, wareId: WareId): boolean {
  const ware = getWareTemplate(wareId);
  // Sink wares consume without producing, so there's no output slot to gate on.
  const isSinkWare = ware.productionOutput === 0;
  if (!isSinkWare) {
    const outputSlot = getInventorySlot(station, wareId);
    if (!outputSlot || outputSlot.current >= outputSlot.max) return false;
  }

  // Pre-compute adjusted costs so the deduction pass reuses them. Only
  // populated if every input passes its precondition.
  const deductions: Array<{ slot: InventorySlot; adjustedCost: number }> = [];
  for (const input of ware.productionInputs) {
    const inputSlot = getInventorySlot(station, input.wareId);
    const adjustedCost = adjustForStation(input.unitsPerTick, station);
    // Don't consume cargo a trade ship has already claimed for pickup.
    if (!inputSlot || inputSlot.current - inputSlot.reservedOutgoing < adjustedCost) {
      return false;
    }
    deductions.push({ slot: inputSlot, adjustedCost });
  }

  for (const { slot, adjustedCost } of deductions) {
    slot.current -= adjustedCost;
  }

  if (!isSinkWare) {
    const outputSlot = getInventorySlot(station, wareId)!;
    outputSlot.current = Math.min(outputSlot.max, outputSlot.current + adjustForStation(ware.productionOutput, station));
  }
  return true;
}

/** Advance one station's tick clock and run its production pass when the per-station
 *  interval elapses. Sets `didProduceLastTick` to whether any ware produced this tick. */
function tickStationProduction(station: Station, deltaSeconds: number): void {
  station.secondsSinceLastTick += deltaSeconds;
  if (station.secondsSinceLastTick < economyConfig.simulationIntervalSeconds) return;
  station.secondsSinceLastTick -= economyConfig.simulationIntervalSeconds;

  let anyProduced = false;
  for (const wareId of station.stationType.produces) {
    if (tickWareProductionIfReady(station, wareId)) anyProduced = true;
  }
  station.didProduceLastTick = anyProduced;
}

export function tickEconomy(stations: Station[], timer: EconomyTimer, deltaSeconds: number) {
  timer.advance(deltaSeconds);
  for (const station of stations) {
    tickStationProduction(station, deltaSeconds);
  }
}
