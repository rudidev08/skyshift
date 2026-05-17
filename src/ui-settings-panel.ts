import {
  saveToManualSlot,
  readSlot,
  exportToFile,
  readFile,
  type ValidationResult,
} from "./ui-savegame-manager";
import { type GameSnapshot } from "./sim-save-types";
import type { Game } from "./game";
import { X, Volume2, VolumeX } from "lucide-static";
import { morseBarGradient } from "./render-morse-bar";
import { enableAudio, disableAudio, isAudioEnabled } from "./audio-announcer";
import { savePreference } from "./storage-preferences";
import type { GridMode } from "./phaser/sector-grid";
import { acquireScopedPause } from "./phaser/auto-release-pause";
import { shieldDomSurfaceFromPhaserInput, type BindEventWithCleanupFunction } from "./ui-dom-input-shield";
import { showToast } from "./ui-toast";
import { SlotSelector } from "./ui-slot-selector";
import { type SlotSummary } from "./storage-save-slots";

export interface SettingsHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Safe to call more than once. */
  dispose(): void;
  /** Stop pointer/wheel events inside the panel from leaking into Phaser.
   *  Caller-owned bindEventWithCleanup pairs each listener with the caller's cleanup. */
  shieldFromPhaserInput(bindEventWithCleanup: BindEventWithCleanupFunction): void;
}

export function createSettingsPanel(
  getScene: () => Game | null,
  remountWithSnapshot: (snapshot: GameSnapshot) => void,
): SettingsHandle {
  const overlay = buildSettingsOverlay();
  const autoPause = createAutoPause();

  const close = () => {
    slotSelector.clear();
    overlay.classList.add("hidden");
    autoPause.release();
  };

  const applyLoadResult = createLoadResultApplier({
    close: () => close(),
    open: () => open(),
    remountWithSnapshot,
  });

  setupOverlayDismiss(overlay, close);
  const { slotSelector, refreshSlots } = setupSlotControls({ overlay, getScene, applyLoadResult });
  setupAudioControls(overlay);
  const refreshGridModeButtonsFromScene = setupGridControls(overlay, getScene);
  setupImportExportControls({ overlay, getScene, applyLoadResult });

  const open = () => {
    overlay.classList.remove("hidden");
    autoPause.acquireIfNeeded();
    refreshSlots();
    refreshGridModeButtonsFromScene(getScene());
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

  const shieldFromPhaserInput = (bindEventWithCleanup: BindEventWithCleanupFunction) => {
    shieldDomSurfaceFromPhaserInput(bindEventWithCleanup, overlay);
  };

  return {
    open,
    close,
    isOpen,
    dispose,
    shieldFromPhaserInput,
  };
}

/** Auto-pause while the panel is open; resume on close (does nothing if we
 *  weren't the one who paused). */
function createAutoPause(): { acquireIfNeeded: () => void; release: () => void } {
  let releasePause: (() => void) | null = null;
  return {
    acquireIfNeeded() {
      if (!releasePause) releasePause = acquireScopedPause();
    },
    release() {
      releasePause?.();
      releasePause = null;
    },
  };
}

function createLoadResultApplier(deps: {
  close: () => void;
  open: () => void;
  remountWithSnapshot: (snapshot: GameSnapshot) => void;
}): (result: ValidationResult) => void {
  return (result) => {
    if (!result.ok) {
      showToast(result.message);
      return;
    }
    deps.close();
    try {
      deps.remountWithSnapshot(result.snapshot);
    } catch (error) {
      // Load failed after close — reopen (re-pauses) so the user sees the
      // error toast and can try another slot.
      deps.open();
      showToast(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  modal.style.setProperty(
    "--morse-bar",
    morseBarGradient("Settings", { letterCount: 8, color: "var(--paper-mute)" }),
  );
  overlay.querySelector<HTMLElement>(".settings-close")!.innerHTML = X;

  return overlay;
}

function setupOverlayDismiss(overlay: HTMLElement, close: () => void): void {
  overlay.querySelector(".settings-close")!.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
}

interface SlotControlsDependencies {
  overlay: HTMLElement;
  getScene: () => Game | null;
  applyLoadResult: (result: ValidationResult) => void;
}

function setupSlotControls(dependencies: SlotControlsDependencies): {
  slotSelector: SlotSelector;
  refreshSlots: () => void;
} {
  const { overlay, getScene, applyLoadResult } = dependencies;
  const slotSelector = new SlotSelector({
    slotList: overlay.querySelector<HTMLElement>('[data-role="slot-list"]')!,
    actionBar: overlay.querySelector<HTMLElement>('[data-role="slot-action-bar"]')!,
    onSave(slot: SlotSummary) {
      const scene = getScene();
      if (!scene) {
        showToast("Game not ready.");
        return;
      }
      try {
        saveToManualSlot(scene, slot.index);
        slotSelector.refresh();
        showToast("Saved.", { ok: true });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Save failed.");
      }
    },
    onLoad(slot: SlotSummary) {
      return readSlot(slot.kind, slot.index);
    },
    onLoadResult: applyLoadResult,
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
    savePreference("audioEnabled", String(next));
    refreshAudioButton();
  });
  refreshAudioButton();
}

/** Scene's sector-grid is the source of truth; mirror its mode into is-on
 *  classes on open and after clicks. */
function setupGridControls(overlay: HTMLElement, getScene: () => Game | null): (scene: Game | null) => void {
  const gridModeSegment = overlay.querySelector<HTMLElement>('[data-role="grid-mode"]')!;
  const gridModeButtons = gridModeSegment.querySelectorAll<HTMLButtonElement>("button[data-grid-mode]");
  /** sectorGrid is assigned in Game.create(); getScene() can return the scene
   *  before create() finishes, so guard the read. */
  function refreshGridModeButtonsFromScene(scene: Game | null): void {
    const mode = scene?.sectorGrid?.gridMode ?? null;
    for (const button of gridModeButtons) {
      button.classList.toggle("is-on", mode !== null && button.dataset.gridMode === mode);
    }
  }
  for (const button of gridModeButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.gridMode as GridMode | undefined;
      if (!mode) return;
      const scene = getScene();
      if (!scene || !scene.sectorGrid) return;
      scene.setSectorGridMode(mode);
      refreshGridModeButtonsFromScene(scene);
    });
  }
  return refreshGridModeButtonsFromScene;
}

interface ImportExportDependencies {
  overlay: HTMLElement;
  getScene: () => Game | null;
  applyLoadResult: (result: ValidationResult) => void;
}

function setupImportExportControls(dependencies: ImportExportDependencies): void {
  const { overlay, getScene, applyLoadResult } = dependencies;
  overlay.querySelector('[data-action="export"]')!.addEventListener("click", () => {
    const scene = getScene();
    if (!scene) {
      showToast("Game not ready.");
      return;
    }
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
      const result = await readFile(file);
      applyLoadResult(result);
    });
    input.click();
  });
}
