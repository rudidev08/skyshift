import { test, assertEqual, assertTrue, assertThrows, assertNotUndefined } from "./test-utils.ts";
import { captureSnapshot, restoreSavedGame } from "../ui-savegame-manager.ts";
import { setupFreshTestGame } from "./savegame-test-fixtures.ts";

test("loading a save invokes the wired timeController.setSpeed with 1x", () => {
  // When a timeController is wired (the live game wires one during render
  // init), restoreSavedGame routes the speed reset through it so the controller
  // owns the canonical playback rate.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame);

  const loadedGame = setupFreshTestGame();
  loadedGame.timeScale = 2;

  let restoredSpeed = -1;
  loadedGame.timeController = {
    setSpeed(scale: number) {
      restoredSpeed = scale;
    },
  };

  restoreSavedGame(loadedGame, snapshot);

  assertEqual(restoredSpeed, 1, "time controller restored speed");
});

test("restoreSavedGame resets timeScale even when no timeController is wired up", () => {
  // Without a timeController shim, the only thing forcing 1x is the direct
  // assignment to game.timeScale — covers the load path before timeController
  // is installed (e.g. headless / pre-render-init).
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame);

  const loadedGame = setupFreshTestGame();
  loadedGame.timeScale = 4;
  restoreSavedGame(loadedGame, snapshot);

  assertEqual(loadedGame.timeScale, 1, "game time scale assigned directly");
});

test("restoreSavedGame zeroes the sub-tick accumulator so reload mid-session doesn't carry over fractional time", () => {
  // Pin economyTimer.reset() in restoreEconomyTime. Removing the reset would
  // leave the sub-tick accumulator from before the load, so a small post-load
  // advance would push past the simulation interval and bump tick.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame);
  const loadedGame = setupFreshTestGame();
  // Push the loaded sim's accumulator just shy of the simulation interval
  // before restoreSavedGame — without a reset on load, the next tiny advance
  // would tip it over and bump tick.
  loadedGame.simulation.economyTimer.tick(0.4);
  restoreSavedGame(loadedGame, snapshot);
  const tickBefore = loadedGame.simulation.economyTimer.tickCount;
  loadedGame.simulation.economyTimer.tick(0.2);
  assertEqual(
    loadedGame.simulation.economyTimer.tickCount,
    tickBefore,
    "small advance after load shouldn't bump tick",
  );
});

test("restoreSavedGame re-staggers station tick offsets so production doesn't pile on one frame", () => {
  // Pin the staggerStationTicks(game.stations) call. Removing it would leave
  // every restored station's secondsSinceLastTick at the post-construction
  // default (all the same), causing every station to fire production on the
  // same frame after load — a frame-jank regression on big maps.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);
  const offsets = restoredGame.stations.map((station) => station.secondsSinceLastTick);
  const distinctOffsets = new Set(offsets);
  assertTrue(
    distinctOffsets.size > 1,
    `expected staggered offsets across ${restoredGame.stations.length} stations, got ${distinctOffsets.size} distinct value(s)`,
  );
});

test("restoreSavedGame rebuilds the trade manager's ware-station index against the restored stations", () => {
  // Pin rebuildWareStationIndex(game.stations) in restoreStations. Skipping the
  // rebuild would leave the index pointing at the previous Station instances
  // (the pre-load fresh-init objects), so trade decisions on the loaded
  // session would resolve producers/consumers to orphaned references.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame);
  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);

  const restoredStations = new Set(restoredGame.stations);
  let totalProducers = 0;
  for (const [
    ,
    producers,
  ] of restoredGame.simulation.tradeManager.wareStationIndex.producedWaresWithStations()) {
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
  const snapshot = captureSnapshot(game, "manual");
  assertEqual(snapshot.source, "manual", "manual source recorded");

  const exported = captureSnapshot(game, "export");
  assertEqual(exported.source, "export", "export source recorded");

  const noSource = captureSnapshot(game);
  assertEqual(noSource.source, undefined, "missing source omitted");
});

test("captureSnapshot writes stationHistory and restoreSavedGame restores it on the loaded sim", () => {
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
  sourceGame.simulation.stationHistory.recordRemoved(0, sentinelId);
  const sourceEventCount = sourceGame.simulation.stationHistory.toSnapshot().length;
  assertTrue(sourceEventCount > 0, `fresh-init should seed stationHistory, got ${sourceEventCount}`);

  const snapshot = captureSnapshot(sourceGame);
  assertEqual(
    snapshot.stationHistory.length,
    sourceEventCount,
    "captureSnapshot writes the events from sim history",
  );

  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);
  const restoredEvents = restoredGame.simulation.stationHistory.toSnapshot();
  assertEqual(restoredEvents.length, sourceEventCount, "restoreSavedGame restores the same event count");
  // Sentinel anchors the test against the restored sim's own fresh-init
  // backfill — without restoreSavedGame calling stationHistory.fromSnapshot, the
  // restored sim still seeds the map's stations into history, so counts match
  // by coincidence. The sentinel only exists in source; it must transfer.
  const sentinelRestored = restoredEvents.some(
    (event) => event.kind === "removed" && event.stationId === sentinelId,
  );
  assertTrue(sentinelRestored, "sentinel-id event from source survives load");
});

test("restoreSavedGame throws if a ship references a station not in the snapshot", () => {
  // Pin the ref-integrity throw in restoreShips. validateSnapshot only checks
  // that each ship has a string stationId — it doesn't verify the id resolves
  // against snapshot.stations. The throw is the actual reference check;
  // silently dropping (e.g. `continue`) would orphan ships and cascade into
  // a missing-trade-ship error downstream instead of pointing at the real cause.
  const sourceGame = setupFreshTestGame();
  const snapshot = captureSnapshot(sourceGame);
  if (snapshot.ships.length === 0) throw new Error("preconditions: expected at least one ship");
  snapshot.ships[0].stationId = "DOES-NOT-EXIST-IN-SNAPSHOT";

  const restoredGame = setupFreshTestGame();
  assertThrows(
    () => restoreSavedGame(restoredGame, snapshot),
    "DOES-NOT-EXIST-IN-SNAPSHOT",
    "throw must reference the missing station id (catches silent-skip mutations that orphan the ship instead)",
  );
});

test("simulationTick round-trips through capture and apply", () => {
  // Pin the simulationTick write on capture and the assignment on apply. Capture
  // hardcoding 0, or apply skipping the `economyTimer.tickCount = snapshot.simulationTick`
  // assignment, would silently rewind the sim clock on every load.
  const sourceGame = setupFreshTestGame();
  for (let i = 0; i < 5; i++) sourceGame.simulation.tick(0.5);
  const expectedTick = sourceGame.simulation.economyTimer.tickCount;
  assertTrue(expectedTick > 0, `preconditions: source tick advanced past 0, got ${expectedTick}`);

  const snapshot = captureSnapshot(sourceGame);
  assertEqual(snapshot.simulationTick, expectedTick, "captureSnapshot writes the live economy tick");

  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);
  assertEqual(
    restoredGame.simulation.economyTimer.tickCount,
    expectedTick,
    "restoreSavedGame restores the economy tick from the snapshot",
  );
});

test("getCurrentBuildStationId is derived from the restored roster, not a persisted nation-manager map", () => {
  // The parallel inFlightBuildStationIdByNation map AND its nationManager
  // snapshot section were removed: the in-flight build for nation X is now
  // derived as the Station with state==="building" and nation.id===X. This
  // mirrors the real load path (game-setup.ts createGameSimulationForSnapshot):
  // restoreSavedGame populates game.stations, then seedRosterForSavedGame
  // reseeds the StationManager from that roster — restoreSavedGame alone does
  // not. Fail-old guard: the OLD map-backed implementation persisted a
  // nationManager snapshot section and rebuilt the map via
  // nationManager.fromSnapshot; the !("nationManager" in snapshot) assertion
  // below fails under that old behavior and passes only with the section
  // gone — that assertion is what pins the removal.
  const sourceGame = setupFreshTestGame();
  const buildingStation = assertNotUndefined(
    sourceGame.simulation.stationManager
      .getStations()
      .find((station) => station.state === "building"),
    "fresh game has at least one building station from startInitialStationBuilds",
  );
  const owningNationId = buildingStation.nation.id;
  assertEqual(
    sourceGame.simulation.nationManager.getCurrentBuildStationId(owningNationId),
    buildingStation.id,
    "source: getCurrentBuildStationId resolves the building station",
  );

  const snapshot = captureSnapshot(sourceGame);
  // The nation-manager snapshot section no longer exists — the building
  // station persists in stations[] with state:"building"+nation.
  assertTrue(
    !("nationManager" in snapshot),
    "snapshot carries no nationManager section",
  );
  assertTrue(
    snapshot.stations.some(
      (station) => station.id === buildingStation.id && station.state === "building",
    ),
    "building station persists in stations[] with state:building",
  );

  const restoredGame = setupFreshTestGame();
  restoreSavedGame(restoredGame, snapshot);
  // Real load path (game-setup.ts createGameSimulationForSnapshot) reseeds the
  // StationManager roster from the restored stations after restoreSavedGame;
  // mirror it so the derivation reads the snapshot roster, not fresh-init.
  restoredGame.simulation.seedRosterForSavedGame(restoredGame.stations, restoredGame.ships);

  assertEqual(
    restoredGame.simulation.nationManager.getCurrentBuildStationId(owningNationId),
    buildingStation.id,
    "restored: getCurrentBuildStationId derives the in-flight build from the roster",
  );
});
