// Speed game can run in — shared by time-controls (simulation rate) and the
// paused-indicator HUD pill.

/** Running speeds the cycle button rotates through. The first entry doubles
 *  as the default speed used on fresh boots / invalid scales. */
export const speedCycle = [1, 2, 5] as const;

export type CycleSpeed = (typeof speedCycle)[number];
