import { test, assertEqual } from "./test-utils.ts";
import { createGameViewModeController, type GameViewMode } from "../game-view-mode.ts";

test("onViewModeChange listener receives exactly one argument (the new mode)", () => {
  // Guard for item 8 — the listener signature is `(mode) => void`, not
  // `(mode, previous) => void`. Under the OLD behavior `captured.length`
  // would be 2 and `captured[1]` would be the prior mode ("normal").
  const controller = createGameViewModeController("normal");
  let captured: GameViewMode[] = [];
  controller.onViewModeChange((...args) => {
    captured = args;
  });

  controller.setViewMode("zones");

  assertEqual(captured.length, 1, "listener called with exactly one argument");
  assertEqual(captured[0], "zones", "the single argument is the new mode");
});
