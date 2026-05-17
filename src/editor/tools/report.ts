import { settledPreset } from "../../../data/map-preset-settled.ts";
import { map } from "../../../data/map.ts";
import { createMapFromTemplate } from "../../sim-map-create.ts";
import { aggregateNationProduction, logNationBalanceReport } from "./report-balance.ts";
import { runProductionSimulation } from "./report-production.ts";
import { runTradeSimulation } from "./report-trade-simulation.ts";

const settledMap = createMapFromTemplate(map, settledPreset);

logNationBalanceReport(aggregateNationProduction(settledMap));
runProductionSimulation();
runTradeSimulation(settledMap);
