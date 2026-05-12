import * as Phaser from "phaser";
import { GAME_SCENE_KEY, type Game } from "../game";

/** Resolves when the scene exists and its `create()` has run. */
export async function waitForEditorSceneReady(game: Phaser.Game, sceneKey: string = GAME_SCENE_KEY): Promise<Game> {
  const scene = await waitForSceneInstance(game, sceneKey);
  await waitForSceneCreate(scene);
  return scene;
}

async function waitForSceneInstance(game: Phaser.Game, sceneKey: string): Promise<Game> {
  const existingScene = game.scene.getScene(sceneKey) as Game | null;
  if (existingScene) return existingScene;

  return new Promise<Game>((resolve, reject) => {
    let animationFrameId: number | null = null;

    const handleDestroyed = () => {
      cleanup();
      reject(new Error(`Game was destroyed before scene "${sceneKey}" was available.`));
    };

    const cleanup = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      game.events.off("destroy", handleDestroyed);
    };

    const checkForScene = () => {
      const scene = game.scene.getScene(sceneKey) as Game | null;
      if (scene) {
        cleanup();
        resolve(scene);
        return;
      }

      animationFrameId = window.requestAnimationFrame(checkForScene);
    };

    game.events.once("destroy", handleDestroyed);
    animationFrameId = window.requestAnimationFrame(checkForScene);
  });
}

async function waitForSceneCreate(scene: Game): Promise<void> {
  // `scene.add` / `scene.input` are injected during boot BEFORE create() runs,
  // so they aren't a reliable readiness signal. `scene.selection` is assigned
  // inside Game.create() (src/game.ts), so its presence proves create() ran.
  if (scene.selection) return;

  await new Promise<void>((resolve, reject) => {
    const handleCreate = () => {
      cleanup();
      resolve();
    };
    const handleSceneGone = () => {
      cleanup();
      reject(new Error("Game scene was destroyed before create completed."));
    };
    const cleanup = () => {
      scene.events.off(Phaser.Scenes.Events.CREATE, handleCreate);
      scene.events.off(Phaser.Scenes.Events.DESTROY, handleSceneGone);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, handleSceneGone);
    };

    scene.events.once(Phaser.Scenes.Events.CREATE, handleCreate);
    scene.events.once(Phaser.Scenes.Events.DESTROY, handleSceneGone);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, handleSceneGone);
  });
}
