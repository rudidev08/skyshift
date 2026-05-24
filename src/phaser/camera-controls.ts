import * as Phaser from "phaser";
import {
  cameraMinZoomPhaserClamp,
  cameraMaxZoomPhaserClamp,
  cameraZoomLevelSpan,
  cameraWheelZoomLevelStep,
  cameraDragFriction,
} from "../../data/controls-camera";

const wheelPhaserZoomStep =
  (cameraWheelZoomLevelStep * (cameraMaxZoomPhaserClamp - cameraMinZoomPhaserClamp)) /
  cameraZoomLevelSpan;

export interface CameraControlsConfig {
  minPhaserZoom?: number;
  onZoom?: () => void;
}

export interface CameraControlsHandle {
  destroy(): void;
  setEnabled(enabled: boolean): void;
  setMinPhaserZoom(minPhaserZoom: number): void;
}

/** Map-space rectangle defining scroll limits. */
export interface ScrollBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface DragState {
  velocityX: number;
  velocityY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
}

interface PinchState {
  lastPinchDistancePixels: number;
}

interface PinchZoomHandlers {
  onPointerDown: () => void;
  onPointerMove: () => void;
  onPointerUp: () => void;
}

interface CameraControlsContext {
  scene: Phaser.Scene;
  camera: Phaser.Cameras.Scene2D.Camera;
  clampCamera: () => void;
  isEnabled: () => boolean;
  options: ResolvedCameraControlsConfig;
}

interface ResolvedCameraControlsConfig {
  minPhaserZoom: number;
  onZoom?: () => void;
}

export function setupCameraControls(
  scene: Phaser.Scene,
  bounds: ScrollBounds,
  config: CameraControlsConfig = {},
): CameraControlsHandle {
  const options: ResolvedCameraControlsConfig = {
    minPhaserZoom: config.minPhaserZoom ?? cameraMinZoomPhaserClamp,
    onZoom: config.onZoom,
  };
  const camera = scene.cameras.main;
  let enabled = true;
  const dragState: DragState = { velocityX: 0, velocityY: 0, lastX: 0, lastY: 0, dragging: false };
  const pinchState: PinchState = { lastPinchDistancePixels: 0 };

  // Phaser only allocates one pointer by default; pinch-to-zoom needs the second touch.
  scene.input.addPointer(1);

  const clampCamera = createCameraClamper(camera, bounds);
  const context: CameraControlsContext = {
    scene,
    camera,
    clampCamera,
    isEnabled: () => enabled,
    options,
  };

  const detachDragPan = attachDragPanToSceneUpdate(context, dragState);
  const detachWheelZoom = setupWheelZoom(context);
  const detachPinchZoom = setupPinchZoom(context, pinchState);

  const destroy = registerCameraTeardown(scene, detachDragPan, detachWheelZoom, detachPinchZoom);

  return {
    destroy,
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      resetDragState(dragState);
    },
    setMinPhaserZoom(minPhaserZoom: number) {
      options.minPhaserZoom = minPhaserZoom;
      if (camera.zoom < minPhaserZoom) {
        camera.zoom = minPhaserZoom;
        clampCamera();
        options.onZoom?.();
      }
    },
  };
}

/**
 * Returns a clamp function that constrains scrollX/scrollY to `bounds` using
 * Phaser 4's zoom-independent formula: worldCenter = scrollX + width/2.
 * Dividing by zoom here would misplace the limit at every zoom level.
 */
function createCameraClamper(camera: Phaser.Cameras.Scene2D.Camera, bounds: ScrollBounds): () => void {
  return () => {
    const halfWidth = camera.width / 2;
    const halfHeight = camera.height / 2;
    camera.scrollX = Phaser.Math.Clamp(camera.scrollX + halfWidth, bounds.minX, bounds.maxX) - halfWidth;
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY + halfHeight, bounds.minY, bounds.maxY) - halfHeight;
  };
}

function resetDragState(dragState: DragState): void {
  dragState.dragging = false;
  dragState.velocityX = 0;
  dragState.velocityY = 0;
}

/** Drag to pan with inertia. Tracks position manually because Phaser's
 *  prevPosition goes stale on mobile and produces growing jumps between touches. */
function updateDragPan(
  pointer: Phaser.Input.Pointer,
  context: CameraControlsContext,
  dragState: DragState,
): void {
  const panActiveThisFrame = pointer.isDown && !context.scene.input.pointer2?.isDown;
  if (panActiveThisFrame && context.isEnabled()) {
    applyDragMotion(pointer, context.camera, dragState);
  } else {
    applyInertiaGlide(context.camera, dragState);
  }
  context.clampCamera();
}

function applyDragMotion(
  pointer: Phaser.Input.Pointer,
  camera: Phaser.Cameras.Scene2D.Camera,
  dragState: DragState,
): void {
  if (!dragState.dragging) {
    // New drag starts from a fresh anchor; any leftover inertia from the previous drag would jerk the camera.
    dragState.lastX = pointer.x;
    dragState.lastY = pointer.y;
    dragState.velocityX = 0;
    dragState.velocityY = 0;
    dragState.dragging = true;
    return;
  }
  const dx = (pointer.x - dragState.lastX) / camera.zoom;
  const dy = (pointer.y - dragState.lastY) / camera.zoom;
  camera.scrollX -= dx;
  camera.scrollY -= dy;
  dragState.velocityX = dx;
  dragState.velocityY = dy;
  dragState.lastX = pointer.x;
  dragState.lastY = pointer.y;
}

function applyInertiaGlide(camera: Phaser.Cameras.Scene2D.Camera, dragState: DragState): void {
  dragState.dragging = false;
  if (Math.abs(dragState.velocityX) > 0.1 || Math.abs(dragState.velocityY) > 0.1) {
    camera.scrollX -= dragState.velocityX;
    camera.scrollY -= dragState.velocityY;
    dragState.velocityX *= cameraDragFriction;
    dragState.velocityY *= cameraDragFriction;
  } else {
    dragState.velocityX = 0;
    dragState.velocityY = 0;
  }
}

/** Wraps `scene.update` so drag-pan runs each frame; returns a function that restores the original update. */
function attachDragPanToSceneUpdate(context: CameraControlsContext, dragState: DragState): () => void {
  const { scene } = context;
  const originalUpdate = scene.update.bind(scene);
  const wrappedUpdate = (time: number, delta: number) => {
    originalUpdate(time, delta);
    updateDragPan(scene.input.activePointer, context, dragState);
  };
  scene.update = wrappedUpdate;
  return () => {
    if (scene.update === wrappedUpdate) {
      scene.update = originalUpdate;
    }
  };
}

function setupWheelZoom(context: CameraControlsContext): () => void {
  const { scene, camera, clampCamera, options } = context;
  const onWheel = (
    _pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ) => {
    if (!context.isEnabled()) return;
    const newZoom = camera.zoom - Math.sign(deltaY) * wheelPhaserZoomStep;
    camera.zoom = Phaser.Math.Clamp(newZoom, options.minPhaserZoom, cameraMaxZoomPhaserClamp);
    clampCamera();
    options.onZoom?.();
  };
  scene.input.on("wheel", onWheel);
  return () => scene.input.off("wheel", onWheel);
}

function setupPinchZoom(context: CameraControlsContext, pinchState: PinchState): () => void {
  const { scene, camera, clampCamera, options } = context;
  const handlers: PinchZoomHandlers = {
    onPointerDown: () => {
      const pointer1 = scene.input.pointer1;
      const pointer2 = scene.input.pointer2;
      if (pointer1.isDown && pointer2.isDown) {
        pinchState.lastPinchDistancePixels = Phaser.Math.Distance.Between(
          pointer1.x,
          pointer1.y,
          pointer2.x,
          pointer2.y,
        );
      }
    },
    onPointerMove: () => {
      const pointer1 = scene.input.pointer1;
      const pointer2 = scene.input.pointer2;
      if (!pointer1.isDown || !pointer2.isDown) return;

      const pinchDistancePixels = Phaser.Math.Distance.Between(
        pointer1.x,
        pointer1.y,
        pointer2.x,
        pointer2.y,
      );
      if (pinchState.lastPinchDistancePixels > 0) {
        const newZoom = camera.zoom * (pinchDistancePixels / pinchState.lastPinchDistancePixels);
        camera.zoom = Phaser.Math.Clamp(newZoom, options.minPhaserZoom, cameraMaxZoomPhaserClamp);
        clampCamera();
        options.onZoom?.();
      }
      pinchState.lastPinchDistancePixels = pinchDistancePixels;
    },
    onPointerUp: () => {
      pinchState.lastPinchDistancePixels = 0;
    },
  };
  scene.input.on("pointerdown", handlers.onPointerDown);
  scene.input.on("pointermove", handlers.onPointerMove);
  scene.input.on("pointerup", handlers.onPointerUp);
  return () => {
    scene.input.off("pointerdown", handlers.onPointerDown);
    scene.input.off("pointermove", handlers.onPointerMove);
    scene.input.off("pointerup", handlers.onPointerUp);
  };
}

/** Wires shutdown/destroy to call all detach functions exactly once; returns the destroy callback. */
function registerCameraTeardown(scene: Phaser.Scene, ...detachers: (() => void)[]): () => void {
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    for (const detach of detachers) detach();
  };
  scene.events.once("shutdown", destroy);
  scene.events.once("destroy", destroy);
  return destroy;
}
