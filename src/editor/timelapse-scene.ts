// src/editor/timelapse-scene.ts
//
// Minimal Phaser scene for the Timelapse tab. Renders only nation-colored
// station discs with type icons — no nebulas, no ships, no HUD chrome.
// Camera fits the map by default; the user can zoom via the dial in the
// surface (min preset = fit-to-map so the entire universe is reachable).

import Phaser from "phaser";
import type { GameMap } from "../sim-map-types";
import type { TimelapseFrame } from "../sim-timelapse-state";
import { preloadStationIcons } from "../phaser/texture-cache";
import { setupZoomControls, type ZoomControls } from "../phaser/zoom-controls";
import { StationDiscPool, DISC_DIAMETER } from "../phaser/station-disc-pool";

export interface TimelapseZoomElements {
  zoomOut: HTMLElement;
  zoomLevel: HTMLElement;
  zoomIn: HTMLElement;
}

export class TimelapseScene extends Phaser.Scene {
  static readonly KEY = "TimelapseScene";

  private stationPool!: StationDiscPool;
  private zoomControls: ZoomControls | null = null;

  constructor(
    private readonly map: GameMap,
    private readonly zoomElements: TimelapseZoomElements,
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
    this.cameras.main.setBackgroundColor("#050709");
    this.stationPool = new StationDiscPool(this);
    const fitZoom = this.fitCameraToMapBounds();
    this.zoomControls = setupZoomControls(this, {
      presets: buildZoomPresets(fitZoom),
      elements: this.zoomElements,
    });
    this.stationPool.draw(this.initialFrame.stations);
  }

  /** Re-renders the visible station set for `frame`. Step changes call this; the runner's live-preview also calls this between captures. */
  renderFrame(frame: TimelapseFrame): void {
    // Guards the case where the runner emits a live-preview before Phaser
    // has finished booting and called create() on this scene.
    if (!this.stationPool) return;
    this.stationPool.draw(frame.stations);
  }

  shutdown(): void {
    this.zoomControls?.destroy();
    this.zoomControls = null;
    this.stationPool?.destroy();
  }

  /** Centers the camera and sets initial zoom = the fit-to-map level. Returns
   *  the fit zoom so the caller can use it as the dial's min preset. */
  private fitCameraToMapBounds(): number {
    // Map runs from (0, 0) to (gridSize × sectorSize) — sectors are shifted onto that
    // origin in sim-map-builder.ts's placeSectorsInMap, so no offset is needed here.
    const totalWidth = this.map.gridSizeX * this.map.sectorSize;
    const totalHeight = this.map.gridSizeY * this.map.sectorSize;
    // Pad the fit area on every side so a station disc placed at the edge stays
    // fully visible (disc radius) plus a small visual buffer. Stations placed by
    // emigration can land anywhere in [0, mapWidth] × [0, mapHeight], and authored
    // zones include positions within ~10 units of the edge — without the pad
    // their discs clip against the canvas border at fit zoom.
    const edgePadding = DISC_DIAMETER;
    const camera = this.cameras.main;
    const fitZoom = Math.min(
      camera.width / (totalWidth + 2 * edgePadding),
      camera.height / (totalHeight + 2 * edgePadding),
    );
    camera.setZoom(fitZoom);
    camera.centerOn(totalWidth / 2, totalHeight / 2);
    return fitZoom;
  }
}

/** Three-stop preset list anchored on the fit-to-map zoom. Filters out stops
 *  that aren't strictly larger than the previous one so the +/- bounds and the
 *  range-dot indicator stay sane on huge or tiny viewports. */
function buildZoomPresets(fitZoom: number): number[] {
  const candidates = [fitZoom, 0.4, 1.0];
  const presets: number[] = [];
  for (const candidate of candidates) {
    if (presets.length === 0 || candidate > presets[presets.length - 1] + 0.05) {
      presets.push(candidate);
    }
  }
  return presets;
}
