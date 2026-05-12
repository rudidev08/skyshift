// Save / revert to files and in-memory draft snapshots that authors can save,
// list, load, and delete without losing tuning across reloads.

import { allShips } from "../../data/ships";
import { allWares } from "../../data/wares";
import { economyConfig } from "../../data/economy-config";
import {
  baselineShips,
  baselineWares,
  baselineConfigValues,
  type EconomyFieldName,
} from "./snapshot-state";
import type { MapEditorState } from "./map-editor-state";
import type { EditorSimulationSession } from "./simulation-session";

interface DraftSnapshot {
  config: Record<EconomyFieldName, number>;
  ships: { id: string; cargoCapacity: number; speed: number }[];
  wares: { id: string; productionOutput: number }[];
  wareInputs: { wareId: string; inputWareId: string; unitsPerTick: number }[];
  removedStationIds: string[];
}

interface SavePayload {
  config: { field: string; value: number }[];
  ships: { id: string; cargoCapacity: number; speed: number }[];
  wares: { id: string; productionOutput: number }[];
  wareInputs: { wareId: string; inputWareId: string; unitsPerTick: number }[];
  removedStationIds: string[];
}

interface ButtonRestoreOptions {
  restoreLabel: string;
  restoreAfterMs: number;
}

function buildSavePayload(mapState: MapEditorState): SavePayload {
  const payload: SavePayload = {
    config: [],
    ships: [],
    wares: [],
    wareInputs: [],
    removedStationIds: [],
  };

  for (const field of Object.keys(baselineConfigValues) as EconomyFieldName[]) {
    const baselineValue = baselineConfigValues[field];
    if (economyConfig[field] !== baselineValue) {
      payload.config.push({ field, value: economyConfig[field] });
    }
  }

  for (const ship of allShips) {
    const baseline = baselineShips.find(baselineShip => baselineShip.id === ship.id);
    if (!baseline) continue;
    if (ship.cargoCapacity !== baseline.cargoCapacity || ship.speed !== baseline.speed)
      payload.ships.push({ id: ship.id, cargoCapacity: ship.cargoCapacity, speed: ship.speed });
  }

  for (const ware of allWares) {
    const baseline = baselineWares.find(baselineWare => baselineWare.id === ware.id);
    if (!baseline) continue;
    if (ware.productionOutput !== baseline.productionOutput)
      payload.wares.push({ id: ware.id, productionOutput: ware.productionOutput });
    for (const input of ware.productionInputs) {
      const baselineInput = baseline.productionInputs.find(item => item.wareId === input.wareId);
      if (baselineInput && input.unitsPerTick !== baselineInput.unitsPerTick)
        payload.wareInputs.push({ wareId: ware.id, inputWareId: input.wareId, unitsPerTick: input.unitsPerTick });
    }
  }

  const currentStationIds = new Set(mapState.editableStations.map(station => station.id));
  for (const station of mapState.baselineMap.stations) {
    if (!currentStationIds.has(station.id))
      payload.removedStationIds.push(station.id);
  }

  return payload;
}

function hasAnyChanges(payload: SavePayload): boolean {
  return payload.config.length > 0 || payload.ships.length > 0 || payload.wares.length > 0 ||
    payload.wareInputs.length > 0 || payload.removedStationIds.length > 0;
}

function flashButtonStatus(button: HTMLElement, message: string, options: ButtonRestoreOptions): void {
  button.textContent = message;
  setTimeout(() => { button.textContent = options.restoreLabel; }, options.restoreAfterMs);
}

export async function saveToFiles(mapState: MapEditorState) {
  const button = document.getElementById("save-button")!;
  const payload = buildSavePayload(mapState);

  if (!hasAnyChanges(payload)) {
    flashButtonStatus(button, "No changes", { restoreLabel: "Save", restoreAfterMs: 1500 });
    return;
  }

  button.textContent = "Saving...";
  try {
    const response = await fetch("/api/economy/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (result.success) {
      flashButtonStatus(button, "Saved!", { restoreLabel: "Save", restoreAfterMs: 1500 });
    } else {
      alert(`Save failed: ${result.error}`);
      flashButtonStatus(button, "Error!", { restoreLabel: "Save", restoreAfterMs: 2000 });
    }
  } catch (error) {
    alert(`Save failed: ${error}`);
    flashButtonStatus(button, "Error!", { restoreLabel: "Save", restoreAfterMs: 2000 });
  }
}

export async function revertFiles() {
  if (!confirm("Revert all economy data to the last backup?")) return;
  try {
    const response = await fetch("/api/economy/revert", { method: "POST" });
    const result = await response.json();
    if (result.success) {
      window.location.reload();
    } else {
      alert(`Revert failed: ${result.error}`);
    }
  } catch (error) {
    alert(`Revert failed: ${error}`);
  }
}

// Save / load work-in-progress snapshots so authors don't lose tuning when
// they reload or switch presets.

function buildDraftSnapshot(mapState: MapEditorState): DraftSnapshot {
  const config = {} as Record<EconomyFieldName, number>;
  for (const field of Object.keys(baselineConfigValues) as EconomyFieldName[]) {
    config[field] = economyConfig[field];
  }

  const ships = allShips.map(ship => ({ id: ship.id, cargoCapacity: ship.cargoCapacity, speed: ship.speed }));

  const wares = allWares.map(ware => ({
    id: ware.id,
    productionOutput: ware.productionOutput,
  }));

  const wareInputs: DraftSnapshot["wareInputs"] = [];
  for (const ware of allWares) {
    for (const input of ware.productionInputs) {
      wareInputs.push({ wareId: ware.id, inputWareId: input.wareId, unitsPerTick: input.unitsPerTick });
    }
  }

  const currentIds = new Set(mapState.editableStations.map(station => station.id));
  const removedStationIds = mapState.baselineMap.stations.filter(station => !currentIds.has(station.id)).map(station => station.id);

  return { config, ships, wares, wareInputs, removedStationIds };
}

export interface DraftDependencies {
  mapState: MapEditorState;
  simulationSession: EditorSimulationSession;
  markMapEditorNeedsRemount: () => void;
  buildPage: () => void;
}

/** Drafts only restore persisted map edits — temporary editor-only stations are simulation-scratch and are discarded on load. */
function restoreEditableStationsFromBaseline(mapState: MapEditorState, removedStationIds: string[]): void {
  mapState.editableStations.length = 0;
  for (const station of mapState.baselineMap.stations) {
    if (!removedStationIds.includes(station.id)) mapState.editableStations.push(station);
  }
}

function applyDraftSnapshot(snapshot: DraftSnapshot, dependencies: DraftDependencies) {
  for (const field of Object.keys(snapshot.config) as EconomyFieldName[]) {
    economyConfig[field] = snapshot.config[field];
  }

  for (const savedShip of snapshot.ships) {
    const ship = allShips.find(shipItem => shipItem.id === savedShip.id);
    if (ship) {
      ship.cargoCapacity = savedShip.cargoCapacity;
      ship.speed = savedShip.speed;
    }
  }

  for (const savedWare of snapshot.wares) {
    const ware = allWares.find(wareItem => wareItem.id === savedWare.id);
    if (ware) {
      ware.productionOutput = savedWare.productionOutput;
    }
  }

  for (const savedInput of snapshot.wareInputs) {
    const ware = allWares.find(wareItem => wareItem.id === savedInput.wareId);
    if (ware) {
      const input = ware.productionInputs.find(item => item.wareId === savedInput.inputWareId);
      if (input) {
        input.unitsPerTick = savedInput.unitsPerTick;
      }
    }
  }

  restoreEditableStationsFromBaseline(dependencies.mapState, snapshot.removedStationIds);

  dependencies.markMapEditorNeedsRemount();
  dependencies.simulationSession.clearCaches();
  dependencies.buildPage();
}

export async function saveDraft(mapState: MapEditorState) {
  const button = document.getElementById("save-draft-button")!;
  const name = prompt("Draft name:");
  if (!name || !name.trim()) return;

  const safeName = name.trim().replace(/[^a-zA-Z0-9 _-]/g, "").substring(0, 64);
  if (!safeName) {
    alert("Invalid draft name");
    return;
  }

  button.textContent = "Saving...";
  try {
    const snapshot = buildDraftSnapshot(mapState);
    const response = await fetch("/api/economy/drafts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: safeName, snapshot }),
    });
    const result = await response.json();
    if (result.success) {
      refreshDraftList();
      flashButtonStatus(button, "Saved!", { restoreLabel: "Save Draft", restoreAfterMs: 1500 });
    } else {
      alert(`Draft save failed: ${result.error}`);
      flashButtonStatus(button, "Error!", { restoreLabel: "Save Draft", restoreAfterMs: 2000 });
    }
  } catch (error) {
    alert(`Draft save failed: ${error}`);
    flashButtonStatus(button, "Error!", { restoreLabel: "Save Draft", restoreAfterMs: 2000 });
  }
}

export async function loadDraft(dependencies: DraftDependencies) {
  const select = document.getElementById("draft-select") as HTMLSelectElement;
  const name = select.value;
  if (!name) return;

  try {
    const response = await fetch("/api/economy/drafts/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (result.snapshot) {
      applyDraftSnapshot(result.snapshot, dependencies);
    } else {
      alert(`Load failed: ${result.error ?? "Unknown error"}`);
    }
  } catch (error) {
    alert(`Load failed: ${error}`);
  }
}

export async function deleteDraft() {
  const select = document.getElementById("draft-select") as HTMLSelectElement;
  const name = select.value;
  if (!name) return;
  if (!confirm(`Delete draft "${name}"?`)) return;

  try {
    const response = await fetch("/api/economy/drafts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (result.success) {
      refreshDraftList();
    } else {
      alert(`Delete failed: ${result.error}`);
    }
  } catch (error) {
    alert(`Delete failed: ${error}`);
  }
}

export async function refreshDraftList() {
  const select = document.getElementById("draft-select") as HTMLSelectElement;
  if (!select) return;

  try {
    const response = await fetch("/api/economy/drafts/list");
    const result = await response.json();
    const previousValue = select.value;
    const drafts: string[] = result.drafts ?? [];
    const placeholderLabel = drafts.length === 0 ? "— no drafts —" : "— drafts —";
    select.innerHTML = `<option value="">${placeholderLabel}</option>`;
    for (const draft of drafts) {
      const option = document.createElement("option");
      option.value = draft;
      option.textContent = draft;
      select.appendChild(option);
    }
    if (previousValue && [...select.options].some(option => option.value === previousValue)) {
      select.value = previousValue;
    }
  } catch {
    // Draft list is non-critical
  }
}
