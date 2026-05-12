// Sim travel constants — flight speed, phase durations, boundary math.
// Changes here affect how ships move, not just how they look.

export const shipTravel = {
  globalSpeed: 1.0,
  baseFlightSpeed: 25, // pixels/second before globalSpeed and nation speed
  accelerationDurationSeconds: 5.0, // take-off phase length
  dockingDurationSeconds: 5.0, // docking phase length
  stationProximityMultiplier: 3, // accel/docking zone = this × station radius
};

/** Orbit-phase endpoint distance from station center. Sim uses it as a coarse
 *  stand-in so same-station orbit↔surface flights never have zero distance
 *  (which would NaN out heading/progress math). Render uses the same value as
 *  the flight→orbit landing backoff. Both sides must agree or the handoff jumps. */
export const ORBIT_APPROACH_RADIUS = 80;
