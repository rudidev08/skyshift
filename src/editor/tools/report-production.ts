import { allWares } from "../../../data/wares.ts";
import { economyConfig } from "../../../data/economy-config.ts";
import { allStationTypes } from "../../../data/stations.ts";
import { createStation, getStationRates, getAllInventorySlots } from "../../sim-station.ts";
import { EconomyTimer, tickEconomy } from "../../sim-economy.ts";
import { hubNation } from "../../../data/nations.ts";

type Ware = (typeof allWares)[number];
type StationType = (typeof allStationTypes)[number];
type Station = ReturnType<typeof createStation>;

type ProductionResult =
  | { kind: "sink"; ware: Ware; stationType: StationType }
  | {
      kind: "raw";
      ware: Ware;
      effectiveOutput: number;
      outputMax: number;
      fillCycles: number;
      timeSeconds: number;
    }
  | {
      kind: "simulated";
      ware: Ware;
      effectiveOutput: number;
      outputMax: number;
      outputCurrent: number;
      outputPercent: number;
      cycles: number;
      timeSeconds: number;
      filled: boolean;
      stationType: StationType;
      station: Station;
    };

function createPrimedSimStation(ware: Ware, stationType: StationType): Station {
  const placement = {
    id: `sim-${ware.id}`,
    name: "Sim",
    x: 0,
    y: 0,
    nation: hubNation,
    stationTypeId: stationType.id,
    size: "S" as const,
  };
  const station = createStation(placement);

  for (const slot of getAllInventorySlots(station)) {
    if (stationType.produces.includes(slot.ware.id)) {
      slot.current = 0;
    } else {
      slot.current = slot.max;
    }
  }

  return station;
}

function runProductionForWare(ware: Ware): ProductionResult | null {
  const stationType = allStationTypes.find((candidate) => candidate.produces.includes(ware.id));
  if (!stationType) return null;

  const station = createPrimedSimStation(ware, stationType);
  const outputSlot = getAllInventorySlots(station).find((slot) => slot.ware.id === ware.id);
  const rates = getStationRates(station);
  const effectiveOutput = rates.production.get(ware.id) ?? 0;

  if (!outputSlot) return { kind: "sink", ware, stationType };

  if (ware.productionInputs.length === 0) {
    const fillCycles = Math.ceil(outputSlot.max / effectiveOutput);
    const timeSeconds = fillCycles * economyConfig.simulationIntervalSeconds;
    return {
      kind: "raw",
      ware,
      effectiveOutput,
      outputMax: outputSlot.max,
      fillCycles,
      timeSeconds,
    };
  }

  const reportTimer = new EconomyTimer();
  let cycles = 0;
  // Double the expected fill time so slow-but-healthy producers don't trip the stall bailout; if inputs deplete the loop hits this cap and the report flags which slot ran out.
  const maxCycles =
    Math.ceil(economyConfig.targetFillTimeSeconds / economyConfig.simulationIntervalSeconds) * 2;

  while (outputSlot.current < outputSlot.max && cycles < maxCycles) {
    tickEconomy([station], reportTimer, economyConfig.simulationIntervalSeconds);
    cycles++;
  }

  return {
    kind: "simulated",
    ware,
    effectiveOutput,
    outputMax: outputSlot.max,
    outputCurrent: outputSlot.current,
    outputPercent: Math.round((outputSlot.current / outputSlot.max) * 100),
    cycles,
    timeSeconds: cycles * economyConfig.simulationIntervalSeconds,
    filled: outputSlot.current >= outputSlot.max,
    stationType,
    station,
  };
}

function printProductionResult(result: ProductionResult): void {
  if (result.kind === "sink") {
    console.log(`  ${result.ware.name} — sink ware`);
    console.log(
      `    No output storage slot. ${result.stationType.name} only consumes inputs in live stations.\n`,
    );
    return;
  }

  if (result.kind === "raw") {
    console.log(`  ${result.ware.name} — per station (output ${result.effectiveOutput}/cycle)`);
    console.log(
      `    Output storage: ${result.outputMax}  →  fills in ${result.fillCycles} cycles (${result.timeSeconds}s)`,
    );
    console.log(`    ✓ Raw resource — always fills\n`);
    return;
  }

  printSimulatedProductionResult(result);
}

function printSimulatedProductionResult(result: Extract<ProductionResult, { kind: "simulated" }>): void {
  console.log(`  ${result.ware.name} — per station (output ${result.effectiveOutput}/cycle)`);
  console.log(
    `    Output storage: ${result.outputMax}  →  ${result.outputCurrent}/${result.outputMax} (${result.outputPercent}%) in ${result.cycles} cycles (${result.timeSeconds}s)`,
  );
  if (result.filled) {
    console.log(`    ✓ Fills completely`);
  } else {
    const emptyInputSlot = getAllInventorySlots(result.station).find(
      (slot) => !result.stationType.produces.includes(slot.ware.id) && slot.current <= 0,
    );
    console.log(
      `    ✗ Stalls at ${result.outputPercent}% — ${emptyInputSlot?.ware.name ?? "unknown"} runs out`,
    );
  }

  for (const slot of getAllInventorySlots(result.station)) {
    if (result.stationType.produces.includes(slot.ware.id)) continue;
    const remainingPercent = Math.round((slot.current / slot.max) * 100);
    console.log(
      `    ${slot.ware.name.padEnd(12)} storage: ${slot.max}  →  ${slot.current}/${slot.max} remaining (${remainingPercent}%)`,
    );
  }
  console.log();
}

export function runProductionSimulation(): void {
  console.log(`\n  ${"─".repeat(50)}`);
  console.log(`  Production Simulation (full inputs, empty output)`);
  console.log(`  Cycle interval: ${economyConfig.simulationIntervalSeconds}s`);
  console.log(
    `  Target fill time: ${economyConfig.targetFillTimeSeconds}s (${economyConfig.targetFillTimeSeconds / 60} min)\n`,
  );

  for (const ware of allWares) {
    const result = runProductionForWare(ware);
    if (result) printProductionResult(result);
  }
}
