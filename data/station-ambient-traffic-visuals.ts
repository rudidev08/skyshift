/** Tiny flavor dots flying between nearby stations. Pure visual, no sim dependency. Dots crossfade to a smaller radius when zoomed in past the station-detail band, so they don't compete with station icons. */
export const ambientTrafficConfig = {
  closestStationCount: 2, // each station connects to this many nearest neighbors
  distanceMultiplier: 0.7, // fraction of sectorSize for max route distance
  dotsPerRoute: [5, 3], // dots per route by neighbor rank — [closest, second-closest]
  dotSpeed: 11, // base pixels per second
  speedVariation: 0.35, // each dot's speed varies by ±35% of dotSpeed
  laneWidth: 12, // max perpendicular offset from the route (wider = more road-like)
  dotColor: 0xffffff,

  // Crossfade between these radii at the station detail zoom band (0.6–0.7).
  dotRadiusZoomedOut: 3,
  dotRadiusZoomedIn: 1.5,

  // Alpha range — dots fade between these values each pulse cycle.
  alphaMin: 0.15,
  alphaMax: 0.5,

  // Seconds per full pulse cycle (alphaMin → alphaMax → alphaMin). Each dot
  // gets a random duration in this range so they don't pulse in sync.
  pulseSecondsMin: 2, // fastest pulse
  pulseSecondsMax: 12, // slowest pulse

  // Decorative dots don't need 60fps. Existing graphics stay on screen between redraws.
  redrawsPerSecond: 12,
};
