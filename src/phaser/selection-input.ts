import { type Scene } from "phaser";
import { isClickNotDrag } from "./viewport-culling";

// Maximum screen-pixel distance from a tap to consider an object a candidate.
const SELECTION_RADIUS_PIXELS = 80;
// Maximum screen-pixel distance between consecutive taps to treat them as cycling.
const SIMILAR_AREA_RADIUS_PIXELS = 100;

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
  hasDetails: boolean;
  /** Nation accent applied to the id-card (tints the serial code). Empty leaves the default gold. */
  accentColor: string;
  /** Status band text at the card's footer (e.g. "Flying", "Producing Metal"). Empty hides the band. */
  statusLabel: string;
}

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
  /** Map position for the zoomed-out selection ring; null to hide. */
  getMapPosition(): { x: number; y: number } | null;
  /** True if the selection ring stays visible when zoomed in. Default: false
   *  (most targets only show the ring at distance). */
  showRingAtCloseZoom?(): boolean;
}

/** Proximity picker, cycling, current target. No Phaser drawing here — the ring visual lives in `SelectionRingRender`. */
export class Selection {
  private current: SelectionTarget | null = null;
  private readonly registeredTargets = new Set<SelectionTarget>();
  private readonly scene: Scene;
  private destroyed = false;
  private readonly onPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (!isClickNotDrag(pointer)) return;
    this.handleProximityClick(pointer, this.scene.cameras.main);
  };
  enabled = true;
  /** Restricts selection to matching kinds; null = all kinds allowed. */
  private allowedKinds: Set<SelectionKind> | null = null;

  /** Last-click screen position, used to detect cycling taps in the same area. Updated on empty-area clicks too so a follow-up tap measures from the latest pointer. */
  private lastClickScreenX = 0;
  private lastClickScreenY = 0;

  constructor(scene: Scene) {
    this.scene = scene;

    // Single global handler — proximity picks the nearest selectable object.
    scene.input.on("pointerup", this.onPointerUp);
    scene.events.once("shutdown", () => this.destroy());
    scene.events.once("destroy", () => this.destroy());
  }

  get target(): SelectionTarget | null {
    return this.current;
  }

  /** True when `target` is the currently-selected target. Lets render code
   *  ask "draw this as selected?" without a per-entity flag. */
  isSelected(target: SelectionTarget): boolean {
    return this.current === target;
  }

  register(target: SelectionTarget) {
    this.registeredTargets.add(target);
  }

  /** Restrict selection to specific kinds; null allows all (default).
   *  Deselects any current target whose kind is no longer allowed. */
  setAllowedKinds(kinds: Set<SelectionKind> | null) {
    this.allowedKinds = kinds;
    if (this.current && kinds && !kinds.has(this.current.kind)) {
      this.deselect();
    }
  }

  unregister(target: SelectionTarget) {
    this.registeredTargets.delete(target);
    if (this.current === target) {
      this.current = null;
    }
  }

  select(target: SelectionTarget) {
    if (this.current === target) return;
    this.current?.exitSelected();
    this.current = target;
    target.enterSelected();
  }

  deselect() {
    this.current?.exitSelected();
    this.current = null;
  }

  /** Click handler: pick nearest selectable within a screen-pixel radius;
   *  tapping the same area cycles through nearby candidates; deselect if
   *  nothing's nearby or candidates exhausted. */
  private handleProximityClick(pointer: Phaser.Input.Pointer, camera: Phaser.Cameras.Scene2D.Camera) {
    if (!this.enabled) return;
    const mapPoint = camera.getWorldPoint(pointer.upX, pointer.upY);
    const radiusMap = SELECTION_RADIUS_PIXELS / camera.zoom;

    const candidates = this.findCandidatesNearPoint(mapPoint, radiusMap);

    if (candidates.length === 0) {
      this.deselect();
      this.lastClickScreenX = pointer.upX;
      this.lastClickScreenY = pointer.upY;
      return;
    }

    candidates.sort((a, b) => a.distance - b.distance);
    this.selectFromSortedCandidates(candidates, pointer);
  }

  /** Walk registered targets, keeping any that pass the kind / canSelect /
   *  position filters and sit within `radiusMap` of `mapPoint`. */
  private findCandidatesNearPoint(
    mapPoint: { x: number; y: number },
    radiusMap: number,
  ): { target: SelectionTarget; distance: number }[] {
    const candidates: { target: SelectionTarget; distance: number }[] = [];
    for (const target of this.registeredTargets) {
      if (this.allowedKinds && !this.allowedKinds.has(target.kind)) continue;
      if (!target.canSelect()) continue;
      const position = target.getMapPosition();
      if (!position) continue;

      const deltaX = position.x - mapPoint.x;
      const deltaY = position.y - mapPoint.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance <= radiusMap) {
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
    const isSimilarArea = Math.sqrt(screenDeltaX * screenDeltaX + screenDeltaY * screenDeltaY) < SIMILAR_AREA_RADIUS_PIXELS;

    this.lastClickScreenX = pointer.upX;
    this.lastClickScreenY = pointer.upY;

    const nearest = candidates[0];
    if (isSimilarArea && this.current !== null && nearest.target === this.current) {
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

  /** Per-frame: auto-deselect stale targets (e.g. a ship that just landed). */
  update() {
    if (this.current && !this.current.isActive()) {
      this.current = null;
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
