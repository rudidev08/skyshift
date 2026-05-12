import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { isSimPaused, pauseSim, resumeSim, setExtendedAllowedSpeeds, setupTimeControls } from "../phaser/time-controls.ts";

function withFakeDocument(run: () => void): void {
  const globalObject = globalThis as unknown as { document?: unknown };
  const previousDocument = globalObject.document;
  globalObject.document = {
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  try {
    run();
  } finally {
    if (previousDocument === undefined) Reflect.deleteProperty(globalObject, "document");
    else globalObject.document = previousDocument;
  }
}

interface FakeButton {
  id: string;
  click(): void;
  addEventListener(event: string, handler: () => void): void;
  removeEventListener(event: string, handler: () => void): void;
}

function buildFakeButton(id: string): FakeButton {
  const handlers = new Set<() => void>();
  return {
    id,
    click() {
      for (const handler of handlers) handler();
    },
    addEventListener(_event: string, handler: () => void) {
      handlers.add(handler);
    },
    removeEventListener(_event: string, handler: () => void) {
      handlers.delete(handler);
    },
  };
}

function withButtonDocument(buttons: FakeButton[], run: () => void): void {
  const globalObject = globalThis as unknown as { document?: unknown };
  const previousDocument = globalObject.document;
  const buttonById = new Map(buttons.map((button) => [button.id, button]));
  globalObject.document = {
    getElementById(id: string) {
      return buttonById.get(id) ?? null;
    },
    querySelectorAll() {
      return [];
    },
  };

  try {
    run();
  } finally {
    if (previousDocument === undefined) Reflect.deleteProperty(globalObject, "document");
    else globalObject.document = previousDocument;
  }
}

function buildFakeScene() {
  return {
    events: {
      once() {
        // Does nothing for tests that do not exercise Scene shutdown.
      },
    },
  };
}

test("time controls snap invalid running speeds to the closest supported value", () => {
  withFakeDocument(() => {
    let observedSpeed = -1;
    const controller = setupTimeControls(buildFakeScene() as never, (scale) => {
      observedSpeed = scale;
    });

    controller.setSpeed(4);
    assertEqual(controller.currentSpeed, 5, "4x snaps to 5x");
    assertEqual(observedSpeed, 5, "observer sees snapped 5x");

    controller.setSpeed(3);
    assertEqual(controller.currentSpeed, 2, "3x snaps to 2x");
    assertEqual(observedSpeed, 2, "observer sees snapped 2x");
  });
});

test("togglePause restores the previous running speed instead of pinning to 0", () => {
  withFakeDocument(() => {
    let observedSpeed = -1;
    const controller = setupTimeControls(buildFakeScene() as never, (scale) => {
      observedSpeed = scale;
    });

    // Pick a non-default running speed so we can tell the difference between
    // "stayed at 1x" and "restored from cache".
    controller.setSpeed(2);
    assertEqual(controller.currentSpeed, 2, "running at 2x before pause");

    // Pause via setSpeed(0) — the explicit pause state.
    controller.setSpeed(0);
    assertEqual(controller.currentSpeed, 0, "paused after setSpeed(0)");
    assertEqual(observedSpeed, 0, "observer sees pause");

    // Resume via togglePause — must come back to 2x, not 0 or default 1x.
    controller.togglePause();
    assertEqual(controller.currentSpeed, 2, "togglePause from paused restores 2x");
    assertEqual(observedSpeed, 2, "observer sees the restored 2x");

    // Pause again via togglePause — must drop back to 0.
    controller.togglePause();
    assertEqual(controller.currentSpeed, 0, "togglePause from running pauses to 0");
  });
});

test("togglePause from 1x resumes at 1x, not the prior higher speed", () => {
  withFakeDocument(() => {
    const controller = setupTimeControls(buildFakeScene() as never, () => {});

    // Visit 2x first so any "remember the highest, not the latest" mistake
    // would leave lastUnpausedSpeed at 2.
    controller.setSpeed(2);
    assertEqual(controller.currentSpeed, 2, "ran at 2x");

    // Drop back to 1x. Pin: setSpeed(1) must update lastUnpausedSpeed to 1.
    // A `> 1` boundary on the lastUnpausedSpeed assignment would skip this
    // update, leaving the cached unpause target at 2.
    controller.setSpeed(1);
    assertEqual(controller.currentSpeed, 1, "ran at 1x");

    controller.togglePause();
    assertEqual(controller.currentSpeed, 0, "paused from 1x");
    controller.togglePause();
    assertEqual(controller.currentSpeed, 1, "resume restores 1x, not the earlier 2x");
  });
});

test("setSpeed is idempotent — repeating the current speed does not refire onSpeedChange", () => {
  withFakeDocument(() => {
    let observerCallCount = 0;
    const controller = setupTimeControls(buildFakeScene() as never, () => {
      observerCallCount++;
    });

    controller.setSpeed(2);
    const callsAfterFirst = observerCallCount;
    // Pin the no-op short-circuit. Removing `if (normalizedScale === currentSpeed) return`
    // would re-fire onSpeedChange (and any other observers) on every redundant setSpeed call.
    controller.setSpeed(2);
    controller.setSpeed(2);
    assertEqual(observerCallCount, callsAfterFirst, "redundant setSpeed calls do not refire the observer");
  });
});

test("normalizeSpeed prefers the lower speed on tied distances", () => {
  withFakeDocument(() => {
    const controller = setupTimeControls(buildFakeScene() as never, () => {});

    // 1.5 is exactly between 1x and 2x — tie should resolve to the lower one.
    controller.setSpeed(1.5);
    assertEqual(controller.currentSpeed, 1, "1.5 ties between 1x and 2x, snaps to lower");
  });
});

test("pause button click toggles between paused and the last running speed", () => {
  const pauseButton = buildFakeButton("speed-pause-btn");
  const cycleButton = buildFakeButton("speed-cycle-btn");
  withButtonDocument([pauseButton, cycleButton], () => {
    let observedSpeed = -1;
    const controller = setupTimeControls(buildFakeScene() as never, (scale) => {
      observedSpeed = scale;
    });

    controller.setSpeed(2);
    assertEqual(controller.currentSpeed, 2, "running at 2x before pause click");

    pauseButton.click();
    assertEqual(controller.currentSpeed, 0, "pause click pauses sim");
    assertEqual(observedSpeed, 0, "observer sees pause click");

    pauseButton.click();
    assertEqual(controller.currentSpeed, 2, "second pause click restores 2x");
    assertEqual(observedSpeed, 2, "observer sees restored 2x");
  });
});

test("cycle button steps through speeds and resumes from pause without bumping speed", () => {
  const pauseButton = buildFakeButton("speed-pause-btn");
  const cycleButton = buildFakeButton("speed-cycle-btn");
  withButtonDocument([pauseButton, cycleButton], () => {
    const controller = setupTimeControls(buildFakeScene() as never, () => {});

    assertEqual(controller.currentSpeed, 1, "starts at 1x");
    cycleButton.click();
    assertEqual(controller.currentSpeed, 2, "1x cycles to 2x");
    cycleButton.click();
    assertEqual(controller.currentSpeed, 5, "2x cycles to 5x");
    cycleButton.click();
    assertEqual(controller.currentSpeed, 1, "5x wraps to 1x");

    // Pause from 5x then cycle: first cycle click should resume at 5x, not
    // advance the cycle. Starting at 5x specifically distinguishes "resume
    // from pause" (5x) from "advance from cycle index 0" (2x).
    cycleButton.click();
    cycleButton.click();
    assertEqual(controller.currentSpeed, 5, "pre-pause: at 5x");
    pauseButton.click();
    assertEqual(controller.currentSpeed, 0, "paused from 5x");
    cycleButton.click();
    assertEqual(controller.currentSpeed, 5, "first cycle click after pause resumes 5x");
  });
});

test("pauseSim / resumeSim / isSimPaused bridge external pause callers to the time controller", () => {
  withFakeDocument(() => {
    let observedSpeed = -1;
    const controller = setupTimeControls(buildFakeScene() as never, (scale) => {
      observedSpeed = scale;
    });

    controller.setSpeed(2);
    assertTrue(!isSimPaused(), "isSimPaused false while running");

    // Pin pauseSim's running-only guard. Mutating `if (currentSpeed === 0) return`
    // to `!== 0` would invert the guard, leaving the running sim unpaused.
    pauseSim();
    assertEqual(controller.currentSpeed, 0, "pauseSim drops the controller speed to 0");
    assertEqual(observedSpeed, 0, "pauseSim fires the registered onSpeedChange");
    assertTrue(isSimPaused(), "isSimPaused true after pauseSim");

    // Pin resumeSim's paused-only guard. Mutating `!== 0` to `=== 0` would
    // invert the guard so resumeSim never restores the prior speed.
    resumeSim();
    assertEqual(controller.currentSpeed, 2, "resumeSim restores the prior running speed");
    assertEqual(observedSpeed, 2, "resumeSim fires the registered onSpeedChange");
    assertTrue(!isSimPaused(), "isSimPaused false after resumeSim");

    // Pin pauseSim's no-op-when-paused branch. A second pauseSim must not
    // re-fire onSpeedChange — observedSpeed stays at 2 here only because
    // the early return blocks the second 0-applySpeed, and the cached
    // current=0 guard further blocks duplicate applies.
    pauseSim();
    pauseSim();
    assertEqual(controller.currentSpeed, 0, "double pauseSim leaves controller paused");
  });
});

test("cycle button from a devmode-extended speed enters the cycle at index 1, not 0", () => {
  const pauseButton = buildFakeButton("speed-pause-btn");
  const cycleButton = buildFakeButton("speed-cycle-btn");
  withButtonDocument([pauseButton, cycleButton], () => {
    setExtendedAllowedSpeeds([20]);
    const controller = setupTimeControls(buildFakeScene() as never, () => {});

    // 20x is registered as allowed (not in SPEED_CYCLE) — devmode buttons jump
    // straight here. The cycle button must still produce a cycle-internal next
    // value rather than re-snapping to 1x.
    controller.setSpeed(20);
    assertEqual(controller.currentSpeed, 20, "extended speed accepted as running speed");

    // Pin Math.max(0, indexOf(...)) clamp. Without the clamp, indexOf(20) = -1
    // and next = SPEED_CYCLE[(-1 + 1) % 3] = SPEED_CYCLE[0] = 1; clamp forces
    // index 0, so next = SPEED_CYCLE[1] = 2.
    cycleButton.click();
    assertEqual(controller.currentSpeed, 2, "cycle from extended speed advances to SPEED_CYCLE[1] (2x), not SPEED_CYCLE[0] (1x)");

    // Reset for the rest of the suite — leaving 20x in allowedSpeeds would let
    // later setSpeed(20) calls succeed where they should snap.
    setExtendedAllowedSpeeds([]);
  });
});
