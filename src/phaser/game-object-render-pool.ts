import { type Scene } from "phaser";

/** Generic Phaser game-object pool — acquire/release to skip per-frame allocation. */
export class GameObjectRenderPool<
  TGameObject extends Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown },
> {
  private readonly pool: TGameObject[] = [];
  private activeCount = 0;
  private readonly scene: Scene;
  private readonly createObject: (scene: Scene) => TGameObject;

  constructor(scene: Scene, createObject: (scene: Scene) => TGameObject, initialSize = 0) {
    this.scene = scene;
    this.createObject = createObject;
    for (let i = 0; i < initialSize; i++) {
      const object = createObject(scene);
      object.setVisible(false);
      this.pool.push(object);
    }
  }

  /** Returned object is already shown; pool grows on demand if exhausted. */
  acquire(): TGameObject {
    if (this.activeCount < this.pool.length) {
      const object = this.pool[this.activeCount];
      object.setVisible(true);
      this.activeCount++;
      return object;
    }
    const object = this.createObject(this.scene);
    this.pool.push(object);
    this.activeCount++;
    return object;
  }

  /** Hides active objects but keeps them allocated; the next acquire reuses them in slot order. */
  releaseAll(): void {
    for (let i = 0; i < this.activeCount; i++) {
      this.pool[i].setVisible(false);
    }
    this.activeCount = 0;
  }

  /** Frees the Phaser objects for real, unlike releaseAll; call when the pool's owner is torn down. */
  destroy(): void {
    for (const object of this.pool) object.destroy();
    this.pool.length = 0;
    this.activeCount = 0;
  }
}
