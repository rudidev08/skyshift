// HUD wiring helpers consumed once by mountGameRuntime — view-mode toggles,
// lore/log toggles, controls toggle, floating-panel stacking, keyboard
// shortcuts, settings panel, snapshot debug hook.

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
import type { GameViewMode } from "./game-view-mode";
import { GAME_SCENE_KEY, type Game } from "./game";
import { loadPreference, savePreference } from "./storage-preferences";
import type { BindEventWithCleanupFunction } from "./ui-dom-input-shield";
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

/** Wires the chevron toggle that hides/shows the gameplay controls row.
 *  Chevron points up to show the row, down to hide it. */
export function setupControlsToggleRow(dependencies: {
  bindEventWithCleanup: BindEventWithCleanupFunction;
}): void {
  const controlsToggle = document.getElementById("controls-toggle")!;
  const topRow = document.getElementById("hud-top-row")!;
  let controlsShown = loadPreference("controlsShown", "false") === "true";
  function setControlsShown(shown: boolean) {
    controlsShown = shown;
    savePreference("controlsShown", String(shown));
    topRow.style.display = shown ? "" : "none";
    controlsToggle.innerHTML = shown ? CircleChevronDown : CircleChevronUp;
    controlsToggle.classList.toggle("is-on", shown);
  }
  setControlsShown(controlsShown);
  dependencies.bindEventWithCleanup(controlsToggle, "click", () => {
    setControlsShown(!controlsShown);
  });
}

/** Wires the Normal / Zones / Overview view-mode buttons and the `V` keyboard
 *  cycle. Returns `cycleViewMode` for the keyboard handler. */
export function setupViewModeToggles(dependencies: {
  game: Phaser.Game;
  requestedViewModeRef: { value: GameViewMode };
  persistViewMode: boolean;
  bindEventWithCleanup: BindEventWithCleanupFunction;
}): { cycleViewMode: () => void } {
  const zonesToggle = document.getElementById("zones-toggle") as HTMLButtonElement | null;
  const overviewToggle = document.getElementById("overview-toggle") as HTMLButtonElement | null;
  if (zonesToggle) zonesToggle.innerHTML = CircleDashed;
  if (overviewToggle) overviewToggle.innerHTML = Cuboid;

  const renderViewModeButton = createViewModeButtonRenderer(zonesToggle, overviewToggle);
  const setViewMode = createViewModeSetter({
    game: dependencies.game,
    requestedViewModeRef: dependencies.requestedViewModeRef,
    persistViewMode: dependencies.persistViewMode,
    renderViewModeButton,
  });

  function getRequestedViewMode(): GameViewMode {
    const gameScene = dependencies.game.scene.getScene<Game>(GAME_SCENE_KEY);
    return gameScene ? gameScene.viewMode.getViewMode() : dependencies.requestedViewModeRef.value;
  }

  function cycleViewMode() {
    setViewMode(nextViewMode(getRequestedViewMode()));
  }

  // Paint button state immediately; Game.create() reads the same shared ref
  // once Phaser finishes booting, so a click during startup isn't lost.
  renderViewModeButton(dependencies.requestedViewModeRef.value);
  bindViewModeToggle(
    zonesToggle,
    "zones",
    getRequestedViewMode,
    setViewMode,
    dependencies.bindEventWithCleanup,
  );
  bindViewModeToggle(
    overviewToggle,
    "overview",
    getRequestedViewMode,
    setViewMode,
    dependencies.bindEventWithCleanup,
  );
  return { cycleViewMode };
}

function createViewModeButtonRenderer(
  zonesToggle: HTMLButtonElement | null,
  overviewToggle: HTMLButtonElement | null,
): (viewMode: GameViewMode) => void {
  return (viewMode: GameViewMode) => {
    zonesToggle?.classList.toggle("is-on", viewMode === "zones");
    overviewToggle?.classList.toggle("is-on", viewMode === "overview");
  };
}

function createViewModeSetter(dependencies: {
  game: Phaser.Game;
  requestedViewModeRef: { value: GameViewMode };
  persistViewMode: boolean;
  renderViewModeButton: (viewMode: GameViewMode) => void;
}): (requestedViewMode: GameViewMode) => void {
  return (requestedViewMode: GameViewMode) => {
    // Startup clicks can land before the scene exists — keep the latest
    // request in shared state so Game.init/create can consume it once
    // Phaser finishes booting.
    dependencies.requestedViewModeRef.value = requestedViewMode;
    const gameScene = dependencies.game.scene.getScene<Game>(GAME_SCENE_KEY);
    gameScene?.viewMode.setViewMode(requestedViewMode);
    persistRequestedViewMode(requestedViewMode, dependencies.persistViewMode);
    dependencies.renderViewModeButton(requestedViewMode);
  };
}

function persistRequestedViewMode(requestedViewMode: GameViewMode, persistViewMode: boolean): void {
  // Overview is a transient inspection mode — never persist it, otherwise
  // the next session would boot into the auto-paused overlay.
  if (persistViewMode && requestedViewMode !== "overview") {
    savePreference("viewMode", requestedViewMode);
  }
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
  bindEventWithCleanup: BindEventWithCleanupFunction,
): void {
  if (!toggle) return;
  bindEventWithCleanup(toggle, "click", () => {
    const requestedViewMode = getRequestedViewMode();
    setViewMode(requestedViewMode === viewMode ? "normal" : viewMode);
  });
}

export function setupInfoCardCollapse(dependencies: {
  bindEventWithCleanup: BindEventWithCleanupFunction;
}): void {
  const collapseToggle = document.getElementById("collapse-toggle")!;
  const infoRail = document.getElementById("info-rail")!;
  const overlayInfoCard = document.getElementById("overlay-info-card")!;
  let collapsed = loadPreference("infoCardCollapsed", "true") === "true";

  function applyCollapse() {
    overlayInfoCard.classList.toggle("is-collapsed", collapsed);
    infoRail.classList.toggle("is-collapsed", collapsed);
    collapseToggle.innerHTML = collapsed ? ChevronDown : ChevronUp;
    collapseToggle.title = collapsed ? "Expand" : "Collapse";
  }
  applyCollapse();
  dependencies.bindEventWithCleanup(collapseToggle, "click", () => {
    collapsed = !collapsed;
    savePreference("infoCardCollapsed", String(collapsed));
    applyCollapse();
  });
}

export function setupLoreAndLogPanelToggles(dependencies: {
  bindEventWithCleanup: BindEventWithCleanupFunction;
}): void {
  const loreToggle = document.getElementById("lore-toggle")!;
  const logToggle = document.getElementById("log-toggle")!;
  const detailsBox = document.getElementById("details-box")!;
  const loreBox = document.getElementById("lore-box")!;

  loreToggle.innerHTML = Book;
  logToggle.innerHTML = Logs;
  let lorePreference = false;
  let logPreference = false;

  function applyToggles() {
    const loreAvailable = loreToggle.dataset.hasLore === "true";
    const logAvailable = logToggle.dataset.hasDetails === "true";
    const loreOpen = lorePreference && loreAvailable;
    const logOpen = logPreference && logAvailable;
    loreBox.style.display = loreOpen ? "flex" : "none";
    detailsBox.style.display = logOpen ? "flex" : "none";
    loreToggle.classList.toggle("is-on", loreOpen);
    logToggle.classList.toggle("is-on", logOpen);
  }

  // src/ui-game-hud.ts dispatches `reapply` on loreToggle after updating hasLore/hasDetails.
  dependencies.bindEventWithCleanup(loreToggle, "reapply", applyToggles);

  dependencies.bindEventWithCleanup(loreToggle, "click", () => {
    if (loreToggle.dataset.hasLore !== "true") return;
    lorePreference = !lorePreference;
    if (lorePreference) logPreference = false;
    applyToggles();
  });

  dependencies.bindEventWithCleanup(logToggle, "click", () => {
    if (logToggle.dataset.hasDetails !== "true") return;
    logPreference = !logPreference;
    if (logPreference) lorePreference = false;
    applyToggles();
  });
}

/** Re-stack lore box and details box below the info box whenever the info box resizes. */
export function setupFloatingPanelStacking(cleanupCallbacks: Array<() => void>): void {
  const overlayInfo = document.getElementById("overlay-info")!;
  const loreBox = document.getElementById("lore-box")!;
  const detailsBox = document.getElementById("details-box")!;
  const positionFloatingPanels = () => {
    const infoRect = overlayInfo.getBoundingClientRect();
    let nextTop = infoRect.bottom + 4;
    loreBox.style.top = `${nextTop}px`;
    if (getComputedStyle(loreBox).display !== "none") {
      nextTop = loreBox.getBoundingClientRect().bottom + 4;
    }
    detailsBox.style.top = `${nextTop}px`;
  };
  const panelResizeObserver = new ResizeObserver(positionFloatingPanels);
  panelResizeObserver.observe(overlayInfo);
  panelResizeObserver.observe(loreBox);
  cleanupCallbacks.push(() => panelResizeObserver.disconnect());
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
  bindEventWithCleanup: BindEventWithCleanupFunction;
}): void {
  dependencies.bindEventWithCleanup(document, "keydown", (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (isShortcutSuppressedByFocus()) return;
    if (dependencies.isSettingsPanelOpen()) return;

    const gameScene = dependencies.game.scene.getScene<Game>(GAME_SCENE_KEY);
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
  cleanupCallbacks: Array<() => void>;
  bindEventWithCleanup: BindEventWithCleanupFunction;
  remountWithSnapshot: (snapshot: GameSnapshot) => void;
}): SettingsHandle {
  const panel = createSettingsPanel(dependencies.getScene, dependencies.remountWithSnapshot);
  // Cleanup closes the panel (releasing pause) and detaches it from the DOM,
  // so the next mount doesn't inherit a paused sim or stacked overlay.
  dependencies.cleanupCallbacks.push(() => panel.dispose());
  panel.shieldFromPhaserInput(dependencies.bindEventWithCleanup);

  const gearButton = document.createElement("button");
  gearButton.className = "hud-btn hud-btn-icon";
  gearButton.setAttribute("aria-label", "Settings");
  gearButton.title = "Settings";
  gearButton.innerHTML = Settings;
  dependencies.bindEventWithCleanup(gearButton, "click", () => panel.open());

  document.getElementById("hud-top-row")!.querySelector(".row")!.appendChild(gearButton);
  dependencies.cleanupCallbacks.push(() => gearButton.remove());
  return panel;
}
