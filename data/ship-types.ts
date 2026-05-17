import type { WareId } from "./ware-types";

/** The four ship classes. The id is the stable key used in data/ships.ts and saved games. */
export type ShipTypeId = "tanker" | "trader" | "seedhaul" | "jumpship";

/** Static definition of one ship class — cargo, speed, allowed wares, and hull/trail render shape. Catalog in data/ships.ts; runtime ships are the Ship type. */
export type ShipTypeTemplate = {
  id: ShipTypeId;
  /** Player-facing class label — shown in the ship's HUD lore overlay and spoken by the announcer. */
  name: string;
  /** Most units of a single ware the ship can carry per trade leg; also the denominator of the cargo-fill ring. */
  cargoCapacity: number;
  /** Travel speed — higher means shorter flight times. Relative scalar, not map units. */
  speed: number;
  allowedWares: WareId[];
  /** Scales engine-trail thickness relative to the base trail width. */
  trailWidthMultiplier: number;
  /** Scales engine-trail opacity while the ship is leaving a station. */
  trailDepartureAlphaMultiplier: number;
  /** Scales engine-trail opacity while the ship is approaching a station. */
  trailArrivalAlphaMultiplier: number;
  /** Nose width — 1 keeps the hull full width, 0 narrows it to a sharp point. */
  taperFront: number;
  /** Stern width — 1 keeps the hull full width, 0 narrows it to a sharp point. */
  taperBack: number;
  /** Bezier bulge on front half — 0 straight, positive convex (pod), negative concave. */
  taperFrontCurve: number;
  /** Bezier bulge on back half — 0 straight, positive convex (pod), negative concave. */
  taperBackCurve: number;
  /** Each flight bows sideways by a random angle; this is the smallest bend, in degrees. */
  flightPathCurveAngleMinDegrees: number;
  /** Largest sideways bend, in degrees; a narrow min–max range looks like a near-straight flight. */
  flightPathCurveAngleMaxDegrees: number;
  /** Flavor text shown in the ship's HUD lore overlay. */
  lore: string;
};
