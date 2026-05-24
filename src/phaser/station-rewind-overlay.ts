// Renders a past station set on the overview map while hiding the live
// station bundles. Used by the Stations Timelapse Log tab while scrubbed
// to a past moment. Activate on first scrub-back; deactivate on tab-leave or
// scrub-back-to-now.

import type { Scene } from "phaser";
import { StationDiscPool } from "./station-disc-pool";
import type { TimelapseStation } from "../sim-timelapse-state";
import { setStationVisualBundleVisible, type StationVisualBundle } from "./station-visual-bundle";

export interface StationRewindOverlay {
  /** Redraws the overlay for a new station set; skips rehiding live bundles if already showing. */
  show(stations: TimelapseStation[]): void;
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
  // Non-null while the overlay is showing — implies the live bundles are hidden.
  let pool: StationDiscPool | null = null;

  function setLiveBundlesVisible(visible: boolean): void {
    for (const bundle of getLiveBundles()) setStationVisualBundleVisible(bundle, visible);
  }

  function show(stations: TimelapseStation[]): void {
    if (!pool) {
      setLiveBundlesVisible(false);
      pool = new StationDiscPool(scene);
    }
    pool.draw(stations);
  }

  function hide(): void {
    if (!pool) return;
    pool.destroy();
    pool = null;
    setLiveBundlesVisible(true);
  }

  function destroy(): void {
    hide();
  }

  return { show, hide, destroy };
}
