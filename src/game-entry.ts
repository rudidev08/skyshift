import * as Phaser from "phaser";
import { inject } from "@vercel/analytics";
import type { GameViewMode } from "./game-view-mode";
import type { GridMode } from "./phaser/sector-grid";
import { getTimeAccelerationCycleButtonTitle, getTimePauseButtonTitle } from "./ui-speed-control-titles";
import { enableAudio, disableAudio } from "./audio-announcer";
import { loadKeyValueSetting } from "./storage-preferences";
import { isDevModeEnabled } from "./util-devmode";
import { setExtendedAllowedSpeeds } from "./phaser/time-controls";

if (location.hostname !== 'localhost') {
  inject({ scriptSrc: "/api/telemetry.js" });
}
import { backgroundConfig } from "../data/visuals-map-background";
import type { GameMap } from "./sim-map-types";
import type { GameSnapshot } from "./sim-save-types";
import { Game, GAME_SCENE_KEY } from "./game";
import { shieldDomSurfaceFromPhaserInput, type BindEventFunction } from "./ui-dom-input-shield";
import { morseBarGradient } from "./render-morse-bar";
import {
  showControlsRowForEditor,
  setupControlsToggleRow,
  setupViewModeToggles,
  setupInfoCardCollapse,
  setupLoreAndLogPanelToggles,
  setupFloatingPanelStacking,
  installSnapshotDebugHook,
  setupGlobalKeyboardShortcuts,
  setupSettingsPanel,
} from "./game-entry-hud";
import { parseRoute, startFromPreset, continueUniverse, renderLoadError } from "./game-entry-routing";

// Paint the morse stripe at module load so the loading card isn't bare during
// the brief pre-script window.
(() => {
  const loadingCard = document.querySelector<HTMLElement>("#loading-screen .id-card");
  if (loadingCard) loadingCard.style.setProperty("--morse-bar", morseBarGradient("Skyshift"));
})();

// URL scheme:
//   /start/:preset  — fresh start; mount replaces history to /universe so
//                     refresh won't reseed.
//   /universe       — load the latest save, or bounce to / if none.

let activeGame: Phaser.Game | null = null;
let disposeRuntime: (() => void) | null = null;

export function destroyGameRuntime() {
  // Run dispose first so cleanup callbacks fire while the scene is still alive;
  // destroy(true) below re-enters dispose via the destroy event, where the
  // disposed flag short-circuits the second call.
  disposeRuntime?.();
  const previousGame = activeGame;
  disposeRuntime = null;
  activeGame = null;
  previousGame?.destroy(true);
}

export function refreshGameRuntimeLayout() {
  if (!activeGame) return;
  const container = document.getElementById("game-container");
  if (!container) return;
  activeGame.scale.resize(container.clientWidth, container.clientHeight);
  activeGame.scale.refresh();
}

export function sleepGameRuntime() {
  activeGame?.loop.sleep();
}

export function wakeGameRuntime() {
  activeGame?.loop.wake();
}

export type GameRuntimeOptions = {
  mapData: GameMap;
  /** Off for the map editor, where these keys collide with editor inputs. */
  keyboardShortcutsEnabled?: boolean;
  /** Editor context disables player-facing settings and keeps audio silent. */
  isEditorMode?: boolean;
  initialSnapshot?: GameSnapshot;
};

export async function mountGameRuntime(options: GameRuntimeOptions) {
  destroyGameRuntime();
  // Remounts (snapshot load from settings) re-run boot — show the loading
  // curtain again until Game.update() clears it.
  document.body.classList.remove("game-ready");

  const isEditorMode = options.isEditorMode ?? false;
  const keyboardShortcutsEnabled = options.keyboardShortcutsEnabled ?? true;
  const initialViewMode = resolveInitialViewMode(isEditorMode);
  const requestedViewModeRef = { value: initialViewMode };
  const speedHud = document.getElementById("speed-hud") as HTMLElement | null;

  setupSpeedHudControls(speedHud, keyboardShortcutsEnabled);

  const game = createGameWithScene({
    mapData: options.mapData,
    initialViewMode,
    requestedViewModeRef,
    isEditorMode,
    initialSnapshot: options.initialSnapshot,
  });
  activeGame = game;

  const cleanupCallbacks: Array<() => void> = [];
  const bindEvent: BindEventFunction = (target, type, listener) => {
    target.addEventListener(type, listener);
    cleanupCallbacks.push(() => target.removeEventListener(type, listener));
  };

  applyAudioPreference(isEditorMode);

  const { cycleViewMode } = wireHudControls({
    game,
    isEditorMode,
    requestedViewModeRef,
    persistViewMode: !isEditorMode,
    bindEvent,
    cleanupCallbacks,
  });

  shieldHudFromPhaserInput(bindEvent, speedHud);

  const getScene = () => game.scene.getScene<Game>(GAME_SCENE_KEY);
  // Shortcuts must not mutate the sim while the settings modal is open — the
  // keyboard handler reads isOpen() to gate.
  const settingsPanel = isEditorMode ? null : setupSettingsPanel({
    getScene,
    cleanupCallbacks,
    bindEvent,
    remountWithSnapshot: (snapshot) => void mountGameRuntime({ ...options, initialSnapshot: snapshot }),
  });

  installSnapshotDebugHook(getScene);

  if (keyboardShortcutsEnabled) {
    setupGlobalKeyboardShortcuts({
      game,
      isSettingsPanelOpen: () => settingsPanel?.isOpen() ?? false,
      cycleViewMode,
      bindEvent,
    });
  }

  registerRuntimeDisposal(game, cleanupCallbacks);
  return { game };
}

function buildPhaserConfig(): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: "game-container",
    backgroundColor: backgroundConfig.backgroundColor,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: "100%",
      height: "100%",
    },
    render: {
      pixelArt: false,
      roundPixels: true,
    },
    fps: {
      target: 60,
      forceSetTimeOut: true,
    },
  };
}

const PERSISTENT_VIEW_MODES: GameViewMode[] = ["normal", "zones"];

/** Editor always boots into normal view; gameplay's saved preference would
 *  otherwise drop the editor into zones/overview HUD chrome on open. */
function resolveInitialViewMode(isEditorMode: boolean): GameViewMode {
  if (isEditorMode) return "normal";
  const savedViewMode = loadKeyValueSetting("viewMode", "normal");
  return (PERSISTENT_VIEW_MODES as string[]).includes(savedViewMode)
    ? (savedViewMode as GameViewMode)
    : "normal";
}

function setupSpeedHudControls(speedHud: HTMLElement | null, keyboardShortcutsEnabled: boolean): void {
  const speedPauseButton = speedHud?.querySelector<HTMLButtonElement>("#speed-pause-btn") ?? null;
  const speedCycleButton = speedHud?.querySelector<HTMLButtonElement>("#speed-cycle-btn") ?? null;

  if (speedHud) speedHud.dataset.keyboardShortcutsEnabled = String(keyboardShortcutsEnabled);
  speedPauseButton?.setAttribute("title", getTimePauseButtonTitle(false, keyboardShortcutsEnabled));
  speedCycleButton?.setAttribute("title", getTimeAccelerationCycleButtonTitle(keyboardShortcutsEnabled));

  if (!isDevModeEnabled() || !speedHud) return;
  // Devmode unlocks 20× / 60× speed pills for debugging.
  setExtendedAllowedSpeeds([20, 60]);
  for (const speedButton of speedHud.querySelectorAll<HTMLButtonElement>("[data-dev-speed]")) {
    speedButton.hidden = false;
  }
}

function createGameWithScene(scene: {
  mapData: GameMap;
  initialViewMode: GameViewMode;
  requestedViewModeRef: { value: GameViewMode };
  isEditorMode: boolean;
  initialSnapshot: GameSnapshot | undefined;
}): Phaser.Game {
  const game = new Phaser.Game(buildPhaserConfig());
  game.scene.add(GAME_SCENE_KEY, Game, true, {
    map: scene.mapData,
    initialViewMode: scene.initialViewMode,
    requestedViewModeRef: scene.requestedViewModeRef,
    initialGridMode: (scene.isEditorMode ? "auto" : undefined) as GridMode | undefined,
    persistGridMode: !scene.isEditorMode,
    isEditorMode: scene.isEditorMode,
    initialSnapshot: scene.initialSnapshot,
  });
  return game;
}

function applyAudioPreference(isEditorMode: boolean): void {
  if (isEditorMode) return;
  if (loadKeyValueSetting("audioEnabled", "false") === "true") enableAudio();
  else disableAudio();
}

function wireHudControls(dependencies: {
  game: Phaser.Game;
  isEditorMode: boolean;
  requestedViewModeRef: { value: GameViewMode };
  persistViewMode: boolean;
  bindEvent: BindEventFunction;
  cleanupCallbacks: Array<() => void>;
}): { cycleViewMode: () => void } {
  if (dependencies.isEditorMode) {
    showControlsRowForEditor();
  } else {
    setupControlsToggleRow({ bindEvent: dependencies.bindEvent });
  }
  const viewMode = setupViewModeToggles({
    game: dependencies.game,
    requestedViewModeRef: dependencies.requestedViewModeRef,
    persistViewMode: dependencies.persistViewMode,
    bindEvent: dependencies.bindEvent,
  });
  setupInfoCardCollapse({ bindEvent: dependencies.bindEvent });
  setupLoreAndLogPanelToggles({ bindEvent: dependencies.bindEvent });
  setupFloatingPanelStacking(dependencies.cleanupCallbacks);
  return viewMode;
}

function shieldHudFromPhaserInput(bindEvent: BindEventFunction, speedHud: HTMLElement | null): void {
  shieldDomSurfaceFromPhaserInput(bindEvent, document.getElementById("hud-bar"));
  shieldDomSurfaceFromPhaserInput(bindEvent, speedHud);
  shieldDomSurfaceFromPhaserInput(bindEvent, document.getElementById("overlay-info"));
  shieldDomSurfaceFromPhaserInput(bindEvent, document.getElementById("lore-box"));
  shieldDomSurfaceFromPhaserInput(bindEvent, document.getElementById("details-box"));
}

function registerRuntimeDisposal(game: Phaser.Game, cleanupCallbacks: Array<() => void>): void {
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    while (cleanupCallbacks.length > 0) {
      cleanupCallbacks.pop()!();
    }
    if (disposeRuntime === dispose) disposeRuntime = null;
    if (activeGame === game) activeGame = null;
  };

  disposeRuntime = dispose;
  game.events.once("destroy", dispose);

  const hot = (import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot;
  if (!hot) return;
  hot.dispose(() => {
    dispose();
    if (activeGame === game) {
      activeGame = null;
      game.destroy(true);
    }
  });
}

const route = parseRoute(window.location.pathname);
if (route) {
  const run = route.kind === "start" ? startFromPreset(route.presetId) : continueUniverse();
  run.catch((error) => {
    console.error(error);
    // Surface the stack inside the "Show details" toggle rather than the headline.
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    renderLoadError(message, stack);
  });
}
