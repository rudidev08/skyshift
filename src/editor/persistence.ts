// Two persistence paths: commit edits to source files (save/revert) and named
// draft snapshots so editors don't lose tuning across reloads or preset switches.

import { allShips } from "../../data/ships";
import { allWares } from "../../data/wares";
import { economyConfig } from "../../data/economy-config";
import { baselineShips, baselineWares, baselineEconomyConfig, type EconomyFieldName } from "./snapshot-state";
import type { MapEditorState } from "./map-editor-state";
import type { EditorSimulationSession } from "./simulation-session";

interface DraftSnapshot {
  config: Record<EconomyFieldName, number>;
  ships: { id: string; cargoCapacity: number; speed: number }[];
  wares: { id: string; productionOutput: number }[];
  wareInputs: { wareId: string; inputWareId: string; unitsPerTick: number }[];
  removedStationIds: string[];
}

interface EconomyFilesPayload {
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

function buildEconomyFilesPayload(mapState: MapEditorState): EconomyFilesPayload {
  const payload: EconomyFilesPayload = {
    config: [],
    ships: [],
    wares: [],
    wareInputs: [],
    removedStationIds: [],
  };
  collectConfigDeltas(payload);
  collectShipDeltas(payload);
  collectWareDeltas(payload);
  collectRemovedStationIds(payload, mapState);
  return payload;
}

function collectConfigDeltas(payload: EconomyFilesPayload): void {
  for (const field of Object.keys(baselineEconomyConfig) as EconomyFieldName[]) {
    const baselineValue = baselineEconomyConfig[field];
    if (economyConfig[field] !== baselineValue) {
      payload.config.push({ field, value: economyConfig[field] });
    }
  }
}

function collectShipDeltas(payload: EconomyFilesPayload): void {
  for (const ship of allShips) {
    const baseline = baselineShips.find((baselineShip) => baselineShip.id === ship.id);
    if (!baseline) continue;
    if (ship.cargoCapacity !== baseline.cargoCapacity || ship.speed !== baseline.speed)
      payload.ships.push({ id: ship.id, cargoCapacity: ship.cargoCapacity, speed: ship.speed });
  }
}

function collectWareDeltas(payload: EconomyFilesPayload): void {
  for (const ware of allWares) {
    const baseline = baselineWares.find((baselineWare) => baselineWare.id === ware.id);
    if (!baseline) continue;
    if (ware.productionOutput !== baseline.productionOutput)
      payload.wares.push({ id: ware.id, productionOutput: ware.productionOutput });
    for (const input of ware.productionInputs) {
      const baselineInput = baseline.productionInputs.find((item) => item.wareId === input.wareId);
      if (baselineInput && input.unitsPerTick !== baselineInput.unitsPerTick)
        payload.wareInputs.push({
          wareId: ware.id,
          inputWareId: input.wareId,
          unitsPerTick: input.unitsPerTick,
        });
    }
  }
}

function collectRemovedStationIds(payload: EconomyFilesPayload, mapState: MapEditorState): void {
  const currentStationIds = new Set(mapState.editableStations.map((station) => station.id));
  for (const station of mapState.baselineMap.stations) {
    if (!currentStationIds.has(station.id)) payload.removedStationIds.push(station.id);
  }
}

function hasAnyChanges(payload: EconomyFilesPayload): boolean {
  return (
    payload.config.length > 0 ||
    payload.ships.length > 0 ||
    payload.wares.length > 0 ||
    payload.wareInputs.length > 0 ||
    payload.removedStationIds.length > 0
  );
}

function flashButtonStatus(button: HTMLElement, message: string, options: ButtonRestoreOptions): void {
  button.textContent = message;
  setTimeout(() => {
    button.textContent = options.restoreLabel;
  }, options.restoreAfterMs);
}

interface PostEconomyApiOptions {
  endpoint: string;
  body: unknown;
  button: HTMLElement;
  labels: {
    progress?: string;
    restore: string;
    success?: string;
    errorPrefix: string;
  };
  onSuccess?: () => void;
}

async function postEconomyApi(options: PostEconomyApiOptions): Promise<void> {
  const { endpoint, body, button, labels, onSuccess } = options;
  if (labels.progress) button.textContent = labels.progress;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (result.success) {
      onSuccess?.();
      if (labels.success)
        flashButtonStatus(button, labels.success, {
          restoreLabel: labels.restore,
          restoreAfterMs: 1500,
        });
    } else {
      alert(`${labels.errorPrefix}: ${result.error}`);
      flashButtonStatus(button, "Error!", { restoreLabel: labels.restore, restoreAfterMs: 2000 });
    }
  } catch (error) {
    alert(`${labels.errorPrefix}: ${error}`);
    flashButtonStatus(button, "Error!", { restoreLabel: labels.restore, restoreAfterMs: 2000 });
  }
}

export async function saveEconomyToFiles(mapState: MapEditorState) {
  const button = document.getElementById("save-button")!;
  const payload = buildEconomyFilesPayload(mapState);

  if (!hasAnyChanges(payload)) {
    flashButtonStatus(button, "No changes", { restoreLabel: "Save", restoreAfterMs: 1500 });
    return;
  }

  await postEconomyApi({
    endpoint: "/api/economy/save",
    body: payload,
    button,
    labels: {
      progress: "Saving...",
      restore: "Save",
      success: "Saved!",
      errorPrefix: "Save failed",
    },
  });
}

export async function revertEconomyFiles() {
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

function buildDraftSnapshot(mapState: MapEditorState): DraftSnapshot {
  const config = {} as Record<EconomyFieldName, number>;
  for (const field of Object.keys(baselineEconomyConfig) as EconomyFieldName[]) {
    config[field] = economyConfig[field];
  }

  const ships = allShips.map((ship) => ({
    id: ship.id,
    cargoCapacity: ship.cargoCapacity,
    speed: ship.speed,
  }));

  const wares = allWares.map((ware) => ({
    id: ware.id,
    productionOutput: ware.productionOutput,
  }));

  const wareInputs: DraftSnapshot["wareInputs"] = [];
  for (const ware of allWares) {
    for (const input of ware.productionInputs) {
      wareInputs.push({
        wareId: ware.id,
        inputWareId: input.wareId,
        unitsPerTick: input.unitsPerTick,
      });
    }
  }

  const currentIds = new Set(mapState.editableStations.map((station) => station.id));
  const removedStationIds = mapState.baselineMap.stations
    .filter((station) => !currentIds.has(station.id))
    .map((station) => station.id);

  return { config, ships, wares, wareInputs, removedStationIds };
}

export interface DraftDependencies {
  mapState: MapEditorState;
  simulationSession: EditorSimulationSession;
  markMapEditorNeedsRemount: () => void;
  rebuildEditorPage: () => void;
}

/** Draft snapshots only carry which baseline stations were removed, so custom stations added via the stations panel are lost on load. */
function resetEditableStationsToBaseline(mapState: MapEditorState, removedStationIds: string[]): void {
  mapState.editableStations.length = 0;
  for (const station of mapState.baselineMap.stations) {
    if (!removedStationIds.includes(station.id)) mapState.editableStations.push(station);
  }
}

function applyDraftSnapshot(snapshot: DraftSnapshot, dependencies: DraftDependencies) {
  restoreConfig(snapshot.config);
  restoreShips(snapshot.ships);
  restoreWares(snapshot.wares);
  restoreWareInputs(snapshot.wareInputs);
  resetEditableStationsToBaseline(dependencies.mapState, snapshot.removedStationIds);

  dependencies.markMapEditorNeedsRemount();
  dependencies.simulationSession.clearCaches();
  dependencies.rebuildEditorPage();
}

function restoreConfig(config: DraftSnapshot["config"]): void {
  for (const field of Object.keys(config) as EconomyFieldName[]) {
    economyConfig[field] = config[field];
  }
}

function restoreShips(ships: DraftSnapshot["ships"]): void {
  for (const savedShip of ships) {
    const ship = allShips.find((shipItem) => shipItem.id === savedShip.id);
    if (!ship) continue;
    ship.cargoCapacity = savedShip.cargoCapacity;
    ship.speed = savedShip.speed;
  }
}

function restoreWares(wares: DraftSnapshot["wares"]): void {
  for (const savedWare of wares) {
    const ware = allWares.find((wareItem) => wareItem.id === savedWare.id);
    if (!ware) continue;
    ware.productionOutput = savedWare.productionOutput;
  }
}

function restoreWareInputs(wareInputs: DraftSnapshot["wareInputs"]): void {
  for (const savedInput of wareInputs) {
    const ware = allWares.find((wareItem) => wareItem.id === savedInput.wareId);
    if (!ware) continue;
    const input = ware.productionInputs.find((item) => item.wareId === savedInput.inputWareId);
    if (!input) continue;
    input.unitsPerTick = savedInput.unitsPerTick;
  }
}

export async function saveDraft(mapState: MapEditorState) {
  const button = document.getElementById("save-draft-button")!;
  const name = prompt("Draft name:");
  if (!name || !name.trim()) return;

  const safeName = name
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .substring(0, 64);
  if (!safeName) {
    alert("Invalid draft name");
    return;
  }

  await postEconomyApi({
    endpoint: "/api/economy/drafts/save",
    body: { name: safeName, snapshot: buildDraftSnapshot(mapState) },
    button,
    labels: {
      progress: "Saving...",
      restore: "Save Draft",
      success: "Saved!",
      errorPrefix: "Draft save failed",
    },
    onSuccess: refreshDraftList,
  });
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

  await postEconomyApi({
    endpoint: "/api/economy/drafts/delete",
    body: { name },
    button: document.getElementById("delete-draft-button")!,
    labels: { restore: "Delete Draft", errorPrefix: "Delete failed" },
    onSuccess: refreshDraftList,
  });
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
    if (previousValue && [...select.options].some((option) => option.value === previousValue)) {
      select.value = previousValue;
    }
  } catch {
    // Draft list is non-critical
  }
}
