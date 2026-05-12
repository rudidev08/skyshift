// Flight-render lifecycle for one ship — start visuals when a flight begins,
// destroy them when it ends, and snap orbit seeds on arrival so the orbit
// sprite picks up exactly where the flight ended.

import { type Scene } from "phaser";
import { getNationShipTemplate } from "../sim-ships";
import type { TradeManager } from "../sim-trade-manager";
import type { TradeShip } from "../sim-trade-types";
import { isTradeShipIdle, isTradeShipDeploying } from "../sim-trade-log";
import {
  createShipTravelVisualBundleForFlightInProgress,
  createShipTravelVisualBundleForFreshFlight,
  destroyShipTravelVisualBundle,
} from "./ship-travel-visual-bundle";
import { createFlightRenderData } from "./flight-render-data";
import type { FlightData } from "../sim-travel";
import type { Station } from "../sim-station-types";
import { ORBIT_APPROACH_RADIUS } from "../../data/ship-travel";
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
  timeSec: number;
}

/** Fresh flights (progress === 0) align takeoff/landing with the actual orbit
 *  sprite position so they don't teleport through the station center.
 *  Mid-flight loads (progress > 0) build geometry from station defaults; this
 *  is a known small visual shift on load since coords + curveAngle aren't
 *  persisted. */
function computeFreshFlightOverrides(
  context: FreshFlightOverridesContext,
): { originOverride: { x: number; y: number } | undefined; destinationOverride: { x: number; y: number } | undefined } {
  const { bundle, flight, originStation, destinationStation, timeSec } = context;
  if (flight.progress !== 0) return { originOverride: undefined, destinationOverride: undefined };

  let originOverride: { x: number; y: number } | undefined;
  let destinationOverride: { x: number; y: number } | undefined;
  if (flight.origin.surfaceOrOrbit === "orbit") {
    const orbitPosition = getOrbitingShipPose(bundle.ship, bundle.orbit, timeSec);
    originOverride = { x: orbitPosition.x, y: orbitPosition.y };
  }
  if (flight.destination.surfaceOrOrbit === "orbit") {
    // Pull endpoint back off destination center along the approach heading
    // so the flight sprite lands on a notional orbit ring, not the station
    // body. The orbit sprite's takeover snap places it exactly here.
    const startX = originOverride?.x ?? originStation.x + (flight.origin.surfaceOrOrbit === "orbit" ? ORBIT_APPROACH_RADIUS : 0);
    const startY = originOverride?.y ?? originStation.y;
    const endRawX = destinationStation.x + ORBIT_APPROACH_RADIUS;
    const endRawY = destinationStation.y;
    const approachHeading = Math.atan2(endRawY - startY, endRawX - startX);
    destinationOverride = {
      x: endRawX - Math.cos(approachHeading) * ORBIT_APPROACH_RADIUS,
      y: endRawY - Math.sin(approachHeading) * ORBIT_APPROACH_RADIUS,
    };
  }
  return { originOverride, destinationOverride };
}

function startFlightVisuals(scene: Scene, bundle: ShipVisualBundle, tradeShip: TradeShip, tradeManager: TradeManager, timeSec: number) {
  const existingFlight = bundle.travelBundle;
  if (existingFlight) {
    destroyShipTravelVisualBundle(existingFlight);
    bundle.travelBundle = null;
  }

  const station = bundle.ship.station;
  const shipType = getNationShipTemplate(station.nation);
  const flight = tradeShip.flight!;
  // Soft-lookup so a save with a mid-flight ferry from a demolished home doesn't crash here.
  // The sim still lands and decommissions the flight; we just skip building visuals when
  // either endpoint is missing, since the approach geometry below needs both.
  const originStation = tradeManager.stationResolver(flight.origin.stationId);
  const destinationStation = tradeManager.stationResolver(flight.destination.stationId);
  if (!originStation || !destinationStation) {
    return;
  }

  const { originOverride, destinationOverride } = computeFreshFlightOverrides({
    bundle,
    flight,
    originStation,
    destinationStation,
    timeSec,
  });

  const flightRender = createFlightRenderData(
    { endpoint: flight.origin, station: originStation, spritePositionOverride: originOverride },
    { endpoint: flight.destination, station: destinationStation, spritePositionOverride: destinationOverride },
    shipType,
  );

  const bundleInput = {
    scene,
    flight,
    flightRender,
    color: station.nation.color,
    shipType,
  };
  // Skip ring pulse if joining a flight already in progress.
  const travelBundle = flight.phase === "departing"
    ? createShipTravelVisualBundleForFreshFlight(bundleInput)
    : createShipTravelVisualBundleForFlightInProgress(bundleInput);

  bundle.travelBundle = travelBundle;

  bundle.shape.setVisible(false);
}

function endFlightVisuals(bundle: ShipVisualBundle, timeSec: number) {
  const existingFlight = bundle.travelBundle!;
  // Orbit-arrival flights: snap orbit seeds so the orbit sprite picks up
  // exactly where the flight ended (avoids a ~orbit-radius jump from flight
  // end point to seeded orbit angle/radius).
  const flight = existingFlight.flight;
  const flightRender = existingFlight.flightRender;
  if (flight.destination.surfaceOrOrbit === "orbit") {
    const station = bundle.ship.station;
    const dx = flightRender.endX - station.x;
    const dy = flightRender.endY - station.y;
    if (dx !== 0 || dy !== 0) {
      const targetAngle = Math.atan2(dy, dx);
      // angle(t) = orbitAngleAtZero + orbitSpeedRadPerSec * t
      // solve for orbitAngleAtZero so that angle(timeSec) === targetAngle.
      bundle.orbit.orbitAngleAtZero = targetAngle - bundle.orbit.orbitSpeedRadPerSec * timeSec;
      bundle.orbit.orbitRadius = Math.hypot(dx, dy);
    }
  }
  destroyShipTravelVisualBundle(existingFlight);
  bundle.travelBundle = null;
}

export function updateFlightLifecycle(scene: Scene, bundle: ShipVisualBundle, tradeShip: TradeShip, tradeManager: TradeManager, timeSec: number) {
  const hasActiveFlight = tradeShip.flight !== null;
  const existingFlight = bundle.travelBundle;
  const flightChanged = hasActiveFlight && (!existingFlight || existingFlight.flight !== tradeShip.flight);

  if (flightChanged) startFlightVisuals(scene, bundle, tradeShip, tradeManager, timeSec);
  if (!hasActiveFlight && existingFlight) endFlightVisuals(bundle, timeSec);
  if (isTradeShipIdle(tradeShip)) bundle.shape.setVisible(true);
  if (isTradeShipDeploying(tradeShip) && !tradeShip.flight) {
    bundle.shape.setVisible(false);
    hideShipUi(bundle.shipUi);
  }
}
