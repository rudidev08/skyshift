import { type Scene } from "phaser";
import type { Nebula } from "../../data/map-types";
import { backgroundConfig } from "../../data/visuals-map-background";
import { starfieldOversizeZoomFloor } from "../../data/controls-camera";
import { Layer } from "../../data/visuals-layers";

import starsFarUrl from "../assets/backgrounds/stars-far.png";
import starsNearUrl from "../assets/backgrounds/stars-near.png";
import nebulaCoreUrl from "../assets/backgrounds/nebula-core.png";
import nebulaSkyshiftUrl from "../assets/backgrounds/nebula-skyshift.png";
import nebulaMiningUrl from "../assets/backgrounds/nebula-mining.png";
import nebulaOminous1Url from "../assets/backgrounds/nebula-ominous1.png";
import nebulaOminous2Url from "../assets/backgrounds/nebula-ominous2.png";
import nebulaOminous3Url from "../assets/backgrounds/nebula-ominous3.png";
import nebulaVoid1Url from "../assets/backgrounds/nebula-void1.png";
import nebulaVoid2Url from "../assets/backgrounds/nebula-void2.png";
import nebulaPurple1Url from "../assets/backgrounds/nebula-purple1.png";
import nebulaPurple2Url from "../assets/backgrounds/nebula-purple2.png";
import nebulaDust1Url from "../assets/backgrounds/nebula-dust1.png";
import nebulaOvergrowthUrl from "../assets/backgrounds/nebula-overgrowth.png";
import darkNebulaSUrl from "../assets/backgrounds/dark-nebula-density-s.png";
import darkNebulaMUrl from "../assets/backgrounds/dark-nebula-density-m.png";
import darkNebulaLUrl from "../assets/backgrounds/dark-nebula-density-l.png";
import darkNebulaXLUrl from "../assets/backgrounds/dark-nebula-density-xl.png";

const backgroundTextures: ReadonlyArray<readonly [string, string]> = [
  ["stars-far", starsFarUrl],
  ["stars-near", starsNearUrl],
  ["nebula-core", nebulaCoreUrl],
  ["nebula-skyshift", nebulaSkyshiftUrl],
  ["nebula-mining", nebulaMiningUrl],
  ["nebula-ominous1", nebulaOminous1Url],
  ["nebula-ominous2", nebulaOminous2Url],
  ["nebula-ominous3", nebulaOminous3Url],
  ["nebula-void1", nebulaVoid1Url],
  ["nebula-void2", nebulaVoid2Url],
  ["nebula-purple1", nebulaPurple1Url],
  ["nebula-purple2", nebulaPurple2Url],
  ["nebula-dust1", nebulaDust1Url],
  ["nebula-overgrowth", nebulaOvergrowthUrl],
  ["dark-nebula-density-s", darkNebulaSUrl],
  ["dark-nebula-density-m", darkNebulaMUrl],
  ["dark-nebula-density-l", darkNebulaLUrl],
  ["dark-nebula-density-xl", darkNebulaXLUrl],
];

export function preloadBackgrounds(scene: Scene) {
  for (const [textureKey, url] of backgroundTextures) scene.load.image(textureKey, url);
}

export interface BackgroundVisualBundle {
  starsFar: Phaser.GameObjects.TileSprite;
  starsNear: Phaser.GameObjects.TileSprite;
  nebulaImages: Phaser.GameObjects.Image[];
}

/** Center the star tile on the canvas, oversized so its edges stay outside the
 *  viewport at the furthest zoom-out — without the oversize, zooming out
 *  reveals the tile boundary. Runs at create and again on every canvas resize. */
function coverCanvasWithStarLayer(scene: Scene, starLayer: Phaser.GameObjects.TileSprite): void {
  const maxCover = 1 / starfieldOversizeZoomFloor;
  starLayer.setPosition(scene.scale.width / 2, scene.scale.height / 2);
  starLayer.setSize(scene.scale.width * maxCover, scene.scale.height * maxCover);
}

function createParallaxStarLayer(
  scene: Scene,
  textureKey: string,
  layer: (typeof Layer)[keyof typeof Layer],
): Phaser.GameObjects.TileSprite {
  const tileScale = backgroundConfig.tileScale;
  const starLayer = scene.add
    .tileSprite(0, 0, 1, 1, textureKey)
    .setScrollFactor(0)
    .setDepth(layer)
    .setTileScale(tileScale, tileScale);
  coverCanvasWithStarLayer(scene, starLayer);
  return starLayer;
}

function createStarfieldTileSprites(scene: Scene): {
  starsFar: Phaser.GameObjects.TileSprite;
  starsNear: Phaser.GameObjects.TileSprite;
} {
  const starsFar = createParallaxStarLayer(scene, "stars-far", Layer.BackgroundStarsFar);
  const starsNear = createParallaxStarLayer(scene, "stars-near", Layer.BackgroundStarsNear);

  // Scale.RESIZE mode grows the canvas with the window — re-cover it, or a
  // window grown past its creation size shows the tile edges at far zoom-out.
  const onResize = () => {
    coverCanvasWithStarLayer(scene, starsFar);
    coverCanvasWithStarLayer(scene, starsNear);
  };
  scene.scale.on("resize", onResize);
  const detachResize = () => scene.scale.off("resize", onResize);
  scene.events.once("shutdown", detachResize);
  scene.events.once("destroy", detachResize);

  return { starsFar, starsNear };
}

function createNebulaImages(scene: Scene, nebulas: Nebula[]): Phaser.GameObjects.Image[] {
  const nebulaImages: Phaser.GameObjects.Image[] = [];
  for (const nebula of nebulas) {
    const image = scene.add.image(nebula.x, nebula.y, nebula.textureKey).setDepth(Layer[nebula.layer]);
    if (nebula.rotationDegrees) image.setAngle(nebula.rotationDegrees);
    nebulaImages.push(image);
  }
  return nebulaImages;
}

export function createBackgroundVisualBundle(scene: Scene, nebulas: Nebula[]): BackgroundVisualBundle {
  const { starsFar, starsNear } = createStarfieldTileSprites(scene);
  const nebulaImages = createNebulaImages(scene, nebulas);
  return { starsFar, starsNear, nebulaImages };
}

export function updateParallax(layers: BackgroundVisualBundle, camera: Phaser.Cameras.Scene2D.Camera) {
  const centerX = camera.worldView.centerX;
  const centerY = camera.worldView.centerY;
  const tileScale = backgroundConfig.tileScale;
  // Divide by tileScale so the on-screen star drift matches the parallax
  // factor regardless of how the tile texture is upscaled — without it,
  // changing tileScale would silently change apparent scroll speed.
  layers.starsFar.tilePositionX = (centerX * backgroundConfig.parallaxFar) / tileScale;
  layers.starsFar.tilePositionY = (centerY * backgroundConfig.parallaxFar) / tileScale;
  layers.starsNear.tilePositionX = (centerX * backgroundConfig.parallaxNear) / tileScale;
  layers.starsNear.tilePositionY = (centerY * backgroundConfig.parallaxNear) / tileScale;
}
