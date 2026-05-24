import type { Sector } from "../sim-map-types.ts";
import {
  buildSectorLabelText,
  createSectorGrid,
  resetAutoSectorGridState,
  updateSectorCorners,
  type SectorGrid,
} from "../phaser/sector-grid.ts";
import { sectorEnvironmentById } from "../../data/map-sector-environments.ts";
import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { makeSector } from "./factories.ts";
import { createMapBackedStorage } from "./local-storage-test-fixtures.ts";

class FakeGraphics {
  visible = false;
  alpha = 1;
  clearCalls = 0;

  setVisible(value: boolean): this {
    this.visible = value;
    return this;
  }

  setAlpha(value: number): this {
    this.alpha = value;
    return this;
  }

  clear(): this {
    this.clearCalls++;
    return this;
  }

  lineStyle(): this {
    return this;
  }

  moveTo(): this {
    return this;
  }

  lineTo(): this {
    return this;
  }

  strokePath(): this {
    return this;
  }
}

class FakeText {
  visible = false;
  alpha = 1;

  setVisible(value: boolean): this {
    this.visible = value;
    return this;
  }

  setAlpha(value: number): this {
    this.alpha = value;
    return this;
  }
}

function createFakeSectorGrid(): {
  corners: FakeGraphics;
  grid: FakeGraphics;
  sectorGrid: SectorGrid;
  sectorLabel: FakeText;
} {
  const grid = new FakeGraphics();
  const corners = new FakeGraphics();
  const sectorLabel = new FakeText();
  return {
    corners,
    grid,
    sectorGrid: {
      fadeState: {
        lastFade: 0,
        lastScrollTime: -1,
        lastScrollX: 0,
        lastScrollY: 0,
        scrollTracked: false,
      },
      grid: grid as unknown as Phaser.GameObjects.Graphics,
      corners: corners as unknown as Phaser.GameObjects.Graphics,
      sectorLabels: [sectorLabel as unknown as Phaser.GameObjects.Text],
      gridMode: "auto",
      setMode() {},
      onModeChange() {
        return () => {};
      },
    },
    sectorLabel,
  };
}

function createFakeCamera(scrollX = 0, scrollY = 0): Phaser.Cameras.Scene2D.Camera {
  return { scrollX, scrollY } as Phaser.Cameras.Scene2D.Camera;
}

const sectors: Sector[] = [
  makeSector({
    lore: "Sector used by the sector-grid regression tests.",
    x: 100,
    y: 100,
    size: 200,
  }),
];

/** Test-only fields the stubs expose so tests can assert visibility/alpha flips
 *  without coupling to Phaser's internal state. */
type TrackedGraphics = Phaser.GameObjects.Graphics & { _visible: boolean; _alpha: number };
type TrackedText = Phaser.GameObjects.Text & { _visible: boolean; _alpha: number };

type GraphicsStub = {
  _visible: boolean;
  _alpha: number;
  setDepth(): GraphicsStub;
  setVisible(value: boolean): GraphicsStub;
  setAlpha(value: number): GraphicsStub;
  clear(): GraphicsStub;
  lineStyle(): GraphicsStub;
  moveTo(): GraphicsStub;
  lineTo(): GraphicsStub;
  strokePath(): GraphicsStub;
};

type TextStub = {
  _visible: boolean;
  _alpha: number;
  setOrigin(): TextStub;
  setDepth(): TextStub;
  setLineSpacing(): TextStub;
  setVisible(value: boolean): TextStub;
  setAlpha(value: number): TextStub;
};

function createFakeGraphics(): GraphicsStub {
  const graphics: GraphicsStub = {
    _visible: true,
    _alpha: 1,
    setDepth() {
      return graphics;
    },
    setVisible(value: boolean) {
      graphics._visible = value;
      return graphics;
    },
    setAlpha(value: number) {
      graphics._alpha = value;
      return graphics;
    },
    clear() {
      return graphics;
    },
    lineStyle() {
      return graphics;
    },
    moveTo() {
      return graphics;
    },
    lineTo() {
      return graphics;
    },
    strokePath() {
      return graphics;
    },
  };
  return graphics;
}

function createFakeText(): TextStub {
  const text: TextStub = {
    _visible: true,
    _alpha: 1,
    setOrigin() {
      return text;
    },
    setDepth() {
      return text;
    },
    setLineSpacing() {
      return text;
    },
    setVisible(value: boolean) {
      text._visible = value;
      return text;
    },
    setAlpha(value: number) {
      text._alpha = value;
      return text;
    },
  };
  return text;
}

function createFakeScene(): Phaser.Scene {
  return {
    add: { graphics: createFakeGraphics, text: createFakeText },
  } as unknown as Phaser.Scene;
}

function withFakeLocalStorage(run: () => void): void {
  const globalObject = globalThis as unknown as { localStorage?: unknown };
  const previous = globalObject.localStorage;
  globalObject.localStorage = createMapBackedStorage().storage;
  try {
    run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalObject, "localStorage");
    else globalObject.localStorage = previous;
  }
}

test("buildSectorLabelText pins the exact label after the render-sector-header inline", () => {
  // The "<name> (<gridX>, <gridY>)" header was a single-consumer formatter in
  // the deleted render-sector-header.ts; it's now inlined here. Pin the exact
  // string both with and without an environment so the inline is provably
  // behavior-preserving at the one consumer.
  const withEnvironment = makeSector({
    name: "Underleaf",
    gridX: 3,
    gridY: 7,
    environment: "deep-space",
  });
  assertEqual(
    buildSectorLabelText(withEnvironment),
    `Underleaf (3, 7)\n${sectorEnvironmentById["deep-space"].name}`,
    "header line + environment line",
  );

  const withoutEnvironment = makeSector({
    name: "Underleaf",
    gridX: 3,
    gridY: 7,
    environment: "" as never,
  });
  assertEqual(
    buildSectorLabelText(withoutEnvironment),
    "Underleaf (3, 7)",
    "header line only when no environment",
  );
});

test("createSectorGrid parses persisted invalid gridMode strings back to 'auto'", () => {
  withFakeLocalStorage(() => {
    // Plant a corrupt persisted value so parseGridMode hits the fallback branch.
    (globalThis as unknown as { localStorage: Storage }).localStorage.setItem("sectorGridMode", "garbage");
    // Pin parseGridMode's fallback, now sourced from
    // uiPreferenceDefaults.sectorGridMode. Mutating that default to a mode that
    // hides the grid (e.g. "off") would silently blank the grid for users with
    // stale/corrupt localStorage from older builds.
    const sectorGrid = createSectorGrid(createFakeScene(), sectors, {
      gridSizeX: 1,
      gridSizeY: 1,
      sectorSize: 200,
    });
    assertEqual(sectorGrid.gridMode, "auto", "invalid persisted mode falls back to auto");
  });
});

test("createSectorGrid persists setMode to localStorage by default (persistMode omitted)", () => {
  withFakeLocalStorage(() => {
    // Pin the persistMode default. Mutating `options.persistMode ?? true` to
    // `?? false` would skip the savePreference call and leave localStorage
    // empty after setMode.
    const sectorGrid = createSectorGrid(
      createFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "auto" },
    );
    sectorGrid.setMode("on");
    const stored = (globalThis as unknown as { localStorage: Storage }).localStorage.getItem(
      "sectorGridMode",
    );
    assertEqual(stored, "on", "setMode persists the mode by default");
  });
});

test("createSectorGrid setMode emits to subscribers and does nothing on a same-mode call", () => {
  withFakeLocalStorage(() => {
    const sectorGrid = createSectorGrid(
      createFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "auto", persistMode: false },
    );

    const observed: string[] = [];
    const unsubscribe = sectorGrid.onModeChange((mode) => observed.push(mode));

    sectorGrid.setMode("on");
    sectorGrid.setMode("on"); // Pin same-mode call: setting the current mode must not re-emit.
    sectorGrid.setMode("off");
    unsubscribe();
    sectorGrid.setMode("auto"); // Pin unsubscribe: detached listener must not fire.

    assertEqual(observed.length, 2, "setMode emits exactly once per real change, never on a same-mode call");
    assertEqual(observed[0], "on", "first emission is the on-mode flip");
    assertEqual(observed[1], "off", "second emission is the off-mode flip");
    assertEqual(sectorGrid.gridMode, "auto", "later setMode still updates gridMode after unsubscribe");
  });
});

test("createSectorGrid setMode auto path resets the auto-fade state", () => {
  withFakeLocalStorage(() => {
    const sectorGrid = createSectorGrid(
      createFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "on", persistMode: false },
    );
    // Plant non-sentinel fade state so we can detect the reset.
    sectorGrid.fadeState.lastScrollTime = 9999;
    sectorGrid.fadeState.scrollTracked = true;
    sectorGrid.fadeState.lastFade = 0.5;

    // Pin the auto-mode dispatch branch. Mutating `if (mode === "off")` to
    // `if (mode === "auto")` would route the auto-mode call into the off-only
    // hide path, skipping resetAutoSectorGridState — lastScrollTime would stay
    // at 9999 instead of being restored to the -1 sentinel.
    sectorGrid.setMode("auto");
    assertEqual(sectorGrid.fadeState.lastScrollTime, -1, "auto mode resets lastScrollTime to the sentinel");
    assertEqual(sectorGrid.fadeState.lastFade, 0, "auto mode resets lastFade to 0");
  });
});

test("createSectorGrid setMode 'on' shows the grid + labels at full alpha", () => {
  withFakeLocalStorage(() => {
    const sectorGrid = createSectorGrid(
      createFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "off", persistMode: false },
    );

    // Pre-condition: off mode left grid hidden.
    assertTrue(!(sectorGrid.grid as unknown as TrackedGraphics)._visible, "off mode hides the grid");

    // Pin the on-mode visibility flip. Mutating `if (mode === "on")` to
    // `if (mode === "off")` would route on-mode through the off-mode hide path
    // and leave grid + labels hidden.
    sectorGrid.setMode("on");
    assertTrue((sectorGrid.grid as unknown as TrackedGraphics)._visible, "on mode reveals the grid");
    assertEqual((sectorGrid.grid as unknown as TrackedGraphics)._alpha, 1, "on mode pins grid alpha to 1");
    for (const label of sectorGrid.sectorLabels) {
      assertTrue((label as unknown as TrackedText)._visible, "on mode reveals each sector label");
      assertEqual((label as unknown as TrackedText)._alpha, 1, "on mode pins each label alpha to 1");
    }
  });
});

test("auto sector grid keeps the initial frame hidden until the camera moves", () => {
  const { sectorGrid, grid, sectorLabel } = createFakeSectorGrid();

  // Asymmetric non-zero baseline so the initial-frame X/Y assignment is observable.
  // Mutating the baseline to read camera.scrollY into lastScrollX (axis-swap on
  // the init path) would leave lastScrollX=200 instead of 80 here.
  updateSectorCorners(sectorGrid, sectors, createFakeCamera(80, 200));

  assertTrue(sectorGrid.fadeState.scrollTracked, "initial frame tracks the current camera position");
  assertEqual(sectorGrid.fadeState.lastScrollTime, -1, "initial frame does not count as a scroll");
  assertEqual(
    sectorGrid.fadeState.lastScrollX,
    80,
    "initial frame baselines lastScrollX from camera.scrollX",
  );
  assertEqual(
    sectorGrid.fadeState.lastScrollY,
    200,
    "initial frame baselines lastScrollY from camera.scrollY",
  );
  assertTrue(!grid.visible, "grid remains hidden before the first movement");
  assertTrue(!sectorLabel.visible, "sector label remains hidden before the first movement");
});

test("resetAutoSectorGridState clears visible auto-grid visuals until movement resumes", () => {
  const { corners, sectorGrid, grid, sectorLabel } = createFakeSectorGrid();
  grid.setVisible(true);
  sectorLabel.setVisible(true);
  sectorGrid.fadeState.lastFade = 1;
  // Fixed sentinel — performance.now() would make this clock-sensitive
  // (slow CI, paused scheduler) for no behavioural reason.
  sectorGrid.fadeState.lastScrollTime = 1000;
  sectorGrid.fadeState.scrollTracked = true;

  resetAutoSectorGridState(sectorGrid);

  assertEqual(sectorGrid.fadeState.lastFade, 0, "reset clears the last fade state");
  assertEqual(sectorGrid.fadeState.lastScrollTime, -1, "reset forgets the last scroll time");
  assertTrue(!grid.visible, "reset hides the grid immediately");
  assertTrue(!sectorLabel.visible, "reset hides labels immediately");
  assertTrue(corners.clearCalls > 0, "reset clears the corner graphics");
});

test("auto sector grid becomes visible after a real camera movement", () => {
  const { sectorGrid, grid, sectorLabel } = createFakeSectorGrid();
  const camera = createFakeCamera();

  updateSectorCorners(sectorGrid, sectors, camera);
  camera.scrollX = 24;
  camera.scrollY = 17;
  updateSectorCorners(sectorGrid, sectors, camera);

  assertTrue(grid.visible, "grid becomes visible after movement");
  assertEqual(grid.alpha, 1, "new movement starts at full opacity");
  assertTrue(sectorLabel.visible, "sector labels become visible after movement");
  assertTrue(sectorGrid.fadeState.lastScrollTime >= 0, "movement stores a scroll timestamp");
  // Asymmetric values catch any X/Y swap in the scroll-tracking assignment.
  assertEqual(sectorGrid.fadeState.lastScrollX, 24, "lastScrollX mirrors camera.scrollX");
  assertEqual(sectorGrid.fadeState.lastScrollY, 17, "lastScrollY mirrors camera.scrollY");
});

test("auto sector grid registers x-only camera movement", () => {
  const { sectorGrid, grid } = createFakeSectorGrid();
  const camera = createFakeCamera();

  updateSectorCorners(sectorGrid, sectors, camera);
  // Move only on X — Y stays at the baseline so the OR-tracker is exercised.
  camera.scrollX = 24;
  updateSectorCorners(sectorGrid, sectors, camera);

  assertTrue(grid.visible, "x-only movement still wakes the grid");
  assertTrue(sectorGrid.fadeState.lastScrollTime >= 0, "x-only movement updates lastScrollTime");
  assertEqual(sectorGrid.fadeState.lastScrollX, 24, "x-only movement updates lastScrollX");
});

test("auto sector grid registers y-only camera movement", () => {
  const { sectorGrid, grid } = createFakeSectorGrid();
  const camera = createFakeCamera();

  updateSectorCorners(sectorGrid, sectors, camera);
  // Move only on Y — X stays at the baseline so the OR-tracker is exercised.
  camera.scrollY = 17;
  updateSectorCorners(sectorGrid, sectors, camera);

  assertTrue(grid.visible, "y-only movement still wakes the grid");
  assertTrue(sectorGrid.fadeState.lastScrollTime >= 0, "y-only movement updates lastScrollTime");
  assertEqual(sectorGrid.fadeState.lastScrollY, 17, "y-only movement updates lastScrollY");
});

test("off mode short-circuits before drawing corners", () => {
  const { corners, sectorGrid, grid } = createFakeSectorGrid();
  sectorGrid.gridMode = "off";

  updateSectorCorners(sectorGrid, sectors, createFakeCamera(50, 50));

  // Pin the off-mode early return. Mutating "off" → "on" or removing the early
  // return would draw corners (clearCalls > 0) and force grid visible.
  assertEqual(corners.clearCalls, 0, "off-mode skips drawAllSectorCorners");
  assertTrue(!grid.visible, "off-mode never reveals the grid");
});

test("on mode pins fade at 1 and redraws corners every frame", () => {
  const { corners, sectorGrid } = createFakeSectorGrid();
  sectorGrid.gridMode = "on";

  updateSectorCorners(sectorGrid, sectors, createFakeCamera());

  // Pin the on-mode branch. Swapping the on/off check or dropping the
  // lastFade=1 + drawAllSectorCorners pair would skip the redraw and leave
  // lastFade at 0.
  assertEqual(sectorGrid.fadeState.lastFade, 1, "on-mode records fade=1");
  assertTrue(corners.clearCalls > 0, "on-mode redraws corners (clear precedes strokePath)");
});

function withFakePerformanceNow(run: (advance: (deltaMilliseconds: number) => void) => void): void {
  const originalNow = performance.now.bind(performance);
  let fakeNowMilliseconds = 1_000_000;
  performance.now = () => fakeNowMilliseconds;
  try {
    run((delta) => {
      fakeNowMilliseconds += delta;
    });
  } finally {
    performance.now = originalNow;
  }
}

test("auto sector grid fades from full opacity to hidden over the configured fade window", () => {
  withFakePerformanceNow((advance) => {
    const { corners, sectorGrid, grid, sectorLabel } = createFakeSectorGrid();
    const camera = createFakeCamera();

    // Frame 1: baseline. Frame 2: real movement, fade should be 1.
    updateSectorCorners(sectorGrid, sectors, camera);
    advance(16);
    camera.scrollX = 50;
    updateSectorCorners(sectorGrid, sectors, camera);
    assertEqual(grid.alpha, 1, "fresh movement holds full opacity");

    // Quarter into the fade-out window — alpha should drop from 1 toward 0.
    // 3000ms FADE_DELAY + 187ms (187ms / 750ms FADE_DURATION ≈ 0.25) gives expected ~0.75.
    // Pin the fade-window second branch. Mutating `elapsed < FADE_DELAY + FADE_DURATION`
    // to `>` would skip this branch and fall straight into the hide path, leaving alpha=1.
    // Pin the fade direction. Mutating `1 - (elapsed - FADE_DELAY) / FADE_DURATION` to
    // drop the `1 -` would invert the fade — alpha=0.25 at 25% would mean fade-IN, not fade-OUT.
    advance(3000 + 187);
    updateSectorCorners(sectorGrid, sectors, camera);
    assertTrue(grid.alpha > 0.5 && grid.alpha < 1, "quarter into fade-out, alpha closer to 1 than 0");
    assertTrue(grid.visible, "quarter into fade, grid still visible");

    // Past the fade-out window — grid hidden, lastFade reset to 0.
    // Pin the post-fade hide-once guard. Mutating `lastFade !== 0` to `=== 0` would
    // skip the hide call here, leaving the grid visible after the fade ended.
    const clearsBeforeHide = corners.clearCalls;
    advance(1000);
    updateSectorCorners(sectorGrid, sectors, camera);
    assertTrue(!grid.visible, "after fade window expires, grid is hidden");
    assertTrue(!sectorLabel.visible, "after fade window expires, label is hidden");
    assertEqual(sectorGrid.fadeState.lastFade, 0, "fade state resets to 0");
    assertEqual(corners.clearCalls, clearsBeforeHide + 1, "hide path clears corners exactly once");
  });
});

test("auto sector grid clears the corner graphics on every redraw", () => {
  const { corners, sectorGrid } = createFakeSectorGrid();
  const camera = createFakeCamera();

  updateSectorCorners(sectorGrid, sectors, camera);
  camera.scrollX = 24;
  updateSectorCorners(sectorGrid, sectors, camera);
  const clearsAfterFirstDraw = corners.clearCalls;
  // Pin drawAllSectorCorners' clear-before-draw step. Without the clear, stale
  // corner segments from previous frames would stack each redraw.
  assertTrue(clearsAfterFirstDraw > 0, "first visible draw clears corners");

  camera.scrollX = 48;
  updateSectorCorners(sectorGrid, sectors, camera);
  assertTrue(corners.clearCalls > clearsAfterFirstDraw, "subsequent redraws clear again");
});
