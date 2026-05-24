export const economyConfig = {
  // time between sim ticks: production, consumption, UI
  // helps with performance since this doesn't need to be calculated every tick
  simulationIntervalSeconds: 0.5,
  // slow tick for build-completion handoff and emigration lifecycle (sim seconds)
  slowSimulationTickIntervalSeconds: 5,
  // time to fill station ware output from empty with production
  targetFillTimeSeconds: 3600, // 1 hour

  // Ships orbit idle, then periodically run a trade route.
  // a ship waits in orbit between trades
  tradeWaitMinSeconds: 2,
  tradeWaitMaxSeconds: 8,
  // ships begin first trade within this window (maps can override)
  // stagger helps with performance and more evenly distributes trade activity
  defaultInitialStaggerDurationSeconds: 30,
  // ship time spent grounded (loading/unloading)
  groundedDelaySeconds: 2,
  // probability of picking the highest-scoring ware/destination trade route vs
  // a random trade route (to have universe trades feel more natural)
  optimalPickChance: 0.75, // 75%
  // ship only accepts trade that fills this fraction of cargo
  // this avoids ships trading low quantities at start of trade search
  minimumCargoFillThreshold: 0.5,
  // over time, ship is willing to accept lower cargo fill thresholds
  // this controls how fast ship reduces minimum threshold
  cargoFillDecayPerSecond: 0.5 / 120, // 2 minutes
  // how often the overview trade view recomputes "which routes have been active recently" — between refreshes, the same list is reused.
  tradeRouteCacheRefreshSeconds: 30,
  // 3h = 1h safety margin over the longest exposed "traders in last X" window (2h); caps growth in long sessions.
  // used in overview: trade view to see route history
  tradeRouteHistoryRetentionSeconds: 3 * 60 * 60,

  // UI throttling — cuts setText/innerHTML calls. Values are tick multiples.
  // selected in-game object (station & ship inventory rings) + HUD panel: every tick (0.5s)
  focusedAttentionIntervalTicks: 1,
  // unselected in-game objects: every 10 ticks (5s)
  backgroundAttentionIntervalTicks: 10,
};
