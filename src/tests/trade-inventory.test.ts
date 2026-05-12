import { test, assertEqual } from "./test-utils.ts";
import { createInventorySlot as createSlot } from "../sim-station.ts";
import {
  effectiveAvailable,
  effectiveSpace,
  effectiveFillPercent,
} from "../sim-trade-decision.ts";
import { ice } from "../../data/wares.ts";

// --- Effective inventory helpers ---

test("effectiveAvailable clamps to zero", () => {
  const slot = createSlot(ice, 10, 500);
  slot.reservedOutgoing = 50;
  assertEqual(effectiveAvailable(slot), 0);
});

test("effectiveSpace clamps to zero", () => {
  const slot = createSlot(ice, 400, 500);
  slot.reservedIncoming = 200;
  assertEqual(effectiveSpace(slot), 0);
});

test("effectiveFillPercent returns 1 for zero-max slot", () => {
  const slot = createSlot(ice, 0, 0);
  assertEqual(effectiveFillPercent(slot), 1);
});
