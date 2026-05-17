/* Nebula PNG loader + additive compositor for static-page sector scenes.
 * Uses canvas "lighter" so nebulas glow over the starfield instead of
 * darkening it. Cache shares one HTMLImageElement per src across canvases. */

export interface SectorNebula {
  src: string;
  xRatio: number;
  yRatio: number;
  /** Fraction of `min(canvasWidth, canvasHeight)` — drawn at that pixel size. */
  sizeFraction: number;
  alpha: number;
  rotationDegrees?: number;
}

const imageCache = new Map<string, HTMLImageElement>();

/** Returns a cached HTMLImageElement per src; the first call kicks off the network load and later callers share the in-flight or completed image. */
export function loadNebulaImage(src: string): HTMLImageElement {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.src = src;
  imageCache.set(src, image);
  return image;
}

/** One nebula draw request: where to paint, how big, and the loaded image to composite. */
export interface NebulaDrawRequest {
  nebula: SectorNebula;
  image: HTMLImageElement;
  canvasWidth: number;
  canvasHeight: number;
}

/** Composites a nebula onto the canvas with additive blending; bails out if the image hasn't finished loading. */
export function drawNebula(context: CanvasRenderingContext2D, request: NebulaDrawRequest): void {
  const { nebula, image, canvasWidth, canvasHeight } = request;
  // Image not loaded yet — skip this frame; a later draw call will paint it once decoded.
  if (!image.complete || !image.naturalWidth) return;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = nebula.alpha;
  const size = Math.min(canvasWidth, canvasHeight) * nebula.sizeFraction;
  context.translate(nebula.xRatio * canvasWidth, nebula.yRatio * canvasHeight);
  if (nebula.rotationDegrees) context.rotate((nebula.rotationDegrees * Math.PI) / 180);
  context.drawImage(image, -size / 2, -size / 2, size, size);
  context.restore();
}
