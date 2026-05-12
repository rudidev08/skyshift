// Shared fixtures for the savegame-* test cluster.
//
// Each test file installs the localStorage shim once on module load and then
// calls `setupFreshTestGame()` to reset shared state before constructing a
// fresh sim. The "fresh" prefix flags the dispose side effect — calling
// twice doesn't stack two simulations, it tears down the previous one.

import type { captureSnapshot } from "../ui-savegame-manager.ts";
import { createSimulation, type Simulation } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-builder.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";

/** Map-backed shim for slot I/O — savegame-manager only touches localStorage
 *  inside saveToManualSlot/saveAutoSlot/loadFromSlot, so it's safe to install
 *  this after the static import block resolves. */
export const localStorageShim = new Map<string, string>();

/** Install the Map-backed localStorage shim onto `globalThis`. Safe to call
 *  more than once — every test file imports this module, so the first import
 *  wins and later ones land on the same shim. */
export function installLocalStorageShim(): void {
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => localStorageShim.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageShim.set(key, value); },
    removeItem: (key: string) => { localStorageShim.delete(key); },
    clear: () => { localStorageShim.clear(); },
    key: (index: number) => Array.from(localStorageShim.keys())[index] ?? null,
    get length() { return localStorageShim.size; },
  } as Storage;
}

installLocalStorageShim();

// The most recently constructed test game's Simulation — disposed at the
// start of each `setupFreshTestGame()` so the previous sim's trade roster,
// timers, and listeners don't bleed into the next test's universe.
let previousTestSimulation: Simulation | null = null;

/** Game-like object for captureSnapshot. Real managers (nation, emigration,
 *  stationHistory) so the round-trip exercises real serialization instead of
 *  falling through to `?? [default]` stubs. */
export function setupFreshTestGame() {
  // Tear down the previous test's simulation before constructing a fresh one.
  previousTestSimulation?.dispose();
  const map = createMapFromTemplate(settledUniverse, settledPreset);
  const simulation = createSimulation(map, { ignoreCargoCompatibility: true, initialStaggerDuration: 0 });
  previousTestSimulation = simulation;
  return {
    map,
    timeScale: 1,
    stations: simulation.stations,
    ships: simulation.ships,
    nationManager: simulation.nationManager,
    emigrationManager: simulation.emigrationManager,
    stationHistory: simulation.stationHistory,
    tradeManager: simulation.tradeManager,
    economyTimer: simulation.economyTimer,
    simulation,
  };
}

/** Drop fields that change every save (wall-clock timestamps, etc.) so the
 *  full-payload JSON compare only reacts to meaningful drift. */
export function stripVolatileFields(snapshot: ReturnType<typeof captureSnapshot>): unknown {
  const { savedAt: _savedAt, ...rest } = snapshot;
  return rest;
}
