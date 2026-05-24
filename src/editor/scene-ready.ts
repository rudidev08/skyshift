import * as Phaser from "phaser";
import { GAME_SCENE_KEY, type Game } from "../game";

function awaitSceneInstance(game: Phaser.Game, sceneKey: string): Promise<Game> {
  return new Promise<Game>((resolve, reject) => {
    let animationFrameId: number | null = null;

    const handleDestroyed = () => {
      destroy();
      reject(new Error(`Game was destroyed before scene "${sceneKey}" was available.`));
    };

    const destroy = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      game.events.off("destroy", handleDestroyed);
    };

    const checkForScene = () => {
      const scene = game.scene.getScene(sceneKey) as Game | null;
      if (scene) {
        destroy();
        resolve(scene);
        return;
      }

      animationFrameId = window.requestAnimationFrame(checkForScene);
    };

    game.events.once("destroy", handleDestroyed);
    animationFrameId = window.requestAnimationFrame(checkForScene);
  });
}

function awaitSceneCreate(scene: Game): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleCreate = () => {
      destroy();
      resolve();
    };
    const handleSceneDestroyed = () => {
      destroy();
      reject(new Error("Game scene was destroyed before create completed."));
    };
    const destroy = () => {
      scene.events.off(Phaser.Scenes.Events.CREATE, handleCreate);
      scene.events.off(Phaser.Scenes.Events.DESTROY, handleSceneDestroyed);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, handleSceneDestroyed);
    };

    scene.events.once(Phaser.Scenes.Events.CREATE, handleCreate);
    scene.events.once(Phaser.Scenes.Events.DESTROY, handleSceneDestroyed);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, handleSceneDestroyed);
  });
}

/** Resolves when the scene exists and its `create()` has run. */
export async function waitForEditorSceneReady(
  game: Phaser.Game,
  sceneKey: string = GAME_SCENE_KEY,
): Promise<Game> {
  const existingScene = game.scene.getScene(sceneKey) as Game | null;
  const scene = existingScene ?? (await awaitSceneInstance(game, sceneKey));

  // `scene.add` / `scene.input` are injected during boot BEFORE create() runs,
  // so they aren't a reliable readiness signal. `scene.selection` is assigned
  // inside Game.create() (src/game.ts), so its presence proves create() ran.
  if (scene.selection) return scene;

  await awaitSceneCreate(scene);
  return scene;
}
