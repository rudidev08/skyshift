// Emigrant ship launch + ferry logic — turns a chosen station's emigration
// state into ships flying to the generational ship.
//
// Lifecycle: beginStationEmigration wires a station into an active event
// (computes its emigrant budget, reroutes pre-existing homed trade ships,
// writes per-station state). On every tick after that, tickEmigrantLaunches
// walks emigrating stations, batches their newly-spawned ships into one
// addShips call, then enrolls each as a trader carrying passengers cargo
// and queues its ferry-to-WAY tail.

import type { Station } from "./sim-station-types";
import type { ShipTypeId } from "../data/ship-types";
import type { Ship } from "./sim-ships";
import type { ShipManager } from "./sim-ship-manager";
import type { TradePort } from "./sim-trade-manager";
import type { TradeShip } from "./sim-trade-types";
import type { StationManager } from "./sim-station-manager";
import type { NamePool } from "./sim-name-pool";
import type { EmigrationEvent, EmigrationEventContext } from "./sim-emigration-types";
import type { EmigrationManager } from "./sim-emigration-manager";
import { EMIGRANT_SHIPS_PER_STATION_BASE, retireUnlaunched } from "./sim-emigration-types";
import { sizeMultiplierBySize } from "../data/stations";
import { getShipTemplate } from "./sim-ship-template";
import { generateCounterId } from "./util-ids";
import { createOrbitEndpoint } from "./sim-travel";

// Gap between consecutive launches at a single station, in sim-seconds.
const EMIGRANT_LAUNCH_INTERVAL_SECONDS = 1;

export interface LaunchDependencies {
  stationManager: StationManager;
  shipManager: ShipManager;
  tradeManager: TradePort;
  namePool: NamePool;
  emigrationManager: EmigrationManager;
}

/** Wire one station into the active emigration event: compute its emigrant
 *  budget, reroute pre-existing homed trade ships to the generational ship,
 *  and write the per-station state. Returns this station's contribution to
 *  totalExpectedShips (= emigrants + pre-existing homed count). */
export function beginStationEmigration(
  station: Station,
  generationalShip: Station,
  context: EmigrationEventContext,
  dependencies: LaunchDependencies,
): number {
  const sizeMultiplier = sizeMultiplierBySize[station.size];
  const totalEmigrants = EMIGRANT_SHIPS_PER_STATION_BASE * sizeMultiplier;
  const initialHomedShipIds: string[] = [];
  for (const tradeShip of dependencies.tradeManager.getTradeShipsByHomeStationId(station.id)) {
    initialHomedShipIds.push(tradeShip.orbitingShipId);
    queueFerryToGenerationalShip(tradeShip, generationalShip, context.destinationName, dependencies);
  }
  station.emigrationEvent = {
    eventId: context.eventId,
    destinationName: context.destinationName,
    initialHomedShipIds,
    initialHomedShipIdSet: new Set(initialHomedShipIds),
    totalEmigrants,
    launched: 0,
    // First launch fires immediately on the next tick.
    secondsUntilNextLaunch: 0,
    progressFraction: 0,
  };
  return totalEmigrants + initialHomedShipIds.length;
}

/** Per-tick emigrant launcher. Walks emigrating stations, batches all
 *  spawned ships into one `addShips` call (single observer fan-out +
 *  path-cache rebuild), then enrolls each as a trader carrying passengers
 *  cargo and queues its ferry-to-WAY tail. */
export function tickEmigrantLaunches(
  event: EmigrationEvent,
  deltaSeconds: number,
  generationalShip: Station,
  dependencies: LaunchDependencies,
): void {
  const orbitingShips = collectEmigrantLaunchesForTick(event, deltaSeconds, dependencies);
  if (orbitingShips.length === 0) return;

  dependencies.shipManager.addShips(orbitingShips);
  enrollLaunchedShipsAsTraders(orbitingShips, generationalShip, event.destinationName, dependencies);
}

/** Walk every emigrating station and gather the ships each one launches this
 *  tick. Returns the combined batch — caller is responsible for registering
 *  them in one `addShips` call so observers fan out only once. */
function collectEmigrantLaunchesForTick(
  event: EmigrationEvent,
  deltaSeconds: number,
  dependencies: LaunchDependencies,
): Ship[] {
  const orbitingShips: Ship[] = [];
  for (const stationId of event.stationIds) {
    const station = dependencies.stationManager.getStation(stationId);
    if (!station) continue; // demolished in a previous tick — keep iterating siblings.
    orbitingShips.push(...launchEmigrantsForStation(station, deltaSeconds, event, dependencies));
  }
  return orbitingShips;
}

/** Post-`addShips` enrollment pass — for each newly-launched ship that the
 *  trade-manager observer wrapped into a TradeShip, attach passengers cargo
 *  and queue the fly-to-WAY + decommission tail. */
function enrollLaunchedShipsAsTraders(
  orbitingShips: Ship[],
  generationalShip: Station,
  destinationName: string,
  dependencies: LaunchDependencies,
): void {
  for (const orbitingShip of orbitingShips) {
    const tradeShip = dependencies.tradeManager.findTradeShip(orbitingShip);
    if (!tradeShip) continue; // station vanished mid-tick; observer skipped enrollment
    // Flavor cargo — passengers ware has no producer/consumer, so it never
    // touches the economy and gets destroyed with the ship on decommission.
    tradeShip.cargoAmountByWareId.set("passengers", getShipTemplate(orbitingShip.shipTypeId).cargoCapacity);
    // After enrollment's deploy-to-orbit leg, fly straight to the
    // generational ship and decommission on arrival.
    queueFerryToGenerationalShip(tradeShip, generationalShip, destinationName, dependencies);
  }
}

/** Launch this station's next batch of emigrant ships. Decrements the timer,
 *  spawns ships until the timer debt is zero or totalEmigrants is hit. If
 *  the nation has no ship type, retire the launch budget so
 *  totalExpectedShips drops in lockstep — otherwise WAY waits on phantoms.
 *  Returns the ships built (caller batches the registration). */
function launchEmigrantsForStation(
  station: Station,
  deltaSeconds: number,
  event: EmigrationEvent,
  dependencies: LaunchDependencies,
): Ship[] {
  const state = station.emigrationEvent!;
  if (state.launched >= state.totalEmigrants) return [];
  const shipTypeId = station.nation.shipTypeId;
  if (!shipTypeId) {
    retireUnlaunched(state, event);
    return [];
  }
  state.secondsUntilNextLaunch -= deltaSeconds;
  const orbitingShips: Ship[] = [];
  while (state.secondsUntilNextLaunch <= 0 && state.launched < state.totalEmigrants) {
    orbitingShips.push(buildEmigrantShip(station, shipTypeId, dependencies));
    state.launched++;
    state.secondsUntilNextLaunch += EMIGRANT_LAUNCH_INTERVAL_SECONDS;
  }
  return orbitingShips;
}

/** Construct (but don't register) an emigrant ship. Caller batches into a
 *  single addShips call to avoid per-ship observer fan-out. Orbit visuals
 *  are render-owned; sim carries only identity + home + inFlight. */
function buildEmigrantShip(
  station: Station,
  shipTypeId: ShipTypeId,
  dependencies: LaunchDependencies,
): Ship {
  const nation = station.nation;
  const id = generateCounterId(`${nation.codeName}-EMIG`, dependencies.emigrationManager.nextEmigrantShipId(), 4);
  return {
    id,
    shipTypeId,
    shipName: dependencies.namePool.claimShipName(nation),
    station,
  };
}

/** Append fly-to-generational-ship + decommission to a trade ship's queue.
 *  Used for fresh emigrants and rerouted homed ships. Decommission targets
 *  the generational ship so save/load survives mid-flight home-station demolition. */
export function queueFerryToGenerationalShip(
  tradeShip: TradeShip,
  generationalShip: Station,
  destinationName: string,
  dependencies: LaunchDependencies,
): void {
  // Origin = the ship's current orbiting station, resolved through
  // ShipManager so TradeShip doesn't carry a live Ship ref.
  const orbitingShip = dependencies.shipManager.getShip(tradeShip.orbitingShipId);
  if (!orbitingShip) throw new Error(`queueFerryToGenerationalShip: ship ${tradeShip.orbitingShipId} not found`);
  const origin = orbitingShip.station;
  dependencies.tradeManager.appendActionsToShip(tradeShip, [
    {
      type: "fly",
      origin: createOrbitEndpoint(origin),
      originStation: origin,
      destination: createOrbitEndpoint(generationalShip),
      destinationStation: generationalShip,
      travelMode: "interStation",
      label: `Ferry to ${destinationName}`,
    },
    {
      type: "decommission",
      station: generationalShip,
      label: `Decommission at ${destinationName}`,
    },
  ]);
}
