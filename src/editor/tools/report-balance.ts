import { allWares } from "../../../data/wares.ts";
import { buildStationRateRecords } from "../util-station-rates.ts";
import type { GameMap } from "../../sim-map-types.ts";

const wareById = Object.fromEntries(allWares.map((ware) => [ware.id, ware]));

export type NationReport = {
  name: string;
  stationCount: number;
  produces: Record<string, number>;
  consumes: Record<string, number>;
};

type GlobalTotals = {
  produced: Record<string, number>;
  consumed: Record<string, number>;
};

export function aggregateNationProduction(map: GameMap): Record<string, NationReport> {
  const nations: Record<string, NationReport> = {};

  for (const { placement, rates } of buildStationRateRecords(map.stations)) {
    if (!nations[placement.nation.id]) {
      nations[placement.nation.id] = {
        name: placement.nation.name,
        stationCount: 0,
        produces: {},
        consumes: {},
      };
    }

    const nation = nations[placement.nation.id];
    nation.stationCount++;

    for (const [wareId, amount] of rates.production) {
      nation.produces[wareId] = (nation.produces[wareId] ?? 0) + amount;
    }
    for (const [wareId, amount] of rates.consumption) {
      nation.consumes[wareId] = (nation.consumes[wareId] ?? 0) + amount;
    }
  }

  return nations;
}

function computeGlobalTotals(nations: Record<string, NationReport>): GlobalTotals {
  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};

  for (const nation of Object.values(nations)) {
    for (const [wareId, amount] of Object.entries(nation.produces)) {
      produced[wareId] = (produced[wareId] ?? 0) + amount;
    }
    for (const [wareId, amount] of Object.entries(nation.consumes)) {
      consumed[wareId] = (consumed[wareId] ?? 0) + amount;
    }
  }

  return { produced, consumed };
}

function printNationWareTotals(
  label: string,
  totalsByWareId: Record<string, number>,
  stationCount: number,
): void {
  console.log(`    ${label}`);
  for (const [wareId, total] of Object.entries(totalsByWareId)) {
    const perStation = total / stationCount;
    console.log(
      `      ${wareById[wareId].name.padEnd(12)} ${perStation.toFixed(1)}/cycle × ${stationCount} = ${total}/cycle`,
    );
  }
}

function printNationBreakdown(nationId: string, nation: NationReport): void {
  console.log(`\n  ${nation.name} (${nationId}) — ${nation.stationCount} stations`);
  printNationWareTotals("Produces per station / total:", nation.produces, nation.stationCount);
  printNationWareTotals("Consumes per station / total:", nation.consumes, nation.stationCount);
}

function printGlobalBalance(nations: Record<string, NationReport>): void {
  console.log(`\n  ${"─".repeat(50)}`);
  console.log(`  Global Balance (totals per cycle)`);

  const totals = computeGlobalTotals(nations);

  for (const ware of allWares) {
    const produced = totals.produced[ware.id] ?? 0;
    const consumed = totals.consumed[ware.id] ?? 0;
    const net = produced - consumed;
    const sign = net >= 0 ? "+" : "";
    console.log(
      `    ${ware.name.padEnd(12)}  produced: ${String(produced).padStart(3)}  consumed: ${String(consumed).padStart(3)}  net: ${sign}${net}`,
    );
  }
}

export function logNationBalanceReport(nations: Record<string, NationReport>): void {
  console.log(`\n  Economy Report: Settled Universe`);
  console.log(`  ${"─".repeat(50)}`);
  for (const [nationId, nation] of Object.entries(nations)) {
    printNationBreakdown(nationId, nation);
  }
  printGlobalBalance(nations);
}
