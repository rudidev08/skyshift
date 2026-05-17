import {
  Stone,
  AudioLines,
  Droplet,
  Apple,
  Pill,
  Hammer,
  Container,
  VectorSquare,
  Bed,
  Wrench,
  Compass,
} from "lucide-static";
import type { StationTypeId } from "../data/station-types";

export const iconSvgByStationType: Record<StationTypeId, string> = {
  "mine": Stone,
  "observatory": AudioLines,
  "water-processing": Droplet,
  "farm": Apple,
  "medical-lab": Pill,
  "metal-forge": Hammer,
  "tech-factory": Container,
  "archives": VectorSquare,
  "habitat": Bed,
  "shipyard": Wrench,
  "generational-ship": Compass,
};

/** Strip the outer `<svg>` wrapper from a Lucide raw SVG and recolor `currentColor` to the nation color. */
function extractLucideInner(rawSvg: string, nationColor: string): string {
  const openTagEnd = rawSvg.indexOf(">");
  const closeTagStart = rawSvg.lastIndexOf("</svg>");
  return rawSvg.substring(openTagEnd + 1, closeTagStart).replace(/currentColor/g, nationColor);
}

export function stationIconDataUri(stationTypeId: StationTypeId, nationColor: string, size: number): string {
  const innerContent = extractLucideInner(iconSvgByStationType[stationTypeId], nationColor);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"`,
    ` fill="none" stroke="${nationColor}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">`,
    innerContent,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
