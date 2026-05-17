import * as Phaser from "phaser";
import { inject } from "@vercel/analytics";
import type { GameViewMode } from "./game-view-mode";
import type { GridMode } from "./phaser/sector-grid";
import { getSpeedCycleButtonTitle, getSpeedPauseButtonTitle } from "./ui-speed-control-titles";
import { enableAudio, disableAudio } from "./audio-announcer";
import { loadPreference } from "./storage-preferences";
import { isDevModeEnabled } from "./util-devmode";
import { setExtendedAllowedSpeeds } from "./phaser/time-controls";

if (location.hostname !== "localhost") {
  inject({ scriptSrc: "/api/telemetry.js" });
}
import { backgroundConfig } from "../data/visuals-map-background";
import type { GameMap } from "./sim-map-types";
import type { GameSnapshot } from "./sim-save-types";
import { Game, GAME_SCENE_KEY } from "./game";
import { shieldDomSurfaceFromPhaserInput, type BindEventWithCleanupFunction } from "./ui-dom-input-shield";
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

  const game = bootPhaserGame({
    mapData: options.mapData,
    initialViewMode,
    requestedViewModeRef,
    isEditorMode,
    initialSnapshot: options.initialSnapshot,
  });
  activeGame = game;

  const { cleanupCallbacks, bindEventWithCleanup } = createCleanupRegistry();

  setupRuntimeControls({
    game,
    options,
    speedHud,
    requestedViewModeRef,
    cleanupCallbacks,
    bindEventWithCleanup,
  });

  return { game };
}

/** Cleanup-lifecycle pair for one runtime mount: a list of teardown callbacks
 *  plus a bindEventWithCleanup that registers a DOM listener and queues its
 *  removal onto that list. Returned together because the binder mutates the
 *  list. */
function createCleanupRegistry(): {
  cleanupCallbacks: Array<() => void>;
  bindEventWithCleanup: BindEventWithCleanupFunction;
} {
  const cleanupCallbacks: Array<() => void> = [];
  const bindEventWithCleanup: BindEventWithCleanupFunction = (target, type, listener) => {
    target.addEventListener(type, listener);
    cleanupCallbacks.push(() => target.removeEventListener(type, listener));
  };
  return { cleanupCallbacks, bindEventWithCleanup };
}

function setupRuntimeControls(dependencies: {
  game: Phaser.Game;
  options: GameRuntimeOptions;
  speedHud: HTMLElement | null;
  requestedViewModeRef: { value: GameViewMode };
  cleanupCallbacks: Array<() => void>;
  bindEventWithCleanup: BindEventWithCleanupFunction;
}): void {
  const isEditorMode = dependencies.options.isEditorMode ?? false;
  const keyboardShortcutsEnabled = dependencies.options.keyboardShortcutsEnabled ?? true;

  applyAudioPreference(isEditorMode);

  const { cycleViewMode } = setupHudControls({
    game: dependencies.game,
    isEditorMode,
    requestedViewModeRef: dependencies.requestedViewModeRef,
    persistViewMode: !isEditorMode,
    bindEventWithCleanup: dependencies.bindEventWithCleanup,
    cleanupCallbacks: dependencies.cleanupCallbacks,
  });

  shieldHudFromPhaserInput(dependencies.bindEventWithCleanup, dependencies.speedHud);

  const getScene = () => dependencies.game.scene.getScene<Game>(GAME_SCENE_KEY);
  // Shortcuts must not mutate the sim while the settings modal is open — the
  // keyboard handler reads isOpen() to gate.
  const settingsPanel = isEditorMode
    ? null
    : setupSettingsPanel({
        getScene,
        cleanupCallbacks: dependencies.cleanupCallbacks,
        bindEventWithCleanup: dependencies.bindEventWithCleanup,
        remountWithSnapshot: (snapshot) =>
          void mountGameRuntime({ ...dependencies.options, initialSnapshot: snapshot }),
      });

  installSnapshotDebugHook(getScene);

  if (keyboardShortcutsEnabled) {
    setupGlobalKeyboardShortcuts({
      game: dependencies.game,
      isSettingsPanelOpen: () => settingsPanel?.isOpen() ?? false,
      cycleViewMode,
      bindEventWithCleanup: dependencies.bindEventWithCleanup,
    });
  }

  registerRuntimeDisposal(dependencies.game, dependencies.cleanupCallbacks);
}

function buildPhaserConfig(): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: "game-container",
    backgroundColor: backgroundConfig.color,
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
  const savedViewMode = loadPreference("viewMode", "normal");
  return (PERSISTENT_VIEW_MODES as string[]).includes(savedViewMode)
    ? (savedViewMode as GameViewMode)
    : "normal";
}

function setupSpeedHudControls(speedHud: HTMLElement | null, keyboardShortcutsEnabled: boolean): void {
  const speedPauseButton = speedHud?.querySelector<HTMLButtonElement>("#speed-pause-btn") ?? null;
  const speedCycleButton = speedHud?.querySelector<HTMLButtonElement>("#speed-cycle-btn") ?? null;

  if (speedHud) speedHud.dataset.keyboardShortcutsEnabled = String(keyboardShortcutsEnabled);
  speedPauseButton?.setAttribute("title", getSpeedPauseButtonTitle(false, keyboardShortcutsEnabled));
  speedCycleButton?.setAttribute("title", getSpeedCycleButtonTitle(keyboardShortcutsEnabled));

  if (!isDevModeEnabled() || !speedHud) return;
  // Devmode unlocks 20× / 60× speed pills for debugging.
  setExtendedAllowedSpeeds([20, 60]);
  for (const speedButton of speedHud.querySelectorAll<HTMLButtonElement>("[data-dev-speed]")) {
    speedButton.hidden = false;
  }
}

function bootPhaserGame(sceneInit: {
  mapData: GameMap;
  initialViewMode: GameViewMode;
  requestedViewModeRef: { value: GameViewMode };
  isEditorMode: boolean;
  initialSnapshot: GameSnapshot | undefined;
}): Phaser.Game {
  const game = new Phaser.Game(buildPhaserConfig());
  game.scene.add(GAME_SCENE_KEY, Game, true, {
    map: sceneInit.mapData,
    initialViewMode: sceneInit.initialViewMode,
    requestedViewModeRef: sceneInit.requestedViewModeRef,
    initialGridMode: (sceneInit.isEditorMode ? "auto" : undefined) as GridMode | undefined,
    persistGridMode: !sceneInit.isEditorMode,
    isEditorMode: sceneInit.isEditorMode,
    initialSnapshot: sceneInit.initialSnapshot,
  });
  return game;
}

function applyAudioPreference(isEditorMode: boolean): void {
  if (isEditorMode) return;
  if (loadPreference("audioEnabled", "true") === "true") enableAudio();
  else disableAudio();
}

function setupHudControls(dependencies: {
  game: Phaser.Game;
  isEditorMode: boolean;
  requestedViewModeRef: { value: GameViewMode };
  persistViewMode: boolean;
  bindEventWithCleanup: BindEventWithCleanupFunction;
  cleanupCallbacks: Array<() => void>;
}): { cycleViewMode: () => void } {
  if (dependencies.isEditorMode) {
    showControlsRowForEditor();
  } else {
    setupControlsToggleRow({ bindEventWithCleanup: dependencies.bindEventWithCleanup });
  }
  const viewMode = setupViewModeToggles({
    game: dependencies.game,
    requestedViewModeRef: dependencies.requestedViewModeRef,
    persistViewMode: dependencies.persistViewMode,
    bindEventWithCleanup: dependencies.bindEventWithCleanup,
  });
  setupInfoCardCollapse({ bindEventWithCleanup: dependencies.bindEventWithCleanup });
  setupLoreAndLogPanelToggles({ bindEventWithCleanup: dependencies.bindEventWithCleanup });
  setupFloatingPanelStacking(dependencies.cleanupCallbacks);
  return viewMode;
}

function shieldHudFromPhaserInput(
  bindEventWithCleanup: BindEventWithCleanupFunction,
  speedHud: HTMLElement | null,
): void {
  shieldDomSurfaceFromPhaserInput(bindEventWithCleanup, document.getElementById("hud-bar"));
  shieldDomSurfaceFromPhaserInput(bindEventWithCleanup, speedHud);
  shieldDomSurfaceFromPhaserInput(bindEventWithCleanup, document.getElementById("overlay-info"));
  shieldDomSurfaceFromPhaserInput(bindEventWithCleanup, document.getElementById("lore-box"));
  shieldDomSurfaceFromPhaserInput(bindEventWithCleanup, document.getElementById("details-box"));
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

function startGameFromUrlRoute(): void {
  const route = parseRoute(window.location.pathname);
  if (!route) return;
  const run = route.kind === "start" ? startFromPreset(route.presetId) : continueUniverse();
  run.catch((error) => {
    console.error(error);
    // Surface the stack inside the "Show details" toggle rather than the headline.
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    renderLoadError(message, stack);
  });
}

startGameFromUrlRoute();
