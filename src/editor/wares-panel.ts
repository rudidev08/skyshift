// Wares table — production output / inputs / costs plus universe totals.
// Table is built once; universe totals refresh in place by cell id so
// editing inputs doesn't lose DOM focus or scroll position.

import { allWares } from "../../data/wares";
import type { WareTemplate, WareId } from "../../data/ware-types";
import type { StationPlacement } from "../../data/station-types";
import { getWareTemplate } from "../sim-ware-template";
import { createStation, getStationRates } from "../sim-station";
import {
  wareProducedCellId,
  wareConsumedCellId,
  wareNetCellId,
} from "./cell-ids";

function computeUniverseTotals(stations: StationPlacement[]): { produced: Map<WareId, number>; consumed: Map<WareId, number> } {
  const produced = new Map<WareId, number>();
  const consumed = new Map<WareId, number>();

  for (const mapStation of stations) {
    const station = createStation(mapStation);
    const rates = getStationRates(station);

    for (const [wareId, amount] of rates.production) {
      produced.set(wareId, (produced.get(wareId) ?? 0) + amount);
    }
    for (const [wareId, amount] of rates.consumption) {
      consumed.set(wareId, (consumed.get(wareId) ?? 0) + amount);
    }
  }

  return { produced, consumed };
}

function buildWaresTableHeaderHtml(): string {
  let html = '<tr>';
  html += '<th rowspan="2">Ware</th>';
  html += '<th rowspan="2" class="numeric-column">Output / tick</th>';
  html += '<th rowspan="2">Input</th>';
  html += '<th rowspan="2" class="numeric-column">Cost</th>';
  html += '<th colspan="3" class="editor-center-header">Universe</th>';
  html += '</tr>';
  html += '<tr><th>Produced</th><th>Consumed</th><th>Net</th></tr>';
  return html;
}

function buildWareRowsHtml(ware: WareTemplate): string {
  const inputs = ware.productionInputs;
  const rowCount = Math.max(1, inputs.length);
  let html = "";

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const groupClass = rowIndex === 0 ? ' class="ware-group-first"' : "";
    html += `<tr${groupClass}>`;

    if (rowIndex === 0) {
      html += `<td class="label-cell">${ware.name}</td>`;
      html += `<td class="numeric-cell input-cell"><input type="number" data-target="ware" data-id="${ware.id}" data-field="productionOutput" value="${ware.productionOutput}" step="0.25"></td>`;
    } else {
      html += '<td></td><td></td>';
    }

    if (rowIndex < inputs.length) {
      const input = inputs[rowIndex];
      const inputWareName = getWareTemplate(input.wareId).name;
      html += `<td>${inputWareName}</td>`;
      html += `<td class="numeric-cell input-cell"><input type="number" class="small" data-target="ware-input-units" data-ware="${ware.id}" data-input="${input.wareId}" data-field="unitsPerTick" value="${input.unitsPerTick}" step="0.5"></td>`;
    } else {
      html += '<td></td><td></td>';
    }

    if (rowIndex === 0) {
      html += `<td class="numeric-cell" id="${wareProducedCellId(ware.id)}"></td>`;
      html += `<td class="numeric-cell" id="${wareConsumedCellId(ware.id)}"></td>`;
      html += `<td class="numeric-cell" id="${wareNetCellId(ware.id)}"></td>`;
    } else {
      html += "<td></td><td></td><td></td>";
    }

    html += "</tr>";
  }

  return html;
}

export function renderWaresTable(applyReadOnlyMode: () => void) {
  const container = document.getElementById("wares-container")!;
  let html = '<div class="panel">';
  html += '<div class="panel-header"><h2>Wares</h2></div>';

  html += '<div class="table-scroll">';
  html += '<table id="wares-table">';
  html += buildWaresTableHeaderHtml();

  for (const ware of allWares) {
    html += buildWareRowsHtml(ware);
  }

  html += "</table></div></div>";
  container.innerHTML = html;
  applyReadOnlyMode();
}

function applyNetCellFormatting(netCell: HTMLElement, produced: number, consumed: number): void {
  if (produced === 0 && consumed === 0) {
    netCell.textContent = "";
    netCell.className = "";
    return;
  }

  const net = produced - consumed;
  const sign = net >= 0 ? "+" : "";
  netCell.textContent = `${sign}${net.toFixed(1)}`;
  netCell.className = net > 0.01 ? "net-positive" : net < -0.01 ? "net-negative" : "dim";
}

/** In-place cell refresh — keeps the wares table mounted so edits don't lose focus. */
export function updateUniverseTotals(stations: StationPlacement[]) {
  const totals = computeUniverseTotals(stations);
  for (const ware of allWares) {
    const produced = totals.produced.get(ware.id) ?? 0;
    const consumed = totals.consumed.get(ware.id) ?? 0;

    const producedCell = document.getElementById(wareProducedCellId(ware.id));
    const consumedCell = document.getElementById(wareConsumedCellId(ware.id));
    const netCell = document.getElementById(wareNetCellId(ware.id));

    if (producedCell) producedCell.textContent = produced > 0 ? produced.toFixed(1) : "";
    if (consumedCell) consumedCell.textContent = consumed > 0 ? consumed.toFixed(1) : "";
    if (netCell) applyNetCellFormatting(netCell, produced, consumed);
  }
}
