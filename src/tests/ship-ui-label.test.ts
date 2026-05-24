import type { Scene } from "phaser";
import { test, assertEqual } from "./test-utils.ts";
import { createShipUi, updateShipUi } from "../phaser/ship-ui.ts";
import { closeViewAlpha } from "../phaser/camera-fade.ts";
import type { Ship } from "../sim-ships.ts";

/** Chainable Phaser game-object stub recording the last alpha/visible it was
 *  given — enough for ship-ui's label + cargo ring + cargo label draws. */
function makePhaserObjectStub() {
  const stub = {
    alpha: 1,
    visible: false,
    setAlpha(value: number) {
      stub.alpha = value;
      return stub;
    },
    setVisible(value: boolean) {
      stub.visible = value;
      return stub;
    },
    setPosition() {
      return stub;
    },
    setOrigin() {
      return stub;
    },
    setResolution() {
      return stub;
    },
    setDepth() {
      return stub;
    },
    setText() {
      return stub;
    },
    clear() {
      return stub;
    },
    lineStyle() {
      return stub;
    },
    beginPath() {
      return stub;
    },
    arc() {
      return stub;
    },
    strokePath() {
      return stub;
    },
    destroy() {},
  };
  return stub;
}

function makeFakeScene(): Scene {
  return {
    add: {
      text: () => makePhaserObjectStub(),
      graphics: () => makePhaserObjectStub(),
    },
  } as unknown as Scene;
}

// shipCodeNameLabel reads only nation.codeName + shipName.
const fakeShip = {
  shipName: "Test 042",
  station: { nation: { codeName: "TST" } },
} as unknown as Ship;

test("ship label alpha tracks closeViewAlpha(frame.zoom) with no separate labelState input", () => {
  // Guard for item 11 — the label alpha is derived from frame.zoom, not read
  // from a threaded ShipRenderFrame.labelAlpha/labelVisible pair. The frame
  // literal below carries ONLY zoom/camera/timeSeconds/currentTick: under the OLD
  // shape ShipRenderFrame still required labelVisible/labelAlpha, so this
  // would not compile, and had a stale cached labelState been threaded the
  // OLD code would have shown that alpha instead of the zoom-derived one.
  const bundle = createShipUi(makeFakeScene(), fakeShip, 100);

  // 0.65 is mid fade band (0.6 → 0.7) so alpha is a partial value, not 0/1 —
  // distinguishes the zoom-derived path from a stale binary visibility flag.
  const zoom = 0.65;
  const expectedAlpha = closeViewAlpha(zoom);

  updateShipUi({
    shipUi: bundle,
    positionX: 0,
    positionY: 0,
    cargo: 0,
    wareName: null,
    selected: true,
    isShipInteractable: true,
    frame: {
      zoom,
      camera: {} as Phaser.Cameras.Scene2D.Camera,
      timeSeconds: 0,
      currentTick: 1,
    },
  });

  assertEqual(bundle.label.visible, expectedAlpha > 0, "label visible iff closeViewAlpha(zoom) > 0");
  assertEqual(bundle.label.alpha, expectedAlpha, "label alpha equals closeViewAlpha(zoom)");
});

test("ship label is hidden when zoom is below the close-view fade start (alpha = 0)", () => {
  // Pin the strict `> 0` predicate. zoom = 0.4 sits below closeViewFadeStart
  // (0.6) so closeViewAlpha returns exactly 0; the label must be hidden, not
  // shown-with-alpha-0. A mutation that loosens `> 0` to `>= 0` would set
  // visible = true here and slip past the mid-band assertion above.
  const bundle = createShipUi(makeFakeScene(), fakeShip, 100);

  updateShipUi({
    shipUi: bundle,
    positionX: 0,
    positionY: 0,
    cargo: 0,
    wareName: null,
    selected: true,
    isShipInteractable: true,
    frame: {
      zoom: 0.4,
      camera: {} as Phaser.Cameras.Scene2D.Camera,
      timeSeconds: 0,
      currentTick: 1,
    },
  });

  assertEqual(bundle.label.visible, false, "label hidden when zoomed out below the fade start");
});
