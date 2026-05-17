import { economyConfig } from "../../data/economy-config";
import type { EconomyFieldName } from "./snapshot-state";

interface EconomyFieldTemplate {
  description: string;
  field: EconomyFieldName;
  label: string;
  step: number;
}

const economyFieldTemplates: EconomyFieldTemplate[] = [
  {
    field: "minimumCargoFillThreshold",
    label: "Ship Min Fill %",
    step: 0.05,
    description: "Lowest starting cargo fill a ship accepts before waiting in orbit relaxes the threshold.",
  },
  {
    field: "cargoFillDecayPerSecond",
    label: "Min Fill Drain / min",
    step: 0.05,
    description:
      "How much the minimum fill threshold drops each minute while a ship stays idle without finding a route.",
  },
  {
    field: "optimalPickChance",
    label: "Optimal Trade %",
    step: 0.05,
    description:
      "Chance a ship picks the best ware and destination instead of taking a random eligible route.",
  },
  {
    field: "tradeWaitMinSeconds",
    label: "Trade Wait Min (s)",
    step: 1,
    description: "Shortest idle delay between completed trade cycles before a ship looks for the next job.",
  },
  {
    field: "tradeWaitMaxSeconds",
    label: "Trade Wait Max (s)",
    step: 1,
    description: "Longest idle delay between completed trade cycles before a ship looks for the next job.",
  },
  {
    field: "groundedDelaySeconds",
    label: "Grounded Delay (s)",
    step: 0.5,
    description: "Docked loading or unloading time spent at each station stop in a trade route.",
  },
];

/** `cargoFillDecayPerSecond` is stored per-second but shown per-minute in the editor. */
export function toDisplayUnit(field: EconomyFieldName, value: number): number {
  if (field === "cargoFillDecayPerSecond") return value * 60;
  return value;
}

export function fromDisplayUnit(field: EconomyFieldName, value: number): number {
  if (field === "cargoFillDecayPerSecond") return value / 60;
  return value;
}

export function buildEconomyConfigHtml(): string {
  let html = '<div class="panel">';
  html += '<div class="panel-header"><h2>Economy</h2></div>';
  html += '<table class="metric-table">';
  html += '<tr><th>Setting</th><th class="numeric-column">Value</th><th>What It Does</th></tr>';
  for (const field of economyFieldTemplates) {
    html += "<tr>";
    html += `<td class="label-cell">${field.label}</td>`;
    html += `<td class="numeric-cell input-cell"><input type="number" data-target="config" data-field="${field.field}" value="${toDisplayUnit(field.field, economyConfig[field.field])}" step="${field.step}"></td>`;
    html += `<td class="description-cell">${field.description}</td>`;
    html += "</tr>";
  }
  html += "</table></div>";
  return html;
}
