// Toggles `.changed` on number inputs that drift from their data-file baseline
// so unsaved edits stand out from saved values.

import {
  baselineShips,
  baselineWares,
  baselineEconomyConfig,
  isEconomyFieldName,
  isShipBaselineFieldName,
} from "./snapshot-state";
import { toDisplayUnit } from "./economy-panel";

function lookupBaselineForInput(input: HTMLInputElement): number | undefined {
  const target = input.dataset.target;
  const field = input.dataset.field;
  if (target === "config") {
    if (isEconomyFieldName(field)) return toDisplayUnit(field, baselineEconomyConfig[field]);
    return undefined;
  }
  if (target === "ship") {
    const shipSnapshot = baselineShips.find((ship) => ship.id === input.dataset.id);
    if (shipSnapshot && isShipBaselineFieldName(field)) return shipSnapshot[field];
    return undefined;
  }
  if (target === "ware-output") {
    const wareSnapshot = baselineWares.find((ware) => ware.id === input.dataset.id);
    if (wareSnapshot && field === "productionOutput") return wareSnapshot.productionOutput;
    return undefined;
  }
  if (target === "ware-input-units") {
    const wareSnapshot = baselineWares.find((ware) => ware.id === input.dataset.ware);
    const inputSnapshot = wareSnapshot?.productionInputs.find((item) => item.wareId === input.dataset.input);
    if (inputSnapshot && field === "unitsPerTick") return inputSnapshot.unitsPerTick;
    return undefined;
  }
  return undefined;
}

/** Toggles `.changed` so unsaved edits stand out from baseline values. */
export function highlightChangedInputs(editorRootElement: HTMLElement) {
  for (const input of editorRootElement.querySelectorAll<HTMLInputElement>(
    "input[type=number][data-target]",
  )) {
    const value = parseFloat(input.value);
    if (isNaN(value)) continue;
    const baseline = lookupBaselineForInput(input);
    input.classList.toggle("changed", baseline !== undefined && value !== baseline);
  }
}
