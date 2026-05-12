import { type Scene } from "phaser";
import { CircleDashed } from "lucide-static";
import type { StationZone } from "../sim-station-zone-types";
import type { Selection, SelectionLabel, SelectionTarget } from "./selection-input";
import type { StationSize } from "../../data/station-types";
import { closeViewAlpha } from "./camera-fade";
import { LABEL_STYLE } from "./viewport-culling";
import { getStationZoneHudIcon } from "../render-hud-icon";
import { announceStationZone } from "../audio-announcer";
import { loadLucideSvgTexture } from "./texture-cache";

const ZONE_ICON_TEXTURE_KEY = "station-zone-icon";
const ZONE_SIZE_LABELS: Record<StationSize, string> = { S: "Small", M: "Medium", L: "Large" };
const ZONE_ICON_TINT = 0x666666;
const ZONE_ICON_MAP_SIZE = 80;
export const ZONE_LABEL_Y_OFFSET = ZONE_ICON_MAP_SIZE / 2 + 8;

export type StationZoneVisualBundle = {
  zone: StationZone;
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
};

/** Queue the station zone icon texture for loading. Call during preload. */
export function preloadStationZoneIcon(scene: Scene): void {
  loadLucideSvgTexture(scene, ZONE_ICON_TEXTURE_KEY, CircleDashed);
}

export class StationZoneSelectionTarget implements SelectionTarget {
  readonly kind = "zone" as const;
  private readonly visualBundle: StationZoneVisualBundle;
  private readonly zonesVisibleRef: { value: boolean };

  constructor(visualBundle: StationZoneVisualBundle, zonesVisibleRef: { value: boolean }) {
    this.visualBundle = visualBundle;
    this.zonesVisibleRef = zonesVisibleRef;
  }

  enterSelected(): void {
    announceStationZone(this.visualBundle.zone.sector.name, this.visualBundle.zone.nameSuffix);
  }

  exitSelected(): void {
    // Nothing to clean up — zones have no animated selected state.
  }

  isActive(): boolean {
    // Always present in the world.
    return true;
  }

  canSelect(): boolean {
    // Selectable only when the toggle is active — prevents clicking invisible zones.
    return this.zonesVisibleRef.value;
  }

  showRingAtCloseZoom(): boolean {
    // Zones have no close-zoom detail visuals; the ring is the only selection indicator.
    return true;
  }

  getSelectedLabel(): SelectionLabel {
    const sizeSegment = ` · ${ZONE_SIZE_LABELS[this.visualBundle.zone.size]}`;
    return {
      iconUri: getStationZoneHudIcon(),
      stackLabel: `Station Zone${sizeSegment}`,
      name: this.visualBundle.zone.name,
      serialCode: this.visualBundle.zone.code,
      description: "",
      loreTypeName: "Unclaimed Station Zone",
      lore: "An unclaimed area of space available for station construction.",
      hasDetails: false,
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
  zonesVisibleRef: { value: boolean },
  selection: Selection,
): { visualBundles: StationZoneVisualBundle[]; selectionTargets: StationZoneSelectionTarget[] } {
  const visualBundles: StationZoneVisualBundle[] = [];
  const selectionTargets: StationZoneSelectionTarget[] = [];

  for (const zone of zones) {
    const image = scene.add.image(zone.x, zone.y, ZONE_ICON_TEXTURE_KEY);
    image.setDisplaySize(ZONE_ICON_MAP_SIZE, ZONE_ICON_MAP_SIZE);
    image.setTint(ZONE_ICON_TINT);
    image.setVisible(false);

    const label = scene.add.text(
      zone.x,
      zone.y + ZONE_LABEL_Y_OFFSET,
      zone.name,
      { ...LABEL_STYLE, fontSize: "40px" },
    );
    label.setOrigin(0.5, 0);
    label.setVisible(false);

    const visualBundle: StationZoneVisualBundle = { zone, image, label };
    const target = new StationZoneSelectionTarget(visualBundle, zonesVisibleRef);
    selection.register(target);

    visualBundles.push(visualBundle);
    selectionTargets.push(target);
  }

  return { visualBundles, selectionTargets };
}

/** Hide zone icons + labels when toggle is off. Turning on shows icons
 *  immediately; labels stay hidden until updateStationZoneLabels reveals them
 *  by zoom level. */
export function updateStationZoneVisibility(
  visualBundles: StationZoneVisualBundle[],
  visible: boolean,
): void {
  for (const visualBundle of visualBundles) {
    if (!visible) {
      visualBundle.image.setVisible(false);
      visualBundle.label.setVisible(false);
      continue;
    }
    visualBundle.image.setVisible(true);
  }
}

/** Fade zone labels in at close zoom. Icons are unaffected so zones stay
 *  identifiable at any zoom. */
export function updateStationZoneLabels(
  visualBundles: StationZoneVisualBundle[],
  zoom: number,
  visible: boolean,
): void {
  if (!visible) return;

  const labelAlpha = closeViewAlpha(zoom);

  for (const visualBundle of visualBundles) {
    if (labelAlpha > 0) {
      visualBundle.label.setVisible(true);
      visualBundle.label.setAlpha(labelAlpha);
    } else {
      visualBundle.label.setVisible(false);
    }
  }
}
