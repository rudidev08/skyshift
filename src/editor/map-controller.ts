import * as Phaser from "phaser";
import type { Game } from "../game";
import type { Nebula } from "../../data/map-types";
import { isClickNotDrag } from "../phaser/viewport-culling";
import { Layer } from "../phaser/depth-layers";
import { getStationRadius } from "../phaser/station-visual-bundle";
import { StationSelectionTarget } from "../phaser/station-render-selection";
import { ZONE_LABEL_Y_OFFSET } from "../phaser/station-zone-render";
import { setAnnouncementsMuted } from "../audio-announcer";

/** Interaction mode for the in-browser map editor.
 *  - `view`   — read-only camera; no edits.
 *  - `select` — click to select an entity for inspection (no drag).
 *  - `move`   — click+drag to reposition stations / zones / nebulas. */
export type MapEditorMode = "move" | "select" | "view";

/** One entry in the click-cycling stack — repeated clicks at the same
 *  point cycle through every overlapping station/nebula/zone. */
type SelectableEntity =
  | { kind: "station"; index: number }
  | { kind: "nebula"; index: number }
  | { kind: "zone"; index: number };

/** Object currently being dragged in the map editor. */
type DragTarget =
  | { type: "background"; backgroundIndex: number }
  | { type: "station"; stationIndex: number }
  | { type: "zone"; zoneIndex: number };

interface MapEditorControls {
  editableNebulas: Nebula[];
  statusText: HTMLElement;
  viewButton: HTMLButtonElement;
  selectButton: HTMLButtonElement;
  moveButton: HTMLButtonElement;
}

const ZONE_CLICK_RADIUS = 60;

export class MapEditorController {
  private mode: MapEditorMode = "view";
  private draggedTarget: DragTarget | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private destroyed = false;
  private readonly backgroundSelectionOutline: Phaser.GameObjects.Rectangle;

  // Click-cycling state — repeated clicks at the same point cycle through
  // all overlapping selectable entities.
  private entityClickStack: SelectableEntity[] = [];
  private entityClickIndex = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private selectedEntity: SelectableEntity | null = null;

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.mode !== "move") return;
    if (this.tryStartStationDrag(pointer)) return;
    if (this.tryStartZoneDrag(pointer)) return;
    this.tryStartBackgroundDrag(pointer);
  };

  private tryStartStationDrag(pointer: Phaser.Input.Pointer): boolean {
    const stationIndex = this.getSelectedStationIndex();
    if (stationIndex === null || !this.isPointerOverStation(stationIndex, pointer.worldX, pointer.worldY)) return false;
    const stationData = this.scene.stations[stationIndex];
    this.draggedTarget = { type: "station", stationIndex };
    this.dragOffsetX = stationData.x - pointer.worldX;
    this.dragOffsetY = stationData.y - pointer.worldY;
    this.scene.cameraControls?.setEnabled(false);
    this.updateStatus();
    return true;
  }

  private tryStartZoneDrag(pointer: Phaser.Input.Pointer): boolean {
    const zoneIndex = this.getSelectedZoneIndex();
    if (zoneIndex === null || !this.isPointerOverZone(zoneIndex, pointer.worldX, pointer.worldY)) return false;
    const zone = this.scene.stationZoneVisualBundles[zoneIndex].zone;
    this.draggedTarget = { type: "zone", zoneIndex };
    this.dragOffsetX = zone.x - pointer.worldX;
    this.dragOffsetY = zone.y - pointer.worldY;
    this.scene.cameraControls?.setEnabled(false);
    this.updateStatus();
    return true;
  }

  private tryStartBackgroundDrag(pointer: Phaser.Input.Pointer): boolean {
    const backgroundIndex = this.getSelectedBackgroundIndex();
    if (backgroundIndex === null || !this.isPointerOverBackground(backgroundIndex, pointer.worldX, pointer.worldY)) return false;
    const backgroundImage = this.scene.nebulaImages[backgroundIndex];
    this.draggedTarget = { type: "background", backgroundIndex };
    this.dragOffsetX = backgroundImage.x - pointer.worldX;
    this.dragOffsetY = backgroundImage.y - pointer.worldY;
    this.scene.cameraControls?.setEnabled(false);
    this.updateStatus();
    return true;
  }

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!this.draggedTarget || !pointer.isDown) return;
    const nextX = pointer.worldX + this.dragOffsetX;
    const nextY = pointer.worldY + this.dragOffsetY;
    if (this.draggedTarget.type === "station") {
      this.moveStation(this.draggedTarget.stationIndex, nextX, nextY);
    } else if (this.draggedTarget.type === "zone") {
      this.moveZone(this.draggedTarget.zoneIndex, nextX, nextY);
    } else {
      this.moveBackground(this.draggedTarget.backgroundIndex, nextX, nextY);
    }
    this.updateStatus();
  };

  private readonly onPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (this.draggedTarget !== null) {
      this.draggedTarget = null;
      this.scene.cameraControls?.setEnabled(true);
      this.updateStatus();
      return;
    }

    if (this.mode !== "view" && isClickNotDrag(pointer)) {
      window.requestAnimationFrame(() => {
        this.selectFromClick(pointer);
        this.updateStatus();
      });
    }
  };

  private readonly onModeButtonClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const mode = button.dataset.mapMode;
    if (mode === "view" || mode === "select" || mode === "move") {
      this.setMode(mode);
    }
  };

  constructor(
    private readonly scene: Game,
    private readonly controls: MapEditorControls,
  ) {
    this.backgroundSelectionOutline = this.scene.add.rectangle(0, 0, 0, 0);
    this.backgroundSelectionOutline.isFilled = false;
    this.backgroundSelectionOutline.setStrokeStyle(3, 0xEEEEEE, 0.95);
    this.backgroundSelectionOutline.setDepth(Layer.SelectionRing);
    this.backgroundSelectionOutline.setVisible(false);

    this.controls.viewButton.addEventListener("click", this.onModeButtonClick);
    this.controls.selectButton.addEventListener("click", this.onModeButtonClick);
    this.controls.moveButton.addEventListener("click", this.onModeButtonClick);
    this.scene.input.on("pointerdown", this.onPointerDown);
    this.scene.input.on("pointermove", this.onPointerMove);
    this.scene.input.on("pointerup", this.onPointerUp);
    this.setMode("view");
  }

  setMode(mode: MapEditorMode) {
    this.mode = mode;
    this.controls.viewButton.classList.toggle("is-active", mode === "view");
    this.controls.selectButton.classList.toggle("is-active", mode === "select");
    this.controls.moveButton.classList.toggle("is-active", mode === "move");

    // Disable the in-game selection handler so the editor's click-cycling
    // owns which entity gets selected.
    this.scene.selection.enabled = false;

    if (mode === "view") {
      this.scene.selection.deselect();
      this.clearEntitySelection();
      this.scene.cameraControls?.setEnabled(true);
      this.draggedTarget = null;
    } else if (this.draggedTarget === null) {
      this.scene.cameraControls?.setEnabled(true);
    }

    this.updateStatus();
  }

  updateStatus() {
    if (this.mode === "view") {
      this.controls.statusText.textContent = "";
      return;
    }

    if (this.selectedEntity !== null) {
      if (this.selectedEntity.kind === "station") {
        this.controls.statusText.textContent = this.formatStationLabel(this.selectedEntity.index);
        return;
      }

      if (this.selectedEntity.kind === "nebula") {
        this.controls.statusText.textContent = this.formatBackgroundLabel(this.selectedEntity.index);
        return;
      }

      if (this.selectedEntity.kind === "zone") {
        this.controls.statusText.textContent = this.formatZoneLabel(this.selectedEntity.index);
        return;
      }
    }

    if (this.mode === "move") {
      this.controls.statusText.textContent = "Select a station or nebula to move";
      return;
    }

    this.controls.statusText.textContent = "Click a station, nebula, or zone to select";
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.input.off("pointerdown", this.onPointerDown);
    this.scene.input.off("pointermove", this.onPointerMove);
    this.scene.input.off("pointerup", this.onPointerUp);
    this.controls.viewButton.removeEventListener("click", this.onModeButtonClick);
    this.controls.selectButton.removeEventListener("click", this.onModeButtonClick);
    this.controls.moveButton.removeEventListener("click", this.onModeButtonClick);
    this.scene.cameraControls?.setEnabled(true);
    this.scene.selection.enabled = true;
    this.draggedTarget = null;
    this.clearEntitySelection();
    this.backgroundSelectionOutline.destroy();
  }

  private getSelectedStationIndex(): number | null {
    const selectedTarget = this.scene.selection.target;
    if (!(selectedTarget instanceof StationSelectionTarget)) return null;

    const selectedIndex = this.scene.stationBundles.findIndex(bundle => bundle.selectionTarget === selectedTarget);
    return selectedIndex >= 0 ? selectedIndex : null;
  }

  private getSelectedBackgroundIndex(): number | null {
    if (this.selectedEntity?.kind === "nebula") return this.selectedEntity.index;
    return null;
  }

  private getSelectedZoneIndex(): number | null {
    if (this.selectedEntity?.kind === "zone") return this.selectedEntity.index;
    return null;
  }

  private moveStation(stationIndex: number, nextX: number, nextY: number) {
    const bundle = this.scene.stationBundles[stationIndex];
    const stationData = this.scene.stations[stationIndex];

    stationData.x = nextX;
    stationData.y = nextY;
    bundle.entry.screenX = nextX;
    bundle.entry.screenY = nextY;

    bundle.baseImage.setPosition(nextX, nextY);
    bundle.overlayImage.setPosition(nextX, nextY);
    bundle.iconImage.setPosition(nextX, nextY);
    bundle.nameLabel.setPosition(nextX, nextY + 40 + 18);
    bundle.ringImage.setPosition(nextX, nextY);
  }

  private moveZone(zoneIndex: number, nextX: number, nextY: number) {
    const zoneVisualBundle = this.scene.stationZoneVisualBundles[zoneIndex];
    zoneVisualBundle.zone.x = nextX;
    zoneVisualBundle.zone.y = nextY;
    zoneVisualBundle.image.setPosition(nextX, nextY);
    zoneVisualBundle.label.setPosition(nextX, nextY + ZONE_LABEL_Y_OFFSET);
  }

  private moveBackground(backgroundIndex: number, nextX: number, nextY: number) {
    const image = this.scene.nebulaImages[backgroundIndex];
    image.setPosition(nextX, nextY);
    this.controls.editableNebulas[backgroundIndex].x = nextX;
    this.controls.editableNebulas[backgroundIndex].y = nextY;
    this.updateBackgroundSelectionOutline();
  }

  private selectFromClick(pointer: Phaser.Input.Pointer) {
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;

    // Gather every entity under the click so repeats cycle through them.
    const entities: SelectableEntity[] = [];

    const clickedStationIndex = this.findStationAt(worldX, worldY);
    if (clickedStationIndex !== null) {
      entities.push({ kind: "station", index: clickedStationIndex });
    }

    const matchingBackgroundIndices = this.findBackgroundIndicesAt(worldX, worldY);
    for (const backgroundIndex of matchingBackgroundIndices) {
      entities.push({ kind: "nebula", index: backgroundIndex });
    }

    const clickedZoneIndex = this.findZoneAt(worldX, worldY);
    if (clickedZoneIndex !== null) {
      entities.push({ kind: "zone", index: clickedZoneIndex });
    }

    if (entities.length === 0) {
      this.scene.selection.deselect();
      this.clearEntitySelection();
      return;
    }

    // Detect a repeat click in the same area to advance the cycle vs. restart it.
    const sameArea = Math.abs(worldX - this.lastClickX) < 20 && Math.abs(worldY - this.lastClickY) < 20;
    const sameStack = sameArea && this.entityClickStack.length === entities.length
      && this.entityClickStack.every((entity, index) =>
        entity.kind === entities[index].kind && entity.index === entities[index].index);

    if (sameStack) {
      this.entityClickIndex = (this.entityClickIndex + 1) % entities.length;
    } else {
      this.entityClickStack = entities;
      this.entityClickIndex = 0;
    }

    this.lastClickX = worldX;
    this.lastClickY = worldY;

    const entity = entities[this.entityClickIndex];
    this.applyEntitySelection(entity);
  }

  private applyEntitySelection(entity: SelectableEntity) {
    // Clear prior selection — Selection system covers stations/zones, the
    // background outline covers nebulas.
    this.scene.selection.deselect();
    this.updateBackgroundSelectionOutline();

    this.selectedEntity = entity;

    const target = entity.kind === "station"
      ? this.scene.stationBundles[entity.index].selectionTarget
      : entity.kind === "zone"
        ? this.scene.stationZoneSelectionTargets[entity.index]
        : undefined;

    if (target) {
      // Editor selections are tooling, not gameplay — suppress the station/zone
      // announcement that enterSelected() would otherwise trigger.
      setAnnouncementsMuted(true);
      try {
        this.scene.selection.select(target);
      } finally {
        setAnnouncementsMuted(false);
      }
    }

    // Nebulas use the editor's own outline rectangle, not the Selection system.
    this.updateBackgroundSelectionOutline();
  }

  private clearEntitySelection() {
    this.selectedEntity = null;
    this.entityClickStack = [];
    this.entityClickIndex = 0;
    this.updateBackgroundSelectionOutline();
  }

  private updateBackgroundSelectionOutline() {
    const selectedBackgroundIndex = this.getSelectedBackgroundIndex();
    if (selectedBackgroundIndex === null) {
      this.backgroundSelectionOutline.setVisible(false);
      return;
    }

    const image = this.scene.nebulaImages[selectedBackgroundIndex];
    this.backgroundSelectionOutline
      .setPosition(image.x, image.y)
      .setSize(image.displayWidth + 16, image.displayHeight + 16)
      .setAngle(image.angle)
      .setVisible(true);
  }

  private formatStationLabel(stationIndex: number): string {
    const station = this.scene.stations[stationIndex];
    return `${station.name ?? station.id} (${Math.round(station.x)}, ${Math.round(station.y)})`;
  }

  private formatZoneLabel(zoneIndex: number): string {
    const zoneVisualBundle = this.scene.stationZoneVisualBundles[zoneIndex];
    return `${zoneVisualBundle.zone.name} (${Math.round(zoneVisualBundle.zone.x)}, ${Math.round(zoneVisualBundle.zone.y)})`;
  }

  private formatBackgroundLabel(backgroundIndex: number): string {
    const image = this.scene.nebulaImages[backgroundIndex];
    return `${image.texture.key} (${Math.round(image.x)}, ${Math.round(image.y)})`;
  }

  private findStationAt(worldX: number, worldY: number): number | null {
    let nearestStationIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let stationIndex = 0; stationIndex < this.scene.stations.length; stationIndex++) {
      if (!this.isPointerOverStation(stationIndex, worldX, worldY)) continue;

      const station = this.scene.stations[stationIndex];
      const deltaX = worldX - station.x;
      const deltaY = worldY - station.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestStationIndex = stationIndex;
      }
    }

    return nearestStationIndex;
  }

  private findZoneAt(worldX: number, worldY: number): number | null {
    let nearestZoneIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let zoneIndex = 0; zoneIndex < this.scene.stationZoneVisualBundles.length; zoneIndex++) {
      const zone = this.scene.stationZoneVisualBundles[zoneIndex].zone;
      const deltaX = worldX - zone.x;
      const deltaY = worldY - zone.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance <= ZONE_CLICK_RADIUS && distance < nearestDistance) {
        nearestDistance = distance;
        nearestZoneIndex = zoneIndex;
      }
    }

    return nearestZoneIndex;
  }

  private isPointerOverZone(zoneIndex: number, worldX: number, worldY: number): boolean {
    const zone = this.scene.stationZoneVisualBundles[zoneIndex].zone;
    const deltaX = worldX - zone.x;
    const deltaY = worldY - zone.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    return distance <= ZONE_CLICK_RADIUS;
  }

  private isPointerOverStation(stationIndex: number, worldX: number, worldY: number): boolean {
    const station = this.scene.stations[stationIndex];
    const stationRadius = getStationRadius(station) + 12;
    const deltaX = worldX - station.x;
    const deltaY = worldY - station.y;
    const pointerDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    return pointerDistance <= stationRadius;
  }

  private findBackgroundIndicesAt(worldX: number, worldY: number): number[] {
    const matchingBackgroundIndices: number[] = [];

    for (let backgroundIndex = 0; backgroundIndex < this.scene.nebulaImages.length; backgroundIndex++) {
      if (this.isPointerOverBackground(backgroundIndex, worldX, worldY)) {
        matchingBackgroundIndices.push(backgroundIndex);
      }
    }

    return matchingBackgroundIndices;
  }

  private isPointerOverBackground(backgroundIndex: number, worldX: number, worldY: number): boolean {
    const image = this.scene.nebulaImages[backgroundIndex];
    const radians = Phaser.Math.DegToRad(-image.angle);
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const deltaX = worldX - image.x;
    const deltaY = worldY - image.y;
    const localX = deltaX * cosine - deltaY * sine;
    const localY = deltaX * sine + deltaY * cosine;
    return Math.abs(localX) <= image.displayWidth / 2 && Math.abs(localY) <= image.displayHeight / 2;
  }
}
