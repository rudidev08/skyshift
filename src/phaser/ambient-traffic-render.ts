// Cosmetic dots flying between nearby stations. No sim dependency, no
// interactivity — purely a visual layer drawn from a pooled set of Circle
// game objects.

import { type Scene } from "phaser";
import { ambientTrafficConfig } from "../../data/station-ambient-traffic-visuals";
import { closeViewAlpha } from "./camera-fade";
import { isVisibleInViewport } from "./viewport-culling";
import { GameObjectRenderPool } from "./game-object-render-pool";
import { Layer } from "../../data/visuals-layers";

/** Structural subset — only x/y are needed; both Station and PlacedStation satisfy it. */
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

export interface AmbientTraffic {
  dotPool: GameObjectRenderPool<Phaser.GameObjects.Arc>;
  routes: AmbientRoute[];
  dots: AmbientDot[];
  secondsSinceLastRedraw: number;
}

/** Call once at scene init to build routes and populate the dot pool. */
export function createAmbientTraffic(
  scene: Scene,
  stations: AmbientStation[],
  sectorSize: number,
): AmbientTraffic {
  const routes = buildAmbientRoutes(stations, sectorSize);
  const dots = spawnAmbientDots(routes);

  const dotPool = new GameObjectRenderPool<Phaser.GameObjects.Arc>(scene, (poolScene) => {
    const circle = poolScene.add.circle(
      0,
      0,
      ambientTrafficConfig.dotRadiusZoomedOut,
      ambientTrafficConfig.dotColor,
      1,
    );
    circle.setDepth(Layer.AmbientTraffic);
    return circle;
  });

  return { dotPool, routes, dots, secondsSinceLastRedraw: 0 };
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
  candidates.sort(
    (leftCandidate, rightCandidate) => leftCandidate.distanceSquared - rightCandidate.distanceSquared,
  );
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

/** Call every frame. Throttles redraws to a fixed rate; dots advance by the full accumulated time each redraw. */
export function updateAmbientTraffic(
  ambientTraffic: AmbientTraffic,
  deltaSeconds: number,
  timeMilliseconds: number,
  camera: Phaser.Cameras.Scene2D.Camera,
) {
  // Skip work between redraws — the previous frame's circles stay on screen until the next redraw tick.
  const redrawInterval = 1 / ambientTrafficConfig.redrawsPerSecond;
  ambientTraffic.secondsSinceLastRedraw += deltaSeconds;
  if (ambientTraffic.secondsSinceLastRedraw < redrawInterval) return;

  // Advance by the full accumulated delta so dots don't lose the time we skipped between redraws.
  const effectiveDelta = ambientTraffic.secondsSinceLastRedraw;
  ambientTraffic.secondsSinceLastRedraw = 0;
  renderAmbientTrafficFrame(ambientTraffic, effectiveDelta, timeMilliseconds, camera);
}

/** Redraw without advancing dots. Used when a view mode hid the pool and the
 *  sim is still paused. */
export function redrawAmbientTraffic(
  ambientTraffic: AmbientTraffic,
  timeMilliseconds: number,
  camera: Phaser.Cameras.Scene2D.Camera,
) {
  renderAmbientTrafficFrame(ambientTraffic, 0, timeMilliseconds, camera);
}

function computeDotRadiusForZoom(camera: Phaser.Cameras.Scene2D.Camera): number {
  // Crossfade dot radius at the same zoom band as station details (0.6–0.7)
  const zoomFraction = closeViewAlpha(camera.zoom);
  return (
    ambientTrafficConfig.dotRadiusZoomedOut +
    (ambientTrafficConfig.dotRadiusZoomedIn - ambientTrafficConfig.dotRadiusZoomedOut) * zoomFraction
  );
}

function advanceDotProgress(dot: AmbientDot, advanceSeconds: number): void {
  dot.progress += ambientTrafficConfig.dotSpeed * dot.speedMultiplier * dot.direction * advanceSeconds;
  if (dot.progress >= dot.route.routeLength) {
    dot.progress -= dot.route.routeLength;
  } else if (dot.progress < 0) {
    dot.progress += dot.route.routeLength;
  }
}

function renderAmbientTrafficFrame(
  ambientTraffic: AmbientTraffic,
  advanceSeconds: number,
  timeMilliseconds: number,
  camera: Phaser.Cameras.Scene2D.Camera,
) {
  ambientTraffic.dotPool.releaseAll();

  const timeSeconds = timeMilliseconds / 1000;
  const dotRadius = computeDotRadiusForZoom(camera);

  const { alphaMin, alphaMax } = ambientTrafficConfig;
  const alphaRange = alphaMax - alphaMin;

  for (const dot of ambientTraffic.dots) {
    // A route is visible if either endpoint is in the viewport. Bounds are
    // cached per frame, so calling isVisibleInViewport per dot is cheap.
    const route = dot.route;
    const routeVisible =
      isVisibleInViewport(camera, { x: route.startX, y: route.startY }) ||
      isVisibleInViewport(camera, { x: route.endX, y: route.endY });
    if (!routeVisible) continue;

    advanceDotProgress(dot, advanceSeconds);

    // Continuous sine wave between alphaMin and alphaMax — dots never disappear
    const pulseFraction = (Math.sin((timeSeconds * dot.pulseSpeed + dot.pulsePhase) * Math.PI * 2) + 1) / 2;
    const alpha = alphaMin + pulseFraction * alphaRange;

    const mapX = route.startX + route.directionX * dot.progress + route.directionY * dot.laneOffset;
    const mapY = route.startY + route.directionY * dot.progress - route.directionX * dot.laneOffset;
    const circle = ambientTraffic.dotPool.acquire();
    circle.setPosition(mapX, mapY);
    if (circle.radius !== dotRadius) circle.radius = dotRadius;
    circle.setAlpha(alpha);
  }
}
