import { economyConfig } from "../../../data/economy-config.ts";
import { getAllInventorySlots, type InventorySlot } from "../../sim-station.ts";
import { createSimulation } from "../../sim-lifecycle.ts";
import { allShips } from "../../../data/ships.ts";
import type { GameMap } from "../../sim-map-types.ts";

const SIMULATION_DURATION_SECONDS = 3600 * 20;
const fastTickIntervalSeconds = economyConfig.simulationIntervalSeconds;
const LOW_STOCK_THRESHOLD_PERCENT = 25;
const HIGH_STOCK_THRESHOLD_PERCENT = 75;

type Simulation = ReturnType<typeof createSimulation>;
type SimulationStation = Simulation["stations"][number];

function formatFleetSummary(shipTypeIds: string[]): string {
  const shipCountByTypeId = new Map<string, number>();

  for (const shipTypeId of shipTypeIds) {
    shipCountByTypeId.set(shipTypeId, (shipCountByTypeId.get(shipTypeId) ?? 0) + 1);
  }

  return allShips
    .map((ship) => ({ ship, count: shipCountByTypeId.get(ship.id) ?? 0 }))
    .filter(({ count }) => count > 0)
    .map(({ ship, count }) => `${ship.name} x${count}`)
    .join(", ");
}

function slotPercent(slot: { current: number; max: number }): number {
  return slot.max > 0 ? Math.round((slot.current / slot.max) * 100) : 0;
}

function formatSlotLabel(wareName: string, isOutput: boolean): string {
  return isOutput ? `${wareName} (out)` : `${wareName} (in)`;
}

function formatTickShareAsPercent(tickCount: number, totalTicks: number): string {
  if (tickCount <= 0) return "0%";

  const percent = (tickCount / totalTicks) * 100;
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/** Created on first encounter — new stations can be added mid-simulation when
 *  nation expansion fires (nationManager.tick → stationManager.placeBuild). */
type StationMeta = { isProducer: boolean; isConsumer: boolean; producedWares: Set<string> };

type SlotRange = {
  min: number;
  max: number;
  minPercent: number;
  maxPercent: number;
  underLowThresholdTicks: number;
  overHighThresholdTicks: number;
};

type TrackingState = {
  stationMeta: Map<string, StationMeta>;
  stalledTicks: Map<string, number>;
  slotRanges: Map<string, SlotRange[]>;
};

function initSlotRanges(stationSlots: readonly { current: number; max: number }[]): SlotRange[] {
  return stationSlots.map((slot) => {
    const percent = slotPercent(slot);
    return {
      min: slot.current,
      max: slot.current,
      minPercent: percent,
      maxPercent: percent,
      underLowThresholdTicks: 0,
      overHighThresholdTicks: 0,
    };
  });
}

function expandSlotRange(range: SlotRange, value: number, percent: number): void {
  if (value < range.min) {
    range.min = value;
    range.minPercent = percent;
  }
  if (value > range.max) {
    range.max = value;
    range.maxPercent = percent;
  }
}

function computeStationMeta(station: SimulationStation, stationSlots: readonly InventorySlot[]): StationMeta {
  return {
    isProducer: station.stationType.produces.length > 0,
    isConsumer: stationSlots.some((slot) => !station.stationType.produces.includes(slot.ware.id)),
    producedWares: new Set(station.stationType.produces),
  };
}

function getOrCreateStationMeta(station: SimulationStation, state: TrackingState): StationMeta {
  const stationSlots = getAllInventorySlots(station);
  const existingMeta = state.stationMeta.get(station.id);
  const existingRanges = state.slotRanges.get(station.id);
  // When a station flips from building to producing, its slot count changes,
  // so meta + ranges must be rebuilt to match.
  const slotCountChanged = existingRanges !== undefined && existingRanges.length !== stationSlots.length;

  if (existingMeta && !slotCountChanged) return existingMeta;

  const freshMeta = computeStationMeta(station, stationSlots);
  state.slotRanges.set(station.id, initSlotRanges(stationSlots));
  if (existingMeta) {
    Object.assign(existingMeta, freshMeta);
    return existingMeta;
  }
  state.stationMeta.set(station.id, freshMeta);
  state.stalledTicks.set(station.id, 0);
  return freshMeta;
}

function tickStationStats(stations: readonly SimulationStation[], state: TrackingState): void {
  for (const station of stations) {
    const meta = getOrCreateStationMeta(station, state);

    const stalled = meta.isProducer && !station.didProduceLastTick;

    if (stalled) {
      state.stalledTicks.set(station.id, (state.stalledTicks.get(station.id) ?? 0) + 1);
    }

    const ranges = state.slotRanges.get(station.id)!;
    const slots = getAllInventorySlots(station);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const percent = slotPercent(slot);
      expandSlotRange(ranges[i], slot.current, percent);
      if (percent < LOW_STOCK_THRESHOLD_PERCENT) {
        ranges[i].underLowThresholdTicks++;
      }
      if (percent > HIGH_STOCK_THRESHOLD_PERCENT) {
        ranges[i].overHighThresholdTicks++;
      }
    }
  }
}

type GameLoopOptions = {
  durationSeconds: number;
  tickIntervalSeconds: number;
  onTick: () => void;
};

function tickGameLoopUntil(simulation: Simulation, options: GameLoopOptions): void {
  // Same two cadences as the game's main loop:
  //   - fast: economy + trade (which moves ships), every tickIntervalSeconds.
  //   - slow: station/nation/emigration managers, every economyConfig.slowSimulationTickIntervalSeconds seconds.
  let accumulatedSlowSimulationSeconds = 0;
  for (let time = 0; time < options.durationSeconds; time += options.tickIntervalSeconds) {
    simulation.tick(options.tickIntervalSeconds);
    accumulatedSlowSimulationSeconds += options.tickIntervalSeconds;
    if (accumulatedSlowSimulationSeconds >= economyConfig.slowSimulationTickIntervalSeconds) {
      simulation.slowSimulationTick(accumulatedSlowSimulationSeconds);
      accumulatedSlowSimulationSeconds = 0;
    }
    options.onTick();
  }
}

function buildStationDisplayLabel(station: SimulationStation): string {
  return `${station.nation.codeName} ${station.name ?? station.id}`;
}

type StationDisplayRow = {
  label: string;
  ranges: SlotRange[];
  meta: StationMeta;
  stalledPercent: number;
  slots: readonly InventorySlot[];
};

function getStationDisplayRow(
  station: SimulationStation,
  state: TrackingState,
  totalTicks: number,
): StationDisplayRow {
  const stalled = state.stalledTicks.get(station.id) ?? 0;
  return {
    label: buildStationDisplayLabel(station),
    ranges: state.slotRanges.get(station.id)!,
    meta: state.stationMeta.get(station.id)!,
    stalledPercent: Math.round((stalled / totalTicks) * 100),
    slots: getAllInventorySlots(station),
  };
}

type StockRangeColumnWidths = { stationColumnWidth: number; slotColumnWidth: number };

function computeColumnWidths(
  stations: readonly SimulationStation[],
  state: TrackingState,
): StockRangeColumnWidths {
  const stationColumnWidth =
    Math.max(
      "Station".length,
      ...stations.map((station) => buildStationDisplayLabel(station).length),
    ) + 2;

  const slotColumnWidth =
    Math.max(
      "Slot".length,
      ...stations.flatMap((station) => {
        const meta = state.stationMeta.get(station.id)!;
        return getAllInventorySlots(station).map(
          (slot) => formatSlotLabel(slot.ware.name, meta.producedWares.has(slot.ware.id)).length,
        );
      }),
    ) + 2;

  return { stationColumnWidth, slotColumnWidth };
}

function formatStockRangeHeaderRow(widths: StockRangeColumnWidths): string {
  const underThresholdHeader = `<${LOW_STOCK_THRESHOLD_PERCENT}%`;
  const overThresholdHeader = `>${HIGH_STOCK_THRESHOLD_PERCENT}%`;
  return `  ${"Station".padEnd(widths.stationColumnWidth)} ${"Slot".padEnd(widths.slotColumnWidth)} ${"Now%".padStart(5)}  ${"Min%".padStart(5)}  ${"Max%".padStart(5)}  ${underThresholdHeader.padStart(5)}  ${overThresholdHeader.padStart(5)}  ${"Stall%".padStart(6)}`;
}

function formatStockRangeDataRow(
  rowLabel: string,
  slotName: string,
  slot: { current: number; max: number },
  range: SlotRange,
  stallColumn: string,
  totalTicks: number,
  widths: StockRangeColumnWidths,
): string {
  const underLowThresholdPercent = formatTickShareAsPercent(range.underLowThresholdTicks, totalTicks);
  const overHighThresholdPercent = formatTickShareAsPercent(range.overHighThresholdTicks, totalTicks);
  return `  ${rowLabel.padEnd(widths.stationColumnWidth)} ${slotName.padEnd(widths.slotColumnWidth)} ${(slotPercent(slot) + "%").padStart(5)}  ${(range.minPercent + "%").padStart(5)}  ${(range.maxPercent + "%").padStart(5)}  ${underLowThresholdPercent.padStart(5)}  ${overHighThresholdPercent.padStart(5)}  ${stallColumn.padStart(6)}`;
}

function renderStockRangeTable(
  stations: readonly SimulationStation[],
  state: TrackingState,
  totalTicks: number,
): void {
  const widths = computeColumnWidths(stations, state);
  const headerRow = formatStockRangeHeaderRow(widths);
  const divider = `  ${"─".repeat(headerRow.length - 2)}`;

  console.log(`\n  Per-station stock ranges over ${SIMULATION_DURATION_SECONDS / 3600}h:`);
  console.log(divider);
  console.log(headerRow);
  console.log(divider);

  for (const station of stations) {
    const row = getStationDisplayRow(station, state, totalTicks);
    for (let i = 0; i < row.slots.length; i++) {
      const slot = row.slots[i];
      const slotName = formatSlotLabel(slot.ware.name, row.meta.producedWares.has(slot.ware.id));
      const stallColumn =
        i === 0 && (row.meta.isProducer || row.meta.isConsumer) ? `${row.stalledPercent}%` : "";
      const rowLabel = i === 0 ? row.label : "";
      console.log(
        formatStockRangeDataRow(rowLabel, slotName, slot, row.ranges[i], stallColumn, totalTicks, widths),
      );
    }
  }
}

type StationOutlier = {
  label: string;
  issues: string[];
};

function collectStationOutliers(
  stations: readonly SimulationStation[],
  state: TrackingState,
  totalTicks: number,
): StationOutlier[] {
  const outliers: StationOutlier[] = [];

  for (const station of stations) {
    const row = getStationDisplayRow(station, state, totalTicks);
    const issues: string[] = [];

    for (let i = 0; i < row.slots.length; i++) {
      const underLowThresholdPercent = formatTickShareAsPercent(
        row.ranges[i].underLowThresholdTicks,
        totalTicks,
      );
      const overHighThresholdPercent = formatTickShareAsPercent(
        row.ranges[i].overHighThresholdTicks,
        totalTicks,
      );
      const slotName = formatSlotLabel(
        row.slots[i].ware.name,
        row.meta.producedWares.has(row.slots[i].ware.id),
      );

      if (row.ranges[i].minPercent < LOW_STOCK_THRESHOLD_PERCENT) {
        issues.push(
          `${slotName} spent ${underLowThresholdPercent} of ticks below ${LOW_STOCK_THRESHOLD_PERCENT}%`,
        );
      }

      if (row.ranges[i].maxPercent > HIGH_STOCK_THRESHOLD_PERCENT) {
        issues.push(
          `${slotName} spent ${overHighThresholdPercent} of ticks above ${HIGH_STOCK_THRESHOLD_PERCENT}%`,
        );
      }
    }

    if ((row.meta.isProducer || row.meta.isConsumer) && row.stalledPercent > 0) {
      const stallLabel = row.meta.isProducer ? "production stalled" : "starved";
      issues.push(`${stallLabel} ${row.stalledPercent}% of ticks`);
    }

    if (issues.length > 0) {
      outliers.push({ label: row.label, issues });
    }
  }

  return outliers;
}

function renderOutlierReport(
  stations: readonly SimulationStation[],
  state: TrackingState,
  totalTicks: number,
): void {
  console.log(`\n  ${"─".repeat(70)}`);
  console.log(
    `  Outliers (any slot <${LOW_STOCK_THRESHOLD_PERCENT}% or >${HIGH_STOCK_THRESHOLD_PERCENT}% at any point)`,
  );
  console.log(`  ${"─".repeat(70)}`);

  const outliers = collectStationOutliers(stations, state, totalTicks);

  if (outliers.length === 0) {
    console.log(`\n  ✓ No outliers — all stations within healthy range.`);
    return;
  }

  for (const outlier of outliers) {
    console.log(`\n  ⚠ ${outlier.label}`);
    for (const issue of outlier.issues) {
      console.log(`    - ${issue}`);
    }
  }
}

function printSimulationHeader(simulation: Simulation): void {
  console.log(`  ${"═".repeat(50)}`);
  console.log(`  ${SIMULATION_DURATION_SECONDS / 3600}h Trade Simulation (actual game values)`);
  console.log(`  Cargo: ${allShips.map((ship) => `${ship.name}=${ship.cargoCapacity}`).join(", ")}`);
  console.log(`  Fleet: ${formatFleetSummary(simulation.ships.map((ship) => ship.shipTypeId))}`);
  console.log(`  ${"─".repeat(50)}`);
}

function printSimulationFooter(simulation: Simulation): void {
  console.log(`\n  ${"─".repeat(70)}`);
  console.log(`  Simulation notes`);
  console.log(`  ${"─".repeat(70)}`);
  console.log(`  Total ships: ${simulation.ships.length}`);
  console.log(
    `  Duration: ${SIMULATION_DURATION_SECONDS / 3600}h, tick: ${fastTickIntervalSeconds}s`,
  );
}

export function runTradeSimulation(map: GameMap): void {
  const simulation = createSimulation(map, { ignoreCargoCompatibility: true });
  printSimulationHeader(simulation);

  const stations = simulation.stations;

  const state: TrackingState = {
    stationMeta: new Map(),
    stalledTicks: new Map(),
    slotRanges: new Map(),
  };

  for (const station of stations) {
    getOrCreateStationMeta(station, state);
  }

  const totalTicks = SIMULATION_DURATION_SECONDS / fastTickIntervalSeconds;

  tickGameLoopUntil(simulation, {
    durationSeconds: SIMULATION_DURATION_SECONDS,
    tickIntervalSeconds: fastTickIntervalSeconds,
    onTick: () => tickStationStats(stations, state),
  });

  renderStockRangeTable(stations, state, totalTicks);
  renderOutlierReport(stations, state, totalTicks);
  printSimulationFooter(simulation);
}
