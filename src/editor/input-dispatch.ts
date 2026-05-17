// Edit dispatch — applies number-input changes to ships, wares, and economy
// config, and routes button clicks to persistence + per-panel actions.

import { allShips } from "../../data/ships";
import { allWares } from "../../data/wares";
import { economyConfig } from "../../data/economy-config";
import { fromDisplayUnit } from "./economy-panel";
import {
  saveEconomyToFiles,
  revertEconomyFiles,
  saveDraft,
  loadDraft,
  deleteDraft,
  type DraftDependencies,
} from "./persistence";
import { refreshShipDerivedColumns } from "./ships-panel";
import { isEconomyFieldName } from "./snapshot-state";
import { addEditableStation, removeEditableStation, type AddStationDependencies } from "./stations-panel";
import type { MapEditorState } from "./map-editor-state";
import type { EditorSimulationSession } from "./simulation-session";

function applyShipEdit(input: HTMLInputElement, value: number) {
  const ship = allShips.find((shipItem) => shipItem.id === input.dataset.id);
  if (!ship) return;
  if (input.dataset.field === "cargoCapacity") ship.cargoCapacity = value;
  if (input.dataset.field === "speed") ship.speed = value;
}

function applyWareOutputEdit(input: HTMLInputElement, value: number) {
  const ware = allWares.find((wareItem) => wareItem.id === input.dataset.id);
  if (ware && input.dataset.field === "productionOutput") ware.productionOutput = value;
}

function applyWareInputUnitsEdit(input: HTMLInputElement, value: number) {
  const ware = allWares.find((wareItem) => wareItem.id === input.dataset.ware);
  if (!ware) return;
  const wareInput = ware.productionInputs.find((item) => item.wareId === input.dataset.input);
  if (wareInput && input.dataset.field === "unitsPerTick") wareInput.unitsPerTick = value;
}

function applyConfigEdit(input: HTMLInputElement, value: number) {
  const field = input.dataset.field;
  if (isEconomyFieldName(field)) {
    economyConfig[field] = fromDisplayUnit(field, value);
  }
}

function applyEdit(input: HTMLInputElement, value: number) {
  const target = input.dataset.target;
  switch (target) {
    case "ship":
      return applyShipEdit(input, value);
    case "ware-output":
      return applyWareOutputEdit(input, value);
    case "ware-input-units":
      return applyWareInputUnitsEdit(input, value);
    case "config":
      return applyConfigEdit(input, value);
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

function handleSaveButton(dependencies: EditorEventDependencies) {
  if (!dependencies.economyEditingIsEnabled) return;
  saveEconomyToFiles(dependencies.mapState);
}

function handleRevertButton(dependencies: EditorEventDependencies) {
  if (!dependencies.economyEditingIsEnabled) return;
  revertEconomyFiles();
}

function handleRunButton(dependencies: EditorEventDependencies) {
  dependencies.runSimulation();
}

function handleAddStationButton(dependencies: EditorEventDependencies) {
  addEditableStation(dependencies.stationDependencies);
}

function handleRemoveStationButton(target: HTMLElement, dependencies: EditorEventDependencies) {
  const stationIndex = parseInt(target.dataset.stationIndex!, 10);
  if (!isNaN(stationIndex)) removeEditableStation(stationIndex, dependencies.stationDependencies);
}

function handleSaveDraftButton(dependencies: EditorEventDependencies) {
  if (!dependencies.economyEditingIsEnabled) return;
  saveDraft(dependencies.mapState);
}

function handleLoadDraftButton(dependencies: EditorEventDependencies) {
  if (!dependencies.economyEditingIsEnabled) return;
  loadDraft(dependencies.draftDependencies);
}

function handleDeleteDraftButton(dependencies: EditorEventDependencies) {
  if (!dependencies.economyEditingIsEnabled) return;
  deleteDraft();
}

function handleEditorClick(event: Event, dependencies: EditorEventDependencies) {
  const target = event.target as HTMLElement;
  if (target.id === "save-button") return handleSaveButton(dependencies);
  if (target.id === "revert-button") return handleRevertButton(dependencies);
  if (target.id === "run-button") return handleRunButton(dependencies);
  if (target.id === "add-station-button") return handleAddStationButton(dependencies);
  if (target.dataset.action === "remove-station") return handleRemoveStationButton(target, dependencies);
  if (target.id === "save-draft-button") return handleSaveDraftButton(dependencies);
  if (target.id === "load-draft-button") return handleLoadDraftButton(dependencies);
  if (target.id === "delete-draft-button") return handleDeleteDraftButton(dependencies);
}

function handleEditorNumberInput(event: Event, dependencies: EditorEventDependencies) {
  const { mapState, simulationSession, refreshDerivedPanels } = dependencies;
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
}

/** Attaches the editor's input + click event listeners to the root element. */
export function attachEditorEventListeners(dependencies: EditorEventDependencies) {
  dependencies.rootElement.addEventListener("input", (event) => handleEditorNumberInput(event, dependencies));
  dependencies.rootElement.addEventListener("click", (event) => handleEditorClick(event, dependencies));
}
