import * as Phaser from "phaser";
import type { GameViewMode, RequestedViewModeCell } from "./game-view-mode";
import type { SectorGridMode } from "./sector-grid-mode";
import { enableAudio, disableAudio } from "./audio-announcer";
import { loadPreference } from "./storage-preferences";
import { uiPreferenceDefaults } from "../data/ui-preference-defaults";
import { isDevModeEnabled } from "./util-devmode";
import { setExtendedAllowedSpeeds } from "./phaser/time-controls";
import { injectAnalyticsUnlessDev } from "./util-analytics";
import { backgroundConfig } from "../data/visuals-map-background";
import type { GameMap } from "./sim-map-types";
import type { GameSnapshot } from "./sim-save-types";
import { Game, GAME_SCENE_KEY, getGameScene } from "./game";
import { shieldDomSurfaceFromPhaserInput, type BindEventWithDestroyFunction } from "./ui-dom-input-shield";
import { morseBarGradient } from "./render-morse-bar";
import {
  showControlsRowForEditor,
  showInfoCardForEditor,
  setupControlsToggleRow,
  setupViewModeToggles,
  setupInfoCardCollapse,
  setupLoreAndLogPanelToggles,
  setupFloatingPanelStacking,
  installSnapshotDebugHook,
  setupGlobalKeyboardShortcuts,
  setupSettingsPanel,
} from "./game-entry-hud";
import { parseRoute, startFreshUniverse, resumeSavedUniverse, renderLoadError } from "./game-entry-routing";

injectAnalyticsUnlessDev();

function paintLoadingCardMorseStripe() {
  const loadingCard = document.querySelector<HTMLElement>("#loading-screen .id-card");
  if (loadingCard) loadingCard.style.setProperty("--morse-bar", morseBarGradient("Skyshift"));
}

// Painted at module load so the loading card isn't bare during the brief pre-script window.
paintLoadingCardMorseStripe();

// Set once we've shown the load-error panel so a later error (or the route
// .catch() below firing on the same failure) doesn't wipe and re-render it.
let loadErrorShown = false;

function showLoadError(message: string, stack?: string): void {
  if (loadErrorShown) return;
  loadErrorShown = true;
  renderLoadError(message, stack);
}

// Earliest-possible boot guard: a throw inside Phaser's deferred scene create()
// (e.g. a bad save) escapes the awaited-boot .catch() and would otherwise leave
// the "Entering universe" curtain frozen. Catch it at the window level instead,
// but only before the first frame clears the curtain (game-ready) — past that,
// the game is live and an unrelated runtime error shouldn't replace it with the
// load-error panel.
function hasReachedFirstFrame(): boolean {
  return document.body.classList.contains("game-ready");
}

window.addEventListener("error", (event) => {
  if (hasReachedFirstFrame()) return;
  const message = event.error instanceof Error ? event.error.message : event.message;
  const stack = event.error instanceof Error ? event.error.stack : undefined;
  showLoadError(message, stack);
});

window.addEventListener("unhandledrejection", (event) => {
  if (hasReachedFirstFrame()) return;
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  showLoadError(message, stack);
});

// URL scheme:
//   /start/:preset  — fresh start; mount replaces history to /universe so
//                     refresh won't reseed.
//   /universe       — load the latest save, or bounce to / if none.

let activeGame: Phaser.Game | null = null;
let destroyRuntime: (() => void) | null = null;

export function destroyGameRuntime() {
  // Capture the game before running destroyRuntime — that closure ends by
  // nulling activeGame. It runs first so destroy callbacks fire while the
  // scene is still alive; destroy(true) below re-enters destroyRuntime via
  // Phaser's destroy event, where the destroyed flag short-circuits the
  // second call.
  const previousGame = activeGame;
  destroyRuntime?.();
  destroyRuntime = null;
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
  const initialViewMode: GameViewMode = "normal";
  const requestedViewModeCell = { value: initialViewMode };
  const speedHud = document.getElementById("speed-hud") as HTMLElement | null;

  setupSpeedHudControls(speedHud, keyboardShortcutsEnabled);

  const game = bootPhaserGame({
    mapData: options.mapData,
    initialViewMode,
    requestedViewModeCell,
    isEditorMode,
    initialSnapshot: options.initialSnapshot,
  });
  activeGame = game;

  // Every DOM listener registered through bindEventWithDestroy queues its own
  // removal here, so destroyRuntime detaches them all on scene destroy.
  const destroyCallbacks: Array<() => void> = [];
  const bindEventWithDestroy: BindEventWithDestroyFunction = (target, type, listener) => {
    target.addEventListener(type, listener);
    destroyCallbacks.push(() => target.removeEventListener(type, listener));
  };

  applyAudioPreference(isEditorMode);

  const { cycleViewMode } = setupHudControls({
    game,
    isEditorMode,
    requestedViewModeCell,
    bindEventWithDestroy,
    destroyCallbacks,
  });

  shieldHudFromPhaserInput(destroyCallbacks, speedHud);

  const getActiveScene = () => getGameScene(game);
  // Shortcuts must not mutate the sim while the settings modal is open — the
  // keyboard handler reads isOpen() to gate.
  const settingsPanel = isEditorMode
    ? null
    : setupSettingsPanel({
        getScene: getActiveScene,
        destroyCallbacks,
        bindEventWithDestroy,
        remountWithSnapshot: (snapshot) =>
          void mountGameRuntime({ ...options, initialSnapshot: snapshot }),
      });

  if (isDevModeEnabled()) {
    installSnapshotDebugHook(getActiveScene);
  }

  if (keyboardShortcutsEnabled) {
    setupGlobalKeyboardShortcuts({
      game,
      isSettingsPanelOpen: () => settingsPanel?.isOpen() ?? false,
      cycleViewMode,
      bindEventWithDestroy,
    });
  }

  registerRuntimeDestroy(game, destroyCallbacks);

  return { game };
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

function setupSpeedHudControls(speedHud: HTMLElement | null, keyboardShortcutsEnabled: boolean): void {
  // The indicator's first setSpeed (game-setup.ts) writes both button titles
  // before paint; setting them here would just be overwritten.
  if (speedHud) speedHud.dataset.keyboardShortcutsEnabled = String(keyboardShortcutsEnabled);

  if (!isDevModeEnabled() || !speedHud) return;
  // Devmode unlocks 20× / 60× speed pills for debugging.
  setExtendedAllowedSpeeds([20, 60]);
  for (const speedButton of speedHud.querySelectorAll<HTMLButtonElement>("[data-dev-speed]")) {
    speedButton.hidden = false;
  }
}

function bootPhaserGame(sceneData: {
  mapData: GameMap;
  initialViewMode: GameViewMode;
  requestedViewModeCell: RequestedViewModeCell;
  isEditorMode: boolean;
  initialSnapshot: GameSnapshot | undefined;
}): Phaser.Game {
  const game = new Phaser.Game(buildPhaserConfig());
  game.scene.add(GAME_SCENE_KEY, Game, true, {
    map: sceneData.mapData,
    initialViewMode: sceneData.initialViewMode,
    requestedViewModeCell: sceneData.requestedViewModeCell,
    initialGridMode: (sceneData.isEditorMode ? "auto" : undefined) as SectorGridMode | undefined,
    persistGridMode: !sceneData.isEditorMode,
    isEditorMode: sceneData.isEditorMode,
    initialSnapshot: sceneData.initialSnapshot,
  });
  return game;
}

function applyAudioPreference(isEditorMode: boolean): void {
  if (isEditorMode) return;
  if (loadPreference("audioEnabled", String(uiPreferenceDefaults.audioEnabled)) === "true") enableAudio();
  else disableAudio();
}

function setupHudControls(dependencies: {
  game: Phaser.Game;
  isEditorMode: boolean;
  requestedViewModeCell: RequestedViewModeCell;
  bindEventWithDestroy: BindEventWithDestroyFunction;
  destroyCallbacks: Array<() => void>;
}): { cycleViewMode: () => void } {
  if (dependencies.isEditorMode) {
    showControlsRowForEditor();
  } else {
    setupControlsToggleRow({ bindEventWithDestroy: dependencies.bindEventWithDestroy });
  }
  const viewMode = setupViewModeToggles({
    game: dependencies.game,
    requestedViewModeCell: dependencies.requestedViewModeCell,
    bindEventWithDestroy: dependencies.bindEventWithDestroy,
  });
  if (dependencies.isEditorMode) {
    showInfoCardForEditor();
  } else {
    setupInfoCardCollapse({ bindEventWithDestroy: dependencies.bindEventWithDestroy });
  }
  setupLoreAndLogPanelToggles({ bindEventWithDestroy: dependencies.bindEventWithDestroy });
  setupFloatingPanelStacking({ destroyCallbacks: dependencies.destroyCallbacks });
  return viewMode;
}

function shieldHudFromPhaserInput(
  destroyCallbacks: Array<() => void>,
  speedHud: HTMLElement | null,
): void {
  destroyCallbacks.push(
    shieldDomSurfaceFromPhaserInput(document.getElementById("hud-bar")),
    shieldDomSurfaceFromPhaserInput(speedHud),
    shieldDomSurfaceFromPhaserInput(document.getElementById("overlay-info")),
    shieldDomSurfaceFromPhaserInput(document.getElementById("lore-box")),
    shieldDomSurfaceFromPhaserInput(document.getElementById("log-box")),
  );
}

function registerRuntimeDestroy(game: Phaser.Game, destroyCallbacks: Array<() => void>): void {
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    while (destroyCallbacks.length > 0) {
      destroyCallbacks.pop()!();
    }
    if (destroyRuntime === destroy) destroyRuntime = null;
    if (activeGame === game) activeGame = null;
  };

  destroyRuntime = destroy;
  game.events.once("destroy", destroy);

  const hot = (import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot;
  if (!hot) return;
  hot.dispose(() => {
    // Capture before destroy() — it nulls activeGame for this game.
    const wasActiveGame = activeGame === game;
    destroy();
    if (wasActiveGame) game.destroy(true);
  });
}

function startGameFromUrlRoute(): void {
  const route = parseRoute(window.location.pathname);
  if (!route) return;
  const run = route.kind === "newGame" ? startFreshUniverse(route.presetId) : resumeSavedUniverse();
  run.catch((error) => {
    console.error(error);
    // Surface the stack inside the "Show details" toggle rather than the headline.
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    showLoadError(message, stack);
  });
}

startGameFromUrlRoute();
