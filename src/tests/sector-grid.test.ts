import type { Sector } from "../sim-map-types.ts";
import { createSectorGrid, resetAutoSectorGridState, updateSectorCorners, type SectorGridSystem } from "../phaser/sector-grid.ts";
import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { makeSector } from "./factories.ts";

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

function createFakeSectorGridSystem(): {
  corners: FakeGraphics;
  grid: FakeGraphics;
  gridSystem: SectorGridSystem;
  sectorLabel: FakeText;
} {
  const grid = new FakeGraphics();
  const corners = new FakeGraphics();
  const sectorLabel = new FakeText();
  return {
    corners,
    grid,
    gridSystem: {
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

function buildFakeScene(): Phaser.Scene {
  const graphics = () => ({
    setDepth() { return graphics(); },
    setVisible() { return graphics(); },
    setAlpha() { return graphics(); },
    clear() { return graphics(); },
    lineStyle() { return graphics(); },
    moveTo() { return graphics(); },
    lineTo() { return graphics(); },
    strokePath() { return graphics(); },
    depth: 0,
  });
  const text = () => ({
    setOrigin() { return text(); },
    setDepth() { return text(); },
    setLineSpacing() { return text(); },
    setVisible() { return text(); },
    setAlpha() { return text(); },
  });
  return {
    add: {
      graphics: () => graphics(),
      text: () => text(),
    },
  } as unknown as Phaser.Scene;
}

function withFakeLocalStorage(run: () => void): void {
  const globalObject = globalThis as unknown as { localStorage?: unknown };
  const previous = globalObject.localStorage;
  const store = new Map<string, string>();
  globalObject.localStorage = {
    getItem(key: string): string | null { return store.get(key) ?? null; },
    setItem(key: string, value: string): void { store.set(key, value); },
    removeItem(key: string): void { store.delete(key); },
    clear(): void { store.clear(); },
  };
  try { run(); }
  finally {
    if (previous === undefined) Reflect.deleteProperty(globalObject, "localStorage");
    else globalObject.localStorage = previous;
  }
}

test("createSectorGrid parses persisted invalid gridMode strings back to 'auto'", () => {
  withFakeLocalStorage(() => {
    // Plant a corrupt persisted value so parseGridMode hits the fallback branch.
    (globalThis as unknown as { localStorage: Storage }).localStorage.setItem("sectorGridMode", "garbage");
    // Pin parseGridMode's fallback. Mutating `: "auto"` to any other mode would
    // surface the corrupt-value branch's choice — e.g. "off" would silently
    // hide the grid for users with stale localStorage from older builds.
    const gridSystem = createSectorGrid(
      buildFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
    );
    assertEqual(gridSystem.gridMode, "auto", "invalid persisted mode falls back to auto");
  });
});

test("createSectorGrid persists setMode to localStorage by default (persistMode omitted)", () => {
  withFakeLocalStorage(() => {
    // Pin the persistMode default. Mutating `options.persistMode ?? true` to
    // `?? false` would skip the saveKeyValueSetting call and leave localStorage
    // empty after setMode.
    const gridSystem = createSectorGrid(
      buildFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "auto" },
    );
    gridSystem.setMode("on");
    const stored = (globalThis as unknown as { localStorage: Storage }).localStorage.getItem("sectorGridMode");
    assertEqual(stored, "on", "setMode persists the mode by default");
  });
});

test("createSectorGrid setMode emits to subscribers and is idempotent for the same mode", () => {
  withFakeLocalStorage(() => {
    const gridSystem = createSectorGrid(
      buildFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "auto", persistMode: false },
    );

    const observed: string[] = [];
    const unsubscribe = gridSystem.onModeChange((mode) => observed.push(mode));

    gridSystem.setMode("on");
    gridSystem.setMode("on"); // Pin idempotency: same mode must not re-emit.
    gridSystem.setMode("off");
    unsubscribe();
    gridSystem.setMode("auto"); // Pin unsubscribe: detached listener must not fire.

    assertEqual(observed.length, 2, "setMode emits exactly once per real change, never on no-op");
    assertEqual(observed[0], "on", "first emission is the on-mode flip");
    assertEqual(observed[1], "off", "second emission is the off-mode flip");
    assertEqual(gridSystem.gridMode, "auto", "later setMode still updates gridMode after unsubscribe");
  });
});

test("createSectorGrid setMode auto path resets the auto-fade state", () => {
  withFakeLocalStorage(() => {
    const gridSystem = createSectorGrid(
      buildFakeScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "on", persistMode: false },
    );
    // Plant non-sentinel fade state so we can detect the reset.
    gridSystem.fadeState.lastScrollTime = 9999;
    gridSystem.fadeState.scrollTracked = true;
    gridSystem.fadeState.lastFade = 0.5;

    // Pin the auto-mode dispatch branch. Mutating `if (mode === "off")` to
    // `if (mode === "auto")` would route the auto-mode call into the off-only
    // hide path, skipping resetAutoSectorGridState — lastScrollTime would stay
    // at 9999 instead of being restored to the -1 sentinel.
    gridSystem.setMode("auto");
    assertEqual(gridSystem.fadeState.lastScrollTime, -1, "auto mode resets lastScrollTime to the sentinel");
    assertEqual(gridSystem.fadeState.lastFade, 0, "auto mode resets lastFade to 0");
  });
});

test("createSectorGrid setMode 'on' shows the grid + labels at full alpha", () => {
  withFakeLocalStorage(() => {
    // Build a Phaser scene whose graphics + text objects track visible/alpha
    // so we can observe on-mode side effects on the actual grid + label objects.
    type TrackedGraphics = Phaser.GameObjects.Graphics & { _visible: boolean; _alpha: number };
    type TrackedText = Phaser.GameObjects.Text & { _visible: boolean; _alpha: number };
    const buildTrackedScene = (): Phaser.Scene => {
      type GraphicsStub = {
        _visible: boolean;
        _alpha: number;
        depth: number;
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
      const makeGraphics = (): GraphicsStub => {
        const g: GraphicsStub = {
          _visible: true,
          _alpha: 1,
          depth: 0,
          setDepth() { return g; },
          setVisible(value: boolean) { g._visible = value; return g; },
          setAlpha(value: number) { g._alpha = value; return g; },
          clear() { return g; },
          lineStyle() { return g; },
          moveTo() { return g; },
          lineTo() { return g; },
          strokePath() { return g; },
        };
        return g;
      };
      const makeText = (): TextStub => {
        const t: TextStub = {
          _visible: true,
          _alpha: 1,
          setOrigin() { return t; },
          setDepth() { return t; },
          setLineSpacing() { return t; },
          setVisible(value: boolean) { t._visible = value; return t; },
          setAlpha(value: number) { t._alpha = value; return t; },
        };
        return t;
      };
      return {
        add: { graphics: makeGraphics, text: makeText },
      } as unknown as Phaser.Scene;
    };

    const gridSystem = createSectorGrid(
      buildTrackedScene(),
      sectors,
      { gridSizeX: 1, gridSizeY: 1, sectorSize: 200 },
      { initialMode: "off", persistMode: false },
    );

    // Pre-condition: off mode left grid hidden.
    assertTrue(!(gridSystem.grid as unknown as TrackedGraphics)._visible, "off mode hides the grid");

    // Pin the on-mode visibility flip. Mutating `if (mode === "on")` to
    // `if (mode === "off")` would route on-mode through the off-mode hide path
    // and leave grid + labels hidden.
    gridSystem.setMode("on");
    assertTrue((gridSystem.grid as unknown as TrackedGraphics)._visible, "on mode reveals the grid");
    assertEqual((gridSystem.grid as unknown as TrackedGraphics)._alpha, 1, "on mode pins grid alpha to 1");
    for (const label of gridSystem.sectorLabels) {
      assertTrue((label as unknown as TrackedText)._visible, "on mode reveals each sector label");
      assertEqual((label as unknown as TrackedText)._alpha, 1, "on mode pins each label alpha to 1");
    }
  });
});

test("auto sector grid keeps the initial frame hidden until the camera moves", () => {
  const { gridSystem, grid, sectorLabel } = createFakeSectorGridSystem();

  updateSectorCorners(gridSystem, sectors, createFakeCamera());

  assertTrue(gridSystem.fadeState.scrollTracked, "initial frame tracks the current camera position");
  assertEqual(gridSystem.fadeState.lastScrollTime, -1, "initial frame does not count as a scroll");
  assertTrue(!grid.visible, "grid remains hidden before the first movement");
  assertTrue(!sectorLabel.visible, "sector label remains hidden before the first movement");
});

test("resetAutoSectorGridState clears visible auto-grid visuals until movement resumes", () => {
  const { corners, gridSystem, grid, sectorLabel } = createFakeSectorGridSystem();
  grid.setVisible(true);
  sectorLabel.setVisible(true);
  gridSystem.fadeState.lastFade = 1;
  // Fixed sentinel — performance.now() would make this clock-sensitive
  // (slow CI, paused scheduler) for no behavioural reason.
  gridSystem.fadeState.lastScrollTime = 1000;
  gridSystem.fadeState.scrollTracked = true;

  resetAutoSectorGridState(gridSystem);

  assertEqual(gridSystem.fadeState.lastFade, 0, "reset clears the last fade state");
  assertEqual(gridSystem.fadeState.lastScrollTime, -1, "reset forgets the last scroll time");
  assertTrue(!grid.visible, "reset hides the grid immediately");
  assertTrue(!sectorLabel.visible, "reset hides labels immediately");
  assertTrue(corners.clearCalls > 0, "reset clears the corner graphics");
});

test("auto sector grid becomes visible after a real camera movement", () => {
  const { gridSystem, grid, sectorLabel } = createFakeSectorGridSystem();
  const camera = createFakeCamera();

  updateSectorCorners(gridSystem, sectors, camera);
  camera.scrollX = 24;
  camera.scrollY = 17;
  updateSectorCorners(gridSystem, sectors, camera);

  assertTrue(grid.visible, "grid becomes visible after movement");
  assertEqual(grid.alpha, 1, "new movement starts at full opacity");
  assertTrue(sectorLabel.visible, "sector labels become visible after movement");
  assertTrue(gridSystem.fadeState.lastScrollTime >= 0, "movement stores a scroll timestamp");
  // Asymmetric values catch any X/Y swap in the scroll-tracking assignment.
  assertEqual(gridSystem.fadeState.lastScrollX, 24, "lastScrollX mirrors camera.scrollX");
  assertEqual(gridSystem.fadeState.lastScrollY, 17, "lastScrollY mirrors camera.scrollY");
});

test("auto sector grid registers x-only camera movement", () => {
  const { gridSystem, grid } = createFakeSectorGridSystem();
  const camera = createFakeCamera();

  updateSectorCorners(gridSystem, sectors, camera);
  // Move only on X — Y stays at the baseline so the OR-tracker is exercised.
  camera.scrollX = 24;
  updateSectorCorners(gridSystem, sectors, camera);

  assertTrue(grid.visible, "x-only movement still wakes the grid");
  assertTrue(gridSystem.fadeState.lastScrollTime >= 0, "x-only movement updates lastScrollTime");
  assertEqual(gridSystem.fadeState.lastScrollX, 24, "x-only movement updates lastScrollX");
});

test("auto sector grid registers y-only camera movement", () => {
  const { gridSystem, grid } = createFakeSectorGridSystem();
  const camera = createFakeCamera();

  updateSectorCorners(gridSystem, sectors, camera);
  // Move only on Y — X stays at the baseline so the OR-tracker is exercised.
  camera.scrollY = 17;
  updateSectorCorners(gridSystem, sectors, camera);

  assertTrue(grid.visible, "y-only movement still wakes the grid");
  assertTrue(gridSystem.fadeState.lastScrollTime >= 0, "y-only movement updates lastScrollTime");
  assertEqual(gridSystem.fadeState.lastScrollY, 17, "y-only movement updates lastScrollY");
});

test("off mode short-circuits before drawing corners", () => {
  const { corners, gridSystem, grid } = createFakeSectorGridSystem();
  gridSystem.gridMode = "off";

  updateSectorCorners(gridSystem, sectors, createFakeCamera(50, 50));

  // Pin the off-mode early return. Mutating "off" → "on" or removing the early
  // return would draw corners (clearCalls > 0) and force grid visible.
  assertEqual(corners.clearCalls, 0, "off-mode skips drawAllSectorCorners");
  assertTrue(!grid.visible, "off-mode never reveals the grid");
});

test("on mode pins fade at 1 and redraws corners every frame", () => {
  const { corners, gridSystem } = createFakeSectorGridSystem();
  gridSystem.gridMode = "on";

  updateSectorCorners(gridSystem, sectors, createFakeCamera());

  // Pin the on-mode branch. Swapping the on/off check or dropping the
  // lastFade=1 + drawAllSectorCorners pair would skip the redraw and leave
  // lastFade at 0.
  assertEqual(gridSystem.fadeState.lastFade, 1, "on-mode records fade=1");
  assertTrue(corners.clearCalls > 0, "on-mode redraws corners (clear precedes strokePath)");
});

function withFakePerformanceNow(run: (advance: (deltaMilliseconds: number) => void) => void): void {
  const originalNow = performance.now.bind(performance);
  let fakeTime = 1_000_000;
  performance.now = () => fakeTime;
  try {
    run((delta) => {
      fakeTime += delta;
    });
  } finally {
    performance.now = originalNow;
  }
}

test("auto sector grid fades from full opacity to hidden over the configured fade window", () => {
  withFakePerformanceNow((advance) => {
    const { corners, gridSystem, grid, sectorLabel } = createFakeSectorGridSystem();
    const camera = createFakeCamera();

    // Frame 1: baseline. Frame 2: real movement, fade should be 1.
    updateSectorCorners(gridSystem, sectors, camera);
    advance(16);
    camera.scrollX = 50;
    updateSectorCorners(gridSystem, sectors, camera);
    assertEqual(grid.alpha, 1, "fresh movement holds full opacity");

    // Quarter into the fade-out window — alpha should drop from 1 toward 0.
    // 3000ms FADE_DELAY + 187ms (250ms / 750ms = 0.25 of FADE_DURATION) gives expected ~0.75.
    // Pin the fade-window second branch. Mutating `elapsed < FADE_DELAY + FADE_DURATION`
    // to `>` would skip this branch and fall straight into the hide path, leaving alpha=1.
    // Pin the fade direction. Mutating `1 - (elapsed - FADE_DELAY) / FADE_DURATION` to
    // drop the `1 -` would invert the fade — alpha=0.25 at 25% would mean fade-IN, not fade-OUT.
    advance(3000 + 187);
    updateSectorCorners(gridSystem, sectors, camera);
    assertTrue(grid.alpha > 0.5 && grid.alpha < 1, "quarter into fade-out, alpha closer to 1 than 0");
    assertTrue(grid.visible, "quarter into fade, grid still visible");

    // Past the fade-out window — grid hidden, lastFade reset to 0.
    // Pin the post-fade hide-once guard. Mutating `lastFade !== 0` to `=== 0` would
    // skip the hide call here, leaving the grid visible after the fade ended.
    const clearsBeforeHide = corners.clearCalls;
    advance(1000);
    updateSectorCorners(gridSystem, sectors, camera);
    assertTrue(!grid.visible, "after fade window expires, grid is hidden");
    assertTrue(!sectorLabel.visible, "after fade window expires, label is hidden");
    assertEqual(gridSystem.fadeState.lastFade, 0, "fade state resets to 0");
    assertEqual(corners.clearCalls, clearsBeforeHide + 1, "hide path clears corners exactly once");
  });
});

test("auto sector grid clears the corner graphics on every redraw", () => {
  const { corners, gridSystem } = createFakeSectorGridSystem();
  const camera = createFakeCamera();

  updateSectorCorners(gridSystem, sectors, camera);
  camera.scrollX = 24;
  updateSectorCorners(gridSystem, sectors, camera);
  const clearsAfterFirstDraw = corners.clearCalls;
  // Pin drawAllSectorCorners' clear-before-draw step. Without the clear, stale
  // corner segments from previous frames would stack each redraw.
  assertTrue(clearsAfterFirstDraw > 0, "first visible draw clears corners");

  camera.scrollX = 48;
  updateSectorCorners(gridSystem, sectors, camera);
  assertTrue(corners.clearCalls > clearsAfterFirstDraw, "subsequent redraws clear again");
});
