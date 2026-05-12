/** Current config sizes station storage to hold 1h of production. */
export const economyConfig = {
  simulationIntervalSeconds: 0.5, // between sim ticks: production, consumption, UI
  targetFillTimeSeconds: 3600, // to fill output from empty (1 hour)

  // Trade — ships orbit idle, then periodically run a trade route.
  tradeWaitMinSeconds: 2, // a ship waits in orbit between trades
  tradeWaitMaxSeconds: 8,
  initialStaggerDurationDefaultSeconds: 30, // ships begin first trade within this window (maps can override)
  groundedDelaySeconds: 2, // spent grounded (loading/unloading)
  optimalChance: 0.75, // probability of picking optimal ware/destination vs random
  minimumCargoFillThreshold: 0.5, // ship only accepts trade that fills ≥ this fraction of cargo
  cargoFillDecayPerSecond: 0.5 / 120, // threshold decays to 0 over 2 minutes
  tradeRouteCacheRefreshSeconds: 30,
  // 3h = 1h safety margin over the longest exposed "traders in last X" window (2h); caps growth in long sessions.
  tradeRouteHistoryRetentionSeconds: 3 * 60 * 60,

  // UI throttling — cuts expensive setText/innerHTML calls. Values are tick multiples.
  focusedAttentionIntervalTicks: 1, // selected item + HUD panel: every tick (0.5s)
  backgroundAttentionIntervalTicks: 10, // unselected labels: every 10 ticks (5s)
};
