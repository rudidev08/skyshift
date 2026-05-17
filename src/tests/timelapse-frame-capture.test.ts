import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { map } from "../../data/map.ts";
import { createMapFromTemplate } from "../sim-map-create.ts";
import { createSimulation } from "../sim-lifecycle.ts";
import { buildPresetMap, captureFrame, capturePresetInitialFrame } from "../editor/timelapse-runner.ts";

// captureFrame is a flat read of simulation.stations into a TimelapseFrame.
// We test against a real settled preset so any field-shape drift fails here
// rather than blowing up in the live runner.

test("captureFrame: includes every operational station from the settled preset", () => {
  const gameMap = createMapFromTemplate(map, { ...settledPreset, simulationWarmupSeconds: 0 });
  const simulation = createSimulation(gameMap);
  try {
    const frame = captureFrame(simulation, 0);

    assertEqual(frame.simSeconds, 0, "simSeconds");
    assertTrue(frame.stations.length > 0, "settled preset has stations");

    // For every station in the sim, the frame entry must match by id.
    for (const station of simulation.stations) {
      const entry = frame.stations.find((s) => s.id === station.id);
      assertTrue(entry !== undefined, `frame entry exists for ${station.id}`);
      assertEqual(entry!.position.x, station.x, `${station.id}.x`);
      assertEqual(entry!.position.y, station.y, `${station.id}.y`);
      assertEqual(entry!.nationId, station.nation.id, `${station.id}.nationId`);
      assertEqual(entry!.typeId, station.stationType.id, `${station.id}.typeId`);
    }
  } finally {
    simulation.dispose();
  }
});

test("captureFrame: maps station.state to operational vs construction", () => {
  // Use a fresh sim; default state for seeded stations is "producing" (operational).
  const gameMap = createMapFromTemplate(map, { ...settledPreset, simulationWarmupSeconds: 0 });
  const simulation = createSimulation(gameMap);
  try {
    const frame = captureFrame(simulation, 0);
    for (const entry of frame.stations) {
      const station = simulation.stations.find((s) => s.id === entry.id)!;
      const expected = station.state === "building" ? "construction" : "operational";
      assertEqual(entry.state, expected, `${entry.id}.state`);
    }
  } finally {
    simulation.dispose();
  }
});

test("captureFrame: simSeconds reflects the argument", () => {
  const gameMap = createMapFromTemplate(map, { ...settledPreset, simulationWarmupSeconds: 0 });
  const simulation = createSimulation(gameMap);
  try {
    const frame = captureFrame(simulation, 1234.5);
    assertEqual(frame.simSeconds, 1234.5, "simSeconds reflects arg");
  } finally {
    simulation.dispose();
  }
});

// capturePresetInitialFrame is the preview-path entry point — builds and
// disposes a transient Simulation to grab frame 0 (incl. nation-level initial
// builds). Pin the contract so the timelapse tab's idle preview doesn't
// silently lose its initial state if the helper drifts.

test("capturePresetInitialFrame: returns frame 0 for a known preset", () => {
  const frame = capturePresetInitialFrame("settled");
  assertTrue(frame !== null, "settled preset resolves");
  assertEqual(frame!.simSeconds, 0, "simSeconds is 0");
  assertTrue(frame!.stations.length > 0, "settled preset has initial stations");
});

test("capturePresetInitialFrame: returns null for an unknown preset", () => {
  const frame = capturePresetInitialFrame("does-not-exist");
  assertEqual(frame, null, "unknown preset returns null");
});

// buildPresetMap overrides the preset's simulationWarmupSeconds to 0 so the
// timelapse preview/run starts from the initial state, not pre-ticked.
// settledPreset.simulationWarmupSeconds is 60 — without the override, the map
// would carry that value and the run would silently start mid-sim.
test("buildPresetMap overrides simulationWarmupSeconds to 0", () => {
  assertTrue(settledPreset.simulationWarmupSeconds !== 0, "settled preset carries a non-zero warmup");
  const map = buildPresetMap("settled");
  assertTrue(map !== null, "settled preset resolves");
  assertEqual(map!.simulationWarmupSeconds, 0, "warmup overridden to 0 for timelapse");
});

test("buildPresetMap returns null for an unknown preset", () => {
  assertEqual(buildPresetMap("does-not-exist"), null, "unknown preset returns null");
});
