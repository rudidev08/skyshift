// Flight-render lifecycle for one ship — start visuals when a flight begins,
// destroy them when it ends, and snap orbit seeds on arrival so the orbit
// sprite picks up exactly where the flight ended.

import { type Scene } from "phaser";
import { getShipTypeTemplate } from "../sim-ship-template";
import type { TradeManager } from "../sim-trade-manager";
import type { TradeShip } from "../sim-trade-types";
import { isTradeShipIdle, isTradeShipDeploying } from "../sim-trade-log";
import {
  createShipTravelVisualBundleForFlightInProgress,
  createShipTravelVisualBundleForFreshFlight,
  destroyShipTravelVisualBundle,
  type ShipTravelVisualBundle,
} from "./ship-travel-visual-bundle";
import { createFlightCurveGeometry } from "./flight-render-data";
import type { FlightData } from "../sim-travel";
import type { Station } from "../sim-station-types";
import { orbitApproachRadiusPixels } from "../../data/ship-travel";
import { getOrbitingShipPose } from "./ship-orbit-pool";
import { hideShipUi } from "./ship-ui";
import type { ShipVisualBundle } from "./ship-visual-bundle";

/** Inputs for computing fresh-flight endpoint overrides. Only used when
 *  starting a flight at progress === 0; mid-flight loads skip this. */
interface FreshFlightOverridesContext {
  bundle: ShipVisualBundle;
  flight: FlightData;
  originStation: Station;
  destinationStation: Station;
  timeSeconds: number;
}

/** Fresh flights (progress === 0) align takeoff/landing with the actual orbit
 *  sprite position so they don't teleport through the station center.
 *  Mid-flight loads (progress > 0) build geometry from station defaults; this
 *  is a known small visual shift on load since coords + curveAngle aren't
 *  persisted. */
function alignFreshFlightEndpointsToOrbitSprite(context: FreshFlightOverridesContext): {
  originOverride: { x: number; y: number } | undefined;
  destinationOverride: { x: number; y: number } | undefined;
} {
  const { bundle, flight, originStation, destinationStation, timeSeconds } = context;
  if (flight.progress !== 0) return { originOverride: undefined, destinationOverride: undefined };

  let originOverride: { x: number; y: number } | undefined;
  let destinationOverride: { x: number; y: number } | undefined;
  if (flight.origin.surfaceOrOrbit === "orbit") {
    const orbitPosition = getOrbitingShipPose(bundle.ship, bundle.orbit, timeSeconds);
    originOverride = { x: orbitPosition.x, y: orbitPosition.y };
  }
  if (flight.destination.surfaceOrOrbit === "orbit") {
    destinationOverride = pullDestinationBackToOrbitRing(
      originStation,
      destinationStation,
      originOverride,
    );
  }
  return { originOverride, destinationOverride };
}

/** Pull the destination endpoint back off the station center along the
 *  approach heading so the flight sprite lands on a notional orbit ring (not
 *  the station body). The orbit sprite's takeover snap places it exactly here. */
function pullDestinationBackToOrbitRing(
  originStation: Station,
  destinationStation: Station,
  originOverride: { x: number; y: number } | undefined,
): { x: number; y: number } {
  const startX = originOverride?.x ?? originStation.x;
  const startY = originOverride?.y ?? originStation.y;
  const endRawX = destinationStation.x + orbitApproachRadiusPixels;
  const endRawY = destinationStation.y;
  const approachHeading = Math.atan2(endRawY - startY, endRawX - startX);
  return {
    x: endRawX - Math.cos(approachHeading) * orbitApproachRadiusPixels,
    y: endRawY - Math.sin(approachHeading) * orbitApproachRadiusPixels,
  };
}

function startFlightVisuals(
  scene: Scene,
  bundle: ShipVisualBundle,
  tradeShip: TradeShip,
  tradeManager: TradeManager,
  timeSeconds: number,
) {
  const existingTravelBundle = bundle.travelBundle;
  if (existingTravelBundle) {
    destroyShipTravelVisualBundle(existingTravelBundle);
    bundle.travelBundle = null;
  }

  const station = bundle.ship.station;
  const shipType = getShipTypeTemplate(bundle.ship.shipTypeId);
  const flight = tradeShip.flight!;
  // Soft-lookup so a save with a mid-flight ferry from a demolished home doesn't crash here.
  // The sim still lands and decommissions the flight; we just skip building visuals when
  // either endpoint is missing, since the approach geometry below needs both.
  const originStation = tradeManager.stationResolver(flight.origin.stationId);
  const destinationStation = tradeManager.stationResolver(flight.destination.stationId);
  if (!originStation || !destinationStation) {
    return;
  }

  const { originOverride, destinationOverride } = alignFreshFlightEndpointsToOrbitSprite({
    bundle,
    flight,
    originStation,
    destinationStation,
    timeSeconds,
  });

  const flightRender = createFlightCurveGeometry(
    { endpoint: flight.origin, station: originStation, spritePositionOverride: originOverride },
    {
      endpoint: flight.destination,
      station: destinationStation,
      spritePositionOverride: destinationOverride,
    },
    shipType,
  );

  const bundleInput = {
    scene,
    flight,
    flightRender,
    color: station.nation.color,
    shipType,
    departureFromHeadingRadians: bundle.lastFlightHeadingRadians,
  };
  // Skip ring pulse if joining a flight already in progress.
  const travelBundle =
    flight.phase === "departing"
      ? createShipTravelVisualBundleForFreshFlight(bundleInput)
      : createShipTravelVisualBundleForFlightInProgress(bundleInput);

  bundle.travelBundle = travelBundle;

  bundle.orbitSprite.setVisible(false);
}

function endFlightVisuals(bundle: ShipVisualBundle, timeSeconds: number) {
  const existingTravelBundle = bundle.travelBundle!;
  if (existingTravelBundle.flight.destination.surfaceOrOrbit === "orbit") {
    seedOrbitFromFlightEnd(bundle, existingTravelBundle, timeSeconds);
  }
  // The exact on-screen heading at flight end — the next leg's departure turn
  // lerps from it so back-to-back legs don't snap.
  bundle.lastFlightHeadingRadians = existingTravelBundle.sprite.rotation;
  destroyShipTravelVisualBundle(existingTravelBundle);
  bundle.travelBundle = null;
}

/** Snap orbit seeds so the orbit sprite picks up exactly where the flight
 *  ended — without this the ship jumps by up to one orbit-radius when the
 *  flight ends and the orbit sprite takes over. */
function seedOrbitFromFlightEnd(
  bundle: ShipVisualBundle,
  flightBundle: ShipTravelVisualBundle,
  timeSeconds: number,
) {
  const station = bundle.ship.station;
  const deltaX = flightBundle.flightRender.endX - station.x;
  const deltaY = flightBundle.flightRender.endY - station.y;
  if (deltaX === 0 && deltaY === 0) return;
  const targetAngle = Math.atan2(deltaY, deltaX);
  // Back-compute orbitAngleAtZero so the orbit formula (orbitAngleAtZero + orbitSpeedRadiansPerSec * t) yields targetAngle at the current time.
  bundle.orbit.orbitAngleAtZero = targetAngle - bundle.orbit.orbitSpeedRadiansPerSec * timeSeconds;
  bundle.orbit.orbitRadius = Math.hypot(deltaX, deltaY);
}

export function updateFlightLifecycle(
  scene: Scene,
  bundle: ShipVisualBundle,
  tradeShip: TradeShip,
  tradeManager: TradeManager,
  timeSeconds: number,
) {
  const hasActiveFlight = tradeShip.flight !== null;
  const existingTravelBundle = bundle.travelBundle;
  const flightStarted =
    hasActiveFlight && (!existingTravelBundle || existingTravelBundle.flight !== tradeShip.flight);

  if (flightStarted) startFlightVisuals(scene, bundle, tradeShip, tradeManager, timeSeconds);
  if (!hasActiveFlight && existingTravelBundle) endFlightVisuals(bundle, timeSeconds);
  if (isTradeShipIdle(tradeShip)) {
    bundle.orbitSprite.setVisible(true);
    // Idle ends the leg chain — the next trip snaps to its course instead of
    // lerping from a heading the ship orbited away from.
    bundle.lastFlightHeadingRadians = null;
  }
  if (isTradeShipDeploying(tradeShip) && !tradeShip.flight) applyDeployingVisibility(bundle);
}

function applyDeployingVisibility(bundle: ShipVisualBundle): void {
  bundle.orbitSprite.setVisible(false);
  hideShipUi(bundle.shipUi);
}
