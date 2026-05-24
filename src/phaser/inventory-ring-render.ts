import { inventoryRingVisuals } from "../../data/station-visuals";

const {
  segmentWidth: SEGMENT_WIDTH,
  segmentWidthSelected: SEGMENT_WIDTH_SELECTED,
  gapAngleRadians: GAP_ANGLE_RADIANS,
  segmentColor: SEGMENT_COLOR,
  segmentFillColor: SEGMENT_FILL_COLOR,
} = inventoryRingVisuals;

export interface WareInventoryArc {
  startAngle: number;
  endAngle: number;
}

type FillDirection = "center" | "start" | "end";

export interface InventoryRingSlot {
  current: number;
  max: number;
}

// Hand-tuned slot positions — the produced ware's slot favors top/right so the eye finds it first.
const layoutsBySlotCount: WareInventoryArc[][] = [
  [],
  // 1 slot: full ring with one bottom gap
  [
    {
      startAngle: Math.PI / 2 + GAP_ANGLE_RADIANS / 2,
      endAngle: (Math.PI * 5) / 2 - GAP_ANGLE_RADIANS / 2,
    },
  ],
  // 2 slots: right (produced ware preferred) + left
  [
    {
      startAngle: -Math.PI / 2 + GAP_ANGLE_RADIANS / 2,
      endAngle: Math.PI / 2 - GAP_ANGLE_RADIANS / 2,
    },
    {
      startAngle: Math.PI / 2 + GAP_ANGLE_RADIANS / 2,
      endAngle: (Math.PI * 3) / 2 - GAP_ANGLE_RADIANS / 2,
    },
  ],
  // 3 slots: top (output preferred, center-filled) + bottom-left + bottom-right
  [
    {
      startAngle: -Math.PI / 2 - (Math.PI / 3 - GAP_ANGLE_RADIANS / 2),
      endAngle: -Math.PI / 2 + (Math.PI / 3 - GAP_ANGLE_RADIANS / 2),
    },
    {
      startAngle: -Math.PI / 2 + Math.PI / 3 + GAP_ANGLE_RADIANS / 2,
      endAngle: -Math.PI / 2 + Math.PI - GAP_ANGLE_RADIANS / 2,
    },
    {
      startAngle: -Math.PI / 2 + Math.PI + GAP_ANGLE_RADIANS / 2,
      endAngle: -Math.PI / 2 + (5 * Math.PI) / 3 - GAP_ANGLE_RADIANS / 2,
    },
  ],
];

/** The slots to draw on a station's inventory ring: the real slots, or a single
 *  empty placeholder so a no-inventory station (generational ship) shows one
 *  segment with a "No Wares" label instead of a blank circle. */
export function displaySlotsForRing(
  slots: readonly InventoryRingSlot[],
): readonly InventoryRingSlot[] {
  return slots.length === 0 ? [{ current: 0, max: 1 }] : slots;
}

export function getSegmentArcsForSlotCount(slotCount: number): WareInventoryArc[] {
  return layoutsBySlotCount[slotCount] ?? layoutsBySlotCount[3];
}

/** Pairs each slot with where its fill anchors so adjacent segments grow from the same gap and stay visually linked as inventory rises. */
function getFillDirectionsForSlotCount(slotCount: number): FillDirection[] {
  if (slotCount === 1) return ["center"];
  if (slotCount === 2) return ["end", "start"];
  return ["center", "start", "end"];
}

interface RingTarget {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  radius: number;
}

export interface InventoryRingDrawRequest {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  radius: number;
  slots: readonly InventoryRingSlot[];
  arcs: WareInventoryArc[];
  alpha: number;
  selected: boolean;
}

function strokeArc(target: RingTarget, startAngle: number, endAngle: number) {
  target.graphics.beginPath();
  target.graphics.arc(target.x, target.y, target.radius, startAngle, endAngle);
  target.graphics.strokePath();
}

interface SegmentDrawRequest {
  target: RingTarget;
  arc: WareInventoryArc;
  slot: InventoryRingSlot;
  fillFrom: FillDirection;
  width: number;
  alpha: number;
}

function drawSegment(request: SegmentDrawRequest) {
  const { target, arc, slot, fillFrom, width, alpha } = request;
  const fillRatio = slot.max > 0 ? slot.current / slot.max : 0;
  const totalArc = arc.endAngle - arc.startAngle;

  target.graphics.lineStyle(width, SEGMENT_COLOR, alpha);
  strokeArc(target, arc.startAngle, arc.endAngle);

  if (fillRatio > 0) {
    target.graphics.lineStyle(width, SEGMENT_FILL_COLOR, alpha);
    let fillStart: number;
    let fillEnd: number;
    if (fillFrom === "center") {
      const midAngle = (arc.startAngle + arc.endAngle) / 2;
      const halfFillArc = (totalArc * fillRatio) / 2;
      fillStart = midAngle - halfFillArc;
      fillEnd = midAngle + halfFillArc;
    } else if (fillFrom === "start") {
      fillStart = arc.startAngle;
      fillEnd = arc.startAngle + totalArc * fillRatio;
    } else {
      fillStart = arc.endAngle - totalArc * fillRatio;
      fillEnd = arc.endAngle;
    }
    strokeArc(target, fillStart, fillEnd);
  }
}

export function drawInventorySegments(request: InventoryRingDrawRequest) {
  const { graphics, x, y, radius, slots, arcs, alpha, selected } = request;
  const target: RingTarget = { graphics, x, y, radius };
  const width = selected ? SEGMENT_WIDTH_SELECTED : SEGMENT_WIDTH;
  const fillDirections = getFillDirectionsForSlotCount(arcs.length);
  for (let i = 0; i < arcs.length; i++) {
    drawSegment({
      target,
      arc: arcs[i],
      slot: slots[i],
      fillFrom: fillDirections[i],
      width,
      alpha,
    });
  }
}
