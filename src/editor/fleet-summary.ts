// Fleet summary panel — per (nation, ship type) row showing count, cargo,
// and per-ware estimated vs simulated transport. Computed from the editable
// station list plus an optional headless trade-sim run from the simulation
// session.

import { allShips } from "../../data/ships";
import { allWares } from "../../data/wares";
import { shipsPerStationBySize } from "../../data/stations";
import { economyConfig } from "../../data/economy-config";
import { shipTravel } from "../../data/ship-travel";
import { formatQuantity } from "../util-quantity-format";
import { createSimulation, type Simulation } from "../sim-lifecycle";
import { buildStationRateRecords } from "./util-station-rates";
import type { ShipTypeTemplate } from "../../data/ship-types";
import type { WareId } from "../../data/ware-types";
import type { PlacedStation } from "../../data/station-types";
import type { Station } from "../sim-station-types";
import type { Nation } from "../sim-nation";
import type { TradeTransferEvent } from "../sim-trade-types";
import type { MapEditorState } from "./map-editor-state";
import { closePanel, openPanel } from "./panel-chrome";
import type { EditorSimulationSession } from "./simulation-session";

interface FleetStationSummary {
  consumption: Map<WareId, number>;
  production: Map<WareId, number>;
  shipCount: number;
  shipTypeId: string;
  placement: PlacedStation;
  station: Station;
}

const fleetSimulationHours = 1;

export function buildFleetStationSummaries(stations: PlacedStation[]): FleetStationSummary[] {
  const summaries: FleetStationSummary[] = [];

  for (const { placement, station, rates } of buildStationRateRecords(stations)) {
    const shipTypeId = placement.nation.shipTypeId;
    if (!shipTypeId) continue;

    summaries.push({
      placement,
      station,
      shipTypeId,
      shipCount: shipsPerStationBySize[station.size] ?? 1,
      production: rates.production,
      consumption: rates.consumption,
    });
  }

  return summaries;
}

function estimateStationWareTransportPerHour(
  home: FleetStationSummary,
  wareId: WareId,
  shipTemplate: ShipTypeTemplate,
  allStations: FleetStationSummary[],
): number {
  if (!shipTemplate.allowedWares.includes(wareId)) return 0;

  const homeProducesWare = (home.production.get(wareId) ?? 0) > 0;
  const homeConsumesWare = (home.consumption.get(wareId) ?? 0) > 0;
  if (!homeProducesWare && !homeConsumesWare) return 0;

  let nearestDistance = Infinity;
  for (const candidate of allStations) {
    if (candidate.placement.id === home.placement.id) continue;

    const candidateMatches = homeProducesWare
      ? (candidate.consumption.get(wareId) ?? 0) > 0
      : (candidate.production.get(wareId) ?? 0) > 0;
    if (!candidateMatches) continue;

    const deltaX = candidate.placement.x - home.placement.x;
    const deltaY = candidate.placement.y - home.placement.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance < nearestDistance) nearestDistance = distance;
  }

  if (!Number.isFinite(nearestDistance)) return 0;

  const cycleSeconds = estimateTradeCycleSeconds(shipTemplate, nearestDistance);
  if (cycleSeconds <= 0) return 0;

  return (home.shipCount * shipTemplate.cargoCapacity * 3600) / cycleSeconds;
}

function estimateTradeCycleSeconds(shipTemplate: ShipTypeTemplate, distance: number): number {
  const interStationSpeed = shipTravel.baseFlightSpeedPixelsPerSecond * shipTravel.globalSpeed * shipTemplate.speed;
  const oneWayLegSeconds =
    shipTravel.accelerationDurationSeconds + distance / interStationSpeed + shipTravel.dockingDurationSeconds;
  const averageTradeWaitSeconds = (economyConfig.tradeWaitMinSeconds + economyConfig.tradeWaitMaxSeconds) / 2;
  const groundedDelayPerCycleSeconds = economyConfig.groundedDelaySeconds * 2;
  const roundTripTravelSeconds = oneWayLegSeconds * 2;
  return averageTradeWaitSeconds + groundedDelayPerCycleSeconds + roundTripTravelSeconds;
}

function recordDeliveryIntoRowTotals(
  event: TradeTransferEvent,
  simulation: Simulation,
  results: Map<string, Map<WareId, number>>,
): void {
  if (event.cargoDirection !== "incoming" || event.amount <= 0) return;

  const homeStation = simulation.stationManager.getStation(event.ship.homeStationId);
  const orbitingShip = simulation.shipManager.getShip(event.ship.orbitingShipId);
  if (!homeStation || !orbitingShip) return;
  const rowKey = `${homeStation.nation.id}:${orbitingShip.shipTypeId}`;
  let wareTotals = results.get(rowKey);
  if (!wareTotals) {
    wareTotals = new Map();
    results.set(rowKey, wareTotals);
  }
  wareTotals.set(event.wareId, (wareTotals.get(event.wareId) ?? 0) + event.amount);
}

export function simulateFleetTransportByRow(mapState: MapEditorState): Map<string, Map<WareId, number>> {
  const results = new Map<string, Map<WareId, number>>();
  const simulation = createSimulation(mapState.currentMap(), { ignoreCargoCompatibility: true });
  const totalSeconds = fleetSimulationHours * 3600;
  const tick = economyConfig.simulationIntervalSeconds;

  const tradeTransferUnsubscribe = simulation.tradeManager.addTradeTransferObserver((event) =>
    recordDeliveryIntoRowTotals(event, simulation, results),
  );

  try {
    for (let elapsedSeconds = 0; elapsedSeconds < totalSeconds; elapsedSeconds += tick) {
      simulation.tick(tick);
    }
  } finally {
    tradeTransferUnsubscribe();
    simulation.destroy();
  }

  return results;
}

function formatFleetSummaryNote(simulationSession: EditorSimulationSession): string {
  const estimateText =
    "Est / h uses current ship stats, average trade wait, grounded delay, and the nearest eligible route from each home station.";

  if (!simulationSession.lastFleetTransportByRow) {
    return `${estimateText} Sim ${fleetSimulationHours}h stays blank until you click Run Simulation.`;
  }

  if (simulationSession.fleetTransportIsStale) {
    return `${estimateText} Sim ${fleetSimulationHours}h currently shows the last run and is stale until you rerun simulation.`;
  }

  return `${estimateText} Sim ${fleetSimulationHours}h sums delivered cargo in a fresh ${fleetSimulationHours}-hour headless trade run with the live economy settings.`;
}

interface FleetRow {
  simulatedByWare: Map<WareId, number>;
  cargoEach: number;
  count: number;
  nationCode: string;
  nationColor: string;
  shipLabel: string;
  transportByWare: Map<WareId, number>;
}

interface FleetTotals {
  fleetRows: Map<string, FleetRow>;
  totalSimulatedByWare: Map<WareId, number>;
  totalCargo: number;
  totalShipCount: number;
  totalTransportByWare: Map<WareId, number>;
}

function sumSimulatedWareTotalsAcrossRows(fleetRows: Map<string, FleetRow>): Map<WareId, number> {
  const totals = new Map<WareId, number>();
  for (const [, row] of fleetRows) {
    for (const ware of allWares) {
      const simulatedDelivered = row.simulatedByWare.get(ware.id) ?? 0;
      if (simulatedDelivered <= 0) continue;
      totals.set(ware.id, (totals.get(ware.id) ?? 0) + simulatedDelivered);
    }
  }
  return totals;
}

function buildFleetTotalsFromSummaries(
  stationSummaries: FleetStationSummary[],
  simulatedTransportByRow: Map<string, Map<WareId, number>>,
): FleetTotals {
  const fleetRows = new Map<string, FleetRow>();
  let totalShipCount = 0;
  let totalCargo = 0;
  const totalTransportByWare = new Map<WareId, number>();

  for (const summary of stationSummaries) {
    const shipTemplate = allShips.find((ship) => ship.id === summary.shipTypeId);
    if (!shipTemplate) continue;

    const rowKey = `${summary.placement.nation.id}:${shipTemplate.id}`;
    let row = fleetRows.get(rowKey);
    if (!row) {
      row = {
        simulatedByWare: simulatedTransportByRow.get(rowKey) ?? new Map(),
        nationColor: summary.placement.nation.color,
        nationCode: summary.placement.nation.codeName,
        shipLabel: shipTemplate.name,
        count: 0,
        cargoEach: shipTemplate.cargoCapacity,
        transportByWare: new Map(),
      };
      fleetRows.set(rowKey, row);
    }

    row.count += summary.shipCount;
    totalShipCount += summary.shipCount;
    totalCargo += summary.shipCount * shipTemplate.cargoCapacity;

    for (const ware of allWares) {
      const ratePerHour = estimateStationWareTransportPerHour(
        summary,
        ware.id,
        shipTemplate,
        stationSummaries,
      );
      if (ratePerHour <= 0) continue;
      row.transportByWare.set(ware.id, (row.transportByWare.get(ware.id) ?? 0) + ratePerHour);
      totalTransportByWare.set(ware.id, (totalTransportByWare.get(ware.id) ?? 0) + ratePerHour);
    }
  }

  const totalSimulatedByWare = sumSimulatedWareTotalsAcrossRows(fleetRows);
  return { fleetRows, totalSimulatedByWare, totalCargo, totalShipCount, totalTransportByWare };
}

function sortFleetRowsByNation(
  fleetRows: Map<string, FleetRow>,
  allPlayableNations: Nation[],
): Array<[string, FleetRow]> {
  const nationOrder = new Map(allPlayableNations.map((nation, index) => [nation.id, index]));
  return [...fleetRows.entries()].sort(([leftKey, leftRow], [rightKey, rightRow]) => {
    const leftNationId = leftKey.split(":")[0];
    const rightNationId = rightKey.split(":")[0];
    const nationDifference = nationOrder.get(leftNationId)! - nationOrder.get(rightNationId)!;
    if (nationDifference !== 0) return nationDifference;
    return leftRow.shipLabel.localeCompare(rightRow.shipLabel);
  });
}

function buildFleetTableHeaderHtml(): string {
  let html =
    '<tr><th rowspan="2">Nation</th><th rowspan="2">Ship Type</th><th rowspan="2" class="numeric-column">Count</th><th rowspan="2" class="numeric-column">Cargo Each</th><th rowspan="2" class="numeric-column">Total Cargo</th>';
  for (const ware of allWares) {
    html += `<th colspan="2">${ware.name}</th>`;
  }
  html += "</tr>";
  html += "<tr>";
  for (const _ware of allWares) {
    html += '<th class="numeric-column">Est / h</th>';
    html += `<th class="numeric-column">Sim ${fleetSimulationHours}h</th>`;
  }
  html += "</tr>";
  return html;
}

function buildFleetRowHtml(row: FleetRow): string {
  let html = "<tr>";
  html += `<td style="color:${row.nationColor}">${row.nationCode}</td>`;
  html += `<td>${row.shipLabel}</td>`;
  html += `<td class="numeric-cell">${row.count}</td>`;
  html += `<td class="numeric-cell">${row.cargoEach.toLocaleString()}</td>`;
  html += `<td class="numeric-cell">${(row.count * row.cargoEach).toLocaleString()}</td>`;
  for (const ware of allWares) {
    const estimatedRate = row.transportByWare.get(ware.id) ?? 0;
    const simulatedRate = row.simulatedByWare.get(ware.id) ?? 0;
    html += `<td class="numeric-cell calculated-cell">${estimatedRate > 0 ? formatQuantity(estimatedRate) : "—"}</td>`;
    html += `<td class="numeric-cell calculated-cell">${simulatedRate > 0 ? formatQuantity(simulatedRate) : "—"}</td>`;
  }
  html += "</tr>";
  return html;
}

function buildFleetTotalsRowHtml(totals: FleetTotals): string {
  let html = `<tr class="summary-row"><td></td><td>Total</td><td class="numeric-cell">${totals.totalShipCount}</td><td></td><td class="numeric-cell">${totals.totalCargo.toLocaleString()}</td>`;
  for (const ware of allWares) {
    const estimatedRate = totals.totalTransportByWare.get(ware.id) ?? 0;
    const simulatedRate = totals.totalSimulatedByWare.get(ware.id) ?? 0;
    html += `<td class="numeric-cell calculated-cell">${estimatedRate > 0 ? formatQuantity(estimatedRate) : "—"}</td>`;
    html += `<td class="numeric-cell calculated-cell">${simulatedRate > 0 ? formatQuantity(simulatedRate) : "—"}</td>`;
  }
  html += "</tr>";
  return html;
}

function buildFleetSummaryHtml(
  totals: FleetTotals,
  sortedRows: Array<[string, FleetRow]>,
  simulationSession: EditorSimulationSession,
): string {
  let html = openPanel("Fleet Summary");
  html += `<div class="fleet-summary-note">${formatFleetSummaryNote(simulationSession)}</div>`;
  html += '<div class="table-scroll table-scroll-fleet">';
  html += '<table class="fleet-table">';
  html += buildFleetTableHeaderHtml();

  for (const [, row] of sortedRows) {
    html += buildFleetRowHtml(row);
  }

  html += buildFleetTotalsRowHtml(totals);
  html += `</table></div>${closePanel()}`;
  return html;
}

/** One row per (nation, ship type) pair with count, cargo, and per-ware estimated vs simulated transport. */
export function renderFleetSummary(
  mapState: MapEditorState,
  simulationSession: EditorSimulationSession,
  allPlayableNations: Nation[],
) {
  const stationSummaries = buildFleetStationSummaries(mapState.editableStations);
  const simulatedTransportByRow =
    simulationSession.lastFleetTransportByRow ?? new Map<string, Map<WareId, number>>();
  const totals = buildFleetTotalsFromSummaries(stationSummaries, simulatedTransportByRow);
  const sortedRows = sortFleetRowsByNation(totals.fleetRows, allPlayableNations);

  document.getElementById("fleet-container")!.innerHTML = buildFleetSummaryHtml(
    totals,
    sortedRows,
    simulationSession,
  );
}
