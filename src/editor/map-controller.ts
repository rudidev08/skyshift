import * as Phaser from "phaser";
import type { Game } from "../game";
import type { Nebula } from "../../data/map-types";
import type { PlacedStation } from "../../data/station-types";
import { isClickNotDrag } from "../phaser/pointer-input";
import { Layer } from "../../data/visuals-layers";
import { getStationBodyRadius, getStationNameLabelOffsetY } from "../phaser/station-visual-bundle";
import type { SelectionTarget } from "../phaser/selection-input";
import { StationSelectionTarget } from "../phaser/station-render-selection";
import { ZONE_LABEL_Y_OFFSET_PIXELS } from "../phaser/station-zone-render";

/** Interaction mode for the in-browser map editor.
 *  - `view`   — read-only camera; no edits.
 *  - `select` — click to select a game object for inspection (no drag).
 *  - `move`   — click+drag to reposition stations / zones / nebulas. */
export type MapEditorMode = "view" | "select" | "move";

/** One entry in the click-cycling stack — repeated clicks at the same
 *  point cycle through every overlapping station/nebula/zone. */
type SelectableEntity =
  | { kind: "station"; index: number }
  | { kind: "nebula"; index: number }
  | { kind: "zone"; index: number };

type DragTarget =
  | { kind: "nebula"; nebulaIndex: number }
  | { kind: "station"; stationIndex: number }
  | { kind: "zone"; zoneIndex: number };

interface MapEditorControls {
  editableStations: PlacedStation[];
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
  private readonly nebulaSelectionOutline: Phaser.GameObjects.Rectangle;

  // Click-cycling state for selectFromClick / advanceClickCycle.
  private entitiesAtLastClick: SelectableEntity[] = [];
  private entityClickIndex = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private selectedEntity: SelectableEntity | null = null;

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.mode !== "move") return;
    if (this.tryStartStationDrag(pointer)) return;
    if (this.tryStartZoneDrag(pointer)) return;
    this.tryStartNebulaDrag(pointer);
  };

  private tryStartStationDrag(pointer: Phaser.Input.Pointer): boolean {
    return this.tryStartDrag(pointer, () => {
      const stationIndex = this.getSelectedStationIndex();
      if (stationIndex === null || !this.isPointerOverStation(stationIndex, pointer.worldX, pointer.worldY))
        return null;
      const station = this.scene.stations[stationIndex];
      return { x: station.x, y: station.y, dragTarget: { kind: "station", stationIndex } };
    });
  }

  private tryStartZoneDrag(pointer: Phaser.Input.Pointer): boolean {
    return this.tryStartDrag(pointer, () => {
      const zoneIndex = this.getSelectedZoneIndex();
      if (zoneIndex === null || !this.isPointerOverZone(zoneIndex, pointer.worldX, pointer.worldY))
        return null;
      const zone = this.scene.stationZoneVisualBundles[zoneIndex].zone;
      return { x: zone.x, y: zone.y, dragTarget: { kind: "zone", zoneIndex } };
    });
  }

  private tryStartNebulaDrag(pointer: Phaser.Input.Pointer): boolean {
    return this.tryStartDrag(pointer, () => {
      const nebulaIndex = this.getSelectedNebulaIndex();
      if (nebulaIndex === null || !this.isPointerOverNebula(nebulaIndex, pointer.worldX, pointer.worldY))
        return null;
      const nebulaImage = this.scene.background.nebulaImages[nebulaIndex];
      return { x: nebulaImage.x, y: nebulaImage.y, dragTarget: { kind: "nebula", nebulaIndex } };
    });
  }

  private tryStartDrag(
    pointer: Phaser.Input.Pointer,
    resolveTarget: () => { x: number; y: number; dragTarget: DragTarget } | null,
  ): boolean {
    const target = resolveTarget();
    if (target === null) return false;
    this.draggedTarget = target.dragTarget;
    this.dragOffsetX = target.x - pointer.worldX;
    this.dragOffsetY = target.y - pointer.worldY;
    this.scene.cameraControls?.setEnabled(false);
    this.updateStatus();
    return true;
  }

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!this.draggedTarget || !pointer.isDown) return;
    const nextX = pointer.worldX + this.dragOffsetX;
    const nextY = pointer.worldY + this.dragOffsetY;
    if (this.draggedTarget.kind === "station") {
      this.moveStation(this.draggedTarget.stationIndex, nextX, nextY);
    } else if (this.draggedTarget.kind === "zone") {
      this.moveZone(this.draggedTarget.zoneIndex, nextX, nextY);
    } else {
      this.moveNebula(this.draggedTarget.nebulaIndex, nextX, nextY);
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
    this.nebulaSelectionOutline = this.scene.add.rectangle(0, 0, 0, 0);
    this.nebulaSelectionOutline.isFilled = false;
    this.nebulaSelectionOutline.setStrokeStyle(3, 0xeeeeee, 0.95);
    this.nebulaSelectionOutline.setDepth(Layer.SelectionRing);
    this.nebulaSelectionOutline.setVisible(false);

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
    // owns which game object gets selected.
    this.scene.selection.interactive = false;

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
    const selectedLabel =
      this.selectedEntity !== null ? this.formatSelectedEntityStatusText(this.selectedEntity) : null;
    this.controls.statusText.textContent = selectedLabel ?? this.defaultModeStatus();
  }

  private formatSelectedEntityStatusText(entity: SelectableEntity): string {
    if (entity.kind === "station") return this.formatStationStatusText(entity.index);
    if (entity.kind === "nebula") return this.formatNebulaStatusText(entity.index);
    return this.formatZoneStatusText(entity.index);
  }

  private defaultModeStatus(): string {
    if (this.mode === "view") return "";
    if (this.mode === "move") return "Select a station, zone, or nebula to move";
    return "Click a station, nebula, or zone to select";
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
    this.scene.selection.interactive = true;
    this.draggedTarget = null;
    this.clearEntitySelection();
    this.nebulaSelectionOutline.destroy();
  }

  private getSelectedStationIndex(): number | null {
    const selectedTarget = this.scene.selection.selectedTarget;
    if (!(selectedTarget instanceof StationSelectionTarget)) return null;

    const selectedIndex = [...this.scene.stationBundleByStation.values()].findIndex(
      (bundle) => bundle.selectionTarget === selectedTarget,
    );
    return selectedIndex >= 0 ? selectedIndex : null;
  }

  private getSelectedNebulaIndex(): number | null {
    if (this.selectedEntity?.kind === "nebula") return this.selectedEntity.index;
    return null;
  }

  private getSelectedZoneIndex(): number | null {
    if (this.selectedEntity?.kind === "zone") return this.selectedEntity.index;
    return null;
  }

  private moveStation(stationIndex: number, nextX: number, nextY: number) {
    const bundle = [...this.scene.stationBundleByStation.values()][stationIndex];
    const stationData = this.scene.stations[stationIndex];

    stationData.x = nextX;
    stationData.y = nextY;

    // Write through to the shared editable state so simulation runs and
    // unsaved-edit checks see the move. Match by id, not index — the live
    // editor sim can append placeBuild stations to `scene.stations`, so scene
    // index and editable index diverge; those sim-built stations have no
    // editable entry and stay scene-only.
    const editableStation = this.controls.editableStations.find((station) => station.id === stationData.id);
    if (editableStation) {
      editableStation.x = nextX;
      editableStation.y = nextY;
    }

    bundle.baseImage.setPosition(nextX, nextY);
    bundle.overlayImage.setPosition(nextX, nextY);
    bundle.iconImage.setPosition(nextX, nextY);
    bundle.nameLabel.setPosition(nextX, nextY + getStationNameLabelOffsetY());
    bundle.ringImage.setPosition(nextX, nextY);
  }

  /** Scene-only: MapEditorState has no editable zone source, so zone moves
   *  are lost on the next remount and never reach simulation runs. */
  private moveZone(zoneIndex: number, nextX: number, nextY: number) {
    const zoneVisualBundle = this.scene.stationZoneVisualBundles[zoneIndex];
    zoneVisualBundle.zone.x = nextX;
    zoneVisualBundle.zone.y = nextY;
    zoneVisualBundle.image.setPosition(nextX, nextY);
    zoneVisualBundle.label.setPosition(nextX, nextY + ZONE_LABEL_Y_OFFSET_PIXELS);
  }

  private moveNebula(nebulaIndex: number, nextX: number, nextY: number) {
    const image = this.scene.background.nebulaImages[nebulaIndex];
    image.setPosition(nextX, nextY);
    this.controls.editableNebulas[nebulaIndex].x = nextX;
    this.controls.editableNebulas[nebulaIndex].y = nextY;
    this.updateNebulaSelectionOutline();
  }

  private selectFromClick(pointer: Phaser.Input.Pointer) {
    const mapX = pointer.worldX;
    const mapY = pointer.worldY;

    const entities = this.gatherEntitiesUnderPointer(mapX, mapY);
    if (entities.length === 0) {
      this.scene.selection.deselect();
      this.clearEntitySelection();
      return;
    }

    const entity = this.advanceClickCycle(entities, mapX, mapY);
    this.applyEntitySelection(entity);
  }

  private gatherEntitiesUnderPointer(mapX: number, mapY: number): SelectableEntity[] {
    const entities: SelectableEntity[] = [];

    const clickedStationIndex = this.findNearestStationAt(mapX, mapY);
    if (clickedStationIndex !== null) {
      entities.push({ kind: "station", index: clickedStationIndex });
    }

    const matchingNebulaIndices = this.findOverlappingNebulaIndicesAt(mapX, mapY);
    for (const nebulaIndex of matchingNebulaIndices) {
      entities.push({ kind: "nebula", index: nebulaIndex });
    }

    const clickedZoneIndex = this.findNearestZoneAt(mapX, mapY);
    if (clickedZoneIndex !== null) {
      entities.push({ kind: "zone", index: clickedZoneIndex });
    }

    return entities;
  }

  /** Repeat clicks at the same point cycle through overlapping entities; a click in a new area restarts the cycle. */
  private advanceClickCycle(entities: SelectableEntity[], mapX: number, mapY: number): SelectableEntity {
    const sameArea = Math.abs(mapX - this.lastClickX) < 20 && Math.abs(mapY - this.lastClickY) < 20;
    const sameStack =
      sameArea &&
      this.entitiesAtLastClick.length === entities.length &&
      this.entitiesAtLastClick.every(
        (entity, index) => entity.kind === entities[index].kind && entity.index === entities[index].index,
      );

    if (sameStack) {
      this.entityClickIndex = (this.entityClickIndex + 1) % entities.length;
    } else {
      this.entitiesAtLastClick = entities;
      this.entityClickIndex = 0;
    }

    this.lastClickX = mapX;
    this.lastClickY = mapY;

    return entities[this.entityClickIndex];
  }

  private applyEntitySelection(entity: SelectableEntity) {
    this.scene.selection.deselect();

    this.selectedEntity = entity;

    const selectionTarget = this.getSelectionTargetForEntity(entity);
    if (selectionTarget) {
      this.scene.selection.select(selectionTarget);
    }

    this.updateNebulaSelectionOutline();
  }

  private getSelectionTargetForEntity(entity: SelectableEntity): SelectionTarget | null {
    if (entity.kind === "station") {
      return [...this.scene.stationBundleByStation.values()][entity.index].selectionTarget;
    }
    if (entity.kind === "zone") return this.scene.stationZoneSelectionTargets[entity.index];
    return null;
  }

  private clearEntitySelection() {
    this.selectedEntity = null;
    this.entitiesAtLastClick = [];
    this.entityClickIndex = 0;
    this.updateNebulaSelectionOutline();
  }

  private updateNebulaSelectionOutline() {
    const selectedNebulaIndex = this.getSelectedNebulaIndex();
    if (selectedNebulaIndex === null) {
      this.nebulaSelectionOutline.setVisible(false);
      return;
    }

    const image = this.scene.background.nebulaImages[selectedNebulaIndex];
    this.nebulaSelectionOutline
      .setPosition(image.x, image.y)
      .setSize(image.displayWidth + 16, image.displayHeight + 16)
      .setAngle(image.angle)
      .setVisible(true);
  }

  private formatStationStatusText(stationIndex: number): string {
    const station = this.scene.stations[stationIndex];
    return `${station.name ?? station.id} (${Math.round(station.x)}, ${Math.round(station.y)})`;
  }

  private formatZoneStatusText(zoneIndex: number): string {
    const zoneVisualBundle = this.scene.stationZoneVisualBundles[zoneIndex];
    return `${zoneVisualBundle.zone.name} (${Math.round(zoneVisualBundle.zone.x)}, ${Math.round(zoneVisualBundle.zone.y)})`;
  }

  private formatNebulaStatusText(nebulaIndex: number): string {
    const image = this.scene.background.nebulaImages[nebulaIndex];
    return `${image.texture.key} (${Math.round(image.x)}, ${Math.round(image.y)})`;
  }

  private findNearestStationAt(mapX: number, mapY: number): number | null {
    let nearestStationIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let stationIndex = 0; stationIndex < this.scene.stations.length; stationIndex++) {
      if (!this.isPointerOverStation(stationIndex, mapX, mapY)) continue;

      const station = this.scene.stations[stationIndex];
      const distance = Math.hypot(mapX - station.x, mapY - station.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestStationIndex = stationIndex;
      }
    }

    return nearestStationIndex;
  }

  private findNearestZoneAt(mapX: number, mapY: number): number | null {
    let nearestZoneIndex: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let zoneIndex = 0; zoneIndex < this.scene.stationZoneVisualBundles.length; zoneIndex++) {
      const zone = this.scene.stationZoneVisualBundles[zoneIndex].zone;
      const distance = Math.hypot(mapX - zone.x, mapY - zone.y);
      if (distance <= ZONE_CLICK_RADIUS && distance < nearestDistance) {
        nearestDistance = distance;
        nearestZoneIndex = zoneIndex;
      }
    }

    return nearestZoneIndex;
  }

  private isPointerOverZone(zoneIndex: number, mapX: number, mapY: number): boolean {
    const zone = this.scene.stationZoneVisualBundles[zoneIndex].zone;
    return Math.hypot(mapX - zone.x, mapY - zone.y) <= ZONE_CLICK_RADIUS;
  }

  private isPointerOverStation(stationIndex: number, mapX: number, mapY: number): boolean {
    const station = this.scene.stations[stationIndex];
    const stationRadius = getStationBodyRadius(station) + 12;
    return Math.hypot(mapX - station.x, mapY - station.y) <= stationRadius;
  }

  private findOverlappingNebulaIndicesAt(mapX: number, mapY: number): number[] {
    const matchingNebulaIndices: number[] = [];

    for (let nebulaIndex = 0; nebulaIndex < this.scene.background.nebulaImages.length; nebulaIndex++) {
      if (this.isPointerOverNebula(nebulaIndex, mapX, mapY)) {
        matchingNebulaIndices.push(nebulaIndex);
      }
    }

    return matchingNebulaIndices;
  }

  private isPointerOverNebula(nebulaIndex: number, mapX: number, mapY: number): boolean {
    const image = this.scene.background.nebulaImages[nebulaIndex];
    return this.pointerWithinRotatedNebula(image, mapX, mapY);
  }

  private pointerWithinRotatedNebula(
    image: Phaser.GameObjects.Image,
    pointerX: number,
    pointerY: number,
  ): boolean {
    const radians = Phaser.Math.DegToRad(-image.angle);
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const deltaX = pointerX - image.x;
    const deltaY = pointerY - image.y;
    const localX = deltaX * cosine - deltaY * sine;
    const localY = deltaX * sine + deltaY * cosine;
    return Math.abs(localX) <= image.displayWidth / 2 && Math.abs(localY) <= image.displayHeight / 2;
  }
}
