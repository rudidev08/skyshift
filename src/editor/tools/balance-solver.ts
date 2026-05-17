// Economy Balance Solver — computes integer production costs that achieve
// net-zero balance per ware against the live map and definitions. When no
// exact integer solution exists, reports the closest options and suggests
// what to change.

import { settledPreset } from "../../../data/map-preset-settled.ts";
import { map } from "../../../data/map.ts";
import { sizeMultiplierBySize } from "../../../data/stations.ts";
import type { StationSize } from "../../../data/station-types.ts";
import { allWares } from "../../../data/wares.ts";
import type { WareId } from "../../../data/ware-types.ts";
import { createMapFromTemplate } from "../../sim-map-create.ts";
import { createStation, getStationRates, type Station } from "../../sim-station.ts";
import { getWareTemplate } from "../../sim-ware-template.ts";

interface WareConsumer {
  label: string;
  producingWareId: WareId;
  currentCost: number;
  totalMultiplier: number;
}

interface WareConsumerRecord {
  inputWareId: WareId;
  producedWareId: WareId;
  currentCost: number;
  multiplier: number;
}

interface ProductionAggregate {
  totalProductionByWareId: Map<WareId, number>;
  totalConsumptionByWareId: Map<WareId, number>;
  wareConsumersByInputWareId: Map<WareId, WareConsumer[]>;
}

const settledMap = createMapFromTemplate(map, settledPreset);

function formatNet(net: number): string {
  const sign = net >= 0 ? "+" : "";
  if (Number.isInteger(net)) return `${sign}${net}`;
  return `${sign}${net.toFixed(2)}`;
}

function addWareAmount(totalsByWareId: Map<WareId, number>, wareId: WareId, amount: number): void {
  totalsByWareId.set(wareId, (totalsByWareId.get(wareId) ?? 0) + amount);
}

function createLiveStations(): Station[] {
  const stations = settledMap.stations.map((station) => createStation(station));
  settledMap.seedInitialInventory?.(stations);
  return stations;
}

function recordWareConsumer(registry: Map<WareId, WareConsumer[]>, record: WareConsumerRecord): void {
  if (!registry.has(record.inputWareId)) registry.set(record.inputWareId, []);
  const consumers = registry.get(record.inputWareId)!;
  let existingConsumer = consumers.find((consumer) => consumer.producingWareId === record.producedWareId);
  if (!existingConsumer) {
    existingConsumer = {
      label: `→ ${record.producedWareId}`,
      producingWareId: record.producedWareId,
      currentCost: record.currentCost,
      totalMultiplier: 0,
    };
    consumers.push(existingConsumer);
  }
  existingConsumer.totalMultiplier += record.multiplier;
}

function aggregateProductionAndConsumption(stations: Station[]): ProductionAggregate {
  const totalProductionByWareId = new Map<WareId, number>();
  const totalConsumptionByWareId = new Map<WareId, number>();
  const wareConsumersByInputWareId = new Map<WareId, WareConsumer[]>();

  for (const station of stations) {
    addStationRatesToTotals(station, totalProductionByWareId, totalConsumptionByWareId);
    addStationToWareConsumerRegistry(station, wareConsumersByInputWareId);
  }

  return { totalProductionByWareId, totalConsumptionByWareId, wareConsumersByInputWareId };
}

function addStationRatesToTotals(
  station: Station,
  totalProductionByWareId: Map<WareId, number>,
  totalConsumptionByWareId: Map<WareId, number>,
): void {
  const stationRates = getStationRates(station);
  for (const [wareId, amount] of stationRates.production) {
    addWareAmount(totalProductionByWareId, wareId, amount);
  }
  for (const [wareId, amount] of stationRates.consumption) {
    addWareAmount(totalConsumptionByWareId, wareId, amount);
  }
}

function addStationToWareConsumerRegistry(
  station: Station,
  wareConsumersByInputWareId: Map<WareId, WareConsumer[]>,
): void {
  for (const producedWareId of station.stationType.produces) {
    const producedWare = getWareTemplate(producedWareId);
    for (const productionInput of producedWare.productionInputs) {
      recordWareConsumer(wareConsumersByInputWareId, {
        inputWareId: productionInput.wareId,
        producedWareId,
        currentCost: productionInput.unitsPerTick,
        multiplier: station.sizeMultiplier,
      });
    }
  }
}

interface BruteForceResult {
  bestCombination: number[];
  bestNet: number;
  isExact: boolean;
}

function findBestFloorCeilCombination(
  idealCosts: number[],
  consumers: WareConsumer[],
  produced: number,
): BruteForceResult {
  const combinationCount = 1 << consumers.length;
  let bestCombination: number[] = [];
  let bestNetAbsoluteValue = Infinity;
  let bestNet = 0;

  for (let mask = 0; mask < combinationCount; mask++) {
    const combination = consumers.map((_, index) => {
      // Recipe ingredients can't be zero — enforce minimum cost 1.
      const value = mask & (1 << index) ? Math.ceil(idealCosts[index]) : Math.floor(idealCosts[index]);
      return Math.max(1, value);
    });
    const total = combination.reduce((sum, cost, index) => sum + cost * consumers[index].totalMultiplier, 0);
    const net = produced - total;
    if (Math.abs(net) < bestNetAbsoluteValue) {
      bestNetAbsoluteValue = Math.abs(net);
      bestNet = net;
      bestCombination = combination;
    }
  }

  return { bestCombination, bestNet, isExact: bestNetAbsoluteValue < 0.001 };
}

function findFactorsThatDivideEvenly(produced: number, currentFactor: number): number[] {
  const nearbyFactors: number[] = [];
  for (let testFactor = 0.5; testFactor <= 10; testFactor += 0.5) {
    if (testFactor === currentFactor) continue;
    if (produced / testFactor === Math.floor(produced / testFactor)) {
      nearbyFactors.push(testFactor);
    }
  }
  return nearbyFactors;
}

function describeFactorAsStationSizeCombination(factor: number): string {
  const combinations: string[] = [];
  const maximumStationCount = Math.max(1, Math.ceil(factor));

  // Try fewest-stations combinations first — a 1-station "L" reads better in
  // suggestions than the equivalent "S+S+S".
  for (let stationCount = 1; stationCount <= maximumStationCount; stationCount++) {
    const sizes: StationSize[] = ["S", "M", "L"];
    const enumerateSizesSummingTo = (remaining: number, target: number, chosen: string[]): void => {
      if (remaining === 0) {
        if (Math.abs(target) < 0.001) combinations.push(chosen.join("+"));
        return;
      }
      for (const size of sizes) {
        enumerateSizesSummingTo(remaining - 1, target - sizeMultiplierBySize[size], [...chosen, size]);
      }
    };
    enumerateSizesSummingTo(stationCount, factor, []);
    if (combinations.length > 0) break;
  }

  return combinations.length > 0 ? combinations[0] : `factor ${factor}`;
}

interface SolvedCostEntry {
  producingWareId: WareId;
  inputWareId: WareId;
  cost: number;
}

interface SingleConsumerSolveResult {
  consumer: WareConsumer;
  idealCost: number;
  floorCost: number;
  ceilCost: number;
  floorNet: number;
  ceilNet: number;
  bestCost: number;
  bestNet: number;
  isExact: boolean;
}

interface MultiConsumerSolveResult {
  consumers: WareConsumer[];
  idealCosts: number[];
  chosenCosts: number[];
  currentNet: number;
  bestNet: number;
  isExact: boolean;
}

type WareBalanceAnalysis =
  | { kind: "no-data"; ware: (typeof allWares)[number] }
  | { kind: "no-consumers"; ware: (typeof allWares)[number]; produced: number; consumed: number }
  | {
      kind: "single";
      ware: (typeof allWares)[number];
      produced: number;
      consumed: number;
      result: SingleConsumerSolveResult;
    }
  | {
      kind: "multi";
      ware: (typeof allWares)[number];
      produced: number;
      consumed: number;
      result: MultiConsumerSolveResult;
    };

function solveSingleConsumer(produced: number, consumer: WareConsumer): SingleConsumerSolveResult {
  const idealCost = produced / consumer.totalMultiplier;

  // Recipe ingredients can't be zero — enforce minimum cost 1.
  const floorCost = Math.max(1, Math.floor(idealCost));
  const ceilCost = Math.max(1, Math.ceil(idealCost));
  const floorNet = produced - floorCost * consumer.totalMultiplier;
  const ceilNet = produced - ceilCost * consumer.totalMultiplier;

  const isExact = idealCost === floorCost;
  const bestCost = isExact || Math.abs(floorNet) <= Math.abs(ceilNet) ? floorCost : ceilCost;
  const bestNet = bestCost === floorCost ? floorNet : ceilNet;

  return {
    consumer,
    idealCost,
    floorCost,
    ceilCost,
    floorNet,
    ceilNet,
    bestCost,
    bestNet,
    isExact,
  };
}

function solveMultiConsumer(
  produced: number,
  consumed: number,
  consumers: WareConsumer[],
): MultiConsumerSolveResult {
  const currentNet = produced - consumed;

  // Preserve the original recipe ratios when retargeting to net zero — split
  // produced units across consumers by each consumer's current cost-weighted
  // share of total consumption.
  const idealCosts = consumers.map((consumer) => {
    const share = (consumer.currentCost * consumer.totalMultiplier) / consumed;
    return (produced * share) / consumer.totalMultiplier;
  });

  const { bestCombination, bestNet, isExact } = findBestFloorCeilCombination(idealCosts, consumers, produced);
  return { consumers, idealCosts, chosenCosts: bestCombination, currentNet, bestNet, isExact };
}

function analyzeWareBalance(
  ware: (typeof allWares)[number],
  aggregate: ProductionAggregate,
): WareBalanceAnalysis {
  const produced = aggregate.totalProductionByWareId.get(ware.id) ?? 0;
  const consumed = aggregate.totalConsumptionByWareId.get(ware.id) ?? 0;
  const consumers = aggregate.wareConsumersByInputWareId.get(ware.id) ?? [];

  if (produced === 0 && consumers.length === 0) return { kind: "no-data", ware };
  if (consumers.length === 0) return { kind: "no-consumers", ware, produced, consumed };
  if (consumers.length === 1) {
    return {
      kind: "single",
      ware,
      produced,
      consumed,
      result: solveSingleConsumer(produced, consumers[0]),
    };
  }
  return {
    kind: "multi",
    ware,
    produced,
    consumed,
    result: solveMultiConsumer(produced, consumed, consumers),
  };
}

function collectSolvedCostEntries(analysis: WareBalanceAnalysis): SolvedCostEntry[] {
  if (analysis.kind === "single") {
    return [
      {
        producingWareId: analysis.result.consumer.producingWareId,
        inputWareId: analysis.ware.id,
        cost: analysis.result.bestCost,
      },
    ];
  }
  if (analysis.kind === "multi") {
    return analysis.result.consumers.map((consumer, index) => ({
      producingWareId: consumer.producingWareId,
      inputWareId: analysis.ware.id,
      cost: analysis.result.chosenCosts[index],
    }));
  }
  return [];
}

function analysisHasIssue(analysis: WareBalanceAnalysis): boolean {
  if (analysis.kind === "single") return !analysis.result.isExact;
  if (analysis.kind === "multi") return !analysis.result.isExact;
  return false;
}

function printSingleConsumerResult(
  ware: (typeof allWares)[number],
  produced: number,
  result: SingleConsumerSolveResult,
): void {
  const { consumer, idealCost, floorCost, ceilCost, floorNet, ceilNet, bestCost, bestNet, isExact } = result;

  if (isExact) {
    console.log(
      `    ${consumer.label}: cost ${consumer.currentCost} → ${floorCost} (factor ${consumer.totalMultiplier})  ✓ exact`,
    );
    if (floorCost !== consumer.currentCost) console.log(`      ← CHANGE`);
    return;
  }

  console.log(`    ${consumer.label}: ideal ${idealCost.toFixed(4)}, factor ${consumer.totalMultiplier}`);
  console.log(`      cost ${floorCost} → net ${formatNet(floorNet)}`);
  console.log(`      cost ${ceilCost} → net ${formatNet(ceilNet)}`);
  console.log(`      ⚠ using ${bestCost} (net ${formatNet(bestNet)})`);
  printSingleConsumerSuggestions(ware.id, produced, consumer);
}

function printSingleConsumerSuggestions(wareId: WareId, produced: number, consumer: WareConsumer): void {
  console.log(`      ─ Suggestions to fix ${wareId}:`);

  const factor = consumer.totalMultiplier;
  const multipleBelow = Math.floor(produced / factor);
  const multipleAbove = Math.ceil(produced / factor);
  const productionBelow = multipleBelow * factor;
  const productionAbove = multipleAbove * factor;

  if (productionBelow !== produced) {
    console.log(
      `      • Change ${wareId} total production from ${produced} to ${productionBelow} (cost = ${multipleBelow})`,
    );
  }
  if (productionAbove !== produced) {
    console.log(
      `      • Change ${wareId} total production from ${produced} to ${productionAbove} (cost = ${multipleAbove})`,
    );
  }

  const nearbyFactors = findFactorsThatDivideEvenly(produced, factor);
  if (nearbyFactors.length > 0) {
    const closest = nearbyFactors.sort((a, b) => Math.abs(a - factor) - Math.abs(b - factor)).slice(0, 3);
    for (const testFactor of closest) {
      const stationSizes = describeFactorAsStationSizeCombination(testFactor);
      console.log(
        `      • Change consuming station factor to ${testFactor} (${stationSizes}) → cost = ${produced / testFactor}`,
      );
    }
  }
}

function printMultiConsumerResult(
  ware: (typeof allWares)[number],
  produced: number,
  result: MultiConsumerSolveResult,
): void {
  const { consumers, idealCosts, chosenCosts, currentNet, bestNet, isExact } = result;

  for (let index = 0; index < consumers.length; index++) {
    const consumer = consumers[index];
    const ideal = idealCosts[index];
    const chosen = chosenCosts[index];
    const marker = chosen !== consumer.currentCost ? " ← CHANGE" : "";
    const exactMarker = ideal === chosen ? "  ✓ exact" : "";
    console.log(
      `    ${consumer.label}: cost ${consumer.currentCost} → ${chosen} (ideal ${ideal.toFixed(4)}, factor ${consumer.totalMultiplier})${exactMarker}${marker}`,
    );
  }

  if (isExact) {
    console.log(`    Net: ${formatNet(currentNet)} → +0  ✓`);
    return;
  }

  console.log(`    Net: ${formatNet(currentNet)} → ${formatNet(bestNet)}  ⚠ no exact integer solution`);
  printMultiConsumerSuggestions(ware.id, produced, consumers);
}

function printMultiConsumerSuggestions(wareId: WareId, produced: number, consumers: WareConsumer[]): void {
  console.log(`      ─ Suggestions to fix ${wareId}:`);

  // Multi-consumer fallback — nudge total production by ±3 looking for a
  // value where every consumer's proportional share lands on an integer.
  for (let delta = -3; delta <= 3; delta++) {
    const testProduction = produced + delta;
    if (testProduction <= 0 || testProduction === produced) continue;

    const totalConsumption = consumers.reduce(
      (sum, consumer) => sum + consumer.currentCost * consumer.totalMultiplier,
      0,
    );
    let allInteger = true;
    const testCosts: number[] = [];
    for (const consumer of consumers) {
      const share = (consumer.currentCost * consumer.totalMultiplier) / totalConsumption;
      const testCost = (testProduction * share) / consumer.totalMultiplier;
      testCosts.push(testCost);
      if (Math.abs(testCost - Math.round(testCost)) > 0.001) allInteger = false;
    }
    if (allInteger) {
      const costString = consumers
        .map((consumer, index) => `${consumer.producingWareId} cost ${Math.round(testCosts[index])}`)
        .join(", ");
      console.log(`      • Change ${wareId} total production to ${testProduction} → [${costString}]`);
    }
  }
}

function printWareBalanceAnalysis(analysis: WareBalanceAnalysis): void {
  if (analysis.kind === "no-data") return;

  console.log(`\n  ${analysis.ware.name} (produced: ${analysis.produced}, consumed: ${analysis.consumed})`);

  if (analysis.kind === "no-consumers") {
    console.log(`    No consumers — not used in any production chain`);
    return;
  }

  if (analysis.kind === "single") {
    printSingleConsumerResult(analysis.ware, analysis.produced, analysis.result);
    return;
  }

  printMultiConsumerResult(analysis.ware, analysis.produced, analysis.result);
}

function printPreamble(): void {
  console.log("\n  Economy Balance Solver (integer costs)");
  console.log(`  ${"═".repeat(60)}`);
  console.log("  Uses current map, ware, and station game data.");
  console.log(
    "  Static balance only: use ./dev/economy/report.sh for ship logistics and full game-loop validation.",
  );
}

function pairKey(producingWareId: WareId, inputWareId: WareId): string {
  return `${producingWareId}:${inputWareId}`;
}

function printCodeReadyWareDefinition(
  ware: (typeof allWares)[number],
  solvedCostByProducerInputPair: Map<string, number>,
): void {
  const costEntries: string[] = [];
  for (const input of ware.productionInputs) {
    const solvedCost =
      solvedCostByProducerInputPair.get(pairKey(ware.id, input.wareId)) ?? input.unitsPerTick;
    costEntries.push(`{ wareId: "${input.wareId}", unitsPerTick: ${solvedCost} }`);
  }

  if (costEntries.length === 0) {
    console.log(`    ${ware.id}: output ${ware.productionOutput}`);
  } else {
    console.log(
      `    ${ware.id}: output ${ware.productionOutput}, productionInputs: [${costEntries.join(", ")}]`,
    );
  }
}

function printSummaryAndCodeReadyValues(
  solvedCostByProducerInputPair: Map<string, number>,
  hasIssues: boolean,
): void {
  console.log(`\n\n  ${"═".repeat(60)}`);
  if (hasIssues) {
    console.log("  Code-ready values (best integer approximation — see warnings above):");
  } else {
    console.log("  Code-ready values (all exact integer solutions):");
  }
  console.log(`  ${"─".repeat(60)}`);

  console.log("\n  Ware definitions:");
  for (const ware of allWares) {
    printCodeReadyWareDefinition(ware, solvedCostByProducerInputPair);
  }

  console.log("");
}

function analyzeAllWares(aggregate: ProductionAggregate): {
  solvedCostByProducerInputPair: Map<string, number>;
  hasIssues: boolean;
} {
  const solvedCostByProducerInputPair = new Map<string, number>();
  let hasIssues = false;
  for (const ware of allWares) {
    const analysis = analyzeWareBalance(ware, aggregate);
    printWareBalanceAnalysis(analysis);
    for (const entry of collectSolvedCostEntries(analysis)) {
      solvedCostByProducerInputPair.set(pairKey(entry.producingWareId, entry.inputWareId), entry.cost);
    }
    if (analysisHasIssue(analysis)) hasIssues = true;
  }
  return { solvedCostByProducerInputPair, hasIssues };
}

function runBalanceSolver(): void {
  const liveStations = createLiveStations();
  const aggregate = aggregateProductionAndConsumption(liveStations);
  printPreamble();
  const { solvedCostByProducerInputPair, hasIssues } = analyzeAllWares(aggregate);
  printSummaryAndCodeReadyValues(solvedCostByProducerInputPair, hasIssues);
}

runBalanceSolver();
