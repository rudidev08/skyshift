// Shared fixtures for the savegame-* test cluster.
//
// Each test file installs the localStorage shim once on module load and then
// calls `setupFreshTestGame()` to reset shared state before constructing a
// fresh sim. The "fresh" prefix flags the destroy side effect — calling
// twice doesn't stack two simulations, it tears down the previous one.

import type { captureSnapshot, SavegameHost } from "../ui-savegame-manager.ts";
import { createSimulation, type Simulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-create.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";
import { createMapBackedStorage } from "./local-storage-test-fixtures.ts";

// Install a Map-backed localStorage shim onto `globalThis` at module load.
// `storage-save-slots.ts` only reads/writes localStorage when its functions
// are called, not at import time, so this shim installed at module load is
// in place before any test invokes them. Every test file imports this module,
// so the first import wins and later ones land on the same shim.
const { storage, store } = createMapBackedStorage();
(globalThis as { localStorage?: Storage }).localStorage = storage;

// Backing Map for the localStorage shim. Tests inspect / mutate entries
// directly (`.clear`, `.set`, `.get`) without going through Storage methods.
export const localStorageShim = store;

// The previous test's Simulation, held so the next `setupFreshTestGame()`
// can destroy it before constructing a fresh sim — keeps trade rosters,
// timers, and listeners from one test bleeding into the next.
let previousSimulation: Simulation | null = null;

/** Real-Simulation-backed `SavegameHost` for the savegame tests. The
 *  `& { simulation: Simulation }` pins the optional contract field non-null
 *  so test bodies read `.simulation` without `!`, while the value still
 *  satisfies what captureSnapshot / restoreSavedGame / the slot APIs read. */
export function setupFreshTestGame(): SavegameHost & { simulation: Simulation } {
  previousSimulation?.destroy();
  const map = createMapFromTemplate(settledUniverse, settledPreset);
  const simulation = createSimulation(map, {
    ignoreCargoCompatibility: true,
    initialStaggerDurationSeconds: 0,
  });
  previousSimulation = simulation;
  return {
    map,
    timeScale: 1,
    stations: simulation.stations,
    ships: simulation.ships,
    simulation,
  };
}

/** Drop the wall-clock save timestamp so the full-payload JSON compare only reacts to meaningful drift. */
export function stripVolatileSnapshotFields(snapshot: ReturnType<typeof captureSnapshot>): unknown {
  const { savedAtMilliseconds: _savedAtMilliseconds, ...rest } = snapshot;
  return rest;
}
