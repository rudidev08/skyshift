// Ships table — cargo/speed inputs plus derived columns (throughput,
// % of smallest matching station storage, suggested cargo).

import { allShips } from "../../data/ships";
import type { ShipTypeTemplate, ShipTypeId } from "../../data/ship-types";
import type { WareId } from "../../data/ware-types";
import type { PlacedStation } from "../../data/station-types";
import { getWareTemplate } from "../sim-ware-template";
import { createStation, getAllInventorySlots } from "../sim-station";
import { shipThroughputCellId, shipStoragePercentCellId, shipSuggestedCargoCellId } from "./cell-ids";
import { closePanel, openPanel } from "./panel-chrome";
import { baselineShips } from "./edit-baselines";

const defaultShipSuggestionPercent = 50;

function buildMinimumStorageByWare(stations: PlacedStation[]): Map<WareId, number> {
  const minimumStorageByWare = new Map<WareId, number>();
  for (const mapStation of stations) {
    const stationData = createStation(mapStation);
    for (const slot of getAllInventorySlots(stationData)) {
      const existing = minimumStorageByWare.get(slot.ware.id);
      if (existing === undefined || slot.max < existing) {
        minimumStorageByWare.set(slot.ware.id, slot.max);
      }
    }
  }
  return minimumStorageByWare;
}

function lowestStorageForShip(shipTemplate: ShipTypeTemplate, minimumStorageByWare: Map<WareId, number>): number {
  let lowest = Infinity;
  for (const wareId of shipTemplate.allowedWares) {
    const storage = minimumStorageByWare.get(wareId);
    if (storage !== undefined && storage < lowest) lowest = storage;
  }
  return lowest;
}

function getShipSuggestionPercent(): number {
  const input = document.getElementById("suggest-percent") as HTMLInputElement | null;
  const parsed = input ? parseFloat(input.value) : defaultShipSuggestionPercent;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultShipSuggestionPercent;
}

function buildSuggestedCargoByShip(
  percentage: number,
  minimumStorageByWare: Map<WareId, number>,
): Map<ShipTypeId, number> {
  const suggestions = new Map<ShipTypeId, number>();
  for (const ship of allShips) {
    const lowest = lowestStorageForShip(ship, minimumStorageByWare);
    if (lowest !== Infinity) suggestions.set(ship.id, Math.floor((percentage / 100) * lowest));
  }
  return suggestions;
}

function formatShipThroughput(shipTemplate: ShipTypeTemplate): string {
  return Math.floor(shipTemplate.cargoCapacity * shipTemplate.speed).toLocaleString();
}

function formatStoragePercentForShip(
  shipTemplate: ShipTypeTemplate,
  minimumStorageByWare: Map<WareId, number>,
): string {
  const lowest = lowestStorageForShip(shipTemplate, minimumStorageByWare);
  return lowest !== Infinity ? ((shipTemplate.cargoCapacity / lowest) * 100).toFixed(1) + "%" : "—";
}

function formatSuggestedCargoForShip(
  shipTemplate: ShipTypeTemplate,
  suggestedCargoByShip: Map<ShipTypeId, number>,
): string {
  const suggestion = suggestedCargoByShip.get(shipTemplate.id);
  return suggestion !== undefined ? suggestion.toLocaleString() : "—";
}

function updateShipDerivedColumns(
  shipTemplate: ShipTypeTemplate,
  minimumStorageByWare: Map<WareId, number>,
  suggestedCargoByShip: Map<ShipTypeId, number>,
) {
  const throughputCell = document.getElementById(shipThroughputCellId(shipTemplate.id));
  if (throughputCell) throughputCell.textContent = formatShipThroughput(shipTemplate);

  const percentCell = document.getElementById(shipStoragePercentCellId(shipTemplate.id));
  if (percentCell) percentCell.textContent = formatStoragePercentForShip(shipTemplate, minimumStorageByWare);

  const suggestionCell = document.getElementById(shipSuggestedCargoCellId(shipTemplate.id));
  if (suggestionCell)
    suggestionCell.textContent = formatSuggestedCargoForShip(shipTemplate, suggestedCargoByShip);
}

export function refreshShipDerivedColumns(stations: PlacedStation[]) {
  const minimumStorageByWare = buildMinimumStorageByWare(stations);
  const suggestedCargoByShip = buildSuggestedCargoByShip(getShipSuggestionPercent(), minimumStorageByWare);
  for (const ship of allShips) {
    updateShipDerivedColumns(ship, minimumStorageByWare, suggestedCargoByShip);
  }
}

function buildShipsTableHeaderHtml(): string {
  return '<tr><th>Ship</th><th class="numeric-column">Cargo</th><th class="numeric-column">Speed</th><th class="numeric-column">Cargo × Speed</th><th class="numeric-column">% Min Storage</th><th class="numeric-column">Suggested Cargo</th></tr>';
}

function buildShipRowHtml(
  shipTemplate: ShipTypeTemplate,
  minimumStorageByWare: Map<WareId, number>,
  suggestedCargoByShip: Map<ShipTypeId, number>,
): string {
  const wareColumnsCount = 6;
  const baseline = baselineShips.find((ship) => ship.id === shipTemplate.id);
  let html = `<tr><td class="label-cell">${shipTemplate.name}</td>`;
  html += `<td class="numeric-cell input-cell"><input type="number" data-target="ship" data-id="${shipTemplate.id}" data-field="cargoCapacity" value="${shipTemplate.cargoCapacity}" data-baseline="${baseline?.cargoCapacity ?? shipTemplate.cargoCapacity}" step="500"></td>`;
  html += `<td class="numeric-cell input-cell"><input type="number" data-target="ship" data-id="${shipTemplate.id}" data-field="speed" value="${shipTemplate.speed}" data-baseline="${baseline?.speed ?? shipTemplate.speed}" step="0.5"></td>`;
  html += `<td class="numeric-cell calculated-cell" id="${shipThroughputCellId(shipTemplate.id)}">${formatShipThroughput(shipTemplate)}</td>`;
  html += `<td class="numeric-cell calculated-cell" id="${shipStoragePercentCellId(shipTemplate.id)}">${formatStoragePercentForShip(shipTemplate, minimumStorageByWare)}</td>`;
  html += `<td class="numeric-cell calculated-cell" id="${shipSuggestedCargoCellId(shipTemplate.id)}">${formatSuggestedCargoForShip(shipTemplate, suggestedCargoByShip)}</td>`;
  html += "</tr>";
  const wareNames = shipTemplate.allowedWares.map((wareId) => getWareTemplate(wareId).name).join(", ");
  html += `<tr class="ship-wares-row"><td colspan="${wareColumnsCount}">Carries: ${wareNames}</td></tr>`;
  return html;
}

function buildShipCalculatorControlsHtml(): string {
  let html = '<div class="calculator-controls">';
  html += `<label>Target min storage fill <input type="number" id="suggest-percent" value="${defaultShipSuggestionPercent}" step="5" min="1" max="100" class="small-input"></label>`;
  html += '<span class="calculator-unit">%</span>';
  html +=
    '<span class="calculator-note">Suggested cargo updates live from the smallest matching station storage.</span>';
  html += "</div>";
  return html;
}

export function buildShipsHtml(stations: PlacedStation[]): string {
  const minimumStorageByWare = buildMinimumStorageByWare(stations);
  const suggestedCargoByShip = buildSuggestedCargoByShip(defaultShipSuggestionPercent, minimumStorageByWare);

  let html = openPanel("Ships");
  html += '<table class="metric-table ships-table">';
  html += buildShipsTableHeaderHtml();
  for (const ship of allShips) {
    html += buildShipRowHtml(ship, minimumStorageByWare, suggestedCargoByShip);
  }
  html += "</table>";
  html += buildShipCalculatorControlsHtml();
  html += closePanel();
  return html;
}
