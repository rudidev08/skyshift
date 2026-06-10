import { test, assertEqual } from "./test-utils.ts";
import { createInventorySlot } from "../sim-station.ts";
import { effectiveAvailable, effectiveSpace, effectiveFillPercent } from "../sim-trade-decision.ts";
import { ice } from "../../data/wares.ts";

// --- Effective inventory helpers ---

test("effectiveAvailable clamps to zero", () => {
  const slot = createInventorySlot(ice, 10, 500);
  slot.reservedOutgoing = 50;
  assertEqual(effectiveAvailable(slot), 0);
});

test("effectiveSpace clamps to zero", () => {
  const slot = createInventorySlot(ice, 400, 500);
  slot.reservedIncoming = 200;
  assertEqual(effectiveSpace(slot), 0);
});

test("effectiveFillPercent returns 1 for zero-max slot", () => {
  const slot = createInventorySlot(ice, 0, 0);
  assertEqual(effectiveFillPercent(slot), 1);
});

test("effectiveFillPercent counts en-route deliveries as fill (reservedIncoming raises it)", () => {
  // Pin the `+ slot.reservedIncoming` term. A `+ → -` mutation flips the sign,
  // so a slot half-full with a pending delivery on top would read as nearly
  // empty (high buy-demand) and ships would pile more deliveries onto a slot
  // that's already spoken-for. With `+`, current 300 + reservedIncoming 100
  // over max 500 = 0.8 (vs 0.6 from current alone); `-` would give 0.4.
  const slot = createInventorySlot(ice, 300, 500);
  slot.reservedIncoming = 100;
  assertEqual(effectiveFillPercent(slot), 0.8, "fill includes en-route cargo, not net of it");
});
