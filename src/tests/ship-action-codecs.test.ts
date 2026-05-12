import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { shipFlyActionToSnapshot, shipFlyActionFromSnapshot } from "../sim-ship-action-fly.ts";
import { shipWaitActionToSnapshot, shipWaitActionFromSnapshot } from "../sim-ship-action-wait.ts";
import { shipCargoWithdrawalActionToSnapshot, shipCargoWithdrawalActionFromSnapshot } from "../sim-ship-action-cargo-withdrawal.ts";
import { shipCargoDepositActionToSnapshot, shipCargoDepositActionFromSnapshot } from "../sim-ship-action-cargo-deposit.ts";
import { shipDecommissionActionToSnapshot, shipDecommissionActionFromSnapshot } from "../sim-ship-action-decommission.ts";
import { createOrbitEndpoint, createSurfaceEndpoint } from "../sim-travel.ts";
import { createStation, type Station } from "../sim-station.ts";
import { hubNation, bioNation } from "../../data/nations.ts";

// Pins encode/decode round-trips for all 5 ship action codecs. Silent codec
// drift turns saved trade queues into wrong-direction flights or
// wait-stalled queues after load.

function buildStation(id: string): Station {
  return createStation({
    id, name: id, x: 0, y: 0, nation: hubNation, stationTypeId: "habitat", size: "M",
  }, 0);
}

function withStations(stations: Station[]): Map<string, Station> {
  const map = new Map<string, Station>();
  for (const station of stations) map.set(station.id, station);
  return map;
}

test("fly action: roundtrip preserves origin endpoint (stationId + surfaceOrOrbit)", () => {
  const origin = buildStation("ORIGIN");
  const destination = buildStation("DEST");
  const action = {
    type: "fly" as const,
    origin: createSurfaceEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "trade leg",
  };
  const snapshot = shipFlyActionToSnapshot(action);
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  // Pin both the stationId and the surfaceOrOrbit fields. Mutating
  // `{ ...action.origin }` to drop a field would lose the surfaceOrOrbit.
  assertEqual(restored.origin.stationId, "ORIGIN", "origin.stationId preserved");
  assertEqual(restored.origin.surfaceOrOrbit, "surface", "origin.surfaceOrOrbit preserved");
  assertEqual(restored.originStation, origin, "originStation reference resolved");
});

test("fly action: roundtrip preserves destination endpoint (stationId + surfaceOrOrbit)", () => {
  const origin = buildStation("ORIGIN");
  const destination = buildStation("DEST");
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createSurfaceEndpoint(destination),
    destinationStation: destination,
    travelMode: "local" as const,
    deploying: true,
    label: "deploy",
  };
  const snapshot = shipFlyActionToSnapshot(action);
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  assertEqual(restored.destination.stationId, "DEST", "destination.stationId preserved");
  assertEqual(restored.destination.surfaceOrOrbit, "surface", "destination.surfaceOrOrbit preserved");
  assertEqual(restored.destinationStation, destination, "destinationStation reference resolved");
  // Pin travelMode propagation. Mutating to "interStation" would change duration math.
  assertEqual(restored.travelMode, "local", "travelMode preserved");
  // Pin the deploying flag through the codec — sim-trade-log gates "deployed
  // initial trader" log entries on `current.deploying === true`. Mutating
  // `deploying: action.deploying` to a constant would break that signal.
  assertEqual(restored.deploying, true, "deploying flag preserved");
});

test("fly action: roundtrip preserves the route reference for trade legs", () => {
  // Trade flights set the `route` so the post-load HUD shows "Route: X to Y".
  // Ferries / deploy legs leave it undefined; pin both shapes.
  const origin = buildStation("HUB-A");
  const destination = buildStation("HUB-B");
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Trade leg",
    route: { fromStation: origin, toStation: destination },
  };
  const snapshot = shipFlyActionToSnapshot(action);
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  // Pin route resolution. Mutating tradeRouteFromSnapshot to return undefined
  // would erase route info post-load, leaving the HUD with a generic label.
  assertTrue(restored.route !== undefined, "route restored");
  assertEqual(restored.route!.fromStation.id, "HUB-A", "route.fromStation resolved");
  assertEqual(restored.route!.toStation.id, "HUB-B", "route.toStation resolved");
});

test("fly action: route is undefined on snapshot for non-trade legs", () => {
  const origin = buildStation("ORIGIN");
  const destination = buildStation("DEST");
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Ferry",
  };
  const snapshot = shipFlyActionToSnapshot(action);
  // Pin the conditional route encoding — `action.route ? {...} : undefined`.
  assertEqual(snapshot.route, undefined, "no route on snapshot when action has no route");
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  assertEqual(restored.route, undefined, "no route on restored when snapshot has none");
});

test("fly action: missing origin station resolves to wait placeholder fallback (label preserved)", () => {
  const origin = buildStation("MISSING-ORIGIN");
  const destination = buildStation("DEST");
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Ferry to The Long Drift",
  };
  const snapshot = shipFlyActionToSnapshot(action);
  // Pass a station map that omits the origin.
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([destination]));
  // Pin the missing-origin fallback. Mutating the guard to drop the origin
  // check would crash (destinationStation = undefined) instead of falling back.
  assertTrue(restored.type === "wait", "fallback to wait when origin missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Ferry to The Long Drift", "label preserved on fallback");
  assertEqual(restored.duration, 0, "duration is 0 on fallback");
});

test("fly action: missing destination station resolves to wait placeholder fallback (label preserved)", () => {
  const origin = buildStation("ORIGIN");
  const destination = buildStation("MISSING-DEST");
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Trade leg",
  };
  const snapshot = shipFlyActionToSnapshot(action);
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([origin]));
  // Pin the missing-destination side of the fallback — both branches must
  // route to the same wait placeholder.
  assertTrue(restored.type === "wait", "fallback to wait when destination missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Trade leg", "label preserved on fallback");
});

test("fly action: route falls back to undefined when one of the route stations is missing", () => {
  // Both origin/destination present, but route.toStation is missing. Per
  // tradeRouteFromSnapshot, route degrades to undefined while the rest of the
  // fly action survives.
  const origin = buildStation("HUB-A");
  const destination = buildStation("HUB-B");
  const ghostStation = buildStation("HUB-GHOST");
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Trade leg",
    route: { fromStation: origin, toStation: ghostStation },
  };
  const snapshot = shipFlyActionToSnapshot(action);
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([origin, destination]));
  assertTrue(restored.type === "fly", "fly survives even with broken route");
  if (restored.type !== "fly") return;
  assertEqual(restored.route, undefined, "route degrades to undefined when a route station is missing");
});

test("wait action: roundtrip preserves duration and label", () => {
  const action = { type: "wait" as const, duration: 12.5, label: "stagger" };
  const snapshot = shipWaitActionToSnapshot(action);
  const restored = shipWaitActionFromSnapshot(snapshot);
  assertTrue(restored.type === "wait", "type preserved");
  if (restored.type !== "wait") return;
  assertEqual(restored.duration, 12.5, "duration preserved");
  assertEqual(restored.label, "stagger", "label preserved");
});

test("cargo-withdrawal action: roundtrip preserves stationId, wareId, amount", () => {
  const station = buildStation("BIO-F");
  const action = { type: "cargo-withdrawal" as const, station, wareId: "food" as const, amount: 250 };
  const snapshot = shipCargoWithdrawalActionToSnapshot(action);
  // Pin the snapshot shape — stationId, not station.
  assertEqual(snapshot.stationId, "BIO-F", "snapshot carries stationId, not the live ref");
  const restored = shipCargoWithdrawalActionFromSnapshot(snapshot, withStations([station]));
  assertTrue(restored.type === "cargo-withdrawal", "type preserved");
  if (restored.type !== "cargo-withdrawal") return;
  assertEqual(restored.station, station, "station reference resolved");
  assertEqual(restored.wareId, "food", "wareId preserved");
  assertEqual(restored.amount, 250, "amount preserved");
});

test("cargo-withdrawal action: missing station resolves to wait placeholder with 'Load' label", () => {
  const station = buildStation("BIO-F");
  const action = { type: "cargo-withdrawal" as const, station, wareId: "food" as const, amount: 250 };
  const snapshot = shipCargoWithdrawalActionToSnapshot(action);
  const restored = shipCargoWithdrawalActionFromSnapshot(snapshot, withStations([]));
  // Pin the fixed "Load" label. cargo-withdrawal has no label field on the
  // action, so the fallback uses a fixed string.
  assertTrue(restored.type === "wait", "fallback to wait when station missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Load", "fallback label is 'Load'");
  assertEqual(restored.duration, 0, "duration 0 on fallback");
});

test("cargo-deposit action: roundtrip preserves stationId, wareId, amount", () => {
  const station = buildStation("HUB-T");
  const action = { type: "cargo-deposit" as const, station, wareId: "tech" as const, amount: 75 };
  const snapshot = shipCargoDepositActionToSnapshot(action);
  assertEqual(snapshot.stationId, "HUB-T", "snapshot carries stationId");
  const restored = shipCargoDepositActionFromSnapshot(snapshot, withStations([station]));
  assertTrue(restored.type === "cargo-deposit", "type preserved");
  if (restored.type !== "cargo-deposit") return;
  assertEqual(restored.station, station, "station resolved");
  assertEqual(restored.wareId, "tech", "wareId preserved");
  assertEqual(restored.amount, 75, "amount preserved");
});

test("cargo-deposit action: missing station resolves to wait placeholder with 'Deliver' label", () => {
  const station = buildStation("HUB-T");
  const action = { type: "cargo-deposit" as const, station, wareId: "tech" as const, amount: 75 };
  const snapshot = shipCargoDepositActionToSnapshot(action);
  const restored = shipCargoDepositActionFromSnapshot(snapshot, withStations([]));
  // Pin the fixed "Deliver" label — distinct from "Load" for withdrawal,
  // matching the user-visible direction the original action would have shown.
  assertTrue(restored.type === "wait", "fallback to wait when station missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Deliver", "fallback label is 'Deliver'");
});

test("decommission action: roundtrip preserves stationId and label", () => {
  const station = buildStation("WAY-001");
  const action = { type: "decommission" as const, station, label: "Decommission at The Long Drift" };
  const snapshot = shipDecommissionActionToSnapshot(action);
  assertEqual(snapshot.stationId, "WAY-001", "snapshot carries stationId");
  assertEqual(snapshot.label, "Decommission at The Long Drift", "snapshot carries label");
  const restored = shipDecommissionActionFromSnapshot(snapshot, withStations([station]));
  assertTrue(restored.type === "decommission", "type preserved");
  if (restored.type !== "decommission") return;
  assertEqual(restored.station, station, "station resolved");
  assertEqual(restored.label, "Decommission at The Long Drift", "label preserved");
});

test("decommission action: missing station resolves to wait placeholder (label preserved)", () => {
  const station = buildStation("WAY-001");
  const action = { type: "decommission" as const, station, label: "Decommission at The Long Drift" };
  const snapshot = shipDecommissionActionToSnapshot(action);
  const restored = shipDecommissionActionFromSnapshot(snapshot, withStations([]));
  // Pin the label-preserving fallback. Decommission DOES have a label field
  // on the action (unlike cargo-*), so the fallback should carry it through.
  assertTrue(restored.type === "wait", "fallback to wait when station missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Decommission at The Long Drift", "label preserved on fallback");
});

test("fly action: stations Map lookup uses stationId — not action.originStation reference", () => {
  // Pin that decoder reads `stations.get(snapshot.origin.stationId)` and not
  // a leftover live ref. Different station instances with the same id should
  // resolve to whichever one is in the stations Map.
  const originalStation = buildStation("BIO-F");
  const replacementStation = createStation({
    id: "BIO-F", name: "BIO-F", x: 99, y: 99, nation: bioNation, stationTypeId: "farm", size: "L",
  }, 0);
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(originalStation),
    originStation: originalStation,
    destination: createOrbitEndpoint(originalStation),
    destinationStation: originalStation,
    travelMode: "local" as const,
    label: "deploy",
  };
  const snapshot = shipFlyActionToSnapshot(action);
  // Decode against a map containing only the replacement (different size, position).
  const restored = shipFlyActionFromSnapshot(snapshot, withStations([replacementStation]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  assertEqual(restored.originStation, replacementStation, "decoder resolves to the post-load station instance");
  assertEqual(restored.originStation.size, "L", "post-load station is a fresh instance, not the original");
});
