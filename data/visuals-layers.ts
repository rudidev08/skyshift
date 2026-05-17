/**
 * Draw order for game objects during gameplay and overview
 * mode — stars, nebulas, trade routes, ships, stations, selection ring. Every
 * `.setDepth(...)` caller imports from here so layer ordering is editable in
 * one place. Higher value renders on top; entries below are listed back to
 * front.
 */
export const Layer = {
  BackgroundStarsFar: 1,
  BackgroundStarsNear: 2,
  NebulaOvergrowth: 3,
  NebulaDark: 4,
  NebulaLight: 5,
  TradeRouteLines: 6,
  TradeRouteRings: 7,
  SectorGrid: 8,
  AmbientTraffic: 9,
  ShipEngine: 10,
  ShipTrail: 11,
  TradeRouteLabelBackground: 12,
  TradeRouteLabelText: 13,
  StationBase: 14,
  InventoryLabel: 15,
  ShipSprite: 16,
  StationLabel: 17,
  StationStatusBadge: 18,
  ShipCargoRing: 19,
  SelectionRing: 20,
} as const;
