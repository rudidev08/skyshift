// HUD wiring helpers consumed once by mountGameRuntime; teardown runs through
// the destroyCallbacks list each caller threads in.

import type * as Phaser from "phaser";
import {
  CircleChevronUp,
  CircleChevronDown,
  CircleDashed,
  Book,
  Logs,
  ChevronUp,
  ChevronDown,
  Settings,
  Cuboid,
} from "lucide-static";
import type { GameViewMode, RequestedViewModeCell } from "./game-view-mode";
import { getGameScene, type Game } from "./game";
import { loadPreference, savePreference } from "./storage-preferences";
import { uiPreferenceDefaults } from "../data/ui-preference-defaults";
import type { BindEventWithDestroyFunction } from "./ui-dom-input-shield";
import { createSettingsPanel, type SettingsHandle } from "./ui-settings-panel";
import { captureSnapshot } from "./ui-savegame-manager";
import type { GameSnapshot } from "./sim-save-types";

/** Editor always shows the controls row and hides the toggle button — the
 *  toggle is for gameplay only. */
export function showControlsRowForEditor(): void {
  const controlsToggle = document.getElementById("controls-toggle")!;
  const topRow = document.getElementById("hud-top-row")!;
  topRow.hidden = false;
  topRow.style.display = "";
  controlsToggle.hidden = true;
}

export function setupControlsToggleRow(dependencies: {
  bindEventWithDestroy: BindEventWithDestroyFunction;
}): void {
  const controlsToggle = document.getElementById("controls-toggle")!;
  const topRow = document.getElementById("hud-top-row")!;
  let controlsShown = loadPreference("controlsShown", String(uiPreferenceDefaults.controlsShown)) === "true";
  function setControlsShown(shown: boolean) {
    controlsShown = shown;
    savePreference("controlsShown", String(shown));
    topRow.style.display = shown ? "" : "none";
    controlsToggle.innerHTML = shown ? CircleChevronDown : CircleChevronUp;
    controlsToggle.classList.toggle("is-on", shown);
  }
  setControlsShown(controlsShown);
  dependencies.bindEventWithDestroy(controlsToggle, "click", () => {
    setControlsShown(!controlsShown);
  });
}

/** Returns `cycleViewMode` so the caller can bind it to the `V` keyboard shortcut. */
export function setupViewModeToggles(dependencies: {
  game: Phaser.Game;
  requestedViewModeCell: RequestedViewModeCell;
  bindEventWithDestroy: BindEventWithDestroyFunction;
}): { cycleViewMode: () => void } {
  const zonesToggle = document.getElementById("zones-toggle") as HTMLButtonElement | null;
  const overviewToggle = document.getElementById("overview-toggle") as HTMLButtonElement | null;
  if (zonesToggle) zonesToggle.innerHTML = CircleDashed;
  if (overviewToggle) overviewToggle.innerHTML = Cuboid;

  function renderViewModeButton(viewMode: GameViewMode) {
    zonesToggle?.classList.toggle("is-on", viewMode === "zones");
    overviewToggle?.classList.toggle("is-on", viewMode === "overview");
  }

  function setViewMode(requestedViewMode: GameViewMode) {
    // Startup clicks can land before the scene exists — keep the latest
    // request in shared state so Game.init/create can consume it once
    // Phaser finishes booting.
    dependencies.requestedViewModeCell.value = requestedViewMode;
    const gameScene = getGameScene(dependencies.game);
    gameScene?.viewMode.setViewMode(requestedViewMode);
    renderViewModeButton(requestedViewMode);
  }

  function getRequestedViewMode(): GameViewMode {
    const gameScene = getGameScene(dependencies.game);
    return gameScene ? gameScene.viewMode.getViewMode() : dependencies.requestedViewModeCell.value;
  }

  function cycleViewMode() {
    setViewMode(nextViewMode(getRequestedViewMode()));
  }

  // Paint button state immediately; Game.create() reads the same shared ref
  // once Phaser finishes booting, so a click during startup isn't lost.
  renderViewModeButton(dependencies.requestedViewModeCell.value);
  bindViewModeToggle(
    zonesToggle,
    "zones",
    getRequestedViewMode,
    setViewMode,
    dependencies.bindEventWithDestroy,
  );
  bindViewModeToggle(
    overviewToggle,
    "overview",
    getRequestedViewMode,
    setViewMode,
    dependencies.bindEventWithDestroy,
  );
  return { cycleViewMode };
}

function nextViewMode(currentViewMode: GameViewMode): GameViewMode {
  if (currentViewMode === "normal") return "zones";
  if (currentViewMode === "zones") return "overview";
  return "normal";
}

/** Click toggles `viewMode` against the current state — picking it again returns to "normal". */
function bindViewModeToggle(
  toggle: HTMLButtonElement | null,
  viewMode: Exclude<GameViewMode, "normal">,
  getRequestedViewMode: () => GameViewMode,
  setViewMode: (viewMode: GameViewMode) => void,
  bindEventWithDestroy: BindEventWithDestroyFunction,
): void {
  if (!toggle) return;
  bindEventWithDestroy(toggle, "click", () => {
    const requestedViewMode = getRequestedViewMode();
    setViewMode(requestedViewMode === viewMode ? "normal" : viewMode);
  });
}

/** Editor shows the info card expanded with no collapse toggle — the editor
 *  inspects map entities, and that open/closed state isn't a persisted player
 *  preference there. */
export function showInfoCardForEditor(): void {
  const collapseToggle = document.getElementById("collapse-toggle")!;
  const infoRail = document.getElementById("info-rail")!;
  const overlayInfoCard = document.getElementById("overlay-info-card")!;
  overlayInfoCard.classList.remove("is-collapsed");
  infoRail.classList.remove("is-collapsed");
  collapseToggle.hidden = true;
}

export function setupInfoCardCollapse(dependencies: {
  bindEventWithDestroy: BindEventWithDestroyFunction;
}): void {
  const collapseToggle = document.getElementById("collapse-toggle")!;
  const infoRail = document.getElementById("info-rail")!;
  const overlayInfoCard = document.getElementById("overlay-info-card")!;
  let collapsed = loadPreference("infoCardCollapsed", String(uiPreferenceDefaults.infoCardCollapsed)) === "true";

  function applyCollapse() {
    overlayInfoCard.classList.toggle("is-collapsed", collapsed);
    infoRail.classList.toggle("is-collapsed", collapsed);
    collapseToggle.innerHTML = collapsed ? ChevronDown : ChevronUp;
    collapseToggle.title = collapsed ? "Expand" : "Collapse";
  }
  applyCollapse();
  dependencies.bindEventWithDestroy(collapseToggle, "click", () => {
    collapsed = !collapsed;
    savePreference("infoCardCollapsed", String(collapsed));
    applyCollapse();
  });
}

export function setupLoreAndLogPanelToggles(dependencies: {
  bindEventWithDestroy: BindEventWithDestroyFunction;
}): void {
  const loreToggle = document.getElementById("lore-toggle")!;
  const logToggle = document.getElementById("log-toggle")!;
  const logBox = document.getElementById("log-box")!;
  const loreBox = document.getElementById("lore-box")!;

  loreToggle.innerHTML = Book;
  logToggle.innerHTML = Logs;
  let lorePanelOpen = false;
  let logPanelOpen = false;

  function applyToggles() {
    const loreAvailable = loreToggle.dataset.hasLore === "true";
    const logAvailable = logToggle.dataset.hasLog === "true";
    const loreOpen = lorePanelOpen && loreAvailable;
    const logOpen = logPanelOpen && logAvailable;
    loreBox.style.display = loreOpen ? "flex" : "none";
    logBox.style.display = logOpen ? "flex" : "none";
    loreToggle.classList.toggle("is-on", loreOpen);
    logToggle.classList.toggle("is-on", logOpen);
  }

  // src/ui-game-hud.ts dispatches `reapply` on loreToggle after updating hasLore/hasLog.
  dependencies.bindEventWithDestroy(loreToggle, "reapply", applyToggles);

  dependencies.bindEventWithDestroy(loreToggle, "click", () => {
    if (loreToggle.dataset.hasLore !== "true") return;
    lorePanelOpen = !lorePanelOpen;
    if (lorePanelOpen) logPanelOpen = false;
    applyToggles();
  });

  dependencies.bindEventWithDestroy(logToggle, "click", () => {
    if (logToggle.dataset.hasLog !== "true") return;
    logPanelOpen = !logPanelOpen;
    if (logPanelOpen) lorePanelOpen = false;
    applyToggles();
  });
}

const FLOATING_PANEL_GAP_PIXELS = 4;

/** Re-stack lore box and log box below the info box whenever the info box resizes. */
export function setupFloatingPanelStacking(dependencies: {
  destroyCallbacks: Array<() => void>;
}): void {
  const overlayInfo = document.getElementById("overlay-info")!;
  const loreBox = document.getElementById("lore-box")!;
  const logBox = document.getElementById("log-box")!;
  const positionFloatingPanels = () => {
    const infoRect = overlayInfo.getBoundingClientRect();
    let nextTopPixels = infoRect.bottom + FLOATING_PANEL_GAP_PIXELS;
    loreBox.style.top = `${nextTopPixels}px`;
    if (getComputedStyle(loreBox).display !== "none") {
      nextTopPixels = loreBox.getBoundingClientRect().bottom + FLOATING_PANEL_GAP_PIXELS;
    }
    logBox.style.top = `${nextTopPixels}px`;
  };
  const panelResizeObserver = new ResizeObserver(positionFloatingPanels);
  panelResizeObserver.observe(overlayInfo);
  panelResizeObserver.observe(loreBox);
  dependencies.destroyCallbacks.push(() => panelResizeObserver.disconnect());
}

/** Exposes `skyshiftSnapshot()` on `window` so devtools can capture a save snapshot on demand. */
export function installSnapshotDebugHook(getScene: () => Game | null): void {
  (window as unknown as { skyshiftSnapshot: () => unknown }).skyshiftSnapshot = () => {
    const scene = getScene();
    return scene ? captureSnapshot(scene) : null;
  };
}

/** Global hotkeys: Space/1/2/3 drive the time controller, V cycles view mode.
 *  Suppressed while a text field has focus or the settings modal is open. */
export function setupGlobalKeyboardShortcuts(dependencies: {
  game: Phaser.Game;
  isSettingsPanelOpen: () => boolean;
  cycleViewMode: () => void;
  bindEventWithDestroy: BindEventWithDestroyFunction;
}): void {
  dependencies.bindEventWithDestroy(document, "keydown", (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (isShortcutSuppressedByFocus()) return;
    if (dependencies.isSettingsPanelOpen()) return;

    const gameScene = getGameScene(dependencies.game);
    if (!gameScene) return;

    if (gameScene.viewMode.getViewMode() === "overview" && isTimeControlKey(keyboardEvent.key)) {
      // Overview hides speed controls — swallow time shortcuts there instead
      // of changing the sim underneath the inspection overlay.
      keyboardEvent.preventDefault();
      blurFocusedHudButton();
      return;
    }

    if (!dispatchShortcut(keyboardEvent.key, gameScene, dependencies.cycleViewMode)) return;
    keyboardEvent.preventDefault();
    blurFocusedHudButton();
  });
}

function isShortcutSuppressedByFocus(): boolean {
  const tag = (document.activeElement?.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function isTimeControlKey(key: string): boolean {
  return key === " " || key === "1" || key === "2" || key === "3";
}

/** Blur any focused HUD button so shortcuts don't leave a stray focus ring. */
function blurFocusedHudButton(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

/** Returns true when the key triggered a recognized shortcut, so the caller
 *  can preventDefault + blur. Returns false for unrecognized keys. */
function dispatchShortcut(key: string, gameScene: Game, cycleViewMode: () => void): boolean {
  const controller = gameScene.timeController;
  switch (key) {
    case " ":
      controller.togglePause();
      return true;
    case "1":
      controller.setSpeed(1);
      return true;
    case "2":
      controller.setSpeed(2);
      return true;
    case "3":
      controller.setSpeed(5);
      return true;
    case "v":
    case "V":
      cycleViewMode();
      return true;
    default:
      return false;
  }
}

/** Settings modal + gear button. Caller (game-entry.ts) skips this in editor mode. */
export function setupSettingsPanel(dependencies: {
  getScene: () => Game | null;
  destroyCallbacks: Array<() => void>;
  bindEventWithDestroy: BindEventWithDestroyFunction;
  remountWithSnapshot: (snapshot: GameSnapshot) => void;
}): SettingsHandle {
  const panel = createSettingsPanel(dependencies.getScene, dependencies.remountWithSnapshot);
  // The destroy callback closes the panel (releasing pause) and detaches it
  // from the DOM, so the next mount doesn't inherit a paused sim or stacked overlay.
  dependencies.destroyCallbacks.push(() => panel.destroy());
  dependencies.destroyCallbacks.push(panel.shieldFromPhaserInput());

  const gearButton = document.createElement("button");
  gearButton.className = "hud-btn hud-btn-icon";
  gearButton.setAttribute("aria-label", "Settings");
  gearButton.title = "Settings";
  gearButton.innerHTML = Settings;
  dependencies.bindEventWithDestroy(gearButton, "click", () => panel.open());

  document.getElementById("hud-top-row")!.appendChild(gearButton);
  dependencies.destroyCallbacks.push(() => gearButton.remove());
  return panel;
}
