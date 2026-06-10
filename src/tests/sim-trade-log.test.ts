// Unit coverage for the HUD-facing trade-ship display helpers in sim-trade-log.ts.
//
// Two kinds of logic are pinned here: the three selection / idle / deploy
// predicates the ship visual bundle gates on, and the BRANCH SELECTION inside
// the status-label / action-note / description / log formatters — which shape a
// given ship state yields. Assertions target the meaningful distinction (which
// branch fired, the key value it surfaces: a ware name, a station code, the
// idle status row, the action-plan marker) and deliberately avoid pinning
// the literal label/prose copy, which is free to change.
//
// The ship-resolving formatters (getTradeShipDescription / getTradeLog) need a
// TradeManager that resolves the orbiting ship + home station. Following the
// trade-route-stats-observer pattern, the local fixtures below build the
// station/ship maps and a dedicated manager rather than withMockManager (which
// resolves stations only, not ships).

import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  isTradeShipSelectable,
  isTradeShipIdle,
  isTradeShipDeploying,
  getTradeShipStatusLabel,
  formatActiveActionNote,
  getTradeShipDescription,
  getTradeLog,
} from "../sim-trade-log.ts";
import { createStation } from "../sim-station.ts";
import { TradeManager } from "../sim-trade-manager.ts";
import type { ShipAction, TravelMode } from "../sim-travel-types.ts";
import type { TradeShip } from "../sim-trade-types.ts";
import type { Station } from "../sim-station-types.ts";
import type { Ship } from "../sim-ships.ts";
import type { ShipTypeId } from "../../data/ship-types.ts";
import type { WareId } from "../../data/ware-types.ts";
import { makeEmptyTradeShip } from "./trade-test-fixtures.ts";
import { makeStation, makePlacedStation } from "./factories.ts";

/** Default endpoint station for fly actions whose endpoints don't matter to the test. */
const anyStation = makeStation({ placement: { id: "HUB-ANY", name: "Anyport" } });

/** A fly action with the full ShipAction shape; tests vary travelMode / deploying
 *  / isTradeFlight / the endpoint stations and let the rest default. */
function flyAction(
  parts: {
    travelMode?: TravelMode;
    deploying?: boolean;
    isTradeFlight?: boolean;
    originStation?: Station;
    destinationStation?: Station;
    label?: string;
  } = {},
): Extract<ShipAction, { type: "fly" }> {
  const origin = parts.originStation ?? anyStation;
  const destination = parts.destinationStation ?? anyStation;
  return {
    type: "fly",
    origin: { stationId: origin.id, surfaceOrOrbit: "orbit" },
    originStation: origin,
    destination: { stationId: destination.id, surfaceOrOrbit: "orbit" },
    destinationStation: destination,
    travelMode: parts.travelMode ?? "interStation",
    deploying: parts.deploying,
    label: parts.label ?? "In transit",
    isTradeFlight: parts.isTradeFlight,
  };
}

/** Trade ship in a given action-queue state; cargo / idle fields stay at their empty defaults. */
function tradeShipWithQueue(actionQueue: ShipAction[]): TradeShip {
  const ship = makeEmptyTradeShip();
  ship.actionQueue = actionQueue;
  return ship;
}

/** A trade manager that resolves the given stations and the one orbiting ship. */
function managerResolving(stations: Station[], orbitingShip: Ship): TradeManager {
  const stationsById = new Map(stations.map((station): [string, Station] => [station.id, station]));
  const shipsById = new Map<string, Ship>([[orbitingShip.id, orbitingShip]]);
  return new TradeManager({
    stationManager: { getStation: (id: string) => stationsById.get(id) },
    shipManager: { getShip: (id: string) => shipsById.get(id) },
  });
}

/** Orbiting ship homed at `home`; the trader template gives a non-zero cargo capacity. */
function orbitingShipAt(home: Station, shipTypeId: ShipTypeId = "trader"): Ship {
  return { id: `${home.id}-SHIP`, shipTypeId, shipName: "Test Trader", station: home };
}

// --- Predicates: selection / idle / deploy gating ---

test("isTradeShipIdle reflects an empty action queue", () => {
  assertEqual(isTradeShipIdle(tradeShipWithQueue([])), true, "empty queue is idle");
  assertEqual(isTradeShipIdle(tradeShipWithQueue([flyAction()])), false, "a queued action is not idle");
});

test("isTradeShipSelectable: idle or on an inter-station flight, not otherwise", () => {
  assertEqual(isTradeShipSelectable(tradeShipWithQueue([])), true, "idle ship is selectable");
  assertEqual(
    isTradeShipSelectable(tradeShipWithQueue([flyAction({ travelMode: "interStation" })])),
    true,
    "inter-station flight is selectable",
  );
  assertEqual(
    isTradeShipSelectable(tradeShipWithQueue([flyAction({ travelMode: "local" })])),
    false,
    "a local (deploy) maneuver is not selectable",
  );
  assertEqual(
    isTradeShipSelectable(tradeShipWithQueue([{ type: "wait", durationSeconds: 5, label: "Holding" }])),
    false,
    "a ship mid-transfer / waiting is not selectable",
  );
});

test("isTradeShipDeploying: a deploying fly at the head or behind the lead wait placeholder", () => {
  assertEqual(isTradeShipDeploying(tradeShipWithQueue([])), false, "idle ship is not deploying");
  assertEqual(
    isTradeShipDeploying(tradeShipWithQueue([flyAction({ travelMode: "local", deploying: true })])),
    true,
    "a deploying fly action is deploying",
  );
  assertEqual(
    isTradeShipDeploying(
      tradeShipWithQueue([
        { type: "wait", durationSeconds: 0, label: "—" },
        flyAction({ travelMode: "local", deploying: true }),
      ]),
    ),
    true,
    "the enrollment queue still reads as deploying while the stagger timer is pending",
  );
  assertEqual(
    isTradeShipDeploying(tradeShipWithQueue([flyAction({ travelMode: "local", deploying: false })])),
    false,
    "a non-deploying fly action is not deploying",
  );
  assertEqual(
    isTradeShipDeploying(tradeShipWithQueue([{ type: "wait", durationSeconds: 5, label: "Holding" }])),
    false,
    "a lone wait with nothing behind it is not deploying",
  );
  assertEqual(
    isTradeShipDeploying(
      tradeShipWithQueue([
        { type: "wait", durationSeconds: 5, label: "Holding" },
        { type: "cargo-withdrawal", station: anyStation, wareId: "water", amount: 100 },
      ]),
    ),
    false,
    "a mid-trade dock wait followed by a transfer is not deploying",
  );
});

// --- Status band selection (idle / deploying / flying / trading) ---

test("getTradeShipStatusLabel maps each ship state to its own distinct band", () => {
  const idle = tradeShipWithQueue([]);
  const deploying = tradeShipWithQueue([flyAction({ travelMode: "local", deploying: true })]);
  const flying = tradeShipWithQueue([flyAction({ travelMode: "interStation" })]);
  const trading = tradeShipWithQueue([{ type: "wait", durationSeconds: 5, label: "Holding" }]);

  const labels = [idle, deploying, flying, trading].map(getTradeShipStatusLabel);
  assertEqual(new Set(labels).size, 4, "the four ship states produce four distinct status bands");
  // Checked by band-distinctness + state-determinism only; the label copy stays free to
  // change. A mutation that permutes the four labels keeps them distinct, so it survives
  // here by design — don't pin the literal wording to kill it.

  // State, not identity, determines the band.
  assertEqual(
    getTradeShipStatusLabel(tradeShipWithQueue([flyAction({ travelMode: "interStation" })])),
    getTradeShipStatusLabel(flying),
    "two ships in the same state share a band",
  );
});

// --- Active-action note: which note shape each queued-action head yields ---

test("formatActiveActionNote: a trade flight shows a route between both stations", () => {
  const origin = makeStation({ placement: { id: "HUB-A", name: "Alpha" } });
  const destination = makeStation({ placement: { id: "HUB-B", name: "Beta" } });

  const routeNote = formatActiveActionNote(
    flyAction({ isTradeFlight: true, originStation: origin, destinationStation: destination }),
  );
  assertTrue(routeNote.includes("Alpha"), "route note names the origin station");
  assertTrue(routeNote.includes("Beta"), "route note names the destination station");
  // Pin the route direction. Swapping origin and destination would still name both,
  // so check the origin reads before the destination.
  assertTrue(routeNote.indexOf("Alpha") < routeNote.indexOf("Beta"), "the route reads origin before destination");

  const statusNote = formatActiveActionNote(
    flyAction({
      isTradeFlight: false,
      originStation: origin,
      destinationStation: destination,
      label: "Repositioning",
    }),
  );
  assertTrue(statusNote.includes("Repositioning"), "a non-trade flight falls back to its status label");
  assertTrue(routeNote !== statusNote, "the trade-flight flag selects a different note shape");
});

test("formatActiveActionNote: wait and decommission pass their action label through", () => {
  const waitNote = formatActiveActionNote({ type: "wait", durationSeconds: 5, label: "Awaiting clearance" });
  assertTrue(waitNote.includes("Awaiting clearance"), "wait note shows its label");

  const decommissionNote = formatActiveActionNote({
    type: "decommission",
    station: anyStation,
    label: "Standing down",
  });
  assertTrue(decommissionNote.includes("Standing down"), "decommission note shows its label");
});

test("formatActiveActionNote: cargo transfer names the station it is transferring at", () => {
  const dock = makeStation({ placement: { id: "HUB-DOCK", name: "Transferport" } });
  const withdrawalNote = formatActiveActionNote({
    type: "cargo-withdrawal",
    station: dock,
    wareId: "water",
    amount: 100,
  });
  const depositNote = formatActiveActionNote({
    type: "cargo-deposit",
    station: dock,
    wareId: "water",
    amount: 100,
  });

  assertTrue(withdrawalNote.includes("Transferport"), "withdrawal note names the transfer station");
  assertTrue(depositNote.includes("Transferport"), "deposit note names the transfer station");
});

// --- getTradeShipDescription: idle / deploying / active + cargo rendering ---

test("getTradeShipDescription: idle ship with no idle stamp shows an empty hold with no status row", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Homeport" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  ship.idleSinceTradeTimeSeconds = 0; // unstamped — the ship has never gone idle

  const html = getTradeShipDescription(ship, manager, 500);

  assertTrue(html.includes("No Cargo"), "idle hold renders the empty cargo bar");
  assertTrue(!html.includes("cargo-note"), "unstamped idle ship shows no status note row");
});

test("getTradeShipDescription: idle ship with an idle stamp adds an idle-duration status row", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Homeport" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  ship.idleSinceTradeTimeSeconds = 100;

  const stamped = getTradeShipDescription(ship, manager, 400); // idle for 300s
  const unstamped = getTradeShipDescription({ ...ship, idleSinceTradeTimeSeconds: 0 }, manager, 400);

  assertTrue(stamped.includes("No Cargo"), "still an empty hold");
  assertTrue(stamped.includes("cargo-note"), "a status note row appears once an idle stamp exists");
  assertTrue(stamped.length > unstamped.length, "stamped description is a superset of the bare idle bar");
  // Only the presence of the status row is pinned. The "Idle Ns" elapsed value
  // is presentation, so a mutation to idleElapsedSeconds' arithmetic survives here by design.
});

test("getTradeShipDescription: deploying ship names its home destination", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Bloomreach" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  ship.actionQueue = [
    flyAction({ travelMode: "local", deploying: true, originStation: home, destinationStation: home }),
  ];

  const html = getTradeShipDescription(ship, manager, 0);

  assertTrue(html.includes("No Cargo"), "deploying ship has an empty hold");
  assertTrue(html.includes("cargo-note"), "deploying ship shows a status note row");
  assertTrue(html.includes("Bloomreach"), "the status row names the home station it is deploying to");
});

test("getTradeShipDescription: deploying ship with an unresolvable home still renders", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Bloomreach" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = "GONE"; // not registered — emigration ferry after home demolition
  ship.orbitingShipId = orbiting.id;
  ship.actionQueue = [flyAction({ travelMode: "local", deploying: true })];

  const html = getTradeShipDescription(ship, manager, 0);

  assertTrue(html.includes("No Cargo"), "still renders the empty hold without a home");
  assertTrue(html.includes("cargo-note"), "still shows a status note row");
  assertTrue(!html.includes("Bloomreach"), "no home station name when home is gone");
});

test("getTradeShipDescription: active ship with an empty hold shows the No-Cargo bar", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Homeport" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  ship.actionQueue = [{ type: "wait", durationSeconds: 5, label: "Holding" }];

  const html = getTradeShipDescription(ship, manager, 0);
  assertTrue(html.includes("No Cargo"), "empty active hold still shows the No-Cargo bar");
});

test("getTradeShipDescription: active ship renders a cargo bar per ware in the hold", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Homeport" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const single = makeEmptyTradeShip();
  single.homeStationId = home.id;
  single.orbitingShipId = orbiting.id;
  single.actionQueue = [{ type: "wait", durationSeconds: 5, label: "Holding" }];
  single.cargoAmountByWareId = new Map<WareId, number>([["water", 1000]]);

  const oneBar = getTradeShipDescription(single, manager, 0);
  assertTrue(oneBar.includes("Water"), "the loaded ware is named");
  assertTrue(!oneBar.includes("No Cargo"), "a loaded hold does not show the empty bar");

  const twoWares = {
    ...single,
    cargoAmountByWareId: new Map<WareId, number>([
      ["water", 1000],
      ["metal", 500],
    ]),
  };
  const twoBars = getTradeShipDescription(twoWares, manager, 0);
  assertTrue(twoBars.includes("Water") && twoBars.includes("Metal"), "one bar per ware — both wares named");
});

// --- getTradeLog: deploying / active / idle / missing-home branch selection ---
//
// The cargoCapacity === 0 guard isn't covered: no ship type in data/ships.ts has
// a zero capacity, so the branch can't fire through getShipTypeTemplate.

test("getTradeLog: deploying ship shows a not-yet-trading notice, not a trade plan", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Homeport" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  ship.actionQueue = [flyAction({ travelMode: "local", deploying: true })];

  const log = getTradeLog(ship, manager, 0);
  assertTrue(log.includes("is-blocked"), "deploying log is a blocked-state notice");
  assertTrue(!log.includes("▸"), "deploying log does not render the action plan");
});

test("getTradeLog: active ship shows the trade summary and an action plan with a current-step marker", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Homeport" } });
  const target = makeStation({ placement: { id: "HUB-DEST", name: "Faraway" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home, target], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  ship.targetStationId = target.id;
  ship.tradeDirection = "sell";
  ship.cargoAmountByWareId = new Map<WareId, number>([["water", 1000]]);
  ship.actionQueue = [
    { type: "cargo-deposit", station: target, wareId: "water", amount: 1000 },
    { type: "wait", durationSeconds: 5, label: "Repositioning" },
  ];

  const log = getTradeLog(ship, manager, 0);
  assertTrue(log.includes("▸"), "the head of the action queue is marked as the current step");
  assertTrue(log.includes("Water"), "the trade summary names the primary ware being moved");
  // Pin the head step's current-step styling. Flipping the `i === 0` class test would
  // move is-current off the ▸ head onto a trailing step.
  assertTrue(
    log.includes('is-current">▸'),
    "the current-step style and the ▸ marker land on the same head step",
  );
  // Pin per-step rendering. Reading actionQueue[0] for every row would repeat the head's
  // line and drop this trailing step's own label.
  assertTrue(log.includes("Repositioning"), "each queued step renders its own action line");
  assertTrue(log.includes("is-blocked"), "a trailing queued step is styled as pending");
});

test("getTradeLog: the active trade summary maps the source station to From and the destination to To", () => {
  // A farm sells its food to a habitat that consumes it; both stations carry a food slot,
  // so both the From and To summary rows render. Swapping source/destination in
  // formatActiveTradeSummary would still name both stations — the read order is the tell.
  const home = createStation(makePlacedStation({ id: "HUB-HOME", name: "Homeport", stationTypeId: "farm" }));
  const target = createStation(makePlacedStation({ id: "HUB-DEST", name: "Faraway", stationTypeId: "habitat" }));
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home, target], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  ship.targetStationId = target.id;
  ship.cargoAmountByWareId = new Map<WareId, number>([["food", 1000]]);
  ship.actionQueue = [{ type: "cargo-deposit", station: target, wareId: "food", amount: 1000 }];

  // Sell: home is the source (From), target the destination (To).
  ship.tradeDirection = "sell";
  const sellLog = getTradeLog(ship, manager, 0);
  assertTrue(
    sellLog.includes("Homeport") && sellLog.includes("Faraway"),
    "the summary names both the source and destination stations",
  );
  assertTrue(
    sellLog.indexOf("Homeport") < sellLog.indexOf("Faraway"),
    "a sell summary reads the source (home) before the destination (target)",
  );

  // Buy: the mapping flips — target is the source (From), home the destination (To).
  ship.tradeDirection = "buy";
  const buyLog = getTradeLog(ship, manager, 0);
  assertTrue(
    buyLog.indexOf("Faraway") < buyLog.indexOf("Homeport"),
    "a buy summary reads the source (target) before the destination (home)",
  );
});

test("getTradeLog: idle ship explains tradeability per home ware across several entries", () => {
  const home = createStation(makePlacedStation({ id: "HUB-HOME", name: "Homeport", stationTypeId: "farm" }));
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = home.id;
  ship.orbitingShipId = orbiting.id;
  // idle: empty action queue (makeEmptyTradeShip default)

  const log = getTradeLog(ship, manager, 0);
  const groupCount = log.split("log-group").length - 1;
  assertTrue(groupCount >= 2, "idle log renders a group per home inventory ware (several entries)");
  assertTrue(!log.includes("▸"), "idle log has no action-plan current-step marker");
});

test("getTradeLog: idle ship with an unresolvable home shows a blocked notice", () => {
  const home = makeStation({ placement: { id: "HUB-HOME", name: "Homeport" } });
  const orbiting = orbitingShipAt(home);
  const manager = managerResolving([home], orbiting);
  const ship = makeEmptyTradeShip();
  ship.homeStationId = "GONE";
  ship.orbitingShipId = orbiting.id;

  const log = getTradeLog(ship, manager, 0);
  assertTrue(log.includes("is-blocked"), "missing home yields a blocked notice");
  assertTrue(!log.includes("▸"), "no action plan rendered");
});
