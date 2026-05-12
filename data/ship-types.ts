import type { WareId } from "./ware-types";

export type ShipTypeId = "tanker" | "trader" | "seedhaul" | "jumpship";

export type ShipTemplate = {
  id: ShipTypeId;
  name: string;
  cargoCapacity: number;
  speed: number;
  allowedWares: WareId[];
  trailWidthMultiplier: number;
  trailDepartureAlphaMultiplier: number;
  trailArrivalAlphaMultiplier: number;
  taperFront: number;
  taperBack: number;
  /** Bezier bulge on front half — 0 straight, positive convex (pod), negative concave. */
  taperFrontCurve: number;
  /** Bezier bulge on back half — 0 straight, positive convex (pod), negative concave. */
  taperBackCurve: number;
  flightPathCurveAngleMinDegrees: number;
  flightPathCurveAngleMaxDegrees: number;
  lore: string;
};
