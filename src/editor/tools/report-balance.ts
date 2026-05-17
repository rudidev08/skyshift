import { allWares } from "../../../data/wares.ts";
import { createStation, getStationRates } from "../../sim-station.ts";
import type { createMapFromTemplate } from "../../sim-map-create.ts";

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

export function aggregateNationProduction(
  map: ReturnType<typeof createMapFromTemplate>,
): Record<string, NationReport> {
  const nations: Record<string, NationReport> = {};

  for (const station of map.stations) {
    if (!nations[station.nation.id]) {
      nations[station.nation.id] = {
        name: station.nation.name,
        stationCount: 0,
        produces: {},
        consumes: {},
      };
    }

    const nation = nations[station.nation.id];
    nation.stationCount++;

    const stationData = createStation(station);
    const rates = getStationRates(stationData);

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

export function logNationBalanceReport(nations: Record<string, NationReport>): void {
  console.log(`\n  Economy Report: Settled Universe`);
  console.log(`  ${"─".repeat(50)}`);

  for (const [nationId, nation] of Object.entries(nations)) {
    console.log(`\n  ${nation.name} (${nationId}) — ${nation.stationCount} stations`);

    console.log(`    Produces per station / total:`);
    for (const [wareId, total] of Object.entries(nation.produces)) {
      const perStation = total / nation.stationCount;
      console.log(
        `      ${wareById[wareId].name.padEnd(12)} ${perStation.toFixed(1)}/cycle × ${nation.stationCount} = ${total}/cycle`,
      );
    }

    console.log(`    Consumes per station / total:`);
    for (const [wareId, total] of Object.entries(nation.consumes)) {
      const perStation = total / nation.stationCount;
      console.log(
        `      ${wareById[wareId].name.padEnd(12)} ${perStation.toFixed(1)}/cycle × ${nation.stationCount} = ${total}/cycle`,
      );
    }
  }

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
