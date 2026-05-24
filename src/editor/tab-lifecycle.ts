// Tab switching + map editor lifecycle. Owns the mount/sleep/wake/destroy
// of the Phaser scene as the user toggles between map and economy tabs, and
// signals when in-flight edits force a remount on the next visit.

import {
  destroyGameRuntime,
  mountGameRuntime,
  refreshGameRuntimeLayout,
  sleepGameRuntime,
  wakeGameRuntime,
} from "../game-entry";
import { map } from "../../data/map";
import { MapEditorController } from "./map-controller";
import type { MapEditorState } from "./map-editor-state";
import { hasUnsavedEdits } from "./edits-heuristic";
import { getPresetById } from "../util-map-preset";
import { waitForEditorSceneReady } from "./scene-ready";
import type { EditorSimulationSession } from "./simulation-session";

export type EditorTab = "timelapse" | "map" | "economy";

/** Map-editor lifecycle:
 *  - `hidden`   — nothing mounted, tab is not "map".
 *  - `mounting` — async mount in flight; cancellable via tab generation.
 *  - `mounted`  — Phaser scene live and current.
 *  - `stale`    — mounted but editable data changed; next view needs a remount. */
type MapEditorPhase = "hidden" | "mounting" | "mounted" | "stale";

export interface EditorTabLifecycleControls {
  mapEditorView: HTMLElement;
  economyEditorView: HTMLElement;
  timelapseEditorView: HTMLElement;
  editorTabButtons: HTMLButtonElement[];
  mapModeViewButton: HTMLButtonElement;
  mapModeSelectButton: HTMLButtonElement;
  mapModeMoveButton: HTMLButtonElement;
  mapEditorStatusText: HTMLElement;
  /** Hidden in dev (editing enabled); in prod, shows on the map + economy tabs
   *  and hides on timelapse, which is a view-only run no banner can clarify. */
  readonlyBanner: HTMLElement | null;
}

export interface EditorTabLifecycleDependencies {
  controls: EditorTabLifecycleControls;
  mapState: MapEditorState;
  simulationSession: EditorSimulationSession;
  refreshDerivedPanels: () => void;
  rebuildEditorPage: () => void;
  timelapseTab: { activate: () => void; destroy: () => void };
}

export interface EditorTabLifecycle {
  setActiveTab: (nextTab: EditorTab) => void;
  markMapEditorNeedsRemount: () => void;
  switchPreset: (presetId: string) => void;
  updateActiveTabUi: (activeTab: EditorTab) => void;
}

/** Builds the tab lifecycle controller and wires the tab + unload listeners.
 *  The returned object owns map-editor mount state and exposes operations the
 *  entry point invokes (set tab, mark stale, switch preset, destroy). */
export function createEditorTabLifecycle(dependencies: EditorTabLifecycleDependencies): EditorTabLifecycle {
  const { controls, mapState, simulationSession, refreshDerivedPanels, rebuildEditorPage } = dependencies;

  let activeTab: EditorTab = "timelapse";
  let mapEditorPhase: MapEditorPhase = "hidden";
  let tabGeneration = 0;
  let mapEditorController: MapEditorController | null = null;

  function destroyMapEditor() {
    mapEditorController?.destroy();
    mapEditorController = null;
    destroyGameRuntime();
  }

  function markMapEditorNeedsRemount() {
    if (mapEditorPhase === "hidden" || mapEditorPhase === "stale") return;
    // Hidden editor data no longer matches the mounted scene — destroy so the
    // next map visit rebuilds from shared state.
    if (activeTab !== "map" && mapEditorPhase === "mounted") {
      destroyMapEditor();
      mapEditorPhase = "hidden";
      return;
    }
    mapEditorPhase = "stale";
  }

  function updateActiveTabUi(nextTab: EditorTab) {
    const mapActive = nextTab === "map";
    const economyActive = nextTab === "economy";
    const timelapseActive = nextTab === "timelapse";

    controls.mapEditorView.classList.toggle("is-active", mapActive);
    controls.mapEditorView.hidden = !mapActive;

    controls.economyEditorView.classList.toggle("is-active", economyActive);
    controls.economyEditorView.hidden = !economyActive;

    controls.timelapseEditorView.classList.toggle("is-active", timelapseActive);
    controls.timelapseEditorView.hidden = !timelapseActive;

    controls.readonlyBanner?.classList.toggle("is-visible", !timelapseActive);

    for (const button of controls.editorTabButtons) {
      const tab = button.dataset.editorTab as EditorTab | undefined;
      const isActive = tab === nextTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  }

  async function mountMapEditor(generation: number) {
    try {
      mapEditorController?.destroy();
      mapEditorController = null;
      mapEditorPhase = "mounting";
      const runtime = await mountGameRuntime({
        mapData: mapState.currentMap(),
        keyboardShortcutsEnabled: false,
        isEditorMode: true,
      });
      const scene = await waitForEditorSceneReady(runtime.game);
      mapEditorController = new MapEditorController(scene, {
        viewButton: controls.mapModeViewButton,
        selectButton: controls.mapModeSelectButton,
        moveButton: controls.mapModeMoveButton,
        statusText: controls.mapEditorStatusText,
        editableNebulas: mapState.editableNebulas,
      });
      if (generation !== tabGeneration || activeTab !== "map") {
        // Tab switched mid-mount — discard the scene we just built.
        destroyMapEditor();
        mapEditorPhase = "hidden";
        return;
      }
      mapEditorPhase = "mounted";
    } catch (error) {
      console.error("Map editor failed to mount:", error);
      mapEditorPhase = "hidden";
    }
  }

  function refreshVisibleMapEditorLayout() {
    window.requestAnimationFrame(() => {
      refreshGameRuntimeLayout();
      window.requestAnimationFrame(() => {
        refreshGameRuntimeLayout();
        mapEditorController?.updateStatus();
      });
    });
  }

  /** Per-arm teardown for the tab being left. Map sleeps its Phaser game
   *  before its container is hidden (Phaser corrupts internal sizing if it
   *  ever sees a 0×0 container); timelapse releases its scene + cancels the
   *  in-flight sim runner so nothing ticks behind a hidden tab. */
  function tearDownLeavingTab(previousTab: EditorTab) {
    if (previousTab === "map") sleepGameRuntime();
    if (previousTab === "timelapse") dependencies.timelapseTab.destroy();
  }

  /** Returning to economy from map invalidates the previous simulation —
   *  station positions and trade distances may have moved. */
  function enterEconomyTab(previousTab: EditorTab) {
    if (previousTab !== "map") return;
    simulationSession.invalidateResults();
    refreshDerivedPanels();
    simulationSession.markResultsStale();
  }

  /** Owns the map-editor mount/wake dispatch. Hidden mounts fresh; stale
   *  tears the prior mount down first so the remount picks up changed data;
   *  mounting in flight relies on its own generation cancellation; mounted
   *  wakes the existing scene and re-fits the layout. */
  function enterMapTab() {
    switch (mapEditorPhase) {
      case "hidden":
        void mountMapEditor(tabGeneration);
        return;
      case "stale":
        destroyMapEditor();
        void mountMapEditor(tabGeneration);
        return;
      case "mounting":
        return;
      case "mounted":
        wakeGameRuntime();
        refreshVisibleMapEditorLayout();
        return;
    }
  }

  function setActiveTab(nextTab: EditorTab) {
    if (nextTab === activeTab) return;

    const previousTab = activeTab;
    activeTab = nextTab;
    tabGeneration++;

    tearDownLeavingTab(previousTab);
    updateActiveTabUi(nextTab);

    if (nextTab === "economy") return enterEconomyTab(previousTab);
    if (nextTab === "timelapse") return dependencies.timelapseTab.activate();
    enterMapTab();
  }

  /** Switches the active preset, prompting first if there are unsaved station/nebula edits to discard. */
  function switchPreset(presetId: string) {
    if (presetId === mapState.activePreset.id) return;
    const nextPreset = getPresetById(presetId);
    if (!nextPreset) return;
    const unsavedEdits = hasUnsavedEdits(
      mapState.editableStations,
      mapState.baselineMap.stations,
      mapState.editableNebulas,
      map.nebulas,
    );
    if (unsavedEdits && !confirmDiscardingUnsavedEdits(nextPreset.name)) return;
    mapState.switchPreset(presetId);
    simulationSession.clearCaches();
    markMapEditorNeedsRemount();
    rebuildEditorPage();
  }

  function confirmDiscardingUnsavedEdits(nextPresetName: string): boolean {
    return window.confirm(
      `Switching to "${nextPresetName}" will discard any station or nebula edits. Continue?`,
    );
  }

  for (const button of controls.editorTabButtons) {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.editorTab;
      if (nextTab === "map" || nextTab === "economy" || nextTab === "timelapse") {
        setActiveTab(nextTab);
      }
    });
  }

  window.addEventListener("beforeunload", () => {
    destroyMapEditor();
    dependencies.timelapseTab.destroy();
  });

  return {
    setActiveTab,
    markMapEditorNeedsRemount,
    switchPreset,
    updateActiveTabUi,
  };
}
