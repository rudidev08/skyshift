import { test, assertEqual } from "./test-utils.ts";
import { economyConfig } from "../../data/economy-config.ts";
import { createSettledSimulation } from "./sim-test-fixtures.ts";

test("runWarmup advances the economy timer by ceil(seconds / simulationIntervalSeconds) ticks", () => {
  // Guard for item 10 — warmup steps at the sim's own configured cadence
  // (economyConfig.simulationIntervalSeconds), not a re-stated 0.5 literal.
  // Under the OLD behavior warmup was a free runWarmupTicks() with a hardcoded
  // `warmupStep = 0.5`; this would not compile (no Simulation.runWarmup) and,
  // were the interval ever changed off 0.5, the literal loop would produce a
  // different tick count than this config-driven expectation.
  const step = economyConfig.simulationIntervalSeconds;

  for (const warmupSeconds of [0, 10, 10.3, 600]) {
    const simulation = createSettledSimulation();
    const before = simulation.economyTimer.tickCount;

    simulation.runWarmup(warmupSeconds);

    const advanced = simulation.economyTimer.tickCount - before;
    assertEqual(
      advanced,
      Math.ceil(warmupSeconds / step),
      `runWarmup(${warmupSeconds}) advances ceil(${warmupSeconds} / ${step}) ticks`,
    );
    simulation.destroy();
  }
});
