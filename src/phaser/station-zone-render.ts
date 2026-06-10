import { type Scene } from "phaser";
import { CircleDashed } from "lucide-static";
import type { StationZone } from "../sim-station-zone-types";
import type { Selection, SelectionLabel, SelectionTarget } from "./selection-input";
import { longNameBySize } from "../../data/stations";
import { Layer } from "../../data/visuals-layers";
import { closeViewAlpha } from "./camera-fade";
import { LABEL_STYLE } from "./text-styles";
import { getStationZoneHudIcon } from "../render-hud-icon";
import { announceStationZone } from "../audio-announcer";
import { loadLucideSvgTexture } from "./texture-cache";

const ZONE_ICON_TEXTURE_KEY = "station-zone-icon";
const ZONE_ICON_TINT = 0x666666;
const ZONE_ICON_MAP_PIXELS = 80;
const ZONE_LABEL_FONT_PIXELS = 40;
export const ZONE_LABEL_Y_OFFSET_PIXELS = ZONE_ICON_MAP_PIXELS / 2 + 8;

export type StationZoneVisualBundle = {
  zone: StationZone;
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  /** A live station claims this zone — visuals stay hidden and unselectable while set. */
  occupiedByStation: boolean;
};

/** Call during Phaser preload — textures loaded outside preload aren't available in create. */
export function preloadStationZoneIcon(scene: Scene): void {
  loadLucideSvgTexture(scene, ZONE_ICON_TEXTURE_KEY, CircleDashed);
}

export class StationZoneSelectionTarget implements SelectionTarget {
  readonly kind = "zone" as const;
  private readonly visualBundle: StationZoneVisualBundle;
  private readonly isZonesViewActive: () => boolean;

  constructor(visualBundle: StationZoneVisualBundle, isZonesViewActive: () => boolean) {
    this.visualBundle = visualBundle;
    this.isZonesViewActive = isZonesViewActive;
  }

  enterSelected(): void {
    announceStationZone(this.visualBundle.zone.sector.name, this.visualBundle.zone.nameSuffix);
  }

  exitSelected(): void {
    // Nothing to clean up — zones have no animated selected state.
  }

  isActive(): boolean {
    return true;
  }

  canSelect(): boolean {
    // Selectable only in zones view and while unclaimed — prevents clicking invisible zones.
    return this.isZonesViewActive() && !this.visualBundle.occupiedByStation;
  }

  showRingAtCloseZoom(): boolean {
    // Zones have no close-zoom detail visuals; the ring is the only selection indicator.
    return true;
  }

  getSelectedLabel(): SelectionLabel {
    return {
      iconUri: getStationZoneHudIcon(),
      stackLabel: `Station Zone · ${longNameBySize[this.visualBundle.zone.size]}`,
      name: this.visualBundle.zone.name,
      serialCode: this.visualBundle.zone.code,
      description: "",
      loreTypeName: "Unclaimed Station Zone",
      lore: "An unclaimed area of space available for station construction.",
      hasLog: false,
      accentColor: "",
      statusLabel: "",
    };
  }

  getMapPosition(): { x: number; y: number } {
    return {
      x: this.visualBundle.zone.x,
      y: this.visualBundle.zone.y,
    };
  }
}

/** Create zone images, labels, and selection targets. Each target is registered
 *  with the selection registry so zones are clickable. */
export function createStationZoneVisualBundles(
  scene: Scene,
  zones: StationZone[],
  isZonesViewActive: () => boolean,
  selection: Selection,
): { visualBundles: StationZoneVisualBundle[]; selectionTargets: StationZoneSelectionTarget[] } {
  const visualBundles: StationZoneVisualBundle[] = [];
  const selectionTargets: StationZoneSelectionTarget[] = [];

  for (const zone of zones) {
    const image = scene.add.image(zone.x, zone.y, ZONE_ICON_TEXTURE_KEY);
    image.setDisplaySize(ZONE_ICON_MAP_PIXELS, ZONE_ICON_MAP_PIXELS);
    image.setTint(ZONE_ICON_TINT);
    image.setDepth(Layer.StationBase);
    image.setVisible(false);

    const label = scene.add.text(zone.x, zone.y + ZONE_LABEL_Y_OFFSET_PIXELS, zone.name, {
      ...LABEL_STYLE,
      fontSize: `${ZONE_LABEL_FONT_PIXELS}px`,
    });
    label.setOrigin(0.5, 0);
    label.setDepth(Layer.StationLabel);
    label.setVisible(false);

    const visualBundle: StationZoneVisualBundle = { zone, image, label, occupiedByStation: false };
    const target = new StationZoneSelectionTarget(visualBundle, isZonesViewActive);
    selection.register(target);

    visualBundles.push(visualBundle);
    selectionTargets.push(target);
  }

  return { visualBundles, selectionTargets };
}

/** Hide zone icons + labels when the toggle is off, and keep zones claimed by
 *  a live station hidden even when it's on. Turning on shows unclaimed icons
 *  immediately; labels stay hidden until updateStationZoneLabels reveals them
 *  by zoom level. */
export function updateStationZoneVisibility(
  visualBundles: StationZoneVisualBundle[],
  zonesViewActive: boolean,
): void {
  for (const visualBundle of visualBundles) {
    if (!zonesViewActive || visualBundle.occupiedByStation) {
      visualBundle.image.setVisible(false);
      visualBundle.label.setVisible(false);
      continue;
    }
    visualBundle.image.setVisible(true);
  }
}

/** Fade zone labels in at close zoom. Icons are unaffected so zones stay
 *  identifiable at any zoom. Claimed zones are skipped — the per-frame fade
 *  must not re-show what occupancy hid. */
export function updateStationZoneLabels(
  visualBundles: StationZoneVisualBundle[],
  zoom: number,
  zonesViewActive: boolean,
): void {
  if (!zonesViewActive) return;

  const labelAlpha = closeViewAlpha(zoom);

  for (const visualBundle of visualBundles) {
    if (visualBundle.occupiedByStation) continue;
    if (labelAlpha > 0) {
      visualBundle.label.setVisible(true);
      visualBundle.label.setAlpha(labelAlpha);
    } else {
      visualBundle.label.setVisible(false);
    }
  }
}

/** Mark a zone claimed or freed by a live station. Claiming (placeBuild puts
 *  a station on top of the zone mid-session) hides the icon + label and makes
 *  the zone unselectable; freeing (emigration) re-shows the icon when the
 *  zones view is active — the label fades back in via updateStationZoneLabels. */
export function setStationZoneOccupied(
  visualBundle: StationZoneVisualBundle,
  occupiedByStation: boolean,
  zonesViewActive: boolean,
): void {
  visualBundle.occupiedByStation = occupiedByStation;
  if (occupiedByStation) {
    visualBundle.image.setVisible(false);
    visualBundle.label.setVisible(false);
    return;
  }
  if (zonesViewActive) visualBundle.image.setVisible(true);
}
