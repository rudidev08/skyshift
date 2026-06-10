import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { createInventorySlot, getAllInventorySlots, getInventorySlot } from "../sim-station.ts";
import { findRoundTradeTrip, effectiveFillPercent } from "../sim-trade-decision.ts";
import { createSimulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-create.ts";
import { getShipTypeTemplate } from "../sim-ship-template.ts";
import { createSettledSimulation } from "./sim-test-fixtures.ts";
import { makeStationWithProduces } from "./factories.ts";
import { TradeManager } from "../sim-trade-manager.ts";
import { ice } from "../../data/wares.ts";
import type { Ship } from "../sim-ships.ts";
import type { Station } from "../sim-station-types.ts";
import type { MapTemplate, MapPreset } from "../../data/map-types.ts";

// `ignoreCargoCompatibility` makes every dockable station spawn its full
// roster so findRoundTradeTrip has plenty of candidates. Each test builds a
// fresh simulation so destroy and per-ship mutations stay self-contained.

test("findRoundTradeTrip returns a 1-or-2-leg Trip for a freshly-initialized ship with routes available", () => {
  const simulation = createSettledSimulation();
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
      const cargoCapacity = getShipTypeTemplate(orbitingShip.shipTypeId).cargoCapacity;
      for (const leg of trip) {
        assertTrue(leg.amount > 0, "leg amount positive");
        assertTrue(leg.amount <= cargoCapacity, "leg amount does not exceed cargo capacity");
      }
      foundTrip = true;
      break;
    }
  }
  assertTrue(foundTrip, "at least one ship found a trip");
  simulation.tradeManager.destroy();
});

test("findRoundTradeTrip picks destinations with the right fill direction (sell to lower-fill, buy from higher-fill)", () => {
  // Pin pickDestinationStation's fill-direction filter:
  //   isSell ? fill < homeFill : fill > homeFill
  // Swapping the comparators would route sell trips to fuller-than-home
  // consumers (defeats the point of selling to make room) and buy trips
  // from emptier-than-home producers. The eligible set would be empty in
  // most realistic seedings — so this catches a swap by frequency, not by
  // single-trip observation.
  const simulation = createSettledSimulation();
  let checkedTrips = 0;
  let mismatchedTrips = 0;
  for (const ship of simulation.tradeManager.tradeShips) {
    const trip = findRoundTradeTrip(ship, simulation.tradeManager);
    if (!trip) continue;
    const primaryLeg = trip[0];
    const sourceSlot = getInventorySlot(primaryLeg.fromStation, primaryLeg.wareId);
    const destinationSlot = getInventorySlot(primaryLeg.toStation, primaryLeg.wareId);
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
  assertEqual(
    mismatchedTrips,
    0,
    "every primary leg flows from higher-fill source to lower-fill destination",
  );
  simulation.tradeManager.destroy();
});

test("findRoundTradeTrip returns null when the ship's home station has no deliverable cargo", () => {
  const simulation = createSettledSimulation();
  const ship = simulation.tradeManager.tradeShips[0];
  const homeStation = simulation.stationManager.getStation(ship.homeStationId);
  assertTrue(homeStation !== undefined, "homeStation should resolve");
  // Drain every home slot and reserve every byte of space so effectiveSpace
  // = 0 too — removes every reason to sell (no cargo) and to buy (no room).
  for (const slot of getAllInventorySlots(homeStation!)) {
    slot.current = 0;
    slot.reservedIncoming = slot.max;
  }
  assertTrue(
    findRoundTradeTrip(ship, simulation.tradeManager) === null,
    "no trade when home is drained and fully reserved",
  );
  simulation.tradeManager.destroy();
});

test("overview ware and route lists reflect spawned fleet cargo capacity", () => {
  const simulation = createSettledSimulation();

  // startInitialStationBuilds places one build site per building nation at game start, and build
  // sites spawn trader ships — provisions/hulls appear in the overlay
  // immediately as construction inflow routes. Signal stays tradeable via
  // SKY's jumpships — positive check that the filter doesn't trim wares the
  // current fleet CAN carry.
  const tradeableWares = new Set(simulation.tradeManager.getShipTransportableWares());
  assertTrue(
    tradeableWares.has("provisions"),
    "provisions should be tradeable — build-site traders carry them",
  );
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
        route.fromStationId === "FAR-D" && route.toStationId === "SKY-A" && route.wares.includes("signal"),
    ),
    "overlay should keep mixed-fleet routes — only the consumer's ship can carry signal",
  );

  simulation.tradeManager.destroy();
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
        environment: "frontier",
      },
    ],
    nebulas: [],
    // Zone coords must land inside the sector (map (0,0)-(1000,1000) here) —
    // every template zone passes the runtime convention check, occupied or not.
    zones: [
      { id: "EMPTY-1", x: 400, y: 500, size: "M" },
      { id: "EMPTY-2", x: 600, y: 500, size: "M" },
    ],
    sectorSize: 1000,
  };
  const noTradeRoutesPreset: MapPreset = {
    id: "no-trade-routes",
    name: "No Trade Routes",
    description: "Regression fixture for overview empty-state startup.",
    presetStations: [
      {
        zoneId: "EMPTY-1",
        stationId: "FAR-OBS",
        name: "FAR-OBS",
        nationId: "far",
        stationTypeId: "observatory",
      },
      {
        zoneId: "EMPTY-2",
        stationId: "ORE-HAB",
        name: "ORE-HAB",
        nationId: "ore",
        stationTypeId: "habitat",
      },
    ],
  };
  const noTradeRoutesMap = createMapFromTemplate(tinyUniverse, noTradeRoutesPreset);

  const simulation = createSimulation(noTradeRoutesMap, { initialStaggerDurationSeconds: 0 });

  assertEqual(
    simulation.tradeManager.getShipTransportableWares().length,
    0,
    "overview should tolerate an empty ware list",
  );
  assertEqual(
    simulation.tradeManager.getPossibleTradeRoutes().length,
    0,
    "overview should tolerate an empty route list",
  );

  simulation.tradeManager.destroy();
});

test("findRoundTradeTrip excludes a counter station whose score exactly ties home's (strict > eligibility)", () => {
  // Pin `if (score > homeScore)` in findEligibleCounterStations (strict, not >=).
  // A `> → >=` mutation would make a counter station with fill EXACTLY equal to
  // home's qualify as a sell destination, so a trip with no fill gradient (no
  // progress) gets flown. Here the sole consumer ties home's fill exactly, so
  // strict `>` leaves the eligible set empty → findRoundTradeTrip returns null;
  // `>=` would admit the tie and return a 1-leg trip. Null-vs-trip is the
  // observable, and it doesn't depend on the random tie-break.
  const stationsById = new Map<string, Station>();
  const shipsById = new Map<string, Ship>();
  const manager = new TradeManager({
    stationManager: { getStation: (id) => stationsById.get(id) },
    shipManager: { getShip: (id) => shipsById.get(id) },
  });

  // Home produces ice with surplus; counter consumes ice with room. Both ice
  // slots sit at identical current/max (fill 0.6) so home's sell score and the
  // counter's buy score are exactly equal. seedhaul (capacity 4000) carries ice;
  // the 4000-unit leg clears the 0.5 minimum-fill threshold with margin, so a
  // `>=` mutant genuinely returns a trip rather than failing the fill gate.
  const home = makeStationWithProduces(["ice"], {
    inventory: [createInventorySlot(ice, 6000, 10000)],
    placement: { id: "TIE-HOME" },
  });
  const counter = makeStationWithProduces([], {
    inventory: [createInventorySlot(ice, 6000, 10000)],
    placement: { id: "TIE-COUNTER" },
  });
  stationsById.set("TIE-HOME", home);
  stationsById.set("TIE-COUNTER", counter);

  const orbitingShip: Ship = {
    id: "TIE-SHIP",
    shipTypeId: "seedhaul",
    shipName: "Tiebreaker",
    station: home,
  };
  shipsById.set("TIE-SHIP", orbitingShip);
  const tradeShip = manager.registerShip(orbitingShip, home);

  manager.rebuildWareStationIndex([home, counter]);

  // Confirm the scores actually tie — guards against fixture drift silently
  // turning this into a strict-inequality case that would pass vacuously.
  const homeSlot = getInventorySlot(home, "ice")!;
  const counterSlot = getInventorySlot(counter, "ice")!;
  assertEqual(
    effectiveFillPercent(homeSlot),
    effectiveFillPercent(counterSlot),
    "home and counter ice fills tie exactly",
  );

  const trip = findRoundTradeTrip(tradeShip, manager);
  assertEqual(trip, null, "no trip when the only counter station ties home's score");

  manager.destroy();
});
