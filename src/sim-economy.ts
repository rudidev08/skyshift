import { economyConfig } from "../data/economy-config";
import type { WareId } from "../data/ware-types";
import { scaleByStationSize, getInventorySlot, type Station, type InventorySlot } from "./sim-station";
import { getWareTemplate } from "./sim-ware-template";
import type { WareTemplate } from "../data/ware-types";

/** Per-simulation tick counter and sub-tick accumulator. Snapshots persist
 *  only `tickCount`; `secondsSinceLastTick` re-zeros on load. */
export class EconomyTimer {
  /** Wall-clock seconds accumulated since the last sim tick fired. */
  private secondsSinceLastTick = 0;
  /** Sim ticks since the last reset. UI throttling reads this. */
  tickCount = 0;

  reset(): void {
    this.secondsSinceLastTick = 0;
    this.tickCount = 0;
  }

  tick(deltaSeconds: number): void {
    this.secondsSinceLastTick += deltaSeconds;
    if (this.secondsSinceLastTick >= economyConfig.simulationIntervalSeconds) {
      this.secondsSinceLastTick -= economyConfig.simulationIntervalSeconds;
      this.tickCount++;
    }
  }
}

/** Stagger per-station tick offsets so production spreads across frames. */
export function staggerStationTicks(stations: Station[]) {
  const interval = economyConfig.simulationIntervalSeconds;
  for (let i = 0; i < stations.length; i++) {
    // Negative offsets spread each station's first tick evenly across one
    // interval, so production doesn't all land on the same frame.
    stations[i].secondsSinceLastTick = -((interval * i) / stations.length);
  }
}

/** Produce one batch of `wareId` at this station if all preconditions hold:
 *  output slot has room (sink wares skip this), and every input slot has
 *  enough stock past its outgoing reservation. Returns true if a batch ran. */
function tickWareProductionIfReady(station: Station, wareId: WareId): boolean {
  const ware = getWareTemplate(wareId);
  if (!hasProductionOutputRoom(station, ware, wareId)) return false;

  // Pre-compute adjusted costs so the deduction pass reuses them. Only
  // populated if every input passes its precondition.
  const deductions: Array<{ slot: InventorySlot; adjustedCost: number }> = [];
  for (const input of ware.productionInputs) {
    const inputSlot = getInventorySlot(station, input.wareId);
    const adjustedCost = scaleByStationSize(input.unitsPerTick, station);
    // Don't consume cargo a trade ship has already claimed for pickup.
    if (!inputSlot || inputSlot.current - inputSlot.reservedOutgoing < adjustedCost) {
      return false;
    }
    deductions.push({ slot: inputSlot, adjustedCost });
  }

  for (const { slot, adjustedCost } of deductions) {
    slot.current -= adjustedCost;
  }

  creditProductionOutput(station, ware, wareId);
  return true;
}

function hasProductionOutputRoom(station: Station, ware: WareTemplate, wareId: WareId): boolean {
  // Sink wares consume without producing — no output slot to gate on.
  if (ware.productionOutput === 0) return true;
  const outputSlot = getInventorySlot(station, wareId);
  return !!outputSlot && outputSlot.current < outputSlot.max;
}

function creditProductionOutput(station: Station, ware: WareTemplate, wareId: WareId): void {
  if (ware.productionOutput === 0) return;
  const outputSlot = getInventorySlot(station, wareId)!;
  outputSlot.current = Math.min(
    outputSlot.max,
    outputSlot.current + scaleByStationSize(ware.productionOutput, station),
  );
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
  timer.tick(deltaSeconds);
  for (const station of stations) {
    tickStationProduction(station, deltaSeconds);
  }
}
