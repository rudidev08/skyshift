// Speed-cycle metadata — shared by time-controls (simulation rate) and the
// paused-indicator HUD pill.

/** Running speeds the cycle button rotates through. The first entry doubles
 *  as the default speed used on fresh boots / invalid scales. */
export const SPEED_CYCLE = [1, 2, 5] as const;

export type CycleSpeed = (typeof SPEED_CYCLE)[number];
