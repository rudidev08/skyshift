import { createSimulation, type Simulation, type SimulationOptions } from "../sim-lifecycle.ts";
import { createMapFromTemplate } from "../sim-map-create.ts";
import { map as settledUniverse } from "../../data/map.ts";
import { settledPreset } from "../../data/map-preset-settled.ts";

/** Every dockable station spawns its full ship roster (`ignoreCargoCompatibility`),
 *  with no launch stagger so all ships execute from the first tick. */
export function createSettledSimulation(extraOptions: SimulationOptions = {}): Simulation {
  return createSimulation(createMapFromTemplate(settledUniverse, settledPreset), {
    ignoreCargoCompatibility: true,
    initialStaggerDurationSeconds: 0,
    ...extraOptions,
  });
}
