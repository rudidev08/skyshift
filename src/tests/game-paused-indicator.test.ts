// Pins the cycle-pill icon mapping in createPausedIndicator. The
// `speedIcons` registry is `Record<CycleSpeed, string>` (total over 1|2|5),
// so the cycle icon for every cycle speed must be the registry entry and
// never the old `?? Play` fallback — that fallback only fired for an
// impossible (non-CycleSpeed) index. A regression that re-typed
// `lastCycleSpeed` loosely or reintroduced a Play fallback masking a
// missing registry key would show Play for a non-1 speed and fail here.

import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { createPausedIndicator } from "../ui-game-paused-indicator.ts";
import { speedIcons } from "../render-speed-icons.ts";
import { Play, FastForward, SkipForward } from "lucide-static";

interface FakeElement {
  innerHTML: string;
  textContent: string;
  title: string;
  dataset: Record<string, string>;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
  classList: { toggle(token: string, force?: boolean): void };
  toggleAttribute(name: string, force?: boolean): boolean;
}

function buildFakeElement(): FakeElement {
  return {
    innerHTML: "",
    textContent: "",
    title: "",
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { toggle() {} },
    toggleAttribute: () => false,
  };
}

/** Wire a #speed-hud tree the way universe.html lays it out so createPausedIndicator's selector chain resolves to real fake nodes. */
function buildFakeSpeedHud(): { root: FakeElement; cycleButtonIcon: FakeElement } {
  const pauseButtonIcon = buildFakeElement();
  const cycleButtonIcon = buildFakeElement();
  const cycleButtonText = buildFakeElement();

  const pauseButton = buildFakeElement();
  pauseButton.querySelector = (selector) =>
    selector === ".speed-pill__icon" ? pauseButtonIcon : null;

  const cycleButton = buildFakeElement();
  cycleButton.querySelector = (selector) => {
    if (selector === ".speed-pill__icon") return cycleButtonIcon;
    if (selector === ".speed-pill__text") return cycleButtonText;
    return null;
  };

  const speedHud = buildFakeElement();
  speedHud.querySelector = (selector) => {
    if (selector === "#speed-pause-btn") return pauseButton;
    if (selector === "#speed-cycle-btn") return cycleButton;
    return null;
  };

  const root = buildFakeElement();
  root.querySelector = (selector) => (selector === "#speed-hud" ? speedHud : null);
  return { root, cycleButtonIcon };
}

test("paused indicator: cycle icon is the registry entry for speed 2 / 5, never the Play fallback", () => {
  const { root, cycleButtonIcon } = buildFakeSpeedHud();
  const indicator = createPausedIndicator(root as unknown as ParentNode);

  indicator.setSpeed(2);
  assertEqual(cycleButtonIcon.innerHTML, speedIcons[2], "speed 2 shows the FastForward registry icon");
  assertTrue(cycleButtonIcon.innerHTML !== Play, "speed 2 never falls back to the Play glyph");

  indicator.setSpeed(5);
  assertEqual(cycleButtonIcon.innerHTML, speedIcons[5], "speed 5 shows the SkipForward registry icon");
  assertTrue(cycleButtonIcon.innerHTML !== Play, "speed 5 never falls back to the Play glyph");

  // Pausing keeps the last cycle speed's icon (so the user sees what they
  // resume to) — still the registry entry, never the Play fallback.
  indicator.setSpeed(0);
  assertEqual(cycleButtonIcon.innerHTML, speedIcons[5], "paused keeps the last cycle speed's registry icon");

  indicator.setSpeed(1);
  assertEqual(cycleButtonIcon.innerHTML, speedIcons[1], "speed 1 shows the Play registry icon (the legit speed-1 glyph)");
});

// Pin the registry's speed → icon mapping. Without this, swapping the two
// non-Play entries (speed 2 ↔ speed 5) would slip past the test above —
// assertions there compare against speedIcons[n] itself, so any mapping
// matches as long as setSpeed(n) reads speedIcons[n].
test("speed icon registry: 1 → Play, 2 → FastForward, 5 → SkipForward", () => {
  assertEqual(speedIcons[1], Play, "speed 1 is the Play glyph");
  assertEqual(speedIcons[2], FastForward, "speed 2 is the FastForward glyph");
  assertEqual(speedIcons[5], SkipForward, "speed 5 is the SkipForward glyph");
});
