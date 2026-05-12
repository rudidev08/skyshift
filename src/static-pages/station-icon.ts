/* 2D canvas station-icon loader + drawer for the sector scene.
 *
 * Keep in sync with src/render-station-icon.ts — same Lucide SVG wrapped with
 * a nation stroke; that one returns a data URI (for <img src>), this one
 * preloads an HTMLImageElement so drawImage doesn't re-decode each frame. */

export interface StationIcon {
  image: HTMLImageElement;
  size: number;
}

const iconCache = new Map<string, HTMLImageElement>();

export function preloadStationIcon(
  svgInner: string,
  nationColor: string,
  scale: number,
): StationIcon {
  const key = `${svgInner}|${nationColor}|${scale}`;
  const size = Math.round(24 * scale);
  let image = iconCache.get(key);
  if (!image) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"` +
      ` fill="none" stroke="${nationColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
      svgInner + `</svg>`;
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
