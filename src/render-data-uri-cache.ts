/** Caches data-URI strings keyed by caller-chosen descriptive ids (e.g. "hud-ship-seedhaul"); callers own key uniqueness, since the cache only sees opaque strings. */

const cache = new Map<string, string>();

/** Encodes raw SVG markup as a `data:image/svg+xml,…` URI suitable for `<img src>` or Phaser texture loaders. */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function getCachedDataUri(key: string, build: () => string): string {
  const cached = cache.get(key);
  if (cached) return cached;
  const dataUri = build();
  cache.set(key, dataUri);
  return dataUri;
}
