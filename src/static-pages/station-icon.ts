/* Cached station-icon loader + drawer for the static sector page's 2D canvas.
 *
 * Holds an HTMLImageElement per (svg, color, scale) so drawImage can reuse
 * the decoded bitmap each frame. The sibling src/render-station-icon.ts
 * returns a plain data URI for <img src> use; that path can't share decoded
 * bitmaps across frames, so canvas drawing needs this cache instead.
 *
 * The image decodes asynchronously after src is set, so callers must check
 * image.complete before drawing — drawStationIcon does so. */

export interface StationIcon {
  image: HTMLImageElement;
  size: number;
}

const iconCache = new Map<string, HTMLImageElement>();

export function prepareStationIcon(svgInner: string, nationColor: string, scale: number): StationIcon {
  const key = `${svgInner}|${nationColor}|${scale}`;
  const size = Math.round(24 * scale);
  let image = iconCache.get(key);
  if (!image) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"` +
      ` fill="none" stroke="${nationColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
      svgInner +
      `</svg>`;
    image = new Image();
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    iconCache.set(key, image);
  }
  return { image, size };
}

export function drawStationIcon(
  context: CanvasRenderingContext2D,
  stationX: number,
  stationY: number,
  icon: StationIcon,
): void {
  if (!icon.image.complete) return;
  context.drawImage(icon.image, stationX - icon.size / 2, stationY - icon.size / 2, icon.size, icon.size);
}
