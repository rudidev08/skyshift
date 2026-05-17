// Stations table — per-station ware production/consumption grid plus
// add/remove controls. The fleet summary panel underneath lives in the
// fleet-summary sibling.

import { allWares } from "../../data/wares";
import { allStationTypes } from "../../data/stations";
import { createStation, getStationRates } from "../sim-station";
import type { WareId } from "../../data/ware-types";
import type { PlacedStation, StationTypeId, StationSize } from "../../data/station-types";
import type { Station } from "../sim-station-types";
import type { Nation } from "../sim-nation";
import type { MapEditorState } from "./map-editor-state";
import type { EditorSimulationSession } from "./simulation-session";

function buildAddStationControlsHtml(allPlayableNations: Nation[]): string {
  let html = '<div class="station-panel-actions">';
  html += '<div class="add-station-controls">';
  html += '<select id="add-nation">';
  for (const nation of allPlayableNations) {
    html += `<option value="${nation.id}">${nation.codeName}</option>`;
  }
  html += "</select>";
  html += '<select id="add-type">';
  for (const stationType of allStationTypes) {
    html += `<option value="${stationType.id}">${stationType.name}</option>`;
  }
  html += "</select>";
  html +=
    '<select id="add-size"><option value="S">S</option><option value="M">M</option><option value="L">L</option></select>';
  html += '<button id="add-station-button">+ Add Station</button>';
  html += "</div>";
  html +=
    '<div class="panel-note">Added stations are temporary simulation-only and are not saved to files or drafts.</div>';
  html += "</div>";
  return html;
}

function buildStationTableHeaderHtml(wareColumns: typeof allWares): string {
  let html = "<tr><th></th><th>Station</th><th>Type</th>";
  for (const ware of wareColumns) {
    html += `<th class="ware-header">${ware.name}</th>`;
  }
  html += "</tr>";
  return html;
}

function sortStationIndicesByNation(
  editableStations: PlacedStation[],
  allPlayableNations: Nation[],
): number[] {
  const nationOrder = new Map(allPlayableNations.map((nation, index) => [nation.id, index]));
  return editableStations
    .map((_station, index) => index)
    .sort((leftIndex, rightIndex) => {
      const leftStation = editableStations[leftIndex];
      const rightStation = editableStations[rightIndex];
      const nationDifference =
        (nationOrder.get(leftStation.nation.id) ?? 999) - (nationOrder.get(rightStation.nation.id) ?? 999);
      if (nationDifference !== 0) return nationDifference;
      const leftName = (leftStation.name ?? leftStation.id).toLowerCase();
      const rightName = (rightStation.name ?? rightStation.id).toLowerCase();
      return leftName.localeCompare(rightName);
    });
}

function getStationHealthClass(stationResults: Array<{ minPercent: number; maxPercent: number }>): string {
  const worstMin = Math.min(...stationResults.map((result) => result.minPercent));
  const worstMax = Math.max(...stationResults.map((result) => result.maxPercent));
  if (worstMin < 15 || worstMax > 85) return "station-critical";
  if (worstMin < 35 || worstMax > 65) return "station-warning";
  return "station-healthy";
}

interface StationRowResult {
  rowHtml: string;
  produced: Map<WareId, number>;
  consumed: Map<WareId, number>;
}

function buildStationRow(stationRowInput: {
  mapStation: PlacedStation;
  stationData: Station;
  rates: { production: Map<WareId, number>; consumption: Map<WareId, number> };
  wareColumns: typeof allWares;
  stationHealthClass: string;
  stationIndex: number;
}): StationRowResult {
  const { mapStation, stationData, rates, wareColumns, stationHealthClass, stationIndex } = stationRowInput;
  const produced = new Map<WareId, number>();
  const consumed = new Map<WareId, number>();

  let rowHtml = "<tr>";
  rowHtml += `<td><button class="remove-button" data-action="remove-station" data-station-index="${stationIndex}" title="Remove station">×</button></td>`;
  const nameClass = stationHealthClass ? ` class="${stationHealthClass}"` : "";
  rowHtml += `<td${nameClass} style="color:${stationHealthClass ? "" : mapStation.nation.color}">${mapStation.nation.codeName} ${mapStation.name ?? mapStation.id} <span class="size-badge">${mapStation.size}</span></td>`;
  rowHtml += `<td>${stationData.stationType.name}</td>`;

  for (const ware of wareColumns) {
    const wareProduced = rates.production.get(ware.id) ?? 0;
    const wareConsumed = rates.consumption.get(ware.id) ?? 0;
    if (wareProduced > 0) produced.set(ware.id, wareProduced);
    if (wareConsumed > 0) consumed.set(ware.id, wareConsumed);

    const net = wareProduced - wareConsumed;
    if (net !== 0) {
      const sign = net > 0 ? "+" : "";
      const rateClass = net > 0 ? "net-positive" : "net-negative";
      rowHtml += `<td class="ware-cell ${rateClass}">${sign}${net.toFixed(1)}</td>`;
    } else {
      rowHtml += '<td class="ware-cell"></td>';
    }
  }
  rowHtml += "</tr>";

  return { rowHtml, produced, consumed };
}

function addToWareTotals(accumulator: Map<WareId, number>, fromRow: Map<WareId, number>): void {
  for (const [wareId, amount] of fromRow) {
    accumulator.set(wareId, (accumulator.get(wareId) ?? 0) + amount);
  }
}

function buildStationTotalsRowsHtml(
  wareColumns: typeof allWares,
  totalProduced: Map<WareId, number>,
  totalConsumed: Map<WareId, number>,
): string {
  let html = "";

  html += "<tr>";
  html += '<td></td><td colspan="2" class="totals-label">Produced</td>';
  for (const ware of wareColumns) {
    const value = totalProduced.get(ware.id) ?? 0;
    html += `<td class="totals-cell${value > 0 ? " net-positive" : ""}">`;
    html += value > 0 ? `+${value.toFixed(1)}` : "";
    html += "</td>";
  }
  html += "</tr>";

  html += "<tr>";
  html += '<td></td><td colspan="2" class="totals-label">Consumed</td>';
  for (const ware of wareColumns) {
    const value = totalConsumed.get(ware.id) ?? 0;
    html += `<td class="totals-cell${value > 0 ? " net-negative" : ""}">`;
    html += value > 0 ? `−${value.toFixed(1)}` : "";
    html += "</td>";
  }
  html += "</tr>";

  html += "<tr>";
  html += '<td></td><td colspan="2" class="totals-label">Net</td>';
  for (const ware of wareColumns) {
    const produced = totalProduced.get(ware.id) ?? 0;
    const consumed = totalConsumed.get(ware.id) ?? 0;
    const net = produced - consumed;
    if (net !== 0) {
      const sign = net > 0 ? "+" : "";
      const netClass = net > 0 ? "net-positive" : "net-negative";
      html += `<td class="totals-cell editor-bold-cell ${netClass}">${sign}${net.toFixed(1)}</td>`;
    } else if (produced > 0 || consumed > 0) {
      html += '<td class="totals-cell dim editor-bold-cell">0</td>';
    } else {
      html += '<td class="totals-cell"></td>';
    }
  }
  html += "</tr>";

  return html;
}

interface StationTableBodyResult {
  bodyHtml: string;
  totalProduced: Map<WareId, number>;
  totalConsumed: Map<WareId, number>;
}

function buildStationTableBodyHtml(
  mapState: MapEditorState,
  simulationSession: EditorSimulationSession,
  allPlayableNations: Nation[],
  wareColumns: typeof allWares,
  totalColumnCount: number,
): StationTableBodyResult {
  const hasResults = simulationSession.lastSlotRangesByStationId !== null;
  const sortedStationIndices = sortStationIndicesByNation(mapState.editableStations, allPlayableNations);

  const totalProduced = new Map<WareId, number>();
  const totalConsumed = new Map<WareId, number>();
  let bodyHtml = "";
  let previousNationId = "";

  for (const stationIndex of sortedStationIndices) {
    const mapStation = mapState.editableStations[stationIndex];

    if (mapStation.nation.id !== previousNationId && previousNationId !== "") {
      bodyHtml += `<tr class="separator"><td colspan="${totalColumnCount}"></td></tr>`;
    }
    previousNationId = mapStation.nation.id;

    const stationData = createStation(mapStation);
    const rates = getStationRates(stationData);

    let stationHealthClass = "";
    if (hasResults) {
      const stationResults = simulationSession.lastSlotRangesByStationId!.get(mapStation.id);
      if (stationResults) stationHealthClass = getStationHealthClass(stationResults);
    }

    const row = buildStationRow({
      mapStation,
      stationData,
      rates,
      wareColumns,
      stationHealthClass,
      stationIndex,
    });
    bodyHtml += row.rowHtml;
    addToWareTotals(totalProduced, row.produced);
    addToWareTotals(totalConsumed, row.consumed);
  }

  return { bodyHtml, totalProduced, totalConsumed };
}

function buildStationPanelHtml(
  mapState: MapEditorState,
  simulationSession: EditorSimulationSession,
  allPlayableNations: Nation[],
): string {
  const wareColumns = allWares;
  const totalColumnCount = 3 + wareColumns.length;

  let html = '<div class="panel">';
  html += '<div class="panel-header"><h2>Stations</h2>';
  html += buildAddStationControlsHtml(allPlayableNations);
  html += "</div>";

  html += '<div class="table-scroll table-scroll-stations">';
  html += '<table class="station-grid">';
  html += buildStationTableHeaderHtml(wareColumns);

  const body = buildStationTableBodyHtml(
    mapState,
    simulationSession,
    allPlayableNations,
    wareColumns,
    totalColumnCount,
  );
  html += body.bodyHtml;

  html += `<tr class="separator"><td colspan="${totalColumnCount}"></td></tr>`;
  html += buildStationTotalsRowsHtml(wareColumns, body.totalProduced, body.totalConsumed);

  html += "</table></div></div>";
  return html;
}

/** Fully re-rendered on every change — the row set itself shifts when stations are added or removed, so per-cell patching wouldn't be enough. */
export function renderStationTable(
  mapState: MapEditorState,
  simulationSession: EditorSimulationSession,
  allPlayableNations: Nation[],
  applyReadOnlyMode: () => void,
) {
  const container = document.getElementById("station-container")!;
  container.innerHTML = buildStationPanelHtml(mapState, simulationSession, allPlayableNations);
  applyReadOnlyMode();
}

export interface AddStationDependencies {
  mapState: MapEditorState;
  nationById: Map<string, Nation>;
  simulationSession: EditorSimulationSession;
  markMapEditorNeedsRemount: () => void;
  refreshDerivedPanels: () => void;
}

let nextCustomStationCount = 0;

export function addEditableStation(dependencies: AddStationDependencies) {
  const nationId = (document.getElementById("add-nation") as HTMLSelectElement).value;
  const stationTypeId = (document.getElementById("add-type") as HTMLSelectElement).value as StationTypeId;
  const size = (document.getElementById("add-size") as HTMLSelectElement).value as StationSize;

  const nation = dependencies.nationById.get(nationId);
  if (!nation) return;

  nextCustomStationCount++;
  const stationType = allStationTypes.find((candidate) => candidate.id === stationTypeId);
  const newStation: PlacedStation = {
    id: `custom-${nextCustomStationCount}`,
    name: `${stationType?.name ?? stationTypeId} ${nextCustomStationCount}`,
    x: 0,
    y: 0,
    nation,
    stationTypeId,
    size,
  };

  dependencies.mapState.editableStations.push(newStation);
  dependencies.markMapEditorNeedsRemount();
  dependencies.simulationSession.invalidateResults();
  dependencies.refreshDerivedPanels();
  dependencies.simulationSession.markResultsStale();
}

export function removeEditableStation(stationIndex: number, dependencies: AddStationDependencies) {
  dependencies.mapState.editableStations.splice(stationIndex, 1);
  dependencies.markMapEditorNeedsRemount();
  dependencies.simulationSession.invalidateResults();
  dependencies.refreshDerivedPanels();
  dependencies.simulationSession.markResultsStale();
}
