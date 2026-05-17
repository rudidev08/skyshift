import type { Scene } from "phaser";
import { test, assertEqual } from "./test-utils.ts";
import { makeStation } from "./factories.ts";
import { createStationVisualBundle } from "../phaser/station-visual-bundle.ts";
import { Layer } from "../../data/visuals-layers.ts";
import type { Selection } from "../phaser/selection-input.ts";

// Regression guard for the "nebula renders on top of the station" bug:
// every Phaser surface that makes up the visible station body must be placed
// on its `Layer` depth. Left at Phaser's default depth 0, the body sits below
// nebulas (NebulaOvergrowth=3, NebulaDark=4, NebulaLight=5) and even the
// starfield — so dark nebulas visibly dimmed stations parked under them.

/** Chainable Phaser game-object stub that records the last `setDepth` value. */
function makeDepthStub() {
  const stub = {
    depth: 0,
    setDepth(value: number) {
      stub.depth = value;
      return stub;
    },
    setData() {
      return stub;
    },
    setScale() {
      return stub;
    },
    setTint() {
      return stub;
    },
    setAlpha() {
      return stub;
    },
    setVisible() {
      return stub;
    },
    setAngle() {
      return stub;
    },
    setOrigin() {
      return stub;
    },
    setResolution() {
      return stub;
    },
    destroy() {},
  };
  return stub;
}

/** Canvas 2D context stub — the station-base/overlay/ring draws only need
 *  path calls that do nothing plus a gradient factory. */
function makeContextStub() {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
}

function makeFakeScene(): Scene {
  const canvas = { getContext: () => makeContextStub(), refresh() {} };
  return {
    textures: {
      createCanvas: () => canvas,
      exists: () => false,
      remove() {},
    },
    add: {
      image: () => makeDepthStub(),
      text: () => makeDepthStub(),
      graphics: () => makeDepthStub(),
    },
  } as unknown as Scene;
}

const noopSelection = {
  register() {},
  unregister() {},
} as unknown as Selection;

test("createStationVisualBundle places every station-body surface on its Layer depth", () => {
  const station = makeStation();
  const bundle = createStationVisualBundle(makeFakeScene(), station, noopSelection);

  // The four surfaces this bug left at default depth 0.
  assertEqual(bundle.baseImage.depth, Layer.StationBase, "black disc + atmosphere ring");
  assertEqual(bundle.overlayImage.depth, Layer.StationBase, "gradient sphere");
  assertEqual(bundle.iconImage.depth, Layer.StationBase, "station-type icon");
  assertEqual(bundle.nameLabel.depth, Layer.StationLabel, "station name label");

  // The two surfaces that were already correct — guard against a "fix" that
  // moves these instead of raising the body.
  assertEqual(bundle.graphics.depth, Layer.StationBase, "inventory segment graphics");
  assertEqual(bundle.ringImage.depth, Layer.StationBase, "inventory ring image");
});
