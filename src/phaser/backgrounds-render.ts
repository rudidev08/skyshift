import { type Scene } from "phaser";
import type { Nebula } from "../../data/map-types";
import { backgroundConfig } from "../../data/visuals-map-background";
import { Layer } from "./depth-layers";

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
import nebulaDust2Url from "../assets/backgrounds/nebula-dust2.png";
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
  ["nebula-dust2", nebulaDust2Url],
  ["nebula-overgrowth", nebulaOvergrowthUrl],
  ["dark-nebula-density-s", darkNebulaSUrl],
  ["dark-nebula-density-m", darkNebulaMUrl],
  ["dark-nebula-density-l", darkNebulaLUrl],
  ["dark-nebula-density-xl", darkNebulaXLUrl],
];

export function preloadBackgrounds(scene: Scene) {
  for (const [textureKey, url] of backgroundTextures) {
    scene.load.image(textureKey, url);
  }
}

export interface BackgroundLayers {
  starsFar: Phaser.GameObjects.TileSprite;
  starsNear: Phaser.GameObjects.TileSprite;
  nebulaImages: Phaser.GameObjects.Image[];
}

export function createBackgrounds(scene: Scene, nebulas: Nebula[]): BackgroundLayers {
  const width = scene.scale.width;
  const height = scene.scale.height;
  // Oversize the star tile so its edges stay outside the viewport at the
  // furthest zoom-out (cameraMinZoom is 0.2 in data/controls-camera.ts; 0.15
  // leaves headroom). Without this, zooming out reveals the tile boundary.
  const maxCover = 1 / 0.15;
  const tileScale = backgroundConfig.backgroundScale;

  const starsFar = scene.add.tileSprite(width / 2, height / 2, width * maxCover, height * maxCover, "stars-far")
    .setScrollFactor(0).setDepth(Layer.BackgroundStarsFar).setTileScale(tileScale, tileScale);
  const starsNear = scene.add.tileSprite(width / 2, height / 2, width * maxCover, height * maxCover, "stars-near")
    .setScrollFactor(0).setDepth(Layer.BackgroundStarsNear).setTileScale(tileScale, tileScale);

  const nebulaImages: Phaser.GameObjects.Image[] = [];
  for (const nebula of nebulas) {
    const depth = nebula.depth ?? (nebula.dark ? Layer.NebulaDark : Layer.NebulaLight);
    const image = scene.add.image(nebula.x, nebula.y, nebula.textureKey).setDepth(depth);
    if (nebula.rotationDegrees) image.setAngle(nebula.rotationDegrees);
    nebulaImages.push(image);
  }

  return { starsFar, starsNear, nebulaImages };
}

export function updateParallax(layers: BackgroundLayers, camera: Phaser.Cameras.Scene2D.Camera) {
  const centerX = camera.worldView.centerX;
  const centerY = camera.worldView.centerY;
  const tileScale = backgroundConfig.backgroundScale;
  // Divide by tileScale so the on-screen star drift matches the parallax
  // factor regardless of how the tile texture is upscaled — without it,
  // changing backgroundScale would silently change apparent scroll speed.
  layers.starsFar.tilePositionX = centerX * backgroundConfig.parallaxFar / tileScale;
  layers.starsFar.tilePositionY = centerY * backgroundConfig.parallaxFar / tileScale;
  layers.starsNear.tilePositionX = centerX * backgroundConfig.parallaxNear / tileScale;
  layers.starsNear.tilePositionY = centerY * backgroundConfig.parallaxNear / tileScale;
}
