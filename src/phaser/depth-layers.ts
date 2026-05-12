/**
 * Phaser depth registry — every `.setDepth(...)` caller imports from here so layer
 * ordering is editable in one place. Higher value renders on top; entries below are
 * listed back to front.
 */
export const Layer = {
  BackgroundStarsFar: -2,
  BackgroundStarsNear: -1,
  NebulaDark: -0.75,
  NebulaLight: -0.5,
  TradeRouteLines: -0.3,
  TradeRouteRings: -0.25,
  Grid: -0.1,
  AmbientTraffic: 0.1,
  ShipEngine: 0.2,
  ShipTrail: 0.25,
  TradeRouteLabels: 0.3,
  StationBase: 0.5,
  InventoryLabel: 1,
  ShipSprite: 2,
  StationLabel: 2,
  StationSerial: 2.1,
  ShipCargoRing: 5,
  SelectionRing: 10,
} as const;
