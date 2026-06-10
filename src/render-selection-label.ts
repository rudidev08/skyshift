// HUD-facing selection contract — what a selectable map target (station,
// ship, zone) exposes to the id-card and the proximity picker. Engine-free so
// ui-* modules can consume it without pulling src/phaser/ into their graph;
// the picker itself lives in src/phaser/selection-input.ts.

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
