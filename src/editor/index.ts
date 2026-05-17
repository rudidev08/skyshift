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
import { attachEditorEventListeners } from "./input-dispatch";
import { runEditorSimulation } from "./simulation-runner";
import { createEditorTabLifecycle, type EditorTabLifecycleControls } from "./tab-lifecycle";
import { createTimelapseTab } from "./timelapse-tab";
import { refreshDraftList, type DraftDependencies } from "./persistence";
import { highlightChangedInputs } from "./changed-input-highlights";
import { renderStationTable, type AddStationDependencies } from "./stations-panel";
import { renderFleetSummary } from "./fleet-summary";
import { refreshShipDerivedColumns } from "./ships-panel";
import { renderWaresTable, updateUniverseTotals } from "./wares-panel";

const editorRootElement = document.getElementById("app")!;
const economyEditingIsEnabled = import.meta.env.DEV;

function queryEditorDomControls(): EditorTabLifecycleControls {
  return {
    mapEditorView: document.getElementById("map-editor-view")!,
    economyEditorView: document.getElementById("economy-editor-view")!,
    timelapseEditorView: document.getElementById("timelapse-editor-view")!,
    editorTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-editor-tab]")],
    mapModeViewButton: document.getElementById("map-mode-view") as HTMLButtonElement,
    mapModeSelectButton: document.getElementById("map-mode-select") as HTMLButtonElement,
    mapModeMoveButton: document.getElementById("map-mode-move") as HTMLButtonElement,
    mapEditorStatusText: document.getElementById("map-editor-status-text")!,
    readonlyBanner: economyEditingIsEnabled ? null : document.getElementById("readonly-banner"),
  };
}
const tabLifecycleControls = queryEditorDomControls();

const INITIAL_PRESET_ID = "settled";
const mapState = new MapEditorState(INITIAL_PRESET_ID);

const allPlayableNations: Nation[] = [hubNation, bioNation, oreNation, skyNation, farNation];
const nationById = new Map(allPlayableNations.map((nation) => [nation.id, nation]));

const simulationSession = new EditorSimulationSession();
let inputListenersWired = false;

function refreshDerivedPanels() {
  updateUniverseTotals(mapState.editableStations);
  renderFleetSummary(mapState, simulationSession, allPlayableNations);
  renderStationTable(mapState, simulationSession, allPlayableNations, applyReadOnlyMode);
  refreshShipDerivedColumns(mapState.editableStations);
  highlightChangedInputs(editorRootElement);
}

function disableReadOnlyControls(rootElement: HTMLElement) {
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
    'button[data-action="remove-station"]',
    "input[data-target]",
  ].join(", ");

  for (const control of rootElement.querySelectorAll(readOnlySelector)) {
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement
    ) {
      control.disabled = true;
    }
  }
}

function applyReadOnlyMode() {
  if (economyEditingIsEnabled) return;
  disableReadOnlyControls(editorRootElement);
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
  rebuildEditorPage: () => buildEditorPage(),
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

function renderEditorPagePanels() {
  editorRootElement.innerHTML = buildEditorPageHtml(mapState.editableStations);
  renderWaresTable(applyReadOnlyMode);
  renderFleetSummary(mapState, simulationSession, allPlayableNations);
  renderStationTable(mapState, simulationSession, allPlayableNations, applyReadOnlyMode);
  updateUniverseTotals(mapState.editableStations);
  refreshShipDerivedColumns(mapState.editableStations);
  highlightChangedInputs(editorRootElement);
}

function wireEditorInputListenersOnce() {
  if (inputListenersWired) return;
  attachEditorEventListeners({
    rootElement: editorRootElement,
    mapState,
    simulationSession,
    stationDependencies,
    draftDependencies,
    economyEditingIsEnabled,
    refreshDerivedPanels,
    runSimulation: () =>
      runEditorSimulation({
        mapState,
        simulationSession,
        allPlayableNations,
        applyReadOnlyMode,
      }),
  });
  inputListenersWired = true;
}

function buildEditorPage() {
  renderEditorPagePanels();
  wireEditorInputListenersOnce();
  if (economyEditingIsEnabled) refreshDraftList();
  applyReadOnlyMode();
}

function wirePresetPicker() {
  const select = document.querySelector<HTMLSelectElement>('[data-role="preset-picker"]');
  if (!select) return;
  // Populated from the registry so adding a new preset doesn't require
  // editing tools.html.
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
  wirePresetPicker();
  buildEditorPage();
  // Timelapse is the default landing tab; map editor mounts lazily on first
  // navigation to it via tab-lifecycle's setActiveTab.
  tabLifecycle.updateActiveTabUi("timelapse");
  timelapseTab.activate();
}

initializeEditor();
