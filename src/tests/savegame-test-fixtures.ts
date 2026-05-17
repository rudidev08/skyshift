// Shared fixtures for the savegame-* test cluster.
//
// Each test file installs the localStorage shim once on module load and then
// calls `setupFreshTestGame()` to reset shared state before constructing a
// fresh sim. The "fresh" prefix flags the dispose side effect — calling
// twice doesn't stack two simulations, it tears down the previous one.

import type { captureSnapshot } from "../ui-savegame-manager.ts";
import { createSimulation, type Simulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-create.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";

/** Map-backed shim for slot I/O — savegame-manager only touches localStorage
 *  inside saveToManualSlot/saveAutoSlot/readSlot, so it's safe to install
 *  this after the static import block resolves. */
export const localStorageShim = new Map<string, string>();

// Install the Map-backed localStorage shim onto `globalThis` at module load.
// Every test file imports this module, so the first import wins and later ones
// land on the same shim.
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => localStorageShim.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageShim.set(key, value);
  },
  removeItem: (key: string) => {
    localStorageShim.delete(key);
  },
  clear: () => {
    localStorageShim.clear();
  },
  key: (index: number) => Array.from(localStorageShim.keys())[index] ?? null,
  get length() {
    return localStorageShim.size;
  },
} as Storage;

// The previous test's Simulation, held so the next `setupFreshTestGame()`
// can dispose it before constructing a fresh sim — keeps trade rosters,
// timers, and listeners from one test bleeding into the next.
let pendingDisposalSimulation: Simulation | null = null;

/** Game-like object for captureSnapshot. Mirrors the real Game class's
 *  surface (map / stations / ships / simulation). Manager access goes through
 *  `.simulation.<manager>` so consumers don't drift from real-Game reads. */
export function setupFreshTestGame() {
  // Tear down the previous test's simulation before constructing a fresh one.
  pendingDisposalSimulation?.dispose();
  const map = createMapFromTemplate(settledUniverse, settledPreset);
  const simulation = createSimulation(map, {
    ignoreCargoCompatibility: true,
    initialStaggerDurationSeconds: 0,
  });
  pendingDisposalSimulation = simulation;
  return {
    map,
    timeScale: 1,
    stations: simulation.stations,
    ships: simulation.ships,
    simulation,
  };
}

/** Drop fields that change every save (wall-clock timestamps, etc.) so the
 *  full-payload JSON compare only reacts to meaningful drift. */
export function stripVolatileFields(snapshot: ReturnType<typeof captureSnapshot>): unknown {
  const { savedAt: _savedAt, ...rest } = snapshot;
  return rest;
}
