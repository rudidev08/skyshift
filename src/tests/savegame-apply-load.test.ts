// applySnapshot side effects beyond field restoration: playback-speed reset
// (with and without a wired timeController), and source recording on
// captureSnapshot. The speed-reset path runs on every load, so each variant
// gets a focused test instead of being lumped into the round-trip suite.

import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { captureSnapshot, applySnapshot } from "../ui-savegame-manager.ts";
import { setupFreshTestGame } from "./savegame-test-fixtures.ts";

test("loading a save invokes the wired timeController.setSpeed with 1x", () => {
  // When a timeController is wired (the live game wires one during render
  // init), applySnapshot routes the speed reset through it so the controller
  // owns the canonical playback rate.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame as never);

  const loadedGame = setupFreshTestGame() as ReturnType<typeof setupFreshTestGame> & {
    timeController?: { setSpeed(scale: number): void };
  };
  loadedGame.timeScale = 2;

  let restoredSpeed = -1;
  loadedGame.timeController = {
    setSpeed(scale: number) {
      restoredSpeed = scale;
    },
  };

  applySnapshot(loadedGame as never, snapshot);

  assertEqual(restoredSpeed, 1, "time controller restored speed");
});

test("applySnapshot resets timeScale even when no timeController is wired up", () => {
  // Without a timeController shim, the only thing forcing 1x is the direct
  // assignment to game.timeScale — covers the load path before timeController
  // is installed (e.g. headless / pre-render-init).
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame as never);

  const loadedGame = setupFreshTestGame();
  loadedGame.timeScale = 4;
  applySnapshot(loadedGame as never, snapshot);

  assertEqual(loadedGame.timeScale, 1, "game time scale assigned directly");
});

test("applySnapshot zeroes the sub-tick accumulator so reload mid-session doesn't carry over fractional time", () => {
  // Pin economyTimer.reset() in restoreEconomyTime. Removing the reset would
  // leave the sub-tick accumulator from before the load, so a small post-load
  // advance would push past the simulation interval and bump tick.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame as never);
  const loadedGame = setupFreshTestGame();
  // Push the loaded sim's accumulator just shy of the simulation interval
  // before applySnapshot — without a reset on load, the next tiny advance
  // would tip it over and bump tick.
  loadedGame.economyTimer.advance(0.4);
  applySnapshot(loadedGame as never, snapshot);
  const tickBefore = loadedGame.economyTimer.tick;
  loadedGame.economyTimer.advance(0.2);
  assertEqual(loadedGame.economyTimer.tick, tickBefore, "small advance after load shouldn't bump tick");
});

test("applySnapshot re-staggers station tick offsets so production doesn't pile on one frame", () => {
  // Pin the staggerStationTicks(game.stations) call. Removing it would leave
  // every restored station's secondsSinceLastTick at the post-construction
  // default (all the same), causing every station to fire production on the
  // same frame after load — a frame-jank regression on big maps.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame as never);
  const restoredGame = setupFreshTestGame();
  applySnapshot(restoredGame as never, snapshot);
  const offsets = restoredGame.stations.map((station) => station.secondsSinceLastTick);
  const distinctOffsets = new Set(offsets);
  assertTrue(
    distinctOffsets.size > 1,
    `expected staggered offsets across ${restoredGame.stations.length} stations, got ${distinctOffsets.size} distinct value(s)`,
  );
});

test("applySnapshot rebuilds the trade manager's ware-station index against the restored stations", () => {
  // Pin rebuildWareStationIndex(game.stations) in restoreStations. Skipping the
  // rebuild would leave the index pointing at the previous Station instances
  // (the pre-load fresh-init objects), so trade decisions on the loaded
  // session would resolve producers/consumers to orphaned references.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame as never);
  const restoredGame = setupFreshTestGame();
  applySnapshot(restoredGame as never, snapshot);

  const restoredStations = new Set(restoredGame.stations);
  let totalProducers = 0;
  for (const [, producers] of restoredGame.tradeManager.wareStationIndex.producersByWareEntries()) {
    for (const producer of producers) {
      totalProducers++;
      assertTrue(
        restoredStations.has(producer),
        `indexed producer must be a station in the restored roster, got orphan ${producer.id}`,
      );
    }
  }
  assertTrue(totalProducers > 0, `expected at least one indexed producer, got ${totalProducers}`);
});

test("captureSnapshot records the source field when one is supplied", () => {
  // Without a recorded source, the snapshot lies about how it was produced —
  // hides the auto/manual/export distinction the export filename and slot UI
  // depend on.
  const game = setupFreshTestGame();
  const snapshot = captureSnapshot(game as never, "manual");
  assertEqual(snapshot.source, "manual", "manual source recorded");

  const exported = captureSnapshot(game as never, "export");
  assertEqual(exported.source, "export", "export source recorded");

  const noSource = captureSnapshot(game as never);
  assertEqual(noSource.source, undefined, "missing source omitted");
});

test("captureSnapshot writes stationHistory and applySnapshot restores it on the loaded sim", () => {
  // Pin the StationHistory wiring on both sides of the round-trip. Fresh-init
  // backfills one "created" event per preset station via
  // recordInitialStationsInHistory; record an extra "removed" event with a
  // unique sentinel id so the restored history can be told apart from the
  // restored sim's own fresh-init backfill (both sims seed from the same map,
  // so plain counts and the seeded ids match either way). Skipping the capture
  // write or the apply-side fromSnapshot would silently empty (or replace) the
  // Stations Timelapse Log on every load.
  const sourceGame = setupFreshTestGame();
  const sentinelId = "ROUNDTRIP-SENTINEL-STATION";
  sourceGame.stationHistory.recordRemoved(0, sentinelId);
  const sourceEventCount = sourceGame.stationHistory.toSnapshot().length;
  assertTrue(sourceEventCount > 0, `fresh-init should seed stationHistory, got ${sourceEventCount}`);

  const snapshot = captureSnapshot(sourceGame as never);
  assertEqual(snapshot.stationHistory.length, sourceEventCount, "captureSnapshot writes the events from sim history");

  const restoredGame = setupFreshTestGame();
  applySnapshot(restoredGame as never, snapshot);
  const restoredEvents = restoredGame.stationHistory.toSnapshot();
  assertEqual(restoredEvents.length, sourceEventCount, "applySnapshot restores the same event count");
  // Sentinel anchors the test against the restored sim's own fresh-init
  // backfill — without applySnapshot calling stationHistory.fromSnapshot, the
  // restored sim still seeds the map's stations into history, so counts match
  // by coincidence. The sentinel only exists in source; it must transfer.
  const sentinelRestored = restoredEvents.some(
    (event) => event.kind === "removed" && event.stationId === sentinelId,
  );
  assertTrue(sentinelRestored, "sentinel-id event from source survives load");
});

test("simTick round-trips through capture and apply", () => {
  // Pin the simTick write on capture and the assignment on apply. Capture
  // hardcoding 0, or apply skipping the `economyTimer.tick = snapshot.simTick`
  // assignment, would silently rewind the sim clock on every load.
  const sourceGame = setupFreshTestGame();
  for (let tickIndex = 0; tickIndex < 5; tickIndex++) sourceGame.simulation.tick(0.5);
  const expectedTick = sourceGame.economyTimer.tick;
  assertTrue(expectedTick > 0, `preconditions: source tick advanced past 0, got ${expectedTick}`);

  const snapshot = captureSnapshot(sourceGame as never);
  assertEqual(snapshot.simTick, expectedTick, "captureSnapshot writes the live economy tick");

  const restoredGame = setupFreshTestGame();
  applySnapshot(restoredGame as never, snapshot);
  assertEqual(restoredGame.economyTimer.tick, expectedTick, "applySnapshot restores the economy tick from the snapshot");
});
