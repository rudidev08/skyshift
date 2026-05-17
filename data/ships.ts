import type { ShipTypeTemplate } from "./ship-types";
import * as shipLore from "./strings-ships";

// heavy and slow ship, made for raw materials
export const tanker: ShipTypeTemplate = {
  id: "tanker",
  name: "Tanker",
  cargoCapacity: 10000,
  speed: 0.8,
  allowedWares: ["ice", "mineral", "water", "metal", "hulls"],
  trailWidthMultiplier: 2,
  trailDepartureAlphaMultiplier: 1,
  trailArrivalAlphaMultiplier: 1,
  taperFront: 0.7,
  taperBack: 1.0,
  taperFrontCurve: 0,
  taperBackCurve: 0,
  flightPathCurveAngleMinDegrees: 8,
  flightPathCurveAngleMaxDegrees: 40,
  lore: shipLore.TANKER,
};

// jack of all trades, common trader ship
export const trader: ShipTypeTemplate = {
  id: "trader",
  name: "Trader",
  cargoCapacity: 2500,
  speed: 3.5,
  allowedWares: ["water", "metal", "food", "medicine", "tech", "provisions", "hulls"],
  trailWidthMultiplier: 1,
  trailDepartureAlphaMultiplier: 1,
  trailArrivalAlphaMultiplier: 1,
  taperFront: 0.3,
  taperBack: 0.55,
  taperFrontCurve: 0,
  taperBackCurve: 0,
  flightPathCurveAngleMinDegrees: 4,
  flightPathCurveAngleMaxDegrees: 12,
  lore: shipLore.TRADER,
};

// bio-ship, organic trader
export const seedhaul: ShipTypeTemplate = {
  id: "seedhaul",
  name: "Seedhaul",
  cargoCapacity: 4000,
  speed: 2.0,
  allowedWares: ["ice", "water", "food", "medicine", "provisions"],
  trailWidthMultiplier: 2.5,
  trailDepartureAlphaMultiplier: 1.5,
  trailArrivalAlphaMultiplier: 0.7,
  taperFront: 0.1,
  taperBack: 0.2,
  taperFrontCurve: 0.6,
  taperBackCurve: 0.6,
  flightPathCurveAngleMinDegrees: 5,
  flightPathCurveAngleMaxDegrees: 15,
  lore: shipLore.SEEDHAUL,
};

// sleek, high-tech, extremely fast, low cargo
export const jumpship: ShipTypeTemplate = {
  id: "jumpship",
  name: "Jumpship",
  cargoCapacity: 2000,
  speed: 20,
  allowedWares: ["signal", "hyperdata"],
  trailWidthMultiplier: 3,
  trailDepartureAlphaMultiplier: 2,
  trailArrivalAlphaMultiplier: 1.25,
  taperFront: 0.1,
  taperBack: 0.1,
  taperFrontCurve: -0.2,
  taperBackCurve: -0.2,
  flightPathCurveAngleMinDegrees: 3,
  flightPathCurveAngleMaxDegrees: 6,
  lore: shipLore.JUMPSHIP,
};

export const allShips: ShipTypeTemplate[] = [tanker, trader, seedhaul, jumpship];
