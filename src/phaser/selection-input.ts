import { type Scene } from "phaser";
import { isClickNotDrag } from "./pointer-input";
import type { SelectionKind, SelectionTarget } from "../render-selection-label";

// The selection contract + HUD label shapes are engine-free and live in
// render-selection-label.ts; re-exported so phaser-side consumers keep one
// import for the selection system.
export { EMPTY_SELECTION_LABEL } from "../render-selection-label";
export type { SelectionKind, SelectionLabel, SelectionTarget } from "../render-selection-label";

const SELECTION_RADIUS_PIXELS = 80;
const SAME_TAP_AREA_RADIUS_PIXELS = 100;

/** Proximity picker, cycling, current target. No Phaser drawing here — the ring visual lives in `SelectionRingRender`. */
export class Selection {
  selectedTarget: SelectionTarget | null = null;
  private readonly registeredTargets = new Set<SelectionTarget>();
  private readonly scene: Scene;
  private destroyed = false;
  private readonly onPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (!isClickNotDrag(pointer)) return;
    this.handleProximityClick(pointer, this.scene.cameras.main);
  };
  interactive = true;
  /** Restricts selection to matching kinds; null = all kinds allowed. */
  private allowedKinds: Set<SelectionKind> | null = null;

  /** Updated on empty-area clicks too, so a follow-up tap measures from the latest pointer rather than the last successful selection. */
  private lastClickScreenX = 0;
  private lastClickScreenY = 0;

  constructor(scene: Scene) {
    this.scene = scene;

    scene.input.on("pointerup", this.onPointerUp);
    scene.events.once("shutdown", () => this.destroy());
    scene.events.once("destroy", () => this.destroy());
  }

  /** True when `target` is the currently-selected target. Lets render code
   *  ask "draw this as selected?" without a per-game-object flag. */
  isSelected(target: SelectionTarget): boolean {
    return this.selectedTarget === target;
  }

  register(target: SelectionTarget) {
    this.registeredTargets.add(target);
  }

  /** Restrict selection to specific kinds; null allows all (default).
   *  Deselects any current target whose kind is no longer allowed. */
  setAllowedKinds(kinds: Set<SelectionKind> | null) {
    this.allowedKinds = kinds;
    if (this.selectedTarget && kinds && !kinds.has(this.selectedTarget.kind)) {
      this.deselect();
    }
  }

  unregister(target: SelectionTarget) {
    this.registeredTargets.delete(target);
    if (this.selectedTarget === target) {
      this.selectedTarget = null;
    }
  }

  select(target: SelectionTarget) {
    if (this.selectedTarget === target) return;
    this.selectedTarget?.exitSelected();
    this.selectedTarget = target;
    target.enterSelected();
  }

  deselect() {
    this.selectedTarget?.exitSelected();
    this.selectedTarget = null;
  }

  /** Click handler: pick nearest selectable within a screen-pixel radius;
   *  tapping the same area cycles through nearby candidates; deselect if
   *  nothing's nearby or candidates exhausted. */
  private handleProximityClick(pointer: Phaser.Input.Pointer, camera: Phaser.Cameras.Scene2D.Camera) {
    if (!this.interactive) return;
    const mapPosition = camera.getWorldPoint(pointer.upX, pointer.upY);
    const radiusInMapUnits = SELECTION_RADIUS_PIXELS / camera.zoom;

    const candidates = this.collectCandidatesNearPoint(mapPosition, radiusInMapUnits);

    if (candidates.length === 0) {
      this.deselect();
      this.lastClickScreenX = pointer.upX;
      this.lastClickScreenY = pointer.upY;
      return;
    }

    candidates.sort((a, b) => a.distance - b.distance);
    this.selectFromSortedCandidates(candidates, pointer);
  }

  private collectCandidatesNearPoint(
    mapPosition: { x: number; y: number },
    radiusInMapUnits: number,
  ): { target: SelectionTarget; distance: number }[] {
    const candidates: { target: SelectionTarget; distance: number }[] = [];
    for (const target of this.registeredTargets) {
      if (this.allowedKinds && !this.allowedKinds.has(target.kind)) continue;
      if (!target.canSelect()) continue;
      const position = target.getMapPosition();
      if (!position) continue;

      const deltaX = position.x - mapPosition.x;
      const deltaY = position.y - mapPosition.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance <= radiusInMapUnits) {
        candidates.push({ target, distance });
      }
    }
    return candidates;
  }

  /** Pick from the (sorted-nearest-first) candidate list. A tap in the same
   *  area as the prior tap cycles past the currently-selected target (then
   *  deselects when the cycle exhausts); a fresh tap selects the nearest. */
  private selectFromSortedCandidates(
    candidates: { target: SelectionTarget; distance: number }[],
    pointer: Phaser.Input.Pointer,
  ) {
    const screenDeltaX = pointer.upX - this.lastClickScreenX;
    const screenDeltaY = pointer.upY - this.lastClickScreenY;
    const isSameTapArea =
      Math.sqrt(screenDeltaX * screenDeltaX + screenDeltaY * screenDeltaY) <
      SAME_TAP_AREA_RADIUS_PIXELS;

    this.lastClickScreenX = pointer.upX;
    this.lastClickScreenY = pointer.upY;

    const selectedIndex = candidates.findIndex((candidate) => candidate.target === this.selectedTarget);
    if (isSameTapArea && this.selectedTarget !== null && selectedIndex !== -1) {
      const nextIndex = selectedIndex + 1;
      if (nextIndex < candidates.length) {
        this.select(candidates[nextIndex].target);
      } else {
        // Cycled past the last candidate — deselect.
        this.deselect();
      }
      return;
    }

    this.select(candidates[0].target);
  }

  /** Per-frame: auto-deselect a stale target (e.g. a ship that just landed). */
  clearStaleTargetThisFrame() {
    if (this.selectedTarget && !this.selectedTarget.isActive()) {
      this.selectedTarget = null;
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.input.off("pointerup", this.onPointerUp);
    this.registeredTargets.clear();
    this.deselect();
  }
}
