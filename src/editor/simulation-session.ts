import type { WareId } from "../../data/ware-types";

export interface SlotResult {
  minPercent: number;
  maxPercent: number;
  finalPercent: number;
}

/** Bundles the economy preview sim's mutable state with the UI helpers that react to it
 *  (status text, cache invalidation), so the run/cancel/stale/clear lifecycle is one handle. */
export class EditorSimulationSession {
  /** Drives the station-table min/max/final columns. */
  lastSlotRangesByStationId: Map<string, SlotResult[]> | null = null;
  /** Last fleet-transport approximation (wares per row per hour), keyed
   *  by `${stationId}:${shipId}`. Rendered into the fleet summary table. */
  lastFleetTransportByRow: Map<string, Map<WareId, number>> | null = null;
  /** Bumped on any user edit so an in-flight async run can detect cancellation. */
  runGeneration = 0;
  /** True while an edit has invalidated the last fleet sim but we haven't
   *  re-run — the sim panel shows the stale numbers dimmed. */
  fleetTransportIsStale = false;
  /** True once any sim run has completed — gates the "results stale" banner. */
  hasBeenRun = false;

  private pendingTimeout: number | null = null;

  /** Cancel a queued run and bump the generation so any in-flight async run
   *  drops its result instead of writing back. */
  cancelPending(): void {
    this.runGeneration++;
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  /** Total reset — used on preset switch or draft load. */
  clearCaches(): void {
    this.cancelPending();
    this.lastSlotRangesByStationId = null;
    this.lastFleetTransportByRow = null;
    this.fleetTransportIsStale = false;
    this.hasBeenRun = false;
    this.setStatus("");
  }

  /** Soft invalidation — drop station-inventory results but keep the fleet
   *  transport on screen (dimmed as stale) so the user can compare
   *  pre/post edits without paying for a fresh 1h trade sim each keystroke. */
  invalidateResults(): void {
    this.lastSlotRangesByStationId = null;
    if (this.lastFleetTransportByRow) this.fleetTransportIsStale = true;
  }

  /** Show the "results stale" banner if a prior run exists, otherwise
   *  clear the status text. */
  markResultsStale(): void {
    this.cancelPending();
    if (!this.hasBeenRun) {
      this.setStatus("");
      return;
    }
    this.setStaleStatus("Results stale — re-run simulation");
  }

  /** Update the status text beside the Run button. Does nothing when the DOM
   *  isn't present (e.g. map tab active). */
  setStatus(text: string): void {
    const statusElement = document.getElementById("simulation-status");
    if (!statusElement) return;
    statusElement.textContent = text;
    statusElement.className = "";
  }

  private setStaleStatus(text: string): void {
    const statusElement = document.getElementById("simulation-status");
    if (!statusElement) return;
    statusElement.textContent = text;
    statusElement.className = "sim-stale";
  }

  /** Run `task` after a one-frame delay so the "Running..." status paints
   *  before the heavy sim work blocks the main thread. Caller passes the
   *  `runGeneration` it captured before calling, and `task` re-checks it
   *  against `session.runGeneration` after each await to drop stale runs. */
  scheduleRun(task: () => void, generation: number): void {
    this.pendingTimeout = window.setTimeout(() => {
      this.pendingTimeout = null;
      if (generation !== this.runGeneration) return;
      task();
    }, 16);
  }
}
