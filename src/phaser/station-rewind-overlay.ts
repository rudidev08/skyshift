// Renders a TimelapseFrame's stations on the overview map while hiding the
// live station bundles. Used by the Stations Timelapse Log tab while scrubbed
// to a past moment. Activate on first scrub-back; deactivate on tab-leave or
// scrub-back-to-now.

import type { Scene } from "phaser";
import { StationDiscPool } from "./station-disc-pool";
import type { TimelapseFrame } from "../sim-timelapse-state";
import type { StationVisualBundle } from "./station-visual-bundle";

export interface StationRewindOverlay {
  /** Hides live bundles + draws the snapshot. Safe to call repeatedly with a new frame as the user scrubs. */
  show(frame: TimelapseFrame): void;
  /** Restores live bundles + clears the snapshot. */
  hide(): void;
  destroy(): void;
}

export interface StationRewindOverlayOptions {
  scene: Scene;
  /** Live bundles to hide while the rewind overlay is showing. */
  getLiveBundles: () => readonly StationVisualBundle[];
}

export function createStationRewindOverlay(options: StationRewindOverlayOptions): StationRewindOverlay {
  const { scene, getLiveBundles } = options;
  let pool: StationDiscPool | null = null;
  let active = false;

  function setLiveBundlesVisible(visible: boolean): void {
    for (const bundle of getLiveBundles()) {
      bundle.baseImage.setVisible(visible);
      bundle.overlayImage.setVisible(visible);
      bundle.iconImage.setVisible(visible);
      bundle.ringImage.setVisible(visible);
      bundle.graphics.setVisible(visible);
      bundle.nameLabel.setVisible(visible);
      for (const label of bundle.inventoryLabels) label.setVisible(visible);
      bundle.statusBadgeCircle?.setVisible(visible);
      bundle.statusBadgeText?.setVisible(visible);
    }
  }

  function show(frame: TimelapseFrame): void {
    if (!active) {
      setLiveBundlesVisible(false);
      active = true;
    }
    if (!pool) pool = new StationDiscPool(scene);
    pool.draw(frame.stations);
  }

  function hide(): void {
    if (!active) return;
    pool?.destroy();
    pool = null;
    setLiveBundlesVisible(true);
    active = false;
  }

  function destroy(): void {
    hide();
  }

  return { show, hide, destroy };
}
