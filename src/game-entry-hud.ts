// HUD wiring helpers consumed once by mountGameRuntime — view-mode toggles,
// lore/log toggles, controls toggle, floating-panel stacking, keyboard
// shortcuts, settings panel, snapshot debug hook.

import type * as Phaser from "phaser";
import { CircleChevronUp, CircleChevronDown, CircleDashed, Book, Logs, ChevronUp, ChevronDown, Settings, Cuboid } from "lucide-static";
import type { GameViewMode } from "./game-view-mode";
import { GAME_SCENE_KEY, type Game } from "./game";
import { loadKeyValueSetting, saveKeyValueSetting } from "./storage-preferences";
import type { BindEventFunction } from "./ui-dom-input-shield";
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
  bindEvent: BindEventFunction;
}): void {
  const controlsToggle = document.getElementById("controls-toggle")!;
  const topRow = document.getElementById("hud-top-row")!;
  let controlsShown = loadKeyValueSetting("controlsShown", "false") === "true";
  function setControlsShown(shown: boolean) {
    controlsShown = shown;
    saveKeyValueSetting("controlsShown", String(shown));
    topRow.style.display = shown ? "" : "none";
    controlsToggle.innerHTML = shown ? CircleChevronDown : CircleChevronUp;
    controlsToggle.classList.toggle("is-on", shown);
  }
  setControlsShown(controlsShown);
  dependencies.bindEvent(controlsToggle, "click", () => {
    setControlsShown(!controlsShown);
  });
}

/** Zones and Overview are mutually exclusive — clicking the active one returns
 *  to Normal, V cycles all three. GameViewModeController owns the state; we mirror
 *  it onto is-on classes. Editor omits the overview button, so overviewToggle
 *  may be null. Returns `cycleViewMode` for the keyboard handler. */
export function setupViewModeToggles(dependencies: {
  game: Phaser.Game;
  requestedViewModeRef: { value: GameViewMode };
  persistViewMode: boolean;
  bindEvent: BindEventFunction;
}): { cycleViewMode: () => void } {
  const zonesToggle = document.getElementById("zones-toggle") as HTMLButtonElement | null;
  const overviewToggle = document.getElementById("overview-toggle") as HTMLButtonElement | null;
  if (zonesToggle) zonesToggle.innerHTML = CircleDashed;
  if (overviewToggle) overviewToggle.innerHTML = Cuboid;

  const renderViewModeButton = makeRenderViewModeButton(zonesToggle, overviewToggle);
  const setViewMode = makeViewModeSetter({
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
    const currentViewMode = getRequestedViewMode();
    const requestedViewMode: GameViewMode = currentViewMode === "normal"
      ? "zones"
      : currentViewMode === "zones"
        ? "overview"
        : "normal";
    setViewMode(requestedViewMode);
  }

  // Paint button state immediately; Game.create() reads the same shared ref
  // once Phaser finishes booting, so a click during startup isn't lost.
  renderViewModeButton(dependencies.requestedViewModeRef.value);
  bindViewModeToggle(zonesToggle, "zones", getRequestedViewMode, setViewMode, dependencies.bindEvent);
  bindViewModeToggle(overviewToggle, "overview", getRequestedViewMode, setViewMode, dependencies.bindEvent);
  return { cycleViewMode };
}

function makeRenderViewModeButton(
  zonesToggle: HTMLButtonElement | null,
  overviewToggle: HTMLButtonElement | null,
): (mode: GameViewMode) => void {
  return (mode: GameViewMode) => {
    zonesToggle?.classList.toggle("is-on", mode === "zones");
    overviewToggle?.classList.toggle("is-on", mode === "overview");
  };
}

function makeViewModeSetter(dependencies: {
  game: Phaser.Game;
  requestedViewModeRef: { value: GameViewMode };
  persistViewMode: boolean;
  renderViewModeButton: (mode: GameViewMode) => void;
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
    saveKeyValueSetting("viewMode", requestedViewMode);
  }
}

/** Click toggles `mode` against the current state — picking it again returns to "normal". */
function bindViewModeToggle(
  toggle: HTMLButtonElement | null,
  mode: Exclude<GameViewMode, "normal">,
  getRequestedViewMode: () => GameViewMode,
  setViewMode: (mode: GameViewMode) => void,
  bindEvent: BindEventFunction,
): void {
  if (!toggle) return;
  bindEvent(toggle, "click", () => {
    const requestedViewMode = getRequestedViewMode();
    setViewMode(requestedViewMode === mode ? "normal" : mode);
  });
}

export function setupInfoCardCollapse(dependencies: { bindEvent: BindEventFunction }): void {
  const collapseToggle = document.getElementById("collapse-toggle")!;
  const infoRail = document.getElementById("info-rail")!;
  const overlayInfoCard = document.getElementById("overlay-info-card")!;
  let collapsed = loadKeyValueSetting("infoCardCollapsed", "true") === "true";

  function applyCollapse() {
    overlayInfoCard.classList.toggle("is-collapsed", collapsed);
    infoRail.classList.toggle("is-collapsed", collapsed);
    collapseToggle.innerHTML = collapsed ? ChevronDown : ChevronUp;
    collapseToggle.title = collapsed ? "Expand" : "Collapse";
  }
  applyCollapse();
  dependencies.bindEvent(collapseToggle, "click", () => {
    collapsed = !collapsed;
    saveKeyValueSetting("infoCardCollapsed", String(collapsed));
    applyCollapse();
  });
}

export function setupLoreAndLogPanelToggles(dependencies: { bindEvent: BindEventFunction }): void {
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
  dependencies.bindEvent(loreToggle, "reapply", applyToggles);

  dependencies.bindEvent(loreToggle, "click", () => {
    if (loreToggle.dataset.hasLore !== "true") return;
    lorePreference = !lorePreference;
    if (lorePreference) logPreference = false;
    applyToggles();
  });

  dependencies.bindEvent(logToggle, "click", () => {
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
  bindEvent: BindEventFunction;
}): void {
  dependencies.bindEvent(document, "keydown", (event: Event) => {
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
  bindEvent: BindEventFunction;
  remountWithSnapshot: (snapshot: GameSnapshot) => void;
}): SettingsHandle {
  const panel = createSettingsPanel(dependencies.getScene, dependencies.remountWithSnapshot);
  // Cleanup closes the panel (releasing pause) and detaches it from the DOM,
  // so the next mount doesn't inherit a paused sim or stacked overlay.
  dependencies.cleanupCallbacks.push(() => panel.dispose());
  panel.shieldFromPhaserInput(dependencies.bindEvent);

  const gearButton = document.createElement("button");
  gearButton.className = "hud-btn hud-btn-icon";
  gearButton.setAttribute("aria-label", "Settings");
  gearButton.title = "Settings";
  gearButton.innerHTML = Settings;
  dependencies.bindEvent(gearButton, "click", () => panel.open());

  document.getElementById("hud-top-row")!.querySelector(".row")!.appendChild(gearButton);
  dependencies.cleanupCallbacks.push(() => gearButton.remove());
  return panel;
}
