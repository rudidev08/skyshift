/** Returns the inner shape markup from a Lucide SVG so callers can re-wrap it
 *  in their own sized/stroked `<svg>`. Trimming and recoloring are left to the
 *  caller. */
export function stripLucideSvgWrapper(rawSvg: string): string {
  const openTagEnd = rawSvg.indexOf(">");
  const closeTagStart = rawSvg.lastIndexOf("</svg>");
  return rawSvg.substring(openTagEnd + 1, closeTagStart);
}
