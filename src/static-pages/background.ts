/* Star + dark-nebula background for static pages (index, help). Tiles the
 * game's starfield PNGs at 1:1 and dims them under dark nebulas — gives
 * every "outside the game" page a consistent backdrop. */

import { PIXEL_RATIO } from "./device";

const ASSET_ROOT = "/index/";

/** Position/size of one dark-nebula overlay; xRatio/yRatio are 0-1 fractions of viewport. */
interface DarkNebula {
  xRatio: number;
  yRatio: number;
  scale: number;
  alpha: number;
}

const DARK_NEBULAS: DarkNebula[] = [
  { xRatio: 0.05, yRatio: 0.15, scale: 0.35, alpha: 0.5 },
  { xRatio: 0.9, yRatio: 0.8, scale: 0.3, alpha: 0.4 },
  { xRatio: 0.55, yRatio: 0.9, scale: 0.28, alpha: 0.35 },
];

/** One tiled starfield layer: the bitmap, its blend opacity, and the offset jitters that break up the visible tile-seam grid. */
interface StarLayer {
  image: HTMLImageElement;
  alpha: number;
  offsets: Array<[number, number]>;
}

const STARS_FAR_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [300, 500],
  [700, 200],
  [150, 750],
];
const STARS_NEAR_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [400, 300],
  [100, 600],
];

/** Resolves `name` against `/index/`; fires `onload` when the bitmap is decoded. */
function loadImage(name: string, onload: () => void): HTMLImageElement {
  const image = new Image();
  image.onload = onload;
  image.src = ASSET_ROOT + name;
  return image;
}

export function mountPageBackground(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d")!;

  const draw = () => drawBackground(context, farLayer, nearLayer);
  const farLayer: StarLayer = {
    image: loadImage("stars-far.png", () => draw()),
    alpha: 0.7,
    offsets: STARS_FAR_OFFSETS,
  };
  const nearLayer: StarLayer = {
    image: loadImage("stars-near.png", () => draw()),
    alpha: 0.85,
    offsets: STARS_NEAR_OFFSETS,
  };

  setupCanvasViewportSync(canvas, context, draw);
  draw();
}

function setupCanvasViewportSync(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  draw: () => void,
): void {
  function resize() {
    canvas.width = innerWidth * PIXEL_RATIO;
    canvas.height = innerHeight * PIXEL_RATIO;
    context.setTransform(PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0);
  }
  resize();
  window.addEventListener("resize", () => {
    resize();
    draw();
  });
}

function drawDarkNebula(
  context: CanvasRenderingContext2D,
  nebula: DarkNebula,
  width: number,
  height: number,
): void {
  context.save();
  context.globalCompositeOperation = "multiply";
  context.globalAlpha = nebula.alpha;
  const centerX = nebula.xRatio * width;
  const centerY = nebula.yRatio * height;
  const radius = Math.max(width, height) * nebula.scale;
  const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, "#0a0a10");
  gradient.addColorStop(0.6, "#1a1a24");
  gradient.addColorStop(1, "#ffffff");
  context.fillStyle = gradient;
  context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  context.restore();
}

function drawBackground(context: CanvasRenderingContext2D, farLayer: StarLayer, nearLayer: StarLayer): void {
  const width = innerWidth,
    height = innerHeight;
  context.globalAlpha = 1;
  context.fillStyle = "#050709";
  context.fillRect(0, 0, width, height);

  tileStarLayer(context, farLayer);
  tileStarLayer(context, nearLayer);
  context.globalAlpha = 1;

  for (const nebula of DARK_NEBULAS) {
    drawDarkNebula(context, nebula, width, height);
  }
}

function tileStarLayer(context: CanvasRenderingContext2D, layer: StarLayer): void {
  const { image, alpha, offsets } = layer;
  if (!image.complete || !image.naturalWidth) return;
  context.globalAlpha = alpha;
  context.imageSmoothingEnabled = false;
  const tileWidth = image.naturalWidth;
  const tileHeight = image.naturalHeight;
  const width = innerWidth,
    height = innerHeight;
  for (const [offsetX, offsetY] of offsets) {
    for (let y = -tileHeight + offsetY; y < height + tileHeight; y += tileHeight) {
      for (let x = -tileWidth + offsetX; x < width + tileWidth; x += tileWidth) {
        context.drawImage(image, x, y, tileWidth, tileHeight);
      }
    }
  }
}
