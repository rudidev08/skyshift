import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { shipFlyActionToSnapshot, shipFlyActionFromSnapshot } from "../sim-ship-action-fly.ts";
import { shipWaitActionToSnapshot, shipWaitActionFromSnapshot } from "../sim-ship-action-wait.ts";
import {
  shipCargoWithdrawalActionToSnapshot,
  shipCargoWithdrawalActionFromSnapshot,
} from "../sim-ship-action-cargo-withdrawal.ts";
import {
  shipCargoDepositActionToSnapshot,
  shipCargoDepositActionFromSnapshot,
} from "../sim-ship-action-cargo-deposit.ts";
import {
  shipDecommissionActionToSnapshot,
  shipDecommissionActionFromSnapshot,
} from "../sim-ship-action-decommission.ts";
import { createOrbitEndpoint, createSurfaceEndpoint } from "../sim-travel.ts";
import { formatActiveActionNote } from "../sim-trade-log.ts";
import { createStation, type Station } from "../sim-station.ts";
import { hubNation, bioNation } from "../../data/nations.ts";

// Pins encode/decode round-trips for all 5 ship action codecs. Silent codec
// drift turns saved trade queues into wrong-direction flights or
// wait-stalled queues after load.

function createCodecTestStation(stationId: string): Station {
  return createStation(
    {
      id: stationId,
      name: stationId,
      x: 0,
      y: 0,
      nation: hubNation,
      stationTypeId: "habitat",
      size: "M",
    },
    0,
  );
}

function stationsById(stations: Station[]): Map<string, Station> {
  const map = new Map<string, Station>();
  for (const station of stations) map.set(station.id, station);
  return map;
}

test("fly action: roundtrip preserves origin endpoint (stationId + surfaceOrOrbit)", () => {
  const origin = createCodecTestStation("ORIGIN");
  const destination = createCodecTestStation("DESTINATION");
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
  const restored = shipFlyActionFromSnapshot(snapshot, stationsById([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  // Pin both the stationId and the surfaceOrOrbit fields. Mutating
  // `{ ...action.origin }` to drop a field would lose the surfaceOrOrbit.
  assertEqual(restored.origin.stationId, "ORIGIN", "origin.stationId preserved");
  assertEqual(restored.origin.surfaceOrOrbit, "surface", "origin.surfaceOrOrbit preserved");
  assertEqual(restored.originStation, origin, "originStation reference resolved");
});

test("fly action: roundtrip preserves destination endpoint (stationId + surfaceOrOrbit)", () => {
  const origin = createCodecTestStation("ORIGIN");
  const destination = createCodecTestStation("DESTINATION");
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
  const restored = shipFlyActionFromSnapshot(snapshot, stationsById([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  assertEqual(restored.destination.stationId, "DESTINATION", "destination.stationId preserved");
  assertEqual(restored.destination.surfaceOrOrbit, "surface", "destination.surfaceOrOrbit preserved");
  assertEqual(restored.destinationStation, destination, "destinationStation reference resolved");
  // Pin travelMode propagation. Mutating to "interStation" would change duration math.
  assertEqual(restored.travelMode, "local", "travelMode preserved");
  // Pin the deploying flag through the codec — sim-trade-log's
  // `isTradeShipDeploying` reads it to switch the HUD to the "Deploying" status
  // and the "Deploying — not yet trading" banner. Mutating `deploying:
  // action.deploying` to a constant would mislabel post-load ships.
  assertEqual(restored.deploying, true, "deploying flag preserved");
});

test("fly action: roundtrip preserves the isTradeFlight discriminator for trade legs", () => {
  // A player trade flight sets isTradeFlight so the post-load HUD shows
  // "Route: X to Y" (derived from origin/destination station). Ferries / deploy
  // legs leave it unset; pin both shapes.
  const origin = createCodecTestStation("HUB-A");
  const destination = createCodecTestStation("HUB-B");
  const action = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Trade leg",
    isTradeFlight: true,
  };
  const snapshot = shipFlyActionToSnapshot(action);
  assertEqual(snapshot.isTradeFlight, true, "isTradeFlight carried onto snapshot");
  const restored = shipFlyActionFromSnapshot(snapshot, stationsById([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  // Pin the discriminator round-trip. Mutating the codec to drop it would
  // erase the trade-flight signal post-load, leaving the HUD a generic label.
  assertEqual(restored.isTradeFlight, true, "isTradeFlight restored");
});

test("fly action: isTradeFlight is unset on snapshot for non-trade legs", () => {
  const origin = createCodecTestStation("ORIGIN");
  const destination = createCodecTestStation("DESTINATION");
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
  assertEqual(snapshot.isTradeFlight, undefined, "no isTradeFlight on snapshot when action has none");
  const restored = shipFlyActionFromSnapshot(snapshot, stationsById([origin, destination]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  assertEqual(restored.isTradeFlight, undefined, "no isTradeFlight on restored when snapshot has none");
});

test("fly action note: trade flight renders the Route card, ferry renders the Status card", () => {
  // Guards the isTradeFlight discriminator that picks the cargo-note variant:
  // a trade flight (isTradeFlight set) gets the Route cargo-note derived from
  // origin/destination station; a ferry (no isTradeFlight) falls back to the
  // Status label carrying the action label.
  const origin = createCodecTestStation("HUB-A");
  const destination = createCodecTestStation("HUB-B");
  const tradeFly = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Fly: HUB-A to HUB-B",
    isTradeFlight: true,
  };
  const tradeNote = formatActiveActionNote(tradeFly);
  assertTrue(tradeNote.includes(">Route<"), "trade flight picks the Route cargo-note");
  assertTrue(tradeNote.includes("HUB-A") && tradeNote.includes("HUB-B"), "Route note names both stations");
  assertTrue(!tradeNote.includes(">Status<"), "trade flight is not a Status note");

  const ferryFly = {
    type: "fly" as const,
    origin: createOrbitEndpoint(origin),
    originStation: origin,
    destination: createOrbitEndpoint(destination),
    destinationStation: destination,
    travelMode: "interStation" as const,
    label: "Ferry to The Long Drift",
  };
  const ferryNote = formatActiveActionNote(ferryFly);
  assertTrue(ferryNote.includes(">Status<"), "ferry flight picks the Status cargo-note");
  assertTrue(ferryNote.includes("Ferry to The Long Drift"), "Status note carries the action label");
  assertTrue(!ferryNote.includes(">Route<"), "ferry flight is not a Route note");
});

test("fly action: missing origin station resolves to wait placeholder fallback (label preserved)", () => {
  const origin = createCodecTestStation("MISSING-ORIGIN");
  const destination = createCodecTestStation("DESTINATION");
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
  const restored = shipFlyActionFromSnapshot(snapshot, stationsById([destination]));
  // Pin the missing-origin fallback. Mutating the guard to drop the origin
  // check would crash (destinationStation = undefined) instead of falling back.
  assertTrue(restored.type === "wait", "fallback to wait when origin missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Ferry to The Long Drift", "label preserved on fallback");
  assertEqual(restored.durationSeconds, 0, "duration is 0 on fallback");
});

test("fly action: missing destination station resolves to wait placeholder fallback (label preserved)", () => {
  const origin = createCodecTestStation("ORIGIN");
  const destination = createCodecTestStation("MISSING-DESTINATION");
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
  const restored = shipFlyActionFromSnapshot(snapshot, stationsById([origin]));
  // Pin the missing-destination side of the fallback — both branches must
  // route to the same wait placeholder.
  assertTrue(restored.type === "wait", "fallback to wait when destination missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Trade leg", "label preserved on fallback");
});

test("wait action: roundtrip preserves duration and label", () => {
  const action = { type: "wait" as const, durationSeconds: 12.5, label: "stagger" };
  const snapshot = shipWaitActionToSnapshot(action);
  const restored = shipWaitActionFromSnapshot(snapshot);
  assertTrue(restored.type === "wait", "type preserved");
  if (restored.type !== "wait") return;
  assertEqual(restored.durationSeconds, 12.5, "duration preserved");
  assertEqual(restored.label, "stagger", "label preserved");
});

test("cargo-withdrawal action: roundtrip preserves stationId, wareId, amount", () => {
  const station = createCodecTestStation("BIO-F");
  const action = {
    type: "cargo-withdrawal" as const,
    station,
    wareId: "food" as const,
    amount: 250,
  };
  const snapshot = shipCargoWithdrawalActionToSnapshot(action);
  // Pin the snapshot shape — stationId, not station.
  assertEqual(snapshot.stationId, "BIO-F", "snapshot carries stationId, not the live ref");
  const restored = shipCargoWithdrawalActionFromSnapshot(snapshot, stationsById([station]));
  assertTrue(restored.type === "cargo-withdrawal", "type preserved");
  if (restored.type !== "cargo-withdrawal") return;
  assertEqual(restored.station, station, "station reference resolved");
  assertEqual(restored.wareId, "food", "wareId preserved");
  assertEqual(restored.amount, 250, "amount preserved");
});

test("cargo-withdrawal action: missing station resolves to wait placeholder with 'Load' label", () => {
  const station = createCodecTestStation("BIO-F");
  const action = {
    type: "cargo-withdrawal" as const,
    station,
    wareId: "food" as const,
    amount: 250,
  };
  const snapshot = shipCargoWithdrawalActionToSnapshot(action);
  const restored = shipCargoWithdrawalActionFromSnapshot(snapshot, stationsById([]));
  // Pin the fixed "Load" label. cargo-withdrawal has no label field on the
  // action, so the fallback uses a fixed string.
  assertTrue(restored.type === "wait", "fallback to wait when station missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Load", "fallback label is 'Load'");
  assertEqual(restored.durationSeconds, 0, "duration 0 on fallback");
});

test("cargo-deposit action: roundtrip preserves stationId, wareId, amount", () => {
  const station = createCodecTestStation("HUB-T");
  const action = { type: "cargo-deposit" as const, station, wareId: "tech" as const, amount: 75 };
  const snapshot = shipCargoDepositActionToSnapshot(action);
  assertEqual(snapshot.stationId, "HUB-T", "snapshot carries stationId");
  const restored = shipCargoDepositActionFromSnapshot(snapshot, stationsById([station]));
  assertTrue(restored.type === "cargo-deposit", "type preserved");
  if (restored.type !== "cargo-deposit") return;
  assertEqual(restored.station, station, "station resolved");
  assertEqual(restored.wareId, "tech", "wareId preserved");
  assertEqual(restored.amount, 75, "amount preserved");
});

test("cargo-deposit action: missing station resolves to wait placeholder with 'Deliver' label", () => {
  const station = createCodecTestStation("HUB-T");
  const action = { type: "cargo-deposit" as const, station, wareId: "tech" as const, amount: 75 };
  const snapshot = shipCargoDepositActionToSnapshot(action);
  const restored = shipCargoDepositActionFromSnapshot(snapshot, stationsById([]));
  // Pin the fixed "Deliver" label — distinct from "Load" for withdrawal,
  // matching the user-visible direction the original action would have shown.
  assertTrue(restored.type === "wait", "fallback to wait when station missing");
  if (restored.type !== "wait") return;
  assertEqual(restored.label, "Deliver", "fallback label is 'Deliver'");
});

test("decommission action: roundtrip preserves stationId and label", () => {
  const station = createCodecTestStation("WAY-001");
  const action = {
    type: "decommission" as const,
    station,
    label: "Decommission at The Long Drift",
  };
  const snapshot = shipDecommissionActionToSnapshot(action);
  assertEqual(snapshot.stationId, "WAY-001", "snapshot carries stationId");
  assertEqual(snapshot.label, "Decommission at The Long Drift", "snapshot carries label");
  const restored = shipDecommissionActionFromSnapshot(snapshot, stationsById([station]));
  assertTrue(restored.type === "decommission", "type preserved");
  if (restored.type !== "decommission") return;
  assertEqual(restored.station, station, "station resolved");
  assertEqual(restored.label, "Decommission at The Long Drift", "label preserved");
});

test("decommission action: missing station resolves to wait placeholder (label preserved)", () => {
  const station = createCodecTestStation("WAY-001");
  const action = {
    type: "decommission" as const,
    station,
    label: "Decommission at The Long Drift",
  };
  const snapshot = shipDecommissionActionToSnapshot(action);
  const restored = shipDecommissionActionFromSnapshot(snapshot, stationsById([]));
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
  const originalStation = createCodecTestStation("BIO-F");
  const replacementStation = createStation(
    {
      id: "BIO-F",
      name: "BIO-F",
      x: 99,
      y: 99,
      nation: bioNation,
      stationTypeId: "farm",
      size: "L",
    },
    0,
  );
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
  const restored = shipFlyActionFromSnapshot(snapshot, stationsById([replacementStation]));
  assertTrue(restored.type === "fly", "type preserved");
  if (restored.type !== "fly") return;
  assertEqual(
    restored.originStation,
    replacementStation,
    "decoder resolves to the post-load station instance",
  );
  assertEqual(restored.originStation.size, "L", "post-load station is a fresh instance, not the original");
});
