// Trade decision logic — given an idle ship and the current map state,
// compute the best 1-or-2-leg round trip and answer the overview-mode
// queries (which routes the fleet can fly, which wares are tradeable, which
// routes saw delivery in a given window).
//
// Pure read-only logic — picks endpoints, doesn't commit reservations or
// build queues. Reservation + queue building runs from sim-trade-queue.ts
// after findRoundTradeTrip resolves the legs.

import { economyConfig } from "../data/economy-config";
import type { WareId } from "../data/ware-types";
import type { TradeTripLeg, TradeDirection } from "./sim-trade-types";
import { getInventorySlot, getAllInventorySlots, isStationUnderConstruction, type Station, type InventorySlot } from "./sim-station";
import { getShipTemplate } from "./sim-ship-template";
import { type TradeShip } from "./sim-trade-types";
import { type RouteStats } from "./sim-trade-route-statistics";
// Type-only — avoids runtime cycle with sim-trade-manager.
import type { TradeManager } from "./sim-trade-manager";

/** Surplus available — current minus claimed-for-pickup. */
export function effectiveAvailable(slot: InventorySlot): number {
  return Math.max(0, slot.current - slot.reservedOutgoing);
}

/** Space for incoming deliveries — max minus current minus en-route. */
export function effectiveSpace(slot: InventorySlot): number {
  return Math.max(0, slot.max - slot.current - slot.reservedIncoming);
}

/** Fill % accounting for reservations: (current + incoming) / max. */
export function effectiveFillPercent(slot: InventorySlot): number {
  if (slot.max === 0) return 1;
  return (slot.current + slot.reservedIncoming) / slot.max;
}

/** Buy-side demand for `slot` — 0-1, higher = the station wants the ware more.
 *  Operational stations: 1 - fill. Build sites floor at 1 so their pull doesn't
 *  trickle as the build nears completion — safe as a per-station floor (not
 *  per-slot) because every slot on a build site is a construction input (see
 *  `createStationUnderConstruction`). */
export function getTradeBuyDemand(station: Station, slot: InventorySlot): number {
  if (isStationUnderConstruction(station)) return 1;
  return 1 - effectiveFillPercent(slot);
}

/** Sell-side supply for `slot` — 0-1, higher = the station ships the ware out
 *  more eagerly. Build sites don't sell their own inventory (filtered upstream
 *  by an empty producedWares set), so no construction case here. */
export function getTradeSellSupply(slot: InventorySlot): number {
  if (slot.max === 0) return 0;
  return slot.current / slot.max;
}

/** Producer-to-consumer routes the current fleet can actually fly,
 *  regardless of whether deliveries have happened. */
export function getPossibleTradeRoutes(manager: TradeManager): Array<{ fromStationId: string; toStationId: string; wares: WareId[] }> {
  const allowedWaresByHomeStationId = new Map<string, Set<WareId>>();
  for (const tradeShip of manager.activeTradeShips.all()) {
    if (allowedWaresByHomeStationId.has(tradeShip.homeStationId)) continue;
    allowedWaresByHomeStationId.set(
      tradeShip.homeStationId,
      new Set(getShipTemplate(manager.requireResolvedShip(tradeShip.orbitingShipId).shipTypeId).allowedWares),
    );
  }

  const routesByPair = new Map<string, { fromStationId: string; toStationId: string; wares: Set<WareId> }>();
  for (const [wareId, producers] of manager.wareStationIndex.producersByWareEntries()) {
    const consumers = manager.wareStationIndex.getConsumers(wareId);
    addRoutesForWare(wareId, producers, consumers, allowedWaresByHomeStationId, routesByPair);
  }

  return Array.from(routesByPair.values()).map((routeEntry) => ({
    fromStationId: routeEntry.fromStationId,
    toStationId: routeEntry.toStationId,
    wares: Array.from(routeEntry.wares),
  }));
}

/** Add producer-to-consumer pairs for one ware to `routesByPair`, skipping pairs
 *  where neither end's home ship can carry the ware. */
function addRoutesForWare(
  wareId: WareId,
  producers: readonly Station[],
  consumers: readonly Station[],
  allowedWaresByHomeStationId: Map<string, Set<WareId>>,
  routesByPair: Map<string, { fromStationId: string; toStationId: string; wares: Set<WareId> }>,
): void {
  for (const producer of producers) {
    for (const consumer of consumers) {
      if (producer === consumer) continue;
      const producerCanShipWare = allowedWaresByHomeStationId.get(producer.id)?.has(wareId) ?? false;
      const consumerCanShipWare = allowedWaresByHomeStationId.get(consumer.id)?.has(wareId) ?? false;
      // Delivery can be flown by the producer's home ship selling output
      // or the consumer's home ship fetching inputs. Neither = impossible.
      if (!producerCanShipWare && !consumerCanShipWare) continue;

      const key = `${producer.id}::${consumer.id}`;
      let routeEntry = routesByPair.get(key);
      if (!routeEntry) {
        routeEntry = { fromStationId: producer.id, toStationId: consumer.id, wares: new Set() };
        routesByPair.set(key, routeEntry);
      }
      routeEntry.wares.add(wareId);
    }
  }
}

/** Ware IDs the current fleet can actually move on at least one
 *  producer-to-consumer route. */
export function getShipTransportableWares(manager: TradeManager): WareId[] {
  const transportableWares = new Set<WareId>();
  for (const route of getPossibleTradeRoutes(manager)) {
    for (const wareId of route.wares) {
      transportableWares.add(wareId);
    }
  }
  return [...transportableWares];
}

/** Routes that carried cargo in the last `windowSeconds` (Infinity = all-time).
 *  Cached per-window, refreshing after tradeRouteCacheRefreshSeconds. Returns
 *  the same reference while warm so callers can identity-compare for diffs. */
export function getOrRefreshTradedRoutes(manager: TradeManager, now: number, windowSeconds: number): RouteStats[] {
  const cached = manager.routesCacheByWindow.get(windowSeconds);
  if (cached && now - cached.cachedAt < economyConfig.tradeRouteCacheRefreshSeconds) return cached.routes;
  const routes = manager.tradeRouteStats.getRouteStatsInWindow(now, windowSeconds);
  manager.routesCacheByWindow.set(windowSeconds, { cachedAt: now, routes });
  return routes;
}

/** Distinct ware IDs across `getOrRefreshTradedRoutes(...)`. */
export function getTradedWares(manager: TradeManager, now: number, windowSeconds: number): WareId[] {
  const set = new Set<WareId>();
  for (const route of getOrRefreshTradedRoutes(manager, now, windowSeconds)) {
    for (const wareStats of route.wares) set.add(wareStats.wareId);
  }
  return [...set];
}

/** Highest-scoring item from `candidates`, with ties broken by uniform random
 *  pick. Caller must pass a non-empty array. */
function pickRandomFromMaxScore<T>(
  candidates: T[],
  scoreFn: (item: T) => number,
): T {
  let bestScore = -Infinity;
  let tied: T[] = [];
  for (const candidate of candidates) {
    const score = scoreFn(candidate);
    if (score > bestScore) {
      bestScore = score;
      tied = [candidate];
    } else if (score === bestScore) {
      tied.push(candidate);
    }
  }
  return tied[Math.floor(Math.random() * tied.length)];
}

/** Pick the main cargo leg — direction (sell/buy), ware, destination, amount.
 *  Respects allowedWares, minimum-fill threshold (with idle decay), and the
 *  optimalChance vs random pick. Returns null if no viable leg exists. */
function pickPrimaryLeg(ship: TradeShip, manager: TradeManager): TradeTripLeg | null {
  const home = manager.requireResolvedStation(ship.homeStationId);
  const orbitingShip = manager.requireResolvedShip(ship.orbitingShipId);
  const cargoCapacity = getShipTemplate(orbitingShip.shipTypeId).cargoCapacity;
  if (cargoCapacity === 0) return null;

  const allowedWares = getShipTemplate(orbitingShip.shipTypeId).allowedWares;
  const candidates = scoreHomeInventoryCandidates(home, allowedWares);
  if (candidates.length === 0) return null;

  const picked = pickPrimaryLegCandidate(candidates);

  const counterStation = pickDestinationStation(picked, home, manager);
  if (!counterStation) return null;

  const isSell = picked.direction === "sell";
  const wareId = picked.slot.ware.id;
  const cargoAmount = sizeCargoForLeg(picked, counterStation, cargoCapacity);
  if (cargoAmount <= 0) return null;

  if (cargoAmount / cargoCapacity < decayedMinimumCargoFill(ship, manager)) return null;

  return {
    wareId,
    amount: cargoAmount,
    fromStation: isSell ? home : counterStation,
    toStation: isSell ? counterStation : home,
  };
}

interface PrimaryLegCandidate {
  slot: InventorySlot;
  score: number;
  direction: TradeDirection;
}

/** Score every home inventory slot the ship can carry — outputs become sell
 *  candidates (higher fill = more urgent), inputs become buy candidates (lower
 *  fill = more desperate). Skips slots with no surplus / no room.
 *
 *  Exported so tests can pin the building-station classification rule directly
 *  — `findEligibleCounterStations` blocks the bug downstream by the demand
 *  floor + `score > homeScore`, but those are trade-balance knobs, not
 *  invariants. The lone external consumer is the test suite. */
export function scoreHomeInventoryCandidates(home: Station, allowedWares: WareId[]): PrimaryLegCandidate[] {
  // A station-under-construction's slots are inbound-only construction inputs.
  // Treating them via stationType.produces (which already names the future
  // output) would route a shipyard-construction's hulls back out, locking
  // total hulls in a closed loop between builds.
  const producedWares = isStationUnderConstruction(home)
    ? new Set<WareId>()
    : new Set(home.stationType.produces);
  const candidates: PrimaryLegCandidate[] = [];

  for (const slot of getAllInventorySlots(home)) {
    if (!allowedWares.includes(slot.ware.id)) continue;

    if (producedWares.has(slot.ware.id)) {
      // Sell own output — surplus past existing pickup reservations.
      if (effectiveAvailable(slot) > 0) {
        candidates.push({
          slot,
          score: getTradeSellSupply(slot),
          direction: "sell",
        });
      }
    } else {
      // Buy missing input — room past existing en-route deliveries.
      if (effectiveSpace(slot) > 0) {
        candidates.push({
          slot,
          score: getTradeBuyDemand(home, slot),
          direction: "buy",
        });
      }
    }
  }

  return candidates;
}

/** optimalChance of the time picks the highest-score candidate (ties shuffle),
 *  otherwise uniform random — keeps fleets from converging on the same leg
 *  every tick. */
function pickPrimaryLegCandidate(candidates: PrimaryLegCandidate[]): PrimaryLegCandidate {
  if (Math.random() < economyConfig.optimalChance) {
    return pickRandomFromMaxScore(candidates, (candidate) => candidate.score);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

interface CounterStationCandidate {
  station: Station;
  slot: InventorySlot;
  score: number;
}

/** Counter-side stations that score higher than home for this ware. Sell-side
 *  ranks consumers by buy-demand; buy-side ranks producers by sell-supply.
 *  Build-site demand floor only fires on the sell branch — buy direction stays
 *  on raw supply, so a build-site home observes the gradient and the producer's
 *  sell pick routes cargo to it. */
function findEligibleCounterStations(
  picked: PrimaryLegCandidate,
  home: Station,
  manager: TradeManager,
): CounterStationCandidate[] {
  const isSell = picked.direction === "sell";
  const wareId = picked.slot.ware.id;
  const stations = isSell
    ? manager.wareStationIndex.getConsumers(wareId)
    : manager.wareStationIndex.getProducers(wareId);
  const scoreFor: (station: Station, slot: InventorySlot) => number = isSell
    ? (station, slot) => getTradeBuyDemand(station, slot)
    : (_station, slot) => getTradeSellSupply(slot);
  const homeScore = scoreFor(home, picked.slot);
  const eligible: CounterStationCandidate[] = [];
  for (const station of stations) {
    if (station === home) continue;
    const slot = getInventorySlot(station, wareId);
    if (!slot) continue;
    const score = scoreFor(station, slot);
    if (score > homeScore) eligible.push({ station, slot, score });
  }
  return eligible;
}

/** Resolve the counter-side station for `picked`'s leg — optimalChance of the
 *  time goes to the highest-scoring eligible candidate, otherwise uniform
 *  random. Returns null if none qualify. */
function pickDestinationStation(
  picked: PrimaryLegCandidate,
  home: Station,
  manager: TradeManager,
): Station | null {
  const eligible = findEligibleCounterStations(picked, home, manager);
  if (eligible.length === 0) return null;
  if (Math.random() < economyConfig.optimalChance) {
    return pickRandomFromMaxScore(eligible, (entry) => entry.score).station;
  }
  return eligible[Math.floor(Math.random() * eligible.length)].station;
}

/** Cargo amount for the leg — clamped by ship capacity, source surplus,
 *  and destination room (all reservation-aware). */
function sizeCargoForLeg(
  picked: PrimaryLegCandidate,
  target: Station,
  cargoCapacity: number,
): number {
  const isSell = picked.direction === "sell";
  const wareId = picked.slot.ware.id;
  const sourceSlot = isSell ? picked.slot : getInventorySlot(target, wareId)!;
  const destinationSlot = isSell ? getInventorySlot(target, wareId)! : picked.slot;
  return Math.min(cargoCapacity, effectiveAvailable(sourceSlot), effectiveSpace(destinationSlot));
}

/** Minimum fraction of cargo a leg must fill to be worth flying. Starts at
 *  minimumCargoFillThreshold and decays to 0 over time per cargoFillDecayPerSecond
 *  — values live in data/economy-config.ts. */
function decayedMinimumCargoFill(ship: TradeShip, manager: TradeManager): number {
  const idleElapsed = manager.tradeTime - ship.idleStartTime;
  return Math.max(0, economyConfig.minimumCargoFillThreshold - idleElapsed * economyConfig.cargoFillDecayPerSecond);
}

/** Opportunistic backhaul for the empty leg of `primary`. Returns null if
 *  nothing qualifies — ship runs the empty leg. */
function pickSecondaryLeg(ship: TradeShip, primary: TradeTripLeg, manager: TradeManager): TradeTripLeg | null {
  const shipTemplate = getShipTemplate(manager.requireResolvedShip(ship.orbitingShipId).shipTypeId);
  const allowed = shipTemplate.allowedWares;

  // Backhaul flows opposite the primary leg — fill the empty return trip.
  const source = primary.toStation;
  const destination = primary.fromStation;

  for (const wareId of source.stationType.produces) {
    if (wareId === primary.wareId) continue;
    if (!allowed.includes(wareId)) continue;
    if (destination.stationType.produces.includes(wareId)) continue;

    const sourceSlot = getInventorySlot(source, wareId);
    const destinationSlot = getInventorySlot(destination, wareId);
    if (!sourceSlot || !destinationSlot) continue;

    const amount = Math.min(shipTemplate.cargoCapacity, effectiveAvailable(sourceSlot), effectiveSpace(destinationSlot));
    if (amount <= 0) continue;

    return { wareId: sourceSlot.ware.id, amount, fromStation: source, toStation: destination };
  }
  return null;
}

/** Best 1-or-2-leg round trip for this idle ship, or null. */
export function findRoundTradeTrip(ship: TradeShip, manager: TradeManager): TradeTripLeg[] | null {
  const primary = pickPrimaryLeg(ship, manager);
  if (!primary) return null;

  const secondary = pickSecondaryLeg(ship, primary, manager);
  const legs: TradeTripLeg[] = [primary];
  if (secondary) legs.push(secondary);
  return legs;
}
