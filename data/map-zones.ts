// Every possible station build zone. Presets in data/map-preset-*.ts pick which to prebuild;
// the rest stay empty for nations / the player to claim at runtime. Ids follow
// `<sector-id>-<n>` with stable numbering inside each sector.
import type { StationZoneTemplate } from "./station-zone-types";

export const zones: readonly StationZoneTemplate[] = [
  // ── abject-pride ──
  {
    id: "abject-pride-1",
    sectorId: "abject-pride",
    x: 3178,
    y: 1658,
    size: "M",
  },
  {
    id: "abject-pride-2",
    sectorId: "abject-pride",
    x: 4369,
    y: 1797,
    size: "S",
  },
  {
    id: "abject-pride-3",
    sectorId: "abject-pride",
    x: 3945,
    y: 1940,
    size: "S",
  },
  {
    id: "abject-pride-4",
    sectorId: "abject-pride",
    x: 3576,
    y: 2461,
    size: "M",
  },
  {
    id: "abject-pride-5",
    sectorId: "abject-pride",
    x: 4262,
    y: 2583,
    size: "S",
  },
  // ── blind-study ──
  { id: "blind-study-1", sectorId: "blind-study", x: 9577, y: 1646, size: "M" },
  {
    id: "blind-study-2",
    sectorId: "blind-study",
    x: 10060,
    y: 2642,
    size: "S",
  },
  { id: "blind-study-3", sectorId: "blind-study", x: 9142, y: 2665, size: "M" },
  // ── border-02 ──
  { id: "border-02-1", sectorId: "border-02", x: 4917, y: 1969, size: "L" },
  { id: "border-02-2", sectorId: "border-02", x: 4727, y: 2808, size: "M" },
  // ── border-03 ──
  { id: "border-03-1", sectorId: "border-03", x: 6600, y: 600, size: "S" },
  { id: "border-03-2", sectorId: "border-03", x: 6880, y: 810, size: "M" },
  { id: "border-03-3", sectorId: "border-03", x: 7318, y: 837, size: "M" },
  { id: "border-03-4", sectorId: "border-03", x: 6082, y: 1262, size: "S" },
  // ── border-05 ──
  { id: "border-05-1", sectorId: "border-05", x: 8702, y: 99, size: "L" },
  { id: "border-05-2", sectorId: "border-05", x: 8794, y: 926, size: "M" },
  // ── bright-towers ──
  {
    id: "bright-towers-1",
    sectorId: "bright-towers",
    x: 3150,
    y: 320,
    size: "S",
  },
  {
    id: "bright-towers-2",
    sectorId: "bright-towers",
    x: 3850,
    y: 420,
    size: "S",
  },
  {
    id: "bright-towers-3",
    sectorId: "bright-towers",
    x: 3494,
    y: 507,
    size: "M",
  },
  {
    id: "bright-towers-4",
    sectorId: "bright-towers",
    x: 3410,
    y: 837,
    size: "L",
  },
  {
    id: "bright-towers-5",
    sectorId: "bright-towers",
    x: 3708,
    y: 1034,
    size: "L",
  },
  {
    id: "bright-towers-6",
    sectorId: "bright-towers",
    x: 3984,
    y: 1480,
    size: "M",
  },
  // ── cartographers-rest ──
  {
    id: "cartographers-rest-1",
    sectorId: "cartographers-rest",
    x: 7371,
    y: 6865,
    size: "M",
  },
  {
    id: "cartographers-rest-2",
    sectorId: "cartographers-rest",
    x: 6501,
    y: 7314,
    size: "S",
  },
  // ── cautious-trails ──
  {
    id: "cautious-trails-1",
    sectorId: "cautious-trails",
    x: 8225,
    y: 1892,
    size: "L",
  },
  {
    id: "cautious-trails-2",
    sectorId: "cautious-trails",
    x: 8315,
    y: 2371,
    size: "M",
  },
  // ── cold-theory ──
  { id: "cold-theory-1", sectorId: "cold-theory", x: 8986, y: 3105, size: "M" },
  { id: "cold-theory-2", sectorId: "cold-theory", x: 8278, y: 3942, size: "L" },
  // ── crossroads ──
  { id: "crossroads-1", sectorId: "crossroads", x: 4600, y: 3956, size: "M" },
  { id: "crossroads-2", sectorId: "crossroads", x: 4535, y: 4421, size: "S" },
  // ── last-relay ──
  { id: "last-relay-1", sectorId: "last-relay", x: 9879, y: 647, size: "M" },
  { id: "last-relay-2", sectorId: "last-relay", x: 9400, y: 1000, size: "S" },
  // ── echo-hollow ──
  { id: "echo-hollow-1", sectorId: "echo-hollow", x: 315, y: 4703, size: "S" },
  { id: "echo-hollow-2", sectorId: "echo-hollow", x: 1250, y: 5081, size: "L" },
  { id: "echo-hollow-3", sectorId: "echo-hollow", x: 235, y: 5866, size: "M" },
  // ── gap-of-calamity ──
  {
    id: "gap-of-calamity-1",
    sectorId: "gap-of-calamity",
    x: 3635,
    y: 3506,
    size: "M",
  },
  {
    id: "gap-of-calamity-2",
    sectorId: "gap-of-calamity",
    x: 3169,
    y: 3783,
    size: "S",
  },
  {
    id: "gap-of-calamity-3",
    sectorId: "gap-of-calamity",
    x: 3959,
    y: 4436,
    size: "M",
  },
  // ── green-silence ──
  {
    id: "green-silence-1",
    sectorId: "green-silence",
    x: 2215,
    y: 1690,
    size: "L",
  },
  {
    id: "green-silence-2",
    sectorId: "green-silence",
    x: 2512,
    y: 1794,
    size: "S",
  },
  {
    id: "green-silence-3",
    sectorId: "green-silence",
    x: 2965,
    y: 1900,
    size: "M",
  },
  {
    id: "green-silence-4",
    sectorId: "green-silence",
    x: 2042,
    y: 2049,
    size: "M",
  },
  {
    id: "green-silence-5",
    sectorId: "green-silence",
    x: 2336,
    y: 2251,
    size: "M",
  },
  {
    id: "green-silence-6",
    sectorId: "green-silence",
    x: 2690,
    y: 2765,
    size: "S",
  },
  // ── hearth ──
  { id: "hearth-1", sectorId: "hearth", x: 7200, y: 1900, size: "L" },
  { id: "hearth-2", sectorId: "hearth", x: 7450, y: 1600, size: "M" },
  { id: "hearth-3", sectorId: "hearth", x: 6524, y: 1993, size: "L" },
  { id: "hearth-4", sectorId: "hearth", x: 6020, y: 2520, size: "S" },
  { id: "hearth-5", sectorId: "hearth", x: 6300, y: 2300, size: "S" },
  { id: "hearth-6", sectorId: "hearth", x: 6900, y: 2300, size: "L" },
  { id: "hearth-7", sectorId: "hearth", x: 6405, y: 2581, size: "M" },
  { id: "hearth-8", sectorId: "hearth", x: 7406, y: 2793, size: "S" },
  // ── idle-spark ──
  { id: "idle-spark-1", sectorId: "idle-spark", x: 7800, y: 7150, size: "S" },
  { id: "idle-spark-2", sectorId: "idle-spark", x: 8827, y: 7399, size: "S" },
  // ── long-decimal ──
  {
    id: "long-decimal-1",
    sectorId: "long-decimal",
    x: 9898,
    y: 6622,
    size: "S",
  },
  {
    id: "long-decimal-2",
    sectorId: "long-decimal",
    x: 9669,
    y: 7036,
    size: "S",
  },
  // ── new-logic ──
  { id: "new-logic-1", sectorId: "new-logic", x: 5006, y: 558, size: "S" },
  { id: "new-logic-2", sectorId: "new-logic", x: 5475, y: 650, size: "M" },
  { id: "new-logic-3", sectorId: "new-logic", x: 5050, y: 950, size: "M" },
  { id: "new-logic-4", sectorId: "new-logic", x: 5237, y: 1270, size: "L" },
  // ── not-here ──
  { id: "not-here-1", sectorId: "not-here", x: 9910, y: 5198, size: "M" },
  { id: "not-here-2", sectorId: "not-here", x: 9003, y: 5393, size: "S" },
  // ── old-frequency ──
  {
    id: "old-frequency-1",
    sectorId: "old-frequency",
    x: 2073,
    y: 6589,
    size: "S",
  },
  {
    id: "old-frequency-2",
    sectorId: "old-frequency",
    x: 2544,
    y: 7438,
    size: "S",
  },
  // ── older-furrow ──
  {
    id: "older-furrow-1",
    sectorId: "older-furrow",
    x: 878,
    y: 3023,
    size: "M",
  },
  {
    id: "older-furrow-2",
    sectorId: "older-furrow",
    x: 353,
    y: 3859,
    size: "S",
  },
  {
    id: "older-furrow-3",
    sectorId: "older-furrow",
    x: 1239,
    y: 4238,
    size: "L",
  },
  // ── overgrowth ──
  { id: "overgrowth-1", sectorId: "overgrowth", x: 2500, y: 1000, size: "L" },
  { id: "overgrowth-2", sectorId: "overgrowth", x: 1555, y: 1133, size: "M" },
  { id: "overgrowth-3", sectorId: "overgrowth", x: 2800, y: 700, size: "S" },
  { id: "overgrowth-4", sectorId: "overgrowth", x: 2813, y: 1458, size: "L" },
  { id: "overgrowth-5", sectorId: "overgrowth", x: 1930, y: 1469, size: "M" },
  // ── pale-anchor ──
  { id: "pale-anchor-1", sectorId: "pale-anchor", x: 4825, y: 5375, size: "M" },
  { id: "pale-anchor-2", sectorId: "pale-anchor", x: 5805, y: 5415, size: "S" },
  // ── pale-drift ──
  { id: "pale-drift-1", sectorId: "pale-drift", x: 1301, y: 6604, size: "S" },
  { id: "pale-drift-2", sectorId: "pale-drift", x: 3, y: 7193, size: "M" },
  // ── smooth-passage ──
  {
    id: "smooth-passage-1",
    sectorId: "smooth-passage",
    x: 3761,
    y: 6375,
    size: "S",
  },
  {
    id: "smooth-passage-2",
    sectorId: "smooth-passage",
    x: 4324,
    y: 7382,
    size: "M",
  },
  // ── soil ──
  { id: "soil-1", sectorId: "soil", x: 6400, y: 3400, size: "S" },
  { id: "soil-2", sectorId: "soil", x: 7061, y: 3548, size: "M" },
  { id: "soil-3", sectorId: "soil", x: 6649, y: 3746, size: "L" },
  { id: "soil-4", sectorId: "soil", x: 6278, y: 4104, size: "S" },
  { id: "soil-5", sectorId: "soil", x: 6321, y: 4487, size: "M" },
  // ── the-fallow ──
  { id: "the-fallow-1", sectorId: "the-fallow", x: 2900, y: 3400, size: "S" },
  { id: "the-fallow-2", sectorId: "the-fallow", x: 1759, y: 3868, size: "S" },
  { id: "the-fallow-3", sectorId: "the-fallow", x: 2886, y: 4395, size: "M" },
  // ── thin-veil ──
  { id: "thin-veil-1", sectorId: "thin-veil", x: 9766, y: 3092, size: "S" },
  { id: "thin-veil-2", sectorId: "thin-veil", x: 10259, y: 4109, size: "S" },
  { id: "thin-veil-3", sectorId: "thin-veil", x: 9965, y: 4372, size: "S" },
  // ── underleaf ──
  { id: "underleaf-1", sectorId: "underleaf", x: 1066, y: 763, size: "L" },
  { id: "underleaf-2", sectorId: "underleaf", x: 360, y: 842, size: "S" },
  { id: "underleaf-3", sectorId: "underleaf", x: 1382, y: 1477, size: "M" },
  // ── void-of-safety ──
  {
    id: "void-of-safety-1",
    sectorId: "void-of-safety",
    x: 5896,
    y: 6164,
    size: "S",
  },
  {
    id: "void-of-safety-2",
    sectorId: "void-of-safety",
    x: 5418,
    y: 6717,
    size: "L",
  },
  {
    id: "void-of-safety-3",
    sectorId: "void-of-safety",
    x: 5085,
    y: 7244,
    size: "M",
  },
  // ── void-of-silence ──
  {
    id: "void-of-silence-1",
    sectorId: "void-of-silence",
    x: 7051,
    y: 4543,
    size: "S",
  },
  {
    id: "void-of-silence-2",
    sectorId: "void-of-silence",
    x: 6447,
    y: 5930,
    size: "M",
  },
  // ── whisper-hold ──
  {
    id: "whisper-hold-1",
    sectorId: "whisper-hold",
    x: 381,
    y: 1520,
    size: "L",
  },
  {
    id: "whisper-hold-2",
    sectorId: "whisper-hold",
    x: 1285,
    y: 2152,
    size: "M",
  },
  { id: "whisper-hold-3", sectorId: "whisper-hold", x: 23, y: 2388, size: "S" },
];
