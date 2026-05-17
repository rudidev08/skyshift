// Flight visuals — trail, engine glow, ring pulse, scale tweens. Layers on top
// of the shared ship indicators.

import { type Scene } from "phaser";
import type { ShipTypeTemplate } from "../../data/ship-types";
import { SHIP_SQUARE, TEXTURE_SCALE } from "../render-ship-hull";
import { ensureShipTexture } from "./texture-cache";
import { shipTravel } from "../../data/ship-travel";
import { shipVisuals } from "../../data/ship-visuals";
import { type FlightData } from "../sim-travel";
import { getPointOnCurve, getFlightHeading, type FlightRenderData } from "./flight-render-data";
import { hexToNumber } from "../util-hex-color";
import { Layer } from "../../data/visuals-layers";

const SHIP_BASE_SCALE = 1 / TEXTURE_SCALE;
const TRAIL_INTERVAL = 1 / shipVisuals.trailSegmentsPerSecond;

export interface ShipTravelVisualBundle {
  flight: FlightData;
  flightRender: FlightRenderData;
  sprite: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Graphics;
  engine: Phaser.GameObjects.Arc;
  ringPulse?: Phaser.GameObjects.Arc;
  color: number;
  trailWidthMultiplier: number;
  trailDepartureAlphaMultiplier: number;
  trailArrivalAlphaMultiplier: number;
  lastTrailProgress: number;
  lastTrailTime: number;
  /** Hyperjump ring pulse fires exactly once per flight. Mid-flight loads
   *  start in "fired" so the pulse doesn't retrigger when joining a flight
   *  already past its departure. */
  ringPulseState: "pending" | "fired";
  /** Trail fade-out tween lifecycle:
   *   - "pending"   — trail still appending segments during hyperjump
   *   - "started"   — arriving-phase fade tween active
   *   - "completed" — tween finished and trail.destroy() ran */
  trailFadeState: "pending" | "started" | "completed";
}

/** Compute the rotation angle for a ship sprite, with smooth turning during departure. */
function getFlightRotation(flight: FlightData, flightRender: FlightRenderData): number {
  const curveHeading = getFlightHeading(flight, flightRender);

  if (flight.phase === "departing" && flight.previousHeading !== null) {
    const departDuration = shipTravel.accelerationDurationSeconds;
    const turnProgress = Math.min(1, flight.totalElapsedSeconds / departDuration);
    const eased = turnProgress * turnProgress * (3 - 2 * turnProgress);
    return lerpAngle(flight.previousHeading, curveHeading, eased);
  }

  return curveHeading;
}

/** Lerp between two angles, taking the shortest path. */
function lerpAngle(startAngle: number, endAngle: number, progress: number): number {
  let difference = endAngle - startAngle;
  while (difference > Math.PI) difference -= 2 * Math.PI;
  while (difference < -Math.PI) difference += 2 * Math.PI;
  return startAngle + difference * progress;
}

function updateEngine(
  bundle: ShipTravelVisualBundle,
  positionX: number,
  positionY: number,
  rotation: number,
) {
  const flight = bundle.flight;
  if (flight.travelMode !== "interStation" || flight.phase === "departing" || flight.phase === "arriving") {
    bundle.engine.setVisible(false);
    return;
  }
  bundle.engine.setVisible(true);
  // Engine glow tracks ship sprite scale (changes during takeoff/landing) so
  // it grows/shrinks with the hull instead of staying a fixed disk.
  const scale = bundle.sprite.scaleX / SHIP_BASE_SCALE;
  // Place glow one ship-square behind the nose along the heading vector.
  const offset = SHIP_SQUARE * scale;
  const engineX = positionX - Math.cos(rotation) * offset;
  const engineY = positionY - Math.sin(rotation) * offset;
  bundle.engine.setPosition(engineX, engineY);
  bundle.engine.setScale(scale);
  const flicker = 0.5 + Math.random() * 0.5;
  bundle.engine.setAlpha(flicker);
}

export interface ShipTravelVisualBundleInput {
  scene: Scene;
  flight: FlightData;
  flightRender: FlightRenderData;
  color: string;
  shipType: ShipTypeTemplate;
}

/** Build a fresh-flight bundle (departing from progress 0). Surface launches
 *  start at takeoff scale; the hyperjump ring pulse is still pending. */
export function createShipTravelVisualBundleForFreshFlight(
  input: ShipTravelVisualBundleInput,
): ShipTravelVisualBundle {
  const surfaceLaunch = input.flight.origin.surfaceOrOrbit === "surface";
  const startScale = surfaceLaunch ? SHIP_BASE_SCALE * shipVisuals.takeoffScale : SHIP_BASE_SCALE;
  return buildShipTravelVisualBundle(input, {
    startScale,
    lastTrailProgress: -1,
    ringPulseState: "pending",
  });
}

/** Build a bundle for a flight loaded mid-progress. Sprite starts at normal
 *  scale; the ring pulse is marked fired so it doesn't retrigger. */
export function createShipTravelVisualBundleForFlightInProgress(
  input: ShipTravelVisualBundleInput,
): ShipTravelVisualBundle {
  return buildShipTravelVisualBundle(input, {
    startScale: SHIP_BASE_SCALE,
    lastTrailProgress: input.flight.progress,
    ringPulseState: "fired",
  });
}

interface ShipTravelVisualBundleInitialFields {
  startScale: number;
  lastTrailProgress: number;
  ringPulseState: "pending" | "fired";
}

function buildShipTravelVisualBundle(
  input: ShipTravelVisualBundleInput,
  initial: ShipTravelVisualBundleInitialFields,
): ShipTravelVisualBundle {
  const { scene, flight, flightRender, color, shipType } = input;
  const colorNumber = hexToNumber(color);

  const textureKey = ensureShipTexture(scene, shipType);
  const sprite = scene.add.image(flightRender.startX, flightRender.startY, textureKey);
  sprite.setScale(initial.startScale);
  sprite.setTint(colorNumber);
  sprite.setAlpha(1);
  sprite.setDepth(Layer.ShipSprite);

  const trail = scene.add.graphics();
  trail.setDepth(Layer.ShipTrail);

  const engineRadius = SHIP_SQUARE * 0.7;
  const engine = scene.add.circle(flightRender.startX, flightRender.startY, engineRadius, 0xffffff, 0.8);
  engine.setDepth(Layer.ShipEngine);
  engine.setVisible(false);

  return {
    flight,
    flightRender,
    sprite,
    trail,
    engine,
    color: colorNumber,
    trailWidthMultiplier: shipType.trailWidthMultiplier,
    trailDepartureAlphaMultiplier: shipType.trailDepartureAlphaMultiplier,
    trailArrivalAlphaMultiplier: shipType.trailArrivalAlphaMultiplier,
    lastTrailProgress: initial.lastTrailProgress,
    lastTrailTime: -1,
    ringPulseState: initial.ringPulseState,
    trailFadeState: "pending",
  };
}

/** Update flight render; returns current position for indicator placement. */
export function updateShipTravelVisualBundle(
  scene: Scene,
  bundle: ShipTravelVisualBundle,
): { x: number; y: number } {
  const { flight, flightRender } = bundle;
  const departEnd = flight.departDistanceFraction;

  tickTakeoffScale(bundle);
  tickHyperjumpRingPulse(scene, bundle, departEnd);
  tickHyperjumpTrail(bundle, departEnd);
  tickArrivingTrailFade(scene, bundle);
  tickLandingScale(bundle);

  const position = getPointOnCurve(flightRender, flight.progress);
  const rotation = getFlightRotation(flight, flightRender);
  bundle.sprite.setPosition(position.x, position.y);
  bundle.sprite.setRotation(rotation);
  updateEngine(bundle, position.x, position.y, rotation);

  return position;
}

/** Quadratic ease-in for takeoff — sprite mostly grows at the end of acceleration. */
function tickTakeoffScale(bundle: ShipTravelVisualBundle): void {
  const flight = bundle.flight;
  if (flight.phase !== "departing" || flight.origin.surfaceOrOrbit !== "surface") return;
  const takeoffProgress = Math.min(1.0, flight.totalElapsedSeconds / shipTravel.accelerationDurationSeconds);
  const eased = takeoffProgress * takeoffProgress;
  const scale =
    SHIP_BASE_SCALE *
    (shipVisuals.takeoffScale + (shipVisuals.normalScale - shipVisuals.takeoffScale) * eased);
  bundle.sprite.setScale(scale);
}

/** Spawn the one-shot ring-pulse tween at the moment the ship enters hyperjump. */
function tickHyperjumpRingPulse(scene: Scene, bundle: ShipTravelVisualBundle, departEnd: number): void {
  const flight = bundle.flight;
  if (
    flight.phase !== "hyperjump" ||
    bundle.ringPulseState !== "pending" ||
    flight.travelMode !== "interStation"
  )
    return;
  bundle.ringPulseState = "fired";
  bundle.sprite.setScale(SHIP_BASE_SCALE);
  const position = getPointOnCurve(bundle.flightRender, departEnd);
  bundle.ringPulse = scene.add.circle(
    position.x,
    position.y,
    shipVisuals.ringPulseInitialRadius,
    0xffffff,
    0,
  );
  bundle.ringPulse.setStrokeStyle(shipVisuals.ringPulseStrokeWidth, 0xffffff);
  scene.tweens.add({
    targets: bundle.ringPulse,
    radius: shipVisuals.ringPulseFinalRadius,
    alpha: 0,
    duration: shipVisuals.ringPulseDurationSeconds * 1000,
    onComplete: () => {
      bundle.ringPulse?.destroy();
      bundle.ringPulse = undefined;
    },
  });
}

/** Append one trail segment per `TRAIL_INTERVAL` while in hyperjump — never clear or redraw. */
function tickHyperjumpTrail(bundle: ShipTravelVisualBundle, departEnd: number): void {
  const flight = bundle.flight;
  if (flight.phase !== "hyperjump" || flight.travelMode !== "interStation") return;
  if (flight.totalElapsedSeconds - bundle.lastTrailTime < TRAIL_INTERVAL) return;
  bundle.lastTrailTime = flight.totalElapsedSeconds;

  const currentPosition = getPointOnCurve(bundle.flightRender, flight.progress);
  const prevProgress =
    bundle.lastTrailProgress >= 0 ? bundle.lastTrailProgress : Math.max(departEnd, flight.progress - 0.02);
  const prevPosition = getPointOnCurve(bundle.flightRender, prevProgress);
  bundle.lastTrailProgress = flight.progress;

  // Alpha gradient from departure to arrival baked into each segment — trail is never redrawn, so we can't tween it later.
  const normalizedProgress = (flight.progress - departEnd) / flight.flightDistanceFraction;
  const departureAlpha = shipVisuals.trailDepartureAlpha * bundle.trailDepartureAlphaMultiplier;
  const arrivalAlpha = shipVisuals.trailArrivalAlpha * bundle.trailArrivalAlphaMultiplier;
  const alpha = departureAlpha + (arrivalAlpha - departureAlpha) * normalizedProgress;

  bundle.trail.lineStyle(shipVisuals.trailWidth * bundle.trailWidthMultiplier, bundle.color, alpha);
  bundle.trail.lineBetween(prevPosition.x, prevPosition.y, currentPosition.x, currentPosition.y);
}

/** Fire the trail-fade tween once when the ship enters the arriving phase. */
function tickArrivingTrailFade(scene: Scene, bundle: ShipTravelVisualBundle): void {
  const flight = bundle.flight;
  if (
    flight.phase !== "arriving" ||
    flight.travelMode !== "interStation" ||
    bundle.trailFadeState !== "pending"
  )
    return;
  bundle.trailFadeState = "started";
  scene.tweens.add({
    targets: bundle.trail,
    alpha: 0,
    duration: shipVisuals.trailFadeSeconds * 1000,
    onComplete: () => {
      bundle.trail.destroy();
      bundle.trailFadeState = "completed";
    },
  });
}

/** Quadratic ease-out for landing — sprite mostly shrinks at the start of docking. */
function tickLandingScale(bundle: ShipTravelVisualBundle): void {
  const flight = bundle.flight;
  if (flight.phase !== "arriving" || flight.destination.surfaceOrOrbit !== "surface") return;
  const dockingProgress = Math.min(
    1.0,
    (flight.totalElapsedSeconds - flight.phaseStartSeconds) / shipTravel.dockingDurationSeconds,
  );
  const eased = 1 - (1 - dockingProgress) * (1 - dockingProgress);
  const scale =
    SHIP_BASE_SCALE *
    (shipVisuals.normalScale - (shipVisuals.normalScale - shipVisuals.landingScale) * eased);
  bundle.sprite.setScale(scale);
}

export function destroyShipTravelVisualBundle(bundle: ShipTravelVisualBundle) {
  bundle.sprite.destroy();
  bundle.engine.destroy();
  if (bundle.ringPulse) bundle.ringPulse.destroy();
  bundle.trail.destroy();
}
