/* 2D canvas sector scene for the landing hero and help-page illustrations.
 * Mini-sim of nation stations with ships looping bezier flights — pure
 * Canvas2D so static pages stay Phaser-free. This file orchestrates motion,
 * trails, and the frame loop; drawing primitives live in sibling files. */

import { PIXEL_RATIO } from "./device";
import { drawNebula, loadNebulaImage, type SectorNebula } from "./nebula-image";
import {
  appendTrailSegmentIfDue,
  computeBezierControlPoint,
  computeFlightAngle,
  sampleFlightPosition,
  type FlightAnimation,
} from "./sector-scene-flight";
import { createTwinklesForStations, type Twinkle } from "./sector-scene-twinkles";
import { drawShipPreview, type SectorShipHull } from "./static-ship-preview";
import { drawStationIcon, prepareStationIcon, type StationIcon } from "./station-icon";

const STATION_RADIUS = 13;
const ORBIT_RING_RADIUS = 10;
const STATION_GLOW_HALO_RADIUS = STATION_RADIUS + 18;
const BASE_FLIGHT_SPEED = 25;
const TRAIL_DEPARTURE_ALPHA = 0.05;
const TRAIL_ARRIVAL_ALPHA = 0.5;
const TRAIL_FADE_DURATION = 3.0;
const CANVAS_SCALE = 3000;
const ENGINE_GLOW_OFFSET_PIXELS = 5;
const ENGINE_GLOW_RADIUS_PIXELS = 4;

export interface SectorStation {
  id: string;
  xRatio: number;
  yRatio: number;
  color: string;
  /** Inner SVG of a Lucide glyph (outer `<svg>` tag stripped). */
  iconSvgInner: string;
  label: string;
  twinkleCount: number;
}

export interface SectorFlight {
  /** Station this ship begins its first flight at. Must match a station id. */
  startStationId: string;
  color: string;
  ship: SectorShipHull;
  /** Whitelist of stations this ship visits. Defaults to every station in
   *  the scene. Use to pin a ship onto a two-station shuttle (e.g. emigration). */
  loopStationIds?: string[];
}

export interface SectorScene {
  stations: SectorStation[];
  flights: SectorFlight[];
  nebulas?: SectorNebula[];
}

export interface SectorAnimationHandle {
  destroy(): void;
}

/** Per-station render state: gradient depends on canvas size and is rebuilt on resize; twinkles and icon are stable. */
interface StationRenderState {
  gradient: CanvasGradient;
  twinkles: Twinkle[];
  icon: StationIcon;
}

/** One flight slot: holds the ship's current home station and its in-flight animation (or null between flights). */
interface FlightSlot {
  config: SectorFlight;
  currentStationId: string;
  flight: FlightAnimation | null;
}

interface LoadedNebula {
  nebula: SectorNebula;
  image: HTMLImageElement;
}

function loadSceneNebulas(scene: SectorScene): LoadedNebula[] {
  return (scene.nebulas ?? []).map((nebula) => ({ nebula, image: loadNebulaImage(nebula.src) }));
}

function createFlightSlots(flights: SectorFlight[]): FlightSlot[] {
  // One slot per scene flight. Each carries its own "current station" so the
  // next flight departs from the last arrival.
  return flights.map((flight) => ({
    config: flight,
    currentStationId: flight.startStationId,
    flight: null,
  }));
}

function buildStationGradient(
  context: CanvasRenderingContext2D,
  station: SectorStation,
  canvasWidth: number,
  canvasHeight: number,
): CanvasGradient {
  const stationX = station.xRatio * canvasWidth;
  const stationY = station.yRatio * canvasHeight;
  const gradient = context.createRadialGradient(
    stationX,
    stationY,
    STATION_RADIUS,
    stationX,
    stationY,
    STATION_GLOW_HALO_RADIUS,
  );
  gradient.addColorStop(0, station.color + "10");
  gradient.addColorStop(1, station.color + "00");
  return gradient;
}

function pickNextFlightTarget(stations: SectorStation[], slot: FlightSlot): SectorStation {
  const loopStationIds = slot.config.loopStationIds;
  const eligibleStations = loopStationIds
    ? stations.filter((station) => loopStationIds.includes(station.id))
    : stations;
  const candidates = eligibleStations.filter((station) => station.id !== slot.currentStationId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function createFlightForSlot(
  slot: FlightSlot,
  stations: SectorStation[],
  stationById: Map<string, SectorStation>,
): FlightAnimation {
  const from = stationById.get(slot.currentStationId);
  if (!from) throw new Error(`Unknown station: ${slot.currentStationId}`);
  const to = pickNextFlightTarget(stations, slot);
  slot.currentStationId = to.id;

  const { controlX, controlY } = computeBezierControlPoint(from, to);

  const deltaX = to.xRatio - from.xRatio;
  const deltaY = to.yRatio - from.yRatio;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const pixelDistance = distance * CANVAS_SCALE;
  const flightDuration = pixelDistance / (BASE_FLIGHT_SPEED * slot.config.ship.speed);

  return {
    fromX: from.xRatio,
    fromY: from.yRatio,
    controlX,
    controlY,
    toX: to.xRatio,
    toY: to.yRatio,
    color: slot.config.color,
    ship: slot.config.ship,
    elapsed: 0,
    flightDuration,
    trailSegments: [],
    fading: false,
    fadeElapsed: 0,
    fadeAlpha: 1,
    done: false,
  };
}

export function mountSectorAnimation(canvas: HTMLCanvasElement, scene: SectorScene): SectorAnimationHandle {
  const context = canvas.getContext("2d")!;
  const stations = scene.stations;
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const nebulas = loadSceneNebulas(scene);
  const twinklesByStation = createTwinklesForStations(stations);
  const iconByStation = new Map(
    stations.map((station) => [station.id, prepareStationIcon(station.iconSvgInner, station.color, 0.65)]),
  );
  const stationRenderStates = new Map<string, StationRenderState>();

  const flightSlots = createFlightSlots(scene.flights);

  function canvasWidth(): number {
    return canvas.width / PIXEL_RATIO;
  }
  function canvasHeight(): number {
    return canvas.height / PIXEL_RATIO;
  }

  function rebuildStationRenderStates(): void {
    stationRenderStates.clear();
    const width = canvasWidth();
    const height = canvasHeight();
    for (const station of stations) {
      stationRenderStates.set(station.id, {
        gradient: buildStationGradient(context, station, width, height),
        twinkles: twinklesByStation.get(station.id)!,
        icon: iconByStation.get(station.id)!,
      });
    }
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * PIXEL_RATIO;
    canvas.height = rect.height * PIXEL_RATIO;
    context.setTransform(PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0);
    context.font = "11px system-ui, sans-serif";
    context.textAlign = "center";
    rebuildStationRenderStates();
  }
  resize();

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas);

  for (const slot of flightSlots) slot.flight = createFlightForSlot(slot, stations, stationById);

  function drawNebulaPass(width: number, height: number): void {
    for (const { nebula, image } of nebulas) {
      drawNebula(context, nebula, image, width, height);
    }
  }

  function drawTrailPass(canvasWidth: number, canvasHeight: number): void {
    for (const slot of flightSlots) {
      const flight = slot.flight;
      if (!flight || flight.trailSegments.length < 2) continue;
      drawFlightTrail(context, flight, canvasWidth, canvasHeight);
    }
  }

  function advanceFlightSlot(slot: FlightSlot, deltaTime: number): void {
    // Lifecycle: active → fading (trail dissipates, ship hidden) → done → respawn next frame.
    if (!slot.flight || slot.flight.done) {
      slot.flight = createFlightForSlot(slot, stations, stationById);
    }
    const flight = slot.flight;

    flight.elapsed += deltaTime;
    const progress = Math.min(flight.elapsed / flight.flightDuration, 1);

    if (progress >= 1 && !flight.fading) {
      flight.fading = true;
      flight.fadeElapsed = 0;
    }

    if (flight.fading) {
      flight.fadeElapsed += deltaTime;
      flight.fadeAlpha = 1 - flight.fadeElapsed / TRAIL_FADE_DURATION;
      if (flight.fadeAlpha <= 0) flight.done = true;
    }
  }

  function appendInFlightTrailSample(
    flight: FlightAnimation,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    if (flight.elapsed >= flight.flightDuration) return;
    const progress = flight.elapsed / flight.flightDuration;
    const { xRatio, yRatio } = sampleFlightPosition(flight, progress);
    appendTrailSegmentIfDue(flight, xRatio, yRatio, progress, canvasWidth, canvasHeight);
  }

  function advanceFlightLifecycles(deltaTime: number): void {
    for (const slot of flightSlots) advanceFlightSlot(slot, deltaTime);
  }

  function sampleActiveFlightTrails(canvasWidth: number, canvasHeight: number): void {
    for (const slot of flightSlots) {
      if (slot.flight && !slot.flight.fading) {
        appendInFlightTrailSample(slot.flight, canvasWidth, canvasHeight);
      }
    }
  }

  function drawShipPass(canvasWidth: number, canvasHeight: number): void {
    for (const slot of flightSlots) {
      const flight = slot.flight;
      if (!flight || flight.fading || flight.done) continue;
      const progress = flight.elapsed / flight.flightDuration;
      if (progress >= 1) continue;

      const { xRatio, yRatio } = sampleFlightPosition(flight, progress);
      const pixelX = xRatio * canvasWidth;
      const pixelY = yRatio * canvasHeight;
      const angle = computeFlightAngle(flight, progress, canvasWidth, canvasHeight);

      drawEngineGlow(context, pixelX, pixelY, angle);
      drawShipPreview(context, {
        x: pixelX,
        y: pixelY,
        rotation: angle,
        nationColor: flight.color,
        ship: flight.ship,
        scale: 1,
      });
    }
  }

  function drawStationPass(canvasWidth: number, canvasHeight: number, timeSeconds: number): void {
    for (const station of stations) {
      const stationX = station.xRatio * canvasWidth;
      const stationY = station.yRatio * canvasHeight;
      const renderState = stationRenderStates.get(station.id)!;
      drawStationOrbitBundle(context, stationX, stationY, timeSeconds, renderState);
      drawStationBodyBundle(context, station, stationX, stationY, renderState.icon);
    }
  }

  let lastFrameTime = -1;
  function frame(now: DOMHighResTimeStamp): void {
    const deltaTime = lastFrameTime < 0 ? 0 : Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    const width = canvasWidth();
    const height = canvasHeight();
    const timeSeconds = now / 1000;

    context.clearRect(0, 0, width, height);

    drawNebulaPass(width, height);
    advanceFlightLifecycles(deltaTime);
    sampleActiveFlightTrails(width, height);
    drawTrailPass(width, height);
    drawShipPass(width, height);
    drawStationPass(width, height, timeSeconds);

    rafId = requestAnimationFrame(frame);
  }

  let rafId = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    },
  };
}

function drawFlightTrail(
  context: CanvasRenderingContext2D,
  flight: FlightAnimation,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const fadeMultiplier = flight.fading ? Math.max(0, flight.fadeAlpha) : 1;
  const ship = flight.ship;
  const departureAlpha = TRAIL_DEPARTURE_ALPHA * ship.trailDepartureAlphaMultiplier;
  const arrivalAlpha = TRAIL_ARRIVAL_ALPHA * ship.trailArrivalAlphaMultiplier;
  context.strokeStyle = flight.color;
  context.lineWidth = ship.trailWidth * 0.45;

  // Trail brightens along the path — faint at departure, full at arrival.
  // fadeMultiplier dims the whole streak after the ship lands.
  for (let j = 1; j < flight.trailSegments.length; j++) {
    const segment = flight.trailSegments[j];
    const previous = flight.trailSegments[j - 1];
    const alpha = (departureAlpha + (arrivalAlpha - departureAlpha) * segment.progress) * fadeMultiplier;
    if (alpha <= 0) continue;
    context.globalAlpha = alpha;
    context.beginPath();
    context.moveTo(previous.x * canvasWidth, previous.y * canvasHeight);
    context.lineTo(segment.x * canvasWidth, segment.y * canvasHeight);
    context.stroke();
  }
  context.globalAlpha = 1;
}

/** Flickering white dot a few pixels aft of the ship along its tangent. */
function drawEngineGlow(
  context: CanvasRenderingContext2D,
  pixelX: number,
  pixelY: number,
  angle: number,
): void {
  const flicker = 0.5 + Math.random() * 0.5;
  context.globalAlpha = flicker * 0.8;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(
    pixelX - Math.cos(angle) * ENGINE_GLOW_OFFSET_PIXELS,
    pixelY - Math.sin(angle) * ENGINE_GLOW_OFFSET_PIXELS,
    ENGINE_GLOW_RADIUS_PIXELS,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.globalAlpha = 1;
}

function drawStationOrbitBundle(
  context: CanvasRenderingContext2D,
  stationX: number,
  stationY: number,
  timeSeconds: number,
  renderState: StationRenderState,
): void {
  context.fillStyle = renderState.gradient;
  context.beginPath();
  context.arc(stationX, stationY, STATION_GLOW_HALO_RADIUS, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(136, 136, 136, 0.35)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(stationX, stationY, STATION_RADIUS + ORBIT_RING_RADIUS, 0, Math.PI * 2);
  context.stroke();

  for (const twinkle of renderState.twinkles) {
    const cycle = (((timeSeconds * twinkle.speed + twinkle.phase) % 1) + 1) % 1;
    const brightness = cycle < 0.5 ? 0 : Math.sin((cycle - 0.5) * 2 * Math.PI);
    if (brightness <= 0) continue;
    context.globalAlpha = brightness * 0.8;
    context.fillStyle = "#eeeeee";
    context.beginPath();
    context.arc(
      stationX + Math.cos(twinkle.angle) * (STATION_RADIUS + ORBIT_RING_RADIUS),
      stationY + Math.sin(twinkle.angle) * (STATION_RADIUS + ORBIT_RING_RADIUS),
      1.5,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
}

function drawStationBodyBundle(
  context: CanvasRenderingContext2D,
  station: SectorStation,
  stationX: number,
  stationY: number,
  icon: StationIcon,
): void {
  context.fillStyle = "#000";
  context.beginPath();
  context.arc(stationX, stationY, STATION_RADIUS, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = station.color;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(stationX, stationY, STATION_RADIUS + 1.5, 0, Math.PI * 2);
  context.stroke();

  drawStationIcon(context, stationX, stationY, icon);

  context.fillStyle = "rgba(204, 204, 204, 0.6)";
  context.fillText(station.label, stationX, stationY + STATION_RADIUS + ORBIT_RING_RADIUS + 14);
}
