import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { getAllInventorySlots, getInventorySlot } from "../sim-station.ts";
import { findRoundTradeTrip, effectiveFillPercent } from "../sim-trade-decision.ts";
import { createSimulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-builder.ts";
import { getShipTemplate } from "../sim-ship-template.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import type { MapTemplate, MapPreset } from "../../data/map-types.ts";

// --- Real findTrip + overview against the settled simulation ---
//
// `ignoreCargoCompatibility` makes every dockable station spawn its full
// roster so findTrip has plenty of candidates. Each test builds a fresh
// simulation so disposal and per-ship mutations stay self-contained.

function freshSettledSimulation(extraOptions: Parameters<typeof createSimulation>[1] = {}) {
  return createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    ...extraOptions,
  });
}

test("findTrip returns a 1-or-2-leg Trip for a freshly-initialized ship with routes available", () => {
  const simulation = freshSettledSimulation();
  const ships = simulation.tradeManager.tradeShips;
  assertTrue(ships.length > 0, "simulation produced ships");

  let foundTrip = false;
  for (const ship of ships) {
    const trip = findRoundTradeTrip(ship, simulation.tradeManager);
    if (trip) {
      assertTrue(trip.length === 1 || trip.length === 2, "trip has 1 or 2 legs");
      // Pin Math.min cargoCapacity clamp on every leg. Dropping cargoCapacity
      // from sizeCargoForLeg's clamp would let a leg's amount exceed the
      // ship's hold when both source surplus and destination room are large.
      const orbitingShip = simulation.tradeManager.requireResolvedShip(ship.orbitingShipId);
      const cargoCapacity = getShipTemplate(orbitingShip.shipTypeId).cargoCapacity;
      for (const leg of trip) {
        assertTrue(leg.amount > 0, "leg amount positive");
        assertTrue(leg.amount <= cargoCapacity, "leg amount does not exceed cargo capacity");
      }
      foundTrip = true;
      break;
    }
  }
  assertTrue(foundTrip, "at least one ship found a trip");
  simulation.tradeManager.dispose();
});

test("findTrip picks destinations with the right fill direction (sell to lower-fill, buy from higher-fill)", () => {
  // Pin pickDestinationStation's fill-direction filter:
  //   isSell ? fill < homeFill : fill > homeFill
  // Swapping the comparators would route sell trips to fuller-than-home
  // consumers (defeats the point of selling to make room) and buy trips
  // from emptier-than-home producers. The eligible set would be empty in
  // most realistic seedings — so this catches a swap by frequency, not by
  // single-trip observation.
  const simulation = freshSettledSimulation();
  let checkedTrips = 0;
  let mismatchedTrips = 0;
  for (const ship of simulation.tradeManager.tradeShips) {
    const trip = findRoundTradeTrip(ship, simulation.tradeManager);
    if (!trip) continue;
    const primary = trip[0];
    const sourceSlot = getInventorySlot(primary.fromStation, primary.wareId);
    const destinationSlot = getInventorySlot(primary.toStation, primary.wareId);
    if (!sourceSlot || !destinationSlot) continue;
    const sourceFill = effectiveFillPercent(sourceSlot);
    const destinationFill = effectiveFillPercent(destinationSlot);
    // For sell (from=home produces) and buy (from=target produces), the
    // primary leg always flows from a higher-fill source to a lower-fill
    // destination — that's the trade gradient findRoundTradeTrip enforces.
    checkedTrips++;
    if (sourceFill < destinationFill) mismatchedTrips++;
  }
  assertTrue(checkedTrips > 0, "at least one trip checked");
  assertEqual(mismatchedTrips, 0, "every primary leg flows from higher-fill source to lower-fill destination");
  simulation.tradeManager.dispose();
});

test("findTrip returns null when the ship's home station has no deliverable cargo", () => {
  const simulation = freshSettledSimulation();
  const ship = simulation.tradeManager.tradeShips[0];
  const home = simulation.stationManager.getStation(ship.homeStationId);
  assertTrue(home !== undefined, "home station should resolve");
  // Drain every home slot and reserve every byte of space so effectiveSpace
  // = 0 too — removes every reason to sell (no cargo) and to buy (no room).
  for (const slot of getAllInventorySlots(home!)) {
    slot.current = 0;
    slot.reservedIncoming = slot.max;
  }
  assertTrue(findRoundTradeTrip(ship, simulation.tradeManager) === null, "no trade when home is drained and fully reserved");
  simulation.tradeManager.dispose();
});

test("overview ware and route lists reflect spawned fleet cargo capacity", () => {
  const simulation = freshSettledSimulation({ initialStaggerDuration: 0 });

  // startInitialStationBuilds places one build site per building nation at game start, and build
  // sites spawn trader ships — provisions/hulls appear in the overlay
  // immediately as construction inflow routes. Signal stays tradeable via
  // SKY's jumpships — positive check that the filter doesn't trim wares the
  // current fleet CAN carry.
  const tradeableWares = new Set(simulation.tradeManager.getShipTransportableWares());
  assertTrue(tradeableWares.has("provisions"), "provisions should be tradeable — build-site traders carry them");
  assertTrue(tradeableWares.has("hulls"), "hulls should be tradeable — build-site traders carry them");
  assertTrue(tradeableWares.has("signal"), "signal should be tradeable — jumpships carry it");

  const possibleRoutes = simulation.tradeManager.getPossibleTradeRoutes();
  assertTrue(
    possibleRoutes.some((route) => route.wares.includes("provisions")),
    "overlay should include provisions delivery to build sites",
  );
  assertTrue(
    possibleRoutes.some((route) => route.wares.includes("signal")),
    "overlay should keep routes that spawned ships can actually fly",
  );

  // Pin the addRoutesForWare OR-tracker. FAR's nation ship is `trader`, which
  // cannot carry "signal" — so FAR-D's home fleet (signal-producing observatory)
  // can't fly the cargo. SKY-A's home fleet is jumpship and CAN carry signal.
  // The route exists only because the consumer's fleet covers it; an AND
  // mutation (require both sides) would drop FAR-D->SKY-A entirely.
  assertTrue(
    possibleRoutes.some(
      (route) =>
        route.fromStationId === "FAR-D" &&
        route.toStationId === "SKY-A" &&
        route.wares.includes("signal"),
    ),
    "overlay should keep mixed-fleet routes — only the consumer's ship can carry signal",
  );

  simulation.tradeManager.dispose();
});

test("maps with no cargo-compatible producer-consumer wares keep overview route data empty", () => {
  const tinyUniverse: MapTemplate = {
    sectors: [
      {
        id: "EMPTY",
        name: "Empty Exchange",
        lore: "No cargo-compatible trade is possible here.",
        gridX: 0,
        gridY: 0,
        environment: "deep-space",
      },
    ],
    nebulas: [],
    zones: [
      { id: "EMPTY-1", sectorId: "EMPTY", x: -100, y: 0, size: "M" },
      { id: "EMPTY-2", sectorId: "EMPTY", x: 100, y: 0, size: "M" },
    ],
    sectorSize: 1000,
  };
  const noTradeRoutesPreset: MapPreset = {
    id: "no-trade-routes",
    name: "No Trade Routes",
    description: "Regression fixture for overview empty-state startup.",
    stations: [
      { zoneId: "EMPTY-1", stationId: "FAR-OBS", name: "FAR-OBS", nationId: "far", stationTypeId: "observatory" },
      { zoneId: "EMPTY-2", stationId: "ORE-HAB", name: "ORE-HAB", nationId: "ore", stationTypeId: "habitat" },
    ],
  };
  const noTradeRoutesMap = createMapFromTemplate(tinyUniverse, noTradeRoutesPreset);

  const simulation = createSimulation(noTradeRoutesMap, { initialStaggerDuration: 0 });

  assertEqual(simulation.tradeManager.getShipTransportableWares().length, 0, "overview should tolerate an empty ware list");
  assertEqual(simulation.tradeManager.getPossibleTradeRoutes().length, 0, "overview should tolerate an empty route list");

  simulation.tradeManager.dispose();
});
