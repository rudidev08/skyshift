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

/** Where a produced ware's output goes. Sink wares (`productionOutput === 0`)
 *  produce nothing; non-sink wares credit an output slot. */
type ProductionOutputTarget = { kind: "sink" } | { kind: "slot"; slot: InventorySlot };

/** Resolve a produced ware's output target, or null if the batch must not run.
 *  Sink wares always have a target. A non-sink ware needs an output slot with
 *  room — a missing slot (in-flight build) or a full slot blocks the batch. */
function resolveProductionOutput(
  station: Station,
  ware: WareTemplate,
  wareId: WareId,
): ProductionOutputTarget | null {
  if (ware.productionOutput === 0) return { kind: "sink" };
  const slot = getInventorySlot(station, wareId);
  if (!slot || slot.current >= slot.max) return null;
  return { kind: "slot", slot };
}

/** Produce one batch of `wareId` at this station if all preconditions hold:
 *  output slot has room (sink wares skip this), and every input slot has
 *  enough stock past its outgoing reservation. Returns true if a batch ran. */
function tickWareProductionIfReady(station: Station, wareId: WareId): boolean {
  const ware = getWareTemplate(wareId);
  const outputTarget = resolveProductionOutput(station, ware, wareId);
  if (!outputTarget) return false;

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

  if (outputTarget.kind === "slot") {
    outputTarget.slot.current = Math.min(
      outputTarget.slot.max,
      outputTarget.slot.current + scaleByStationSize(ware.productionOutput, station),
    );
  }
  return true;
}

/** Run a station's production pass each sim tick, firing once per
 *  `simulationIntervalSeconds`. Sets `didProduceLastTick` to whether any ware produced. */
function tickStationProduction(station: Station, deltaSeconds: number): void {
  station.secondsSinceLastTick += deltaSeconds;
  if (station.secondsSinceLastTick < economyConfig.simulationIntervalSeconds) return;
  station.secondsSinceLastTick -= economyConfig.simulationIntervalSeconds;

  let producedAnyWare = false;
  for (const wareId of station.stationType.produces) {
    if (tickWareProductionIfReady(station, wareId)) producedAnyWare = true;
  }
  station.didProduceLastTick = producedAnyWare;
}

export function tickEconomy(stations: Station[], timer: EconomyTimer, deltaSeconds: number) {
  timer.tick(deltaSeconds);
  for (const station of stations) {
    tickStationProduction(station, deltaSeconds);
  }
}
