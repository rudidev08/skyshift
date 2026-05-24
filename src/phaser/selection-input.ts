import { type Scene } from "phaser";
import { isClickNotDrag } from "./pointer-input";

const SELECTION_RADIUS_PIXELS = 80;
const SAME_TAP_AREA_RADIUS_PIXELS = 100;

export interface SelectionLabel {
  /** Data URI for the ghosted outline seal behind the id-card header */
  iconUri: string;
  /** Type line shown in the id-card header under the name, e.g. "Seedhaul" or "Farm · Large" */
  stackLabel: string;
  name: string;
  /** Passport-style short id, e.g. "BIO-42" or "BIO-F" */
  serialCode: string;
  /** Cargo-grid contents (direct grid children) — empty when no inventory */
  description: string;
  /** Title shown inside the lore drawer */
  loreTypeName: string;
  /** Lore body text shown inside the lore drawer */
  lore: string;
  /** Whether this target has a trade debug log available */
  hasLog: boolean;
  /** Nation accent applied to the id-card (tints the serial code). Empty leaves the default gold. */
  accentColor: string;
  /** Status band text at the card's footer (e.g. "Flying", "Producing Metal"). Empty hides the band. */
  statusLabel: string;
}

// Shown in the HUD when nothing is selected.
export const EMPTY_SELECTION_LABEL: SelectionLabel = {
  iconUri: "",
  stackLabel: "",
  name: "",
  serialCode: "",
  description: "",
  loreTypeName: "",
  lore: "",
  hasLog: false,
  accentColor: "",
  statusLabel: "",
};

export type SelectionKind = "station" | "ship" | "zone";

export interface SelectionTarget {
  /** Target type — `allowedKinds` filter restricts what's selectable per view
   *  mode (e.g. overview only selects stations). */
  readonly kind: SelectionKind;
  enterSelected(): void;
  exitSelected(): void;
  /** False if the target was deselected externally (e.g. ship landing). */
  isActive(): boolean;
  /** True if currently eligible for proximity selection. */
  canSelect(): boolean;
  /** HUD content for the info panel. */
  getSelectedLabel(): SelectionLabel;
  /** Map position used both for the zoomed-out selection ring and for the proximity picker; null hides the ring AND excludes the target from picker candidates. */
  getMapPosition(): { x: number; y: number } | null;
  /** True if the selection ring stays visible when zoomed in. Default: false
   *  (most targets only show the ring at distance). */
  showRingAtCloseZoom?(): boolean;
}

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

    const nearest = candidates[0];
    if (isSameTapArea && this.selectedTarget !== null && nearest.target === this.selectedTarget) {
      if (candidates.length > 1) {
        this.select(candidates[1].target);
      } else {
        // Cycled past the last candidate — deselect.
        this.deselect();
      }
      return;
    }

    this.select(nearest.target);
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
