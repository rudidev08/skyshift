// Trail appearance, ring pulse, flight scale tween targets.

export const shipVisuals = {
  trailWidth: 3,
  trailDepartureAlpha: 0.05, // Dim end of the gradient.
  trailArrivalAlpha: 0.5, // Bright end of the gradient.
  trailSegmentsPerSecond: 10,
  trailFadeSeconds: 3.0, // Applied once after arrival.
  takeoffScale: 0.1,
  landingScale: 0.1,
  normalScale: 1.0,
  ringPulseInitialRadius: 5,
  ringPulseFinalRadius: 128,
  ringPulseStrokeWidth: 3,
  ringPulseDurationMilliseconds: 1000,
};

/** Per-ship orbit tuning — each orbiter gets a random angle, a rotation speed
 *  in [speedMin, speedMax] rad/s (random sign), and a base radius offset by
 *  station slot index so orbits don't overlap. */
export const shipOrbitVisuals = {
  speedMin: 0.15,
  speedMax: 0.3,
  radiusMin: 65,
  radiusSpacing: 25,
};
