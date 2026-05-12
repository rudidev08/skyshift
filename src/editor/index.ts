// Editor entry point — assembles top-level state (map, simulation session,
// dependency bags), delegates DOM page assembly, edit dispatch, simulation
// runs, and tab lifecycle to dedicated modules, and kicks off the initial
// mount.

import { presets } from "../../data/map-presets";
import { hubNation, bioNation, oreNation, skyNation, farNation } from "../../data/nations";
import type { Nation } from "../sim-nation";
import { MapEditorState } from "./map-editor-state";
import { EditorSimulationSession } from "./simulation-session";
import { buildEditorPageHtml } from "./page-html";
import { wireEditorEventListeners } from "./input-dispatch";
import { runEditorSimulation } from "./simulation-runner";
import {
  createEditorTabLifecycle,
  type EditorTabLifecycleControls,
} from "./tab-lifecycle";
import { createTimelapseTab } from "./timelapse-tab";
import { refreshDraftList, type DraftDependencies } from "./persistence";
import { highlightChangedInputs } from "./changed-input-highlights";
import {
  renderStationTable,
  type AddStationDependencies,
} from "./stations-panel";
import { renderFleetSummary } from "./fleet-summary";
import { refreshShipDerivedColumns } from "./ships-panel";
import { renderWaresTable, updateUniverseTotals } from "./wares-panel";

const editorRootElement = document.getElementById("app")!;
const tabLifecycleControls: EditorTabLifecycleControls = {
  mapEditorView: document.getElementById("map-editor-view")!,
  economyEditorView: document.getElementById("economy-editor-view")!,
  timelapseEditorView: document.getElementById("timelapse-editor-view")!,
  editorTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-editor-tab]")],
  mapModeViewButton: document.getElementById("map-mode-view") as HTMLButtonElement,
  mapModeSelectButton: document.getElementById("map-mode-select") as HTMLButtonElement,
  mapModeMoveButton: document.getElementById("map-mode-move") as HTMLButtonElement,
  mapEditorStatusText: document.getElementById("map-editor-status-text")!,
};

// Reads/writes go through MapEditorState (not destructured locals) so
// switchPreset can swap preset + editable arrays atomically.
const INITIAL_PRESET_ID = "settled";
const mapState = new MapEditorState(INITIAL_PRESET_ID);

const allPlayableNations: Nation[] = [hubNation, bioNation, oreNation, skyNation, farNation];
const nationById = new Map(allPlayableNations.map(nation => [nation.id, nation]));

const simulationSession = new EditorSimulationSession();
let inputsWired = false;

const economyEditingIsEnabled = import.meta.env.DEV;

function refreshDerivedPanels() {
  updateUniverseTotals(mapState.editableStations);
  renderFleetSummary(mapState, simulationSession, allPlayableNations);
  renderStationTable(mapState, simulationSession, allPlayableNations, applyReadOnlyMode);
  refreshShipDerivedColumns(mapState.editableStations);
  highlightChangedInputs(editorRootElement);
}

function applyReadOnlyMode() {
  if (economyEditingIsEnabled) return;

  const readOnlySelector = [
    "#save-button",
    "#revert-button",
    "#save-draft-button",
    "#load-draft-button",
    "#delete-draft-button",
    "#add-station-button",
    "#add-nation",
    "#add-type",
    "#add-size",
    "button[data-action=\"remove-station\"]",
    "input[data-target]",
  ].join(", ");

  for (const control of editorRootElement.querySelectorAll(readOnlySelector)) {
    if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.disabled = true;
    }
  }
}

const stationDependencies: AddStationDependencies = {
  mapState,
  nationById,
  simulationSession,
  markMapEditorNeedsRemount: () => tabLifecycle.markMapEditorNeedsRemount(),
  refreshDerivedPanels,
};

const draftDependencies: DraftDependencies = {
  mapState,
  simulationSession,
  markMapEditorNeedsRemount: () => tabLifecycle.markMapEditorNeedsRemount(),
  buildPage: () => buildEditorPage(),
};

const timelapseTab = createTimelapseTab();

const tabLifecycle = createEditorTabLifecycle({
  controls: tabLifecycleControls,
  mapState,
  simulationSession,
  refreshDerivedPanels,
  rebuildEditorPage: () => buildEditorPage(),
  timelapseTab,
});

function buildEditorPage() {
  editorRootElement.innerHTML = buildEditorPageHtml(mapState.editableStations, economyEditingIsEnabled);
  renderWaresTable(applyReadOnlyMode);
  renderFleetSummary(mapState, simulationSession, allPlayableNations);
  renderStationTable(mapState, simulationSession, allPlayableNations, applyReadOnlyMode);
  updateUniverseTotals(mapState.editableStations);
  refreshShipDerivedColumns(mapState.editableStations);
  highlightChangedInputs(editorRootElement);
  if (!inputsWired) {
    wireEditorEventListeners({
      rootElement: editorRootElement,
      mapState,
      simulationSession,
      stationDependencies,
      draftDependencies,
      economyEditingIsEnabled,
      refreshDerivedPanels,
      runSimulation: () => runEditorSimulation({
        mapState,
        simulationSession,
        allPlayableNations,
        applyReadOnlyMode,
      }),
    });
    inputsWired = true;
  }
  if (economyEditingIsEnabled) refreshDraftList();
  applyReadOnlyMode();
}

function wirePresetPicker() {
  const select = document.querySelector<HTMLSelectElement>('[data-role="preset-picker"]');
  if (!select) return;
  // Populated from the registry so adding a new preset doesn't require
  // editing tools.html. "blank" is a first-class editor option — starts
  // with zero stations so authors can build up from scratch.
  select.innerHTML = "";
  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    if (preset.id === mapState.activePreset.id) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    tabLifecycle.switchPreset(select.value);
    // Sync the select back — switchPreset bails on confirm-reject.
    select.value = mapState.activePreset.id;
  });
}

function initializeEditor() {
  if (!economyEditingIsEnabled) {
    document.getElementById("readonly-banner")?.classList.add("is-visible");
  }
  wirePresetPicker();
  buildEditorPage();
  // Timelapse is the default landing tab; map editor mounts lazily on first
  // navigation to it via tab-lifecycle's setActiveTab.
  tabLifecycle.updateActiveTabUi("timelapse");
  timelapseTab.activate();
}

initializeEditor();
