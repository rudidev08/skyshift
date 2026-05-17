// White arc drawn around the currently-selected target. Reads position +
// visibility from a Selection instance; owns only the Phaser Arc.

import { type Scene } from "phaser";
import { closeViewAlpha } from "./camera-fade";
import { bodyRadiusBySize } from "../../data/stations";
import { selectionRingVisuals, stationVisuals } from "../../data/station-visuals";
import { Layer } from "../../data/visuals-layers";
import type { Selection } from "./selection-input";

export class SelectionRingRender {
  readonly ring: Phaser.GameObjects.Arc;
  private readonly selection: Selection;
  /** Forces the ring hidden regardless of selection/zoom. Set by the
   *  blocking-toast path while a modal has the player's attention. */
  private hiddenByToast = false;

  constructor(scene: Scene, selection: Selection) {
    this.selection = selection;
    this.ring = scene.add.circle(0, 0, bodyRadiusBySize.L + stationVisuals.inventoryRingDistanceFromBody);
    this.ring.isFilled = false;
    this.ring.setStrokeStyle(selectionRingVisuals.width, selectionRingVisuals.color);
    this.ring.setDepth(Layer.SelectionRing);
    this.ring.setVisible(false);
  }

  update(zoom: number): void {
    if (this.hiddenByToast) {
      this.ring.setVisible(false);
      return;
    }
    const target = this.selection.selectedTarget;

    // Ring fades at close zoom so it doesn't overlap station detail; opt-in
    // targets stay at full alpha.
    const keepAtCloseZoom = target?.showRingAtCloseZoom?.() ?? false;
    const ringAlpha = keepAtCloseZoom ? 1 : 1 - closeViewAlpha(zoom);
    const mapPosition = target?.getMapPosition();

    if (ringAlpha <= 0 || !mapPosition) {
      this.ring.setVisible(false);
      return;
    }

    this.ring.setPosition(mapPosition.x, mapPosition.y);
    this.ring.setAlpha(ringAlpha);
    this.ring.setVisible(true);
  }

  setHiddenByToast(hidden: boolean): void {
    this.hiddenByToast = hidden;
  }

  destroy(): void {
    this.ring.destroy();
  }
}
