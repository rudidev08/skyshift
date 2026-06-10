import { test, assertEqual } from "./test-utils.ts";
import {
  StationZoneSelectionTarget,
  type StationZoneVisualBundle,
} from "../phaser/station-zone-render.ts";
import { createGameViewModeController } from "../game-view-mode.ts";

// canSelect() reads the isZonesViewActive getter and the occupiedByStation
// flag — the other bundle fields are untouched on that path, so an
// unclaimed-only stub is enough here.
const stubBundle = { occupiedByStation: false } as StationZoneVisualBundle;

test("zone canSelect() tracks getViewMode() across mode switches with no explicit ref priming", () => {
  // Guard for item 9 — the target derives selectability from the view-mode
  // controller, not a separately-primed { value: boolean } ref. Switching the
  // controller's mode away from "zones" and back must flip canSelect() with no
  // intervening priming step. Under the OLD behavior the constructor took a
  // stored ref that stayed stale unless a writer set it, so this would not
  // even compile (different constructor signature) and the consistency this
  // asserts was a manual obligation rather than a derived fact.
  const controller = createGameViewModeController("normal");
  const target = new StationZoneSelectionTarget(
    stubBundle,
    () => controller.getViewMode() === "zones",
  );

  assertEqual(target.canSelect(), false, "not selectable in normal view");

  controller.setViewMode("zones");
  assertEqual(target.canSelect(), true, "selectable once the controller enters zones view");

  controller.setViewMode("overview");
  assertEqual(target.canSelect(), false, "not selectable after leaving zones view");

  controller.setViewMode("zones");
  assertEqual(target.canSelect(), true, "selectable again on returning to zones view");
});
