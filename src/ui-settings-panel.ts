import {
  saveToManualSlot, loadFromSlot, exportToFile, importFromFile,
  type ValidationResult,
} from "./ui-savegame-manager";
import { type GameSnapshot } from "./sim-save-types";
import type { Game } from "./game";
import { X, Volume2, VolumeX } from "lucide-static";
import { morseBarGradient } from "./render-morse-bar";
import { enableAudio, disableAudio, isAudioEnabled } from "./audio-announcer";
import { saveKeyValueSetting } from "./storage-preferences";
import type { GridMode } from "./phaser/sector-grid";
import { acquireScopedPause } from "./phaser/auto-release-pause";
import { shieldDomSurfaceFromPhaserInput, type BindEventFunction } from "./ui-dom-input-shield";
import { showToast } from "./ui-toast";
import { SlotSelector, type SlotInfo } from "./ui-slot-selector";

export interface SettingsHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Safe to call more than once. */
  dispose(): void;
  /** Stop pointer/wheel events inside the panel from leaking into Phaser.
   *  Caller-owned bindEvent pairs each listener with the caller's cleanup. */
  shieldFromPhaserInput(bindEvent: BindEventFunction): void;
}

export function createSettingsPanel(
  getScene: () => Game | null,
  remountWithSnapshot: (snapshot: GameSnapshot) => void,
): SettingsHandle {
  const overlay = buildSettingsOverlay();

  // Auto-pause while open; the release fn resumes on close (does nothing if we
  // weren't the one who paused).
  let releasePause: (() => void) | null = null;

  const close = () => {
    slotSelector.clear();
    overlay.classList.add("hidden");
    releasePause?.();
    releasePause = null;
  };

  const handleValidation = (result: ValidationResult) => {
    if (!result.ok) { showToast(result.message); return; }
    close();
    try {
      remountWithSnapshot(result.snapshot);
    } catch (error) {
      // Load failed after close — reopen (re-pauses) so the user sees the
      // error toast and can try another slot.
      open();
      showToast(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  wireOverlayDismiss(overlay, close);
  const { slotSelector, refreshSlots } = setupSlotControls({ overlay, getScene, handleValidation });
  setupAudioControls(overlay);
  const { refreshGridModeButtons, readSceneGridMode } = setupGridControls(overlay, getScene);
  setupImportExportControls({ overlay, getScene, handleValidation });

  const open = () => {
    overlay.classList.remove("hidden");
    if (!releasePause) releasePause = acquireScopedPause();
    refreshSlots();
    refreshGridModeButtons(readSceneGridMode(getScene()));
  };

  const isOpen = () => !overlay.classList.contains("hidden");

  document.body.appendChild(overlay);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    close();
    overlay.remove();
  };

  const shieldFromPhaserInput = (bindEvent: BindEventFunction) => {
    shieldDomSurfaceFromPhaserInput(bindEvent, overlay);
  };

  return {
    open,
    close,
    isOpen,
    dispose,
    shieldFromPhaserInput,
  };
}

function buildSettingsOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay hidden";
  overlay.innerHTML = `
    <div class="settings-modal id-card">
      <div class="settings-head">
        <span>Settings</span>
        <button class="settings-close hud-btn hud-btn-icon" aria-label="Close"></button>
      </div>
      <div class="settings-section">
        <h3>» View</h3>
        <div class="settings-row">
          <span class="settings-row-label">Show sector grid</span>
          <div class="hud-segment" data-role="grid-mode">
            <button class="hud-btn" data-grid-mode="auto">Scrolling</button>
            <button class="hud-btn" data-grid-mode="on">Always</button>
            <button class="hud-btn" data-grid-mode="off">Never</button>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <h3>» Audio</h3>
        <div class="settings-row">
          <span class="settings-row-label">Announce station and ship names</span>
          <button class="hud-btn" data-role="audio-toggle" aria-pressed="false"></button>
        </div>
      </div>
      <div class="settings-section">
        <h3>» Browser Savegame</h3>
        <div class="slot-list" data-role="slot-list"></div>
        <div class="slot-action-bar" data-role="slot-action-bar"></div>
      </div>
      <div class="settings-section">
        <h3>» File Savegame</h3>
        <div class="settings-actions">
          <button class="hud-btn" data-action="export">Download</button>
          <button class="hud-btn" data-action="import">Restore</button>
        </div>
      </div>
    </div>
  `;

  const modal = overlay.querySelector<HTMLElement>(".settings-modal")!;
  modal.style.setProperty("--morse-bar", morseBarGradient("Settings", { letterCount: 8, color: "var(--paper-mute)" }));
  overlay.querySelector<HTMLElement>(".settings-close")!.innerHTML = X;

  return overlay;
}

function wireOverlayDismiss(overlay: HTMLElement, close: () => void): void {
  overlay.querySelector(".settings-close")!.addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
}

interface SlotControlsDependencies {
  overlay: HTMLElement;
  getScene: () => Game | null;
  handleValidation: (result: ValidationResult) => void;
}

function setupSlotControls(dependencies: SlotControlsDependencies): {
  slotSelector: SlotSelector;
  refreshSlots: () => void;
} {
  const { overlay, getScene, handleValidation } = dependencies;
  const slotSelector = new SlotSelector({
    slotList: overlay.querySelector<HTMLElement>('[data-role="slot-list"]')!,
    actionBar: overlay.querySelector<HTMLElement>('[data-role="slot-action-bar"]')!,
    onSave(slot: SlotInfo) {
      const scene = getScene();
      if (!scene) { showToast("Game not ready."); return; }
      try {
        saveToManualSlot(scene, slot.index);
        slotSelector.refresh();
        showToast("Saved.", { ok: true });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Save failed.");
      }
    },
    onLoad(slot: SlotInfo) {
      return loadFromSlot(slot.kind, slot.index);
    },
    onLoadResult: handleValidation,
  });
  return { slotSelector, refreshSlots: () => slotSelector.refresh() };
}

function setupAudioControls(overlay: HTMLElement): void {
  const audioButton = overlay.querySelector<HTMLButtonElement>('[data-role="audio-toggle"]')!;
  const refreshAudioButton = () => {
    const enabled = isAudioEnabled();
    audioButton.innerHTML = `${enabled ? Volume2 : VolumeX}<span>${enabled ? "On" : "Off"}</span>`;
    audioButton.classList.toggle("is-on", enabled);
    audioButton.setAttribute("aria-pressed", String(enabled));
  };
  audioButton.addEventListener("click", () => {
    const next = !isAudioEnabled();
    if (next) enableAudio();
    else disableAudio();
    saveKeyValueSetting("audioEnabled", String(next));
    refreshAudioButton();
  });
  refreshAudioButton();
}

function setupGridControls(overlay: HTMLElement, getScene: () => Game | null): {
  refreshGridModeButtons: (mode: GridMode | null) => void;
  readSceneGridMode: (scene: Game | null) => GridMode | null;
} {
  // Scene's sector-grid is the source of truth; mirror its mode into is-on
  // classes on open and after clicks.
  const gridModeSegment = overlay.querySelector<HTMLElement>('[data-role="grid-mode"]')!;
  const gridModeButtons = gridModeSegment.querySelectorAll<HTMLButtonElement>("button[data-grid-mode]");
  // gridSystem is assigned in Game.create(); getScene() can return the scene
  // before create() finishes, so guard the read.
  const readSceneGridMode = (scene: Game | null): GridMode | null =>
    scene?.gridSystem?.gridMode ?? null;
  const refreshGridModeButtons = (mode: GridMode | null) => {
    for (const button of gridModeButtons) {
      button.classList.toggle("is-on", mode !== null && button.dataset.gridMode === mode);
    }
  };
  for (const button of gridModeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.gridMode as GridMode | undefined;
      if (!mode) return;
      const scene = getScene();
      if (!scene || readSceneGridMode(scene) === null) return;
      scene.setSectorGridMode(mode);
      refreshGridModeButtons(readSceneGridMode(scene));
    });
  }
  return { refreshGridModeButtons, readSceneGridMode };
}

interface ImportExportDependencies {
  overlay: HTMLElement;
  getScene: () => Game | null;
  handleValidation: (result: ValidationResult) => void;
}

function setupImportExportControls(dependencies: ImportExportDependencies): void {
  const { overlay, getScene, handleValidation } = dependencies;
  overlay.querySelector('[data-action="export"]')!.addEventListener("click", () => {
    const scene = getScene();
    if (!scene) { showToast("Game not ready."); return; }
    exportToFile(scene);
    showToast("Exported.", { ok: true });
  });

  overlay.querySelector('[data-action="import"]')!.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const result = await importFromFile(file);
      handleValidation(result);
    });
    input.click();
  });
}
