import { cullingMargin, cullingRefreshIntervalMilliseconds } from "../../data/controls-camera";

interface CullingBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// One struct so the culling state stays in sync; separate `let`s drift.
const cullingCache: {
  bounds: CullingBounds | null;
  lastRefreshTime: number;
  lastScrollX: number;
  lastScrollY: number;
  lastZoom: number;
  lastWidth: number;
  lastHeight: number;
} = {
  bounds: null,
  lastRefreshTime: 0,
  lastScrollX: 0,
  lastScrollY: 0,
  lastZoom: 0,
  lastWidth: 0,
  lastHeight: 0,
};

/** Recomputes at most once per `cullingRefreshIntervalMilliseconds`; `cullingMargin`
 *  pads the bounds so off-screen entities that scroll in between refreshes still
 *  draw without popping. */
function getOrRefreshCullingBounds(camera: Phaser.Cameras.Scene2D.Camera): CullingBounds {
  if (cullingCache.bounds && !isCullingCacheStale(camera)) return cullingCache.bounds;
  recomputeCullingBounds(camera);
  return cullingCache.bounds!;
}

function isCullingCacheStale(camera: Phaser.Cameras.Scene2D.Camera): boolean {
  const cameraChanged =
    camera.scrollX !== cullingCache.lastScrollX ||
    camera.scrollY !== cullingCache.lastScrollY ||
    camera.zoom !== cullingCache.lastZoom ||
    camera.width !== cullingCache.lastWidth ||
    camera.height !== cullingCache.lastHeight;
  if (!cameraChanged) return false;
  // A moved camera isn't enough — wait until the refresh interval elapses so we
  // recompute at most once per `cullingRefreshIntervalMilliseconds`.
  return performance.now() - cullingCache.lastRefreshTime >= cullingRefreshIntervalMilliseconds;
}

function recomputeCullingBounds(camera: Phaser.Cameras.Scene2D.Camera): void {
  cullingCache.lastRefreshTime = performance.now();
  cullingCache.lastScrollX = camera.scrollX;
  cullingCache.lastScrollY = camera.scrollY;
  cullingCache.lastZoom = camera.zoom;
  cullingCache.lastWidth = camera.width;
  cullingCache.lastHeight = camera.height;

  // Phaser 4: world center = scrollX + width/2 (zoom-independent). Dividing by
  // zoom would shift the culling region off-center.
  const centerX = cullingCache.lastScrollX + cullingCache.lastWidth / 2;
  const centerY = cullingCache.lastScrollY + cullingCache.lastHeight / 2;
  const halfVisibleWidth = cullingCache.lastWidth / (2 * cullingCache.lastZoom);
  const halfVisibleHeight = cullingCache.lastHeight / (2 * cullingCache.lastZoom);
  const extendX = halfVisibleWidth * (1 + cullingMargin);
  const extendY = halfVisibleHeight * (1 + cullingMargin);
  cullingCache.bounds = {
    minX: centerX - extendX,
    maxX: centerX + extendX,
    minY: centerY - extendY,
    maxY: centerY + extendY,
  };
}

/** True if a map-space point is within the culling viewport. Bounds cache
 *  invalidates on camera move/zoom/resize. */
export function isVisibleInViewport(
  camera: Phaser.Cameras.Scene2D.Camera,
  target: { x: number; y: number },
): boolean {
  const bounds = getOrRefreshCullingBounds(camera);
  return (
    target.x >= bounds.minX && target.x <= bounds.maxX && target.y >= bounds.minY && target.y <= bounds.maxY
  );
}

/** Reset the culling cache. Call on scene restart to drop stale bounds. */
export function resetCullingCache(): void {
  cullingCache.bounds = null;
}
