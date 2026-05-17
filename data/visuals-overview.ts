// Visible only in overview mode (the zoomed-out trade map toggled from the
// HUD): the trade-route overlay drawn over the map. Sizes, colors, alphas,
// and label geometry for the map-space lines/rings/arrows that
// `src/phaser/overview-trade-render.ts` draws.

export const overviewTradeVisuals = {
  // Map units: distance from station center where lines begin (and the
  // station ring is drawn at this radius).
  endpointPad: 44,
  stationRingStroke: 12,
  lineStroke: 10,
  // Spacing between parallel per-ware lines on the same route, as a multiple
  // of lineStroke.
  lineGapMultiplier: 1.6,
  // Ring color — a hair above pure ink bg.
  neutralRingRgb: 0x14171f,
  // Baseline gray for every route — readable without carrying per-ware color,
  // so the accent overlay can pick out the selected ware on top.
  baselineLineRgb: 0x4a5060,
  // When a ware is selected, the gray lines that don't carry it fade to this
  // fraction of their normal alpha so the green selected-ware lines stand out.
  baselineDimMultiplier: 0.22,
  // --accent (green) from ui.css.
  accentRgb: 0x87d186,
  selectedRingAlpha: 1.0,
  // Both baseline and accent lines use an asymmetric alpha gradient to encode
  // trade direction: dim at the producer (origin), brightening into the
  // consumer (destination).
  gradientSegments: 8,
  lineAlphaProducer: 0.3,
  lineAlphaConsumer: 1.0,
  // Filled arrow head at the consumer end, pointing into the station ring.
  arrowHeadAlpha: 1.0,
  arrowLengthMultiplier: 4.8, // × lineStroke
  arrowHalfWidthMultiplier: 2.4, // × lineStroke
  // Trade-count labels match the sector-name font size so the map's two
  // readable-at-zoom-out text systems feel like one.
  tradeLabelFontPixels: 56,
  tradeLabelPadX: 18,
  tradeLabelPadY: 8,
  tradeLabelRadius: 14,
} as const;
