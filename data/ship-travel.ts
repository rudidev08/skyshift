// Changes here affect how ships move, not just how they look.

export const shipTravel = {
  globalSpeed: 1.0,
  baseFlightSpeedPixelsPerSecond: 25, // before globalSpeed and per-ship speed multiplier
  accelerationDurationSeconds: 5.0,
  dockingDurationSeconds: 5.0,
  stationProximityZoneRadiusMultiplier: 3, // accel/docking zone = this × station body radius
  orbitApproachZonePixels: 20, // accel/docking zone when departing or arriving at orbit (no station body to scale against)
};

/** Orbit-phase endpoint distance from station center. Sim uses it as a coarse
 *  stand-in so same-station orbit↔surface flights never have zero distance
 *  (which would NaN out heading/progress math). Render uses the same value as
 *  the flight→orbit landing backoff. Both sides must agree or the handoff jumps. */
export const orbitApproachRadiusPixels = 80;
