// src/editor/timelapse-scene.ts
//
// Minimal Phaser scene for the Timelapse tab. Renders only nation-colored
// station discs with type icons — no nebulas, no ships, no HUD chrome.
// Camera is fixed at the fit-to-map zoom so the entire universe is always
// visible; there are no zoom controls.

import Phaser from "phaser";
import type { GameMap } from "../sim-map-types";
import type { TimelapseFrame } from "../sim-timelapse-state";
import { preloadStationIcons } from "../phaser/texture-cache";
import { StationDiscPool, DISC_DIAMETER } from "../phaser/station-disc-pool";

export class TimelapseScene extends Phaser.Scene {
  static readonly KEY = "TimelapseScene";

  private stationPool!: StationDiscPool;

  constructor(
    private readonly map: GameMap,
    /** Frame to render once `create()` finishes. The tab module captures
     *  frame 0 from the selected preset and passes it here so the user sees
     *  the universe's starting state before pressing Run. */
    private readonly initialFrame: TimelapseFrame,
  ) {
    super({ key: TimelapseScene.KEY });
  }

  preload(): void {
    preloadStationIcons(this);
  }

  create(): void {
    this.events.once("shutdown", this.destroyScene, this);
    this.events.once("destroy", this.destroyScene, this);
    this.cameras.main.setBackgroundColor("#050709");
    this.stationPool = new StationDiscPool(this);
    this.fitCameraToMapBounds();
    this.stationPool.draw(this.initialFrame.stations);
  }

  /** Re-renders the visible station set for `frame`. Step changes call this; the runner's live-preview also calls this between captures. */
  renderFrame(frame: TimelapseFrame): void {
    // Guards the case where the runner emits a live-preview before Phaser
    // has finished booting and called create() on this scene.
    if (!this.stationPool) return;
    this.stationPool.draw(frame.stations);
  }

  private destroyScene(): void {
    this.stationPool?.destroy();
  }

  private fitCameraToMapBounds(): void {
    const totalWidth = this.map.gridSizeX * this.map.sectorSize;
    const totalHeight = this.map.gridSizeY * this.map.sectorSize;
    const camera = this.cameras.main;
    camera.setZoom(computeFitToMapZoom(camera, totalWidth, totalHeight, DISC_DIAMETER));
    camera.centerOn(totalWidth / 2, totalHeight / 2);
  }
}

/** Zoom that fits the whole map plus `edgePadding` margin on every side. The
 *  padding keeps station discs at the map edge fully visible — emigration
 *  placements can land anywhere in [0, mapWidth] × [0, mapHeight], and
 *  the map's zones run within ~10 units of the edge. */
function computeFitToMapZoom(
  camera: Phaser.Cameras.Scene2D.Camera,
  totalWidth: number,
  totalHeight: number,
  edgePadding: number,
): number {
  return Math.min(
    camera.width / (totalWidth + 2 * edgePadding),
    camera.height / (totalHeight + 2 * edgePadding),
  );
}
