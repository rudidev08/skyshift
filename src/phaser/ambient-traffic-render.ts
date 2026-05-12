// Cosmetic dots flying between nearby stations. No sim dependency, no
// interactivity — purely a visual layer drawn from a pooled set of Circle
// game objects.

import { type Scene } from "phaser";
import { ambientTrafficConfig } from "../../data/station-ambient-traffic-visuals";
import { closeViewAlpha } from "./camera-fade";
import { isVisibleInViewport } from "./viewport-culling";
import { GameObjectRenderPool } from "./game-object-render-pool";
import { Layer } from "./depth-layers";

/** Structural subset — only x/y are needed; both Station and StationPlacement satisfy it. */
type AmbientStation = { x: number; y: number };

interface AmbientRoute {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  directionX: number;
  directionY: number;
  routeLength: number;
  dotCount: number;
}

interface AmbientDot {
  route: AmbientRoute;
  progress: number;
  direction: number;
  speedMultiplier: number;
  laneOffset: number;
  pulseSpeed: number;
  pulsePhase: number;
}

export interface AmbientTrafficSystem {
  dotPool: GameObjectRenderPool<Phaser.GameObjects.Arc>;
  routes: AmbientRoute[];
  dots: AmbientDot[];
  accumulatedDelta: number;
}

interface AmbientTrafficRenderFrameOptions {
  advanceSeconds: number;
  time: number;
  camera: Phaser.Cameras.Scene2D.Camera;
}

/** Build route cache and create all ambient dots. Call once at scene init. */
export function createAmbientTraffic(scene: Scene, stations: AmbientStation[], sectorSize: number): AmbientTrafficSystem {
  const routes = buildAmbientRoutes(stations, sectorSize);
  const dots = spawnAmbientDots(routes);

  const dotPool = new GameObjectRenderPool<Phaser.GameObjects.Arc>(scene, (poolScene) => {
    const circle = poolScene.add.circle(0, 0, ambientTrafficConfig.dotRadiusZoomedOut, ambientTrafficConfig.dotColor, 1);
    circle.setDepth(Layer.AmbientTraffic);
    return circle;
  });

  return { dotPool, routes, dots, accumulatedDelta: 0 };
}

interface NeighborCandidate {
  index: number;
  distanceSquared: number;
}

function buildAmbientRoutes(stations: AmbientStation[], sectorSize: number): AmbientRoute[] {
  const maxDistance = sectorSize * ambientTrafficConfig.distanceMultiplier;
  const maxDistanceSquared = maxDistance * maxDistance;
  const dotsPerRoute = ambientTrafficConfig.dotsPerRoute;
  const closestCount = ambientTrafficConfig.closestStationCount;
  const routes: AmbientRoute[] = [];

  // Each station picks its N closest neighbors within max distance. Pairs are
  // deduped; if both ends claim the same route, the higher dot count wins.
  const routeByStationPair = new Map<string, AmbientRoute>();

  for (let i = 0; i < stations.length; i++) {
    const candidates = findClosestNeighborCandidates(stations, i, maxDistanceSquared);
    const neighborCount = Math.min(closestCount, candidates.length);

    for (let n = 0; n < neighborCount; n++) {
      // Closer neighbors get more dots; ranks past the array length reuse the last value.
      const dotCount = dotsPerRoute[Math.min(n, dotsPerRoute.length - 1)];
      upsertPairRoute(routes, routeByStationPair, stations, i, candidates[n], dotCount);
    }
  }
  return routes;
}

function findClosestNeighborCandidates(
  stations: AmbientStation[],
  fromIndex: number,
  maxDistanceSquared: number,
): NeighborCandidate[] {
  const stationA = stations[fromIndex];
  const candidates: NeighborCandidate[] = [];
  for (let j = 0; j < stations.length; j++) {
    if (j === fromIndex) continue;
    const stationB = stations[j];
    const deltaX = stationB.x - stationA.x;
    const deltaY = stationB.y - stationA.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared > maxDistanceSquared || distanceSquared === 0) continue;
    candidates.push({ index: j, distanceSquared });
  }
  candidates.sort((leftCandidate, rightCandidate) => leftCandidate.distanceSquared - rightCandidate.distanceSquared);
  return candidates;
}

function upsertPairRoute(
  routes: AmbientRoute[],
  routeByStationPair: Map<string, AmbientRoute>,
  stations: AmbientStation[],
  fromIndex: number,
  neighbor: NeighborCandidate,
  dotCount: number,
): void {
  const low = Math.min(fromIndex, neighbor.index);
  const high = Math.max(fromIndex, neighbor.index);
  const stationPairKey = `${low}:${high}`;

  const existing = routeByStationPair.get(stationPairKey);
  if (existing) {
    // Both stations claim this route — keep the higher dot count.
    if (dotCount > existing.dotCount) existing.dotCount = dotCount;
    return;
  }

  const stationA = stations[fromIndex];
  const stationB = stations[neighbor.index];
  const deltaX = stationB.x - stationA.x;
  const deltaY = stationB.y - stationA.y;
  const routeLength = Math.sqrt(neighbor.distanceSquared);
  const route: AmbientRoute = {
    startX: stationA.x,
    startY: stationA.y,
    endX: stationB.x,
    endY: stationB.y,
    directionX: deltaX / routeLength,
    directionY: deltaY / routeLength,
    routeLength,
    dotCount,
  };
  routeByStationPair.set(stationPairKey, route);
  routes.push(route);
}

function spawnAmbientDots(routes: AmbientRoute[]): AmbientDot[] {
  // Per-dot randomization (direction, speed, pulse) keeps dots from moving in lockstep.
  const dots: AmbientDot[] = [];
  const fastPulse = 1 / ambientTrafficConfig.pulseSecondsMin;
  const slowPulse = 1 / ambientTrafficConfig.pulseSecondsMax;
  const speedVariation = ambientTrafficConfig.speedVariation;
  const laneWidth = ambientTrafficConfig.laneWidth;
  for (const route of routes) {
    for (let dotIndex = 0; dotIndex < route.dotCount; dotIndex++) {
      dots.push({
        route,
        progress: (dotIndex / route.dotCount) * route.routeLength,
        direction: Math.random() < 0.5 ? 1 : -1,
        speedMultiplier: 1 + (Math.random() * 2 - 1) * speedVariation,
        laneOffset: (Math.random() * 2 - 1) * laneWidth,
        pulseSpeed: slowPulse + Math.random() * (fastPulse - slowPulse),
        pulsePhase: Math.random(),
      });
    }
  }
  return dots;
}

/** Advance dots and redraw at a fixed rate. Call every frame — skips work between redraws. */
export function updateAmbientTraffic(
  state: AmbientTrafficSystem,
  deltaSeconds: number,
  time: number,
  camera: Phaser.Cameras.Scene2D.Camera,
) {
  // Skip work between redraws — the previous frame's circles stay on screen until the next redraw tick.
  const redrawInterval = 1 / ambientTrafficConfig.redrawsPerSecond;
  state.accumulatedDelta += deltaSeconds;
  if (state.accumulatedDelta < redrawInterval) return;

  // Advance by the full accumulated delta so dots don't lose the time we skipped between redraws.
  const effectiveDelta = state.accumulatedDelta;
  state.accumulatedDelta = 0;
  renderAmbientTrafficFrame(state, {
    advanceSeconds: effectiveDelta,
    time,
    camera,
  });
}

/** Redraw without advancing dots. Used when a view mode hid the pool and the
 *  sim is still paused. */
export function redrawAmbientTraffic(
  state: AmbientTrafficSystem,
  time: number,
  camera: Phaser.Cameras.Scene2D.Camera,
) {
  renderAmbientTrafficFrame(state, {
    advanceSeconds: 0,
    time,
    camera,
  });
}

function renderAmbientTrafficFrame(
  state: AmbientTrafficSystem,
  options: AmbientTrafficRenderFrameOptions,
) {
  state.dotPool.releaseAll();

  const timeSeconds = options.time / 1000;

  // Crossfade dot radius at the same zoom band as station details (0.6–0.7)
  const zoomFraction = closeViewAlpha(options.camera.zoom);
  const dotRadius = ambientTrafficConfig.dotRadiusZoomedOut
    + (ambientTrafficConfig.dotRadiusZoomedIn - ambientTrafficConfig.dotRadiusZoomedOut) * zoomFraction;

  const { alphaMin, alphaMax, dotSpeed } = ambientTrafficConfig;
  const alphaRange = alphaMax - alphaMin;

  for (const dot of state.dots) {
    // A route is visible if either endpoint is in the viewport. Bounds are
    // cached per frame, so calling isVisibleInViewport per dot is cheap.
    const route = dot.route;
    const routeVisible =
      isVisibleInViewport(options.camera, { x: route.startX, y: route.startY })
      || isVisibleInViewport(options.camera, { x: route.endX, y: route.endY });
    if (!routeVisible) continue;

    dot.progress += dotSpeed * dot.speedMultiplier * dot.direction * options.advanceSeconds;
    if (dot.progress >= dot.route.routeLength) {
      dot.progress -= dot.route.routeLength;
    } else if (dot.progress < 0) {
      dot.progress += dot.route.routeLength;
    }

    // Continuous sine wave between alphaMin and alphaMax — dots never disappear
    const wave = (Math.sin((timeSeconds * dot.pulseSpeed + dot.pulsePhase) * Math.PI * 2) + 1) / 2;
    const alpha = alphaMin + wave * alphaRange;

    const mapX = dot.route.startX + dot.route.directionX * dot.progress + dot.route.directionY * dot.laneOffset;
    const mapY = dot.route.startY + dot.route.directionY * dot.progress - dot.route.directionX * dot.laneOffset;
    const circle = state.dotPool.acquire();
    circle.setPosition(mapX, mapY);
    if (circle.radius !== dotRadius) circle.radius = dotRadius;
    circle.setAlpha(alpha);
  }
}
