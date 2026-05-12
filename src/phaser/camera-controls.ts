import * as Phaser from "phaser";
import { cameraMinZoom, cameraMaxZoom, cameraZoomStep, cameraDragFriction } from "../../data/controls-camera";

export interface CameraControlsConfig {
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  /** 0-1 velocity multiplier per frame after release; lower = longer glide. */
  friction?: number;
  onZoom?: () => void;
}

export interface CameraControlsHandle {
  destroy(): void;
  setEnabled(enabled: boolean): void;
  setMinZoom(min: number): void;
}

/** Map-space rectangle defining scroll limits. */
export interface ScrollBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const defaults: Omit<Required<CameraControlsConfig>, "onZoom"> = {
  minZoom: cameraMinZoom,
  maxZoom: cameraMaxZoom,
  zoomStep: cameraZoomStep,
  friction: cameraDragFriction,
};

interface DragState {
  velocityX: number;
  velocityY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
}

interface PinchState {
  lastPinchDistance: number;
}

interface PinchZoomHandlers {
  onPointerDown: () => void;
  onPointerMove: () => void;
  onPointerUp: () => void;
}

export function setupCameraControls(
  scene: Phaser.Scene,
  bounds: ScrollBounds,
  config: CameraControlsConfig = {},
): CameraControlsHandle {
  const options = { ...defaults, ...config };
  const camera = scene.cameras.main;
  let enabled = true;
  const dragState: DragState = { velocityX: 0, velocityY: 0, lastX: 0, lastY: 0, dragging: false };
  const pinchState: PinchState = { lastPinchDistance: 0 };

  // Phaser only allocates one pointer by default; pinch-to-zoom needs the second touch.
  scene.input.addPointer(1);

  const clampCamera = createCameraClamper(camera, bounds);
  const restoreUpdate = wireDragPanIntoSceneUpdate(scene, () => enabled, dragState, options.friction, camera, clampCamera);
  const detachWheelZoom = setupWheelZoom(scene, camera, options, clampCamera, () => enabled);
  const detachPinchZoom = setupPinchZoom(scene, camera, options, clampCamera, pinchState);

  const destroy = registerCameraTeardown(scene, restoreUpdate, detachWheelZoom, detachPinchZoom);

  return {
    destroy,
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      resetDragState(dragState);
    },
    setMinZoom(min: number) {
      options.minZoom = min;
      if (camera.zoom < min) {
        camera.zoom = min;
        clampCamera();
        options.onZoom?.();
      }
    },
  };
}

/**
 * Build a clamp function that keeps the grid edge at screen center but no further.
 * Phaser 4 world center = scrollX + width/2 (zoom-independent) — DO NOT divide by zoom.
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

/**
 * Drag to pan with inertia. Tracks position manually because Phaser's
 * prevPosition goes stale on mobile and produces growing jumps between touches.
 */
function updateDragPan(
  pointer: Phaser.Input.Pointer,
  scene: Phaser.Scene,
  enabled: boolean,
  dragState: DragState,
  friction: number,
  camera: Phaser.Cameras.Scene2D.Camera,
  clampCamera: () => void,
): void {
  const isDown = pointer.isDown && !scene.input.pointer2?.isDown;
  if (isDown && enabled) {
    if (!dragState.dragging) {
      // New drag starts from a fresh anchor; any leftover inertia from the previous drag would jerk the camera.
      dragState.lastX = pointer.x;
      dragState.lastY = pointer.y;
      dragState.velocityX = 0;
      dragState.velocityY = 0;
      dragState.dragging = true;
    } else {
      const dx = (pointer.x - dragState.lastX) / camera.zoom;
      const dy = (pointer.y - dragState.lastY) / camera.zoom;
      camera.scrollX -= dx;
      camera.scrollY -= dy;
      dragState.velocityX = dx;
      dragState.velocityY = dy;
      dragState.lastX = pointer.x;
      dragState.lastY = pointer.y;
    }
  } else {
    dragState.dragging = false;
    if (Math.abs(dragState.velocityX) > 0.1 || Math.abs(dragState.velocityY) > 0.1) {
      camera.scrollX -= dragState.velocityX;
      camera.scrollY -= dragState.velocityY;
      dragState.velocityX *= friction;
      dragState.velocityY *= friction;
    } else {
      dragState.velocityX = 0;
      dragState.velocityY = 0;
    }
  }
  clampCamera();
}

/** Wraps `scene.update` so drag-pan runs each frame; returns a function that restores the original update. */
function wireDragPanIntoSceneUpdate(
  scene: Phaser.Scene,
  isEnabled: () => boolean,
  dragState: DragState,
  friction: number,
  camera: Phaser.Cameras.Scene2D.Camera,
  clampCamera: () => void,
): () => void {
  const originalUpdate = scene.update.bind(scene);
  const wrappedUpdate = (time: number, delta: number) => {
    originalUpdate(time, delta);
    updateDragPan(scene.input.activePointer, scene, isEnabled(), dragState, friction, camera, clampCamera);
  };
  scene.update = wrappedUpdate;
  return () => {
    if (scene.update === wrappedUpdate) {
      scene.update = originalUpdate;
    }
  };
}

/** Returns a detach function that removes the wheel listener. */
function setupWheelZoom(
  scene: Phaser.Scene,
  camera: Phaser.Cameras.Scene2D.Camera,
  options: Required<Omit<CameraControlsConfig, "onZoom">> & { onZoom?: () => void },
  clampCamera: () => void,
  isEnabled: () => boolean,
): () => void {
  const onWheel = (
    _pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ) => {
    if (!isEnabled()) return;
    const newZoom = camera.zoom - Math.sign(deltaY) * options.zoomStep;
    camera.zoom = Phaser.Math.Clamp(newZoom, options.minZoom, options.maxZoom);
    clampCamera();
    options.onZoom?.();
  };
  scene.input.on("wheel", onWheel);
  return () => scene.input.off("wheel", onWheel);
}

/** Returns a detach function that removes the three pointer listeners. */
function setupPinchZoom(
  scene: Phaser.Scene,
  camera: Phaser.Cameras.Scene2D.Camera,
  options: Required<Omit<CameraControlsConfig, "onZoom">> & { onZoom?: () => void },
  clampCamera: () => void,
  pinchState: PinchState,
): () => void {
  const handlers: PinchZoomHandlers = {
    onPointerDown: () => {
      const pointer1 = scene.input.pointer1;
      const pointer2 = scene.input.pointer2;
      if (pointer1.isDown && pointer2.isDown) {
        pinchState.lastPinchDistance = Phaser.Math.Distance.Between(pointer1.x, pointer1.y, pointer2.x, pointer2.y);
      }
    },
    onPointerMove: () => {
      const pointer1 = scene.input.pointer1;
      const pointer2 = scene.input.pointer2;
      if (!pointer1.isDown || !pointer2.isDown) return;

      const distance = Phaser.Math.Distance.Between(pointer1.x, pointer1.y, pointer2.x, pointer2.y);
      if (pinchState.lastPinchDistance > 0) {
        const newZoom = camera.zoom * (distance / pinchState.lastPinchDistance);
        camera.zoom = Phaser.Math.Clamp(newZoom, options.minZoom, options.maxZoom);
        clampCamera();
        options.onZoom?.();
      }
      pinchState.lastPinchDistance = distance;
    },
    onPointerUp: () => {
      pinchState.lastPinchDistance = 0;
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
function registerCameraTeardown(
  scene: Phaser.Scene,
  ...detachers: (() => void)[]
): () => void {
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
