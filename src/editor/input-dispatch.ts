// Edit dispatch — applies number-input changes to ships, wares, and economy
// config, and routes button clicks to persistence + per-panel actions.

import { allShips } from "../../data/ships";
import { allWares } from "../../data/wares";
import { economyConfig } from "../../data/economy-config";
import { fromEconomyEditorValue } from "./economy-panel";
import {
  saveToFiles,
  revertFiles,
  saveDraft,
  loadDraft,
  deleteDraft,
  type DraftDependencies,
} from "./persistence";
import { refreshShipDerivedColumns } from "./ships-panel";
import { isEconomyFieldName } from "./snapshot-state";
import {
  addStation as addStationPanel,
  removeStation as removeStationPanel,
  type AddStationDependencies,
} from "./stations-panel";
import type { MapEditorState } from "./map-editor-state";
import type { EditorSimulationSession } from "./simulation-session";

function applyShipEdit(input: HTMLInputElement, value: number) {
  const ship = allShips.find(shipItem => shipItem.id === input.dataset.id);
  if (!ship) return;
  if (input.dataset.field === "cargoCapacity") ship.cargoCapacity = value;
  if (input.dataset.field === "speed") ship.speed = value;
}

function applyWareOutputEdit(input: HTMLInputElement, value: number) {
  const ware = allWares.find(wareItem => wareItem.id === input.dataset.id);
  if (ware && input.dataset.field === "productionOutput") ware.productionOutput = value;
}

function applyWareInputUnitsEdit(input: HTMLInputElement, value: number) {
  const ware = allWares.find(wareItem => wareItem.id === input.dataset.ware);
  if (!ware) return;
  const wareInput = ware.productionInputs.find(item => item.wareId === input.dataset.input);
  if (wareInput && input.dataset.field === "unitsPerTick") wareInput.unitsPerTick = value;
}

function applyConfigEdit(input: HTMLInputElement, value: number) {
  const field = input.dataset.field;
  if (isEconomyFieldName(field)) {
    economyConfig[field] = fromEconomyEditorValue(field, value);
  }
}

function applyEdit(input: HTMLInputElement, value: number) {
  const target = input.dataset.target;
  switch (target) {
    case "ship": return applyShipEdit(input, value);
    case "ware": return applyWareOutputEdit(input, value);
    case "ware-input-units": return applyWareInputUnitsEdit(input, value);
    case "config": return applyConfigEdit(input, value);
  }
}

export interface EditorEventDependencies {
  rootElement: HTMLElement;
  mapState: MapEditorState;
  simulationSession: EditorSimulationSession;
  stationDependencies: AddStationDependencies;
  draftDependencies: DraftDependencies;
  economyEditingIsEnabled: boolean;
  refreshDerivedPanels: () => void;
  runSimulation: () => void;
}

function handleEditorClick(event: Event, dependencies: EditorEventDependencies) {
  const target = event.target as HTMLElement;
  const { mapState, stationDependencies, draftDependencies, economyEditingIsEnabled } = dependencies;

  if (target.id === "save-button") {
    if (economyEditingIsEnabled) saveToFiles(mapState);
  } else if (target.id === "revert-button") {
    if (economyEditingIsEnabled) revertFiles();
  } else if (target.id === "run-button") {
    dependencies.runSimulation();
  } else if (target.id === "add-station-button") {
    addStationPanel(stationDependencies);
  } else if (target.dataset.action === "remove-station") {
    const stationIndex = parseInt(target.dataset.stationIndex!, 10);
    if (!isNaN(stationIndex)) removeStationPanel(stationIndex, stationDependencies);
  } else if (target.id === "save-draft-button") {
    if (economyEditingIsEnabled) saveDraft(mapState);
  } else if (target.id === "load-draft-button") {
    if (economyEditingIsEnabled) loadDraft(draftDependencies);
  } else if (target.id === "delete-draft-button") {
    if (economyEditingIsEnabled) deleteDraft();
  }
}

/** Attaches the editor's input + click event listeners to the root element. */
export function wireEditorEventListeners(dependencies: EditorEventDependencies) {
  const { rootElement, mapState, simulationSession, refreshDerivedPanels } = dependencies;

  rootElement.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.tagName !== "INPUT" || input.type !== "number") return;
    if (input.id === "simulation-hours") return;
    if (input.id === "suggest-percent") {
      refreshShipDerivedColumns(mapState.editableStations);
      return;
    }
    const value = parseFloat(input.value);
    if (isNaN(value)) return;

    applyEdit(input, value);
    simulationSession.invalidateResults();
    refreshDerivedPanels();
    simulationSession.markResultsStale();
  });

  rootElement.addEventListener("click", (event) => handleEditorClick(event, dependencies));
}
