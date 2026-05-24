// White arc drawn around the currently-selected target. Reads position +
// visibility from a Selection instance; owns only the Phaser Arc.

import { type Scene } from "phaser";
import { closeViewAlpha } from "./camera-fade";
import { selectionRingVisuals, stationOrbitRingRadius } from "../../data/station-visuals";
import { Layer } from "../../data/visuals-layers";
import type { Selection } from "./selection-input";

export class SelectionRingRender {
  readonly ring: Phaser.GameObjects.Arc;
  private readonly selection: Selection;

  constructor(scene: Scene, selection: Selection) {
    this.selection = selection;
    this.ring = scene.add.circle(0, 0, stationOrbitRingRadius);
    this.ring.isFilled = false;
    this.ring.setStrokeStyle(selectionRingVisuals.width, selectionRingVisuals.color);
    this.ring.setDepth(Layer.SelectionRing);
    this.ring.setVisible(false);
  }

  update(zoom: number): void {
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

  destroy(): void {
    this.ring.destroy();
  }
}
