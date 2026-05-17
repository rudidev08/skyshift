// HTML string assembly for the economy editor view — toolbar, simulation
// controls, and the full page composition that the entry point pours into the
// editor root element.

import type { PlacedStation } from "../../data/station-types";
import { buildEconomyConfigHtml } from "./economy-panel";
import { buildShipsHtml } from "./ships-panel";

function buildToolbarHtml(): string {
  let html = '<div class="toolbar">';
  html += '<div class="toolbar-group"><h1>Skyshift Economy Tool</h1></div>';
  html += '<div class="toolbar-group">';
  html += '<button id="save-button" class="button-primary">Save</button>';
  html += '<button id="revert-button" class="button-danger">Revert</button>';
  html += "</div>";
  html += '<div class="toolbar-divider"></div>';
  html += '<div class="toolbar-group">';
  html += '<button id="save-draft-button">Save Draft</button>';
  html +=
    '<select id="draft-select" class="editor-compact-select"><option value="">— drafts —</option></select>';
  html += '<button id="load-draft-button">Load Draft</button>';
  html +=
    '<button id="delete-draft-button" class="button-danger" title="Delete selected draft">Delete</button>';
  html += "</div>";
  html += "</div>";
  return html;
}

function buildSimulationPanelHtml(): string {
  let html = '<div class="panel panel-simulation">';
  html += '<div class="panel-header"><h2>Simulation</h2></div>';
  html += '<div class="sim-controls">';
  html +=
    '<span class="sim-label">Hours:</span> <input type="number" id="simulation-hours" value="20" step="1" min="1" class="editor-compact-number-input">';
  html += '<button id="run-button" class="button-action">Run Simulation</button>';
  html += '<span id="simulation-status"></span>';
  html += "</div></div>";
  return html;
}

/** Builds the full inner HTML for the economy editor page. */
export function buildEditorPageHtml(editableStations: PlacedStation[]): string {
  let html = buildToolbarHtml();
  html += buildEconomyConfigHtml();
  html += buildShipsHtml(editableStations);
  html += '<div id="wares-container"></div>';
  html += buildSimulationPanelHtml();
  html += '<div id="station-container"></div>';
  html += '<div id="fleet-container"></div>';
  return html;
}
