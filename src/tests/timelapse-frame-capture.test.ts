import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { map } from "../../data/map.ts";
import { createMapFromTemplate } from "../sim-map-create.ts";
import { createSimulation } from "../sim-lifecycle.ts";
import { createTimelapseMapForPresetId, captureTimelapseFrame, capturePresetInitialFrame } from "../editor/timelapse-runner.ts";

// captureTimelapseFrame is a flat read of simulation.stations into a TimelapseFrame.
// We test against a real settled preset so any field-shape drift fails here
// rather than blowing up in the live runner.

test("captureTimelapseFrame: includes every operational station from the settled preset", () => {
  const gameMap = createMapFromTemplate(map, { ...settledPreset, simulationWarmupSeconds: 0 });
  const simulation = createSimulation(gameMap);
  try {
    const frame = captureTimelapseFrame(simulation, 0);

    assertEqual(frame.simTimeSeconds, 0, "simTimeSeconds");
    assertTrue(frame.stations.length > 0, "settled preset has stations");

    // For every station in the sim, the frame entry must match by id.
    for (const station of simulation.stations) {
      const frameStation = frame.stations.find((candidate) => candidate.id === station.id);
      assertTrue(frameStation !== undefined, `frame entry exists for ${station.id}`);
      assertEqual(frameStation!.position.x, station.x, `${station.id}.x`);
      assertEqual(frameStation!.position.y, station.y, `${station.id}.y`);
      assertEqual(frameStation!.nationId, station.nation.id, `${station.id}.nationId`);
      assertEqual(frameStation!.typeId, station.stationType.id, `${station.id}.typeId`);
    }
  } finally {
    simulation.destroy();
  }
});

test("captureTimelapseFrame: maps station.state to operational vs construction", () => {
  // Use a fresh sim; default state for seeded stations is "producing" (operational).
  const gameMap = createMapFromTemplate(map, { ...settledPreset, simulationWarmupSeconds: 0 });
  const simulation = createSimulation(gameMap);
  try {
    const frame = captureTimelapseFrame(simulation, 0);
    for (const entry of frame.stations) {
      const station = simulation.stations.find((candidate) => candidate.id === entry.id)!;
      const expected = station.state === "building" ? "construction" : "operational";
      assertEqual(entry.state, expected, `${entry.id}.state`);
    }
  } finally {
    simulation.destroy();
  }
});

test("captureTimelapseFrame: simTimeSeconds reflects the argument", () => {
  const gameMap = createMapFromTemplate(map, { ...settledPreset, simulationWarmupSeconds: 0 });
  const simulation = createSimulation(gameMap);
  try {
    const frame = captureTimelapseFrame(simulation, 1234.5);
    assertEqual(frame.simTimeSeconds, 1234.5, "simTimeSeconds reflects arg");
  } finally {
    simulation.destroy();
  }
});

// capturePresetInitialFrame is the preview-path entry point — builds and
// destroys a transient Simulation to grab frame 0 (incl. nation-level initial
// builds). Pin the contract so the timelapse tab's idle preview doesn't
// silently lose its initial state if the helper drifts.

test("capturePresetInitialFrame: returns frame 0 for a known preset", () => {
  const frame = capturePresetInitialFrame("settled");
  assertTrue(frame !== null, "settled preset resolves");
  assertEqual(frame!.simTimeSeconds, 0, "simTimeSeconds is 0");
  assertTrue(frame!.stations.length > 0, "settled preset has initial stations");
});

test("capturePresetInitialFrame: returns null for an unknown preset", () => {
  const frame = capturePresetInitialFrame("does-not-exist");
  assertEqual(frame, null, "unknown preset returns null");
});

// createTimelapseMapForPresetId overrides the preset's simulationWarmupSeconds to 0 so the
// timelapse preview/run starts from the initial state, not pre-ticked.
// settledPreset.simulationWarmupSeconds is 60 — without the override, the map
// would carry that value and the run would silently start mid-sim.
test("createTimelapseMapForPresetId overrides simulationWarmupSeconds to 0", () => {
  assertTrue(settledPreset.simulationWarmupSeconds !== 0, "settled preset carries a non-zero warmup");
  const presetMap = createTimelapseMapForPresetId("settled");
  assertTrue(presetMap !== null, "settled preset resolves");
  assertEqual(presetMap!.simulationWarmupSeconds, 0, "warmup overridden to 0 for timelapse");
});
