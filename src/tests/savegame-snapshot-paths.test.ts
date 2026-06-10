// Catches new fields silently entering save files.
//
// The test captures a snapshot from a settled-preset sim — 120 fast ticks,
// then a build flip and a mid-demolition emigration event (see the test body)
// — walks the JSON tree, collects every distinct field path (array indices
// collapsed to `[]`), and compares the resulting set against the list in
// `savegame-snapshot-paths.json`. If a runtime field gets added — e.g.
// `currentRenderHeading` on `FlightData` — and a snapshot codec spreads
// `{...trade.flight}` somewhere, the new path appears in the captured set
// and the test fails with `+ tradeShips[].flight.currentRenderHeading`.
//
// The author decides:
//   - intentional schema change → regenerate `savegame-snapshot-paths.json`
//     with the new set.
//   - accidental leak → find the spread and either drop the runtime field
//     from the snapshot path or opt it into the matching `Pick<...>` in
//     `sim-save-types.ts`. The `Pick<>` discipline there is the compile-time
//     backstop; this test is the runtime backstop for new snapshot types
//     written as plain interfaces that bypass it.
//
// The 120 fast ticks exercise trade-related branches (mid-flight ships,
// queued actions, reservations) that a freshly-spawned sim wouldn't cover.
// The fixture steps after them cover the shapes a plain run never reaches:
// an active emigration event (manager activeEvent + per-station emigration
// state + the generational-ship build), an explicit save source, and all
// three stationHistory event kinds — created, state-changed (the build
// flip), removed (the demolition). The stationHistory codec is a bare
// `slice()`, so this path diff is the only leak backstop those event
// shapes have. The captured field path set is deterministic across runs
// even though sim values aren't — values vary with `Math.random`, but the
// set of fields touched does not.

import { readFileSync } from "node:fs";
import { test, assertEqual, assertTrue, assertNotNull, assertNotUndefined } from "./test-utils.ts";
import { captureSnapshot } from "../ui-savegame-manager.ts";
import { setupFreshTestGame, stripVolatileSnapshotFields } from "./savegame-test-fixtures.ts";

/** Walk a JSON-able value and add every distinct field path to `paths`,
 *  collapsing array indices to `[]`. The resulting set is independent of
 *  array element values and counts. */
function collectFieldPaths(value: unknown, prefix: string, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldPaths(item, `${prefix}[]`, paths);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, subValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.add(path);
    collectFieldPaths(subValue, path, paths);
  }
}

test("savegame snapshot field paths match the checked-in list", () => {
  const game = setupFreshTestGame();
  for (let i = 0; i < 120; i++) game.simulation.tick(0.5);

  // Manual mode before any slow tick so the slow ticks below can't auto-trigger
  // an emigration event of their own.
  game.simulation.emigrationManager.setMode("manual");

  // Build flip → a "state-changed" stationHistory event. A freshly placed
  // build (rather than one of the boot-time builds, whose slots already carry
  // trader reservations that block isBuildComplete) flips on the next slow
  // tick once its two construction slots are filled. The flip also spawns a
  // fresh fleet whose staggered deploy actions are still queued at capture
  // (no trade tick runs after this), keeping the `deploying` path present.
  const freeZone = assertNotUndefined(
    game.map.stationZones.find(
      (zone) => !game.simulation.stationManager.getStations().some((station) => station.zoneId === zone.id),
    ),
    "settled boot leaves at least one free zone",
  );
  const { station: flipStation } = game.simulation.stationManager.placeBuild({
    zoneId: freeZone.id,
    typeId: "tech-factory",
    size: "M",
    nationId: "hub",
    x: freeZone.x,
    y: freeZone.y,
  });
  for (const slot of flipStation.inventory) slot.current = slot.max;
  game.simulation.slowSimulationTick(1);
  assertEqual(flipStation.state, "producing", "ware-filled build flipped");

  // Emigration event, still active at capture → activeEvent + per-station
  // emigrationEvent + generational-ship build shapes. Faking one station's
  // launches as complete (with no docked homed ships) makes the next slow
  // tick demolish it — a "removed" stationHistory event — while the event
  // and its other stations stay live.
  const event = assertNotNull(
    game.simulation.emigrationManager.triggerEvent({ intensity: "high" }),
    "emigration event triggered",
  );
  assertTrue(event.stationIds.length >= 2, "event spans 2+ stations (one survives the demolition below)");
  const demolished = assertNotUndefined(
    game.simulation.stationManager.getStation(event.stationIds[0]),
    "first event station resolves",
  );
  const emigration = assertNotNull(demolished.emigrationEvent, "event station carries emigration state");
  emigration.launched = emigration.totalEmigrants;
  emigration.initialHomedShipIdSet.clear();
  game.simulation.slowSimulationTick(1);
  assertEqual(
    game.simulation.stationManager.getStation(demolished.id),
    undefined,
    "faked-complete station demolished",
  );
  assertNotNull(game.simulation.emigrationManager.getActiveEvent(), "event still active at capture");

  const snapshot = stripVolatileSnapshotFields(captureSnapshot(game, "manual"));

  const actual = new Set<string>();
  collectFieldPaths(snapshot, "", actual);

  const expectedUrl = new URL("./savegame-snapshot-paths.json", import.meta.url);
  const expected = new Set<string>(JSON.parse(readFileSync(expectedUrl, "utf-8")) as string[]);

  const added = [...actual].filter((path) => !expected.has(path)).sort();
  const removed = [...expected].filter((path) => !actual.has(path)).sort();

  if (added.length === 0 && removed.length === 0) return;

  const lines = [
    "snapshot field paths drifted — if intentional, regenerate savegame-snapshot-paths.json; if not, check for new runtime fields leaking via spread (see file header):",
    ...added.map((path) => `  + ${path}`),
    ...removed.map((path) => `  - ${path}`),
  ];
  throw new Error(lines.join("\n"));
});
